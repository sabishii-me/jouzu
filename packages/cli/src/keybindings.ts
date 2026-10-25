import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
	CatalogMessageId,
	type CatalogMessageRef,
	type CatalogRenderOptions,
	catalogMessage,
	catalogMessageText,
	catalogText,
	defaultCatalog,
} from "./cli-messages.js";
import { CommandReport, type CommandReportEntry } from "./command-report.js";
import { protectedSourceError } from "./human-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import type { JouzuPaths } from "./paths.js";
import { copyPrivateFile, validatePrivateDirectory, writeFilePrivateAtomic } from "./private-fs.js";
import { acquireStateLock, STATE_LOCK_STALE_MS } from "./state-lock.js";

export type KeyBindingValue = string | string[];

/**
 * The catalog IDs this module renders. They stay local rather than joining the
 * shared `CatalogMessageId` table so a parallel surface migration does not
 * conflict on that file; `scripts/check-locales.mjs` allows a catalog-only ID
 * present in both locales.
 */
const KEYBINDING_TEXT_IDS = {
	actionConflictDetail: "jouzu.cli.keybindings.action.conflictDetail",
	actionCurrentDetail: "jouzu.cli.keybindings.action.currentDetail",
	lockBusy: "jouzu.cli.keybindings.lockBusy",
} as const;

/**
 * The catalog IDs for the keybindings.json and keybindings-state.json validation
 * messages a `jz keybindings` run reports. An action id and a JSON error detail
 * are protected values passed as arguments.
 */
const KEYBINDING_VALIDATION_IDS = {
	configNotRegularFile: "jouzu.cli.keybindings.config.notRegularFile",
	configInvalidJson: "jouzu.cli.keybindings.config.invalidJson",
	configNotObject: "jouzu.cli.keybindings.config.notObject",
	configBindingInvalid: "jouzu.cli.keybindings.config.bindingInvalid",
	stateNotRegularFile: "jouzu.cli.keybindings.state.notRegularFile",
	stateInvalidJson: "jouzu.cli.keybindings.state.invalidJson",
	stateNotObject: "jouzu.cli.keybindings.state.notObject",
	stateFieldsInvalid: "jouzu.cli.keybindings.state.fieldsInvalid",
	stateInsertedNotObject: "jouzu.cli.keybindings.state.insertedNotObject",
	stateInsertedInvalid: "jouzu.cli.keybindings.state.insertedInvalid",
} as const;

/** The pair of message IDs a `readRegularJson` call reports its two file failures with. */
interface RegularJsonIds {
	notRegularFile: string;
	invalidJson: string;
}

const CONFIG_JSON_IDS: RegularJsonIds = {
	notRegularFile: KEYBINDING_VALIDATION_IDS.configNotRegularFile,
	invalidJson: KEYBINDING_VALIDATION_IDS.configInvalidJson,
};

const STATE_JSON_IDS: RegularJsonIds = {
	notRegularFile: KEYBINDING_VALIDATION_IDS.stateNotRegularFile,
	invalidJson: KEYBINDING_VALIDATION_IDS.stateInvalidJson,
};
export type KeybindingPolicy = "applied" | "disabled";
export type KeybindingStatusKind = "uninitialized" | "converged" | "customized";

export const JOUZU_KEYBINDING_DEFAULTS_VERSION = 2;
export const JOUZU_KEYBINDING_DEFAULTS: Readonly<Record<string, KeyBindingValue>> = Object.freeze({
	"app.message.followUp": "ctrl+enter",
	"app.message.dequeue": "ctrl+up",
});

const STATE_FIELDS = new Set([
	"schemaVersion",
	"defaultsVersion",
	"policy",
	"transactionId",
	"updatedAt",
	"createdConfig",
	"insertedBindings",
]);
const INSERTED_BINDING_FIELDS = new Set(["action", "binding"]);
const EDITOR_PRIORITY_ACTIONS = new Set(["tui.editor.historyPrevious", "tui.editor.historyNext"]);
const LEGACY_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
	"app.message.followUp": "followUp",
	"app.message.dequeue": "dequeue",
});

export interface InsertedBinding {
	action: string;
	binding: KeyBindingValue;
}

export interface KeybindingState {
	schemaVersion: 1;
	defaultsVersion: number;
	policy: KeybindingPolicy;
	transactionId: string;
	updatedAt: string;
	createdConfig: boolean;
	insertedBindings: InsertedBinding[];
}

export interface KeybindingPlanAction {
	type: "set" | "remove" | "conflict";
	action: string;
	binding?: KeyBindingValue;
	reason: string;
	conflictingAction?: string;
	observed?: KeyBindingValue;
}

export interface KeybindingPlan {
	schemaVersion: 1;
	defaultsVersion: number;
	configPath: string;
	statePath: string;
	configExists: boolean;
	policy: KeybindingPolicy | "unset";
	status: KeybindingStatusKind;
	portabilityWarnings: string[];
	actions: KeybindingPlanAction[];
}

export interface ApplyKeybindingsResult {
	changed: boolean;
	plan: KeybindingPlan;
	transactionId?: string;
	backupDir?: string;
}

export interface BootstrapKeybindingsResult {
	changed: boolean;
	message?: CatalogMessageRef;
}

export class KeybindingConfigError extends Error {
	readonly exitCode = 5;

	constructor(message: string) {
		super(message);
		this.name = "KeybindingConfigError";
	}
}

export class KeybindingConflictError extends KeybindingConfigError {
	readonly plan: KeybindingPlan;

	constructor(plan: KeybindingPlan) {
		super("keybinding plan contains conflicts");
		this.name = "KeybindingConflictError";
		this.plan = plan;
	}
}

function exactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
	return Object.keys(value).every((key) => fields.has(key)) && Object.keys(value).length === fields.size;
}

function bindingIsValid(value: unknown): value is KeyBindingValue {
	return (
		(typeof value === "string" && value.length > 0) ||
		(Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0))
	);
}

function bindingKeys(value: KeyBindingValue): string[] {
	return (typeof value === "string" ? [value] : value).map((key) => key.toLowerCase());
}

function bindingEquals(left: KeyBindingValue, right: KeyBindingValue): boolean {
	const a = bindingKeys(left);
	const b = bindingKeys(right);
	return a.length === b.length && a.every((key, index) => key === b[index]);
}

function configPath(paths: JouzuPaths): string {
	return join(paths.agentDir, "keybindings.json");
}

export function keybindingStatePath(paths: JouzuPaths): string {
	return join(paths.stateDir, "keybindings-state.json");
}

function lockPath(paths: JouzuPaths): string {
	return join(paths.stateDir, "keybindings.lock");
}

function readRegularJson(path: string, ids: RegularJsonIds, catalog: CatalogBundle): unknown {
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new KeybindingConfigError(catalogText(catalog, ids.notRegularFile));
	}
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new KeybindingConfigError(
			catalogText(catalog, ids.invalidJson, {
				detail: error instanceof Error ? error.message : String(error),
			}),
		);
	}
}

export function readKeybindingConfig(
	path: string,
	catalog: CatalogBundle = defaultCatalog(),
): Record<string, KeyBindingValue> | undefined {
	if (!existsSync(path)) return undefined;
	const parsed = readRegularJson(path, CONFIG_JSON_IDS, catalog);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.configNotObject));
	}
	const config: Record<string, KeyBindingValue> = {};
	for (const [action, binding] of Object.entries(parsed)) {
		if (!bindingIsValid(binding)) {
			throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.configBindingInvalid, { action }));
		}
		config[action] = binding;
	}
	return config;
}

export function readKeybindingState(
	path: string,
	catalog: CatalogBundle = defaultCatalog(),
): KeybindingState | undefined {
	if (!existsSync(path)) return undefined;
	const parsed = readRegularJson(path, STATE_JSON_IDS, catalog);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.stateNotObject));
	}
	const value = parsed as Record<string, unknown>;
	if (
		!exactFields(value, STATE_FIELDS) ||
		value.schemaVersion !== 1 ||
		!Number.isInteger(value.defaultsVersion) ||
		Number(value.defaultsVersion) < 1 ||
		(value.policy !== "applied" && value.policy !== "disabled") ||
		typeof value.transactionId !== "string" ||
		typeof value.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(value.updatedAt)) ||
		typeof value.createdConfig !== "boolean" ||
		!Array.isArray(value.insertedBindings)
	) {
		throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.stateFieldsInvalid));
	}
	const actions = new Set<string>();
	const insertedBindings = value.insertedBindings.map((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.stateInsertedNotObject));
		}
		const binding = entry as Record<string, unknown>;
		if (
			!exactFields(binding, INSERTED_BINDING_FIELDS) ||
			typeof binding.action !== "string" ||
			!bindingIsValid(binding.binding) ||
			actions.has(binding.action)
		) {
			throw new KeybindingConfigError(catalogText(catalog, KEYBINDING_VALIDATION_IDS.stateInsertedInvalid));
		}
		actions.add(binding.action);
		return { action: binding.action, binding: binding.binding };
	});
	return {
		schemaVersion: 1,
		defaultsVersion: Number(value.defaultsVersion),
		policy: value.policy,
		transactionId: value.transactionId,
		updatedAt: value.updatedAt,
		createdConfig: value.createdConfig,
		insertedBindings,
	};
}

function claimsEditorPriority(action: string): boolean {
	return action.startsWith("app.") || EDITOR_PRIORITY_ACTIONS.has(action);
}

function findConflict(
	config: Record<string, KeyBindingValue>,
	targetAction: string,
	targetBinding: KeyBindingValue,
): string | undefined {
	const desiredKeys = new Set(bindingKeys(targetBinding));
	for (const [action, binding] of Object.entries(config)) {
		if (action === targetAction || !claimsEditorPriority(action)) continue;
		if (bindingKeys(binding).some((key) => desiredKeys.has(key))) return action;
	}
	return undefined;
}

function observedBinding(config: Record<string, KeyBindingValue>, action: string): KeyBindingValue | undefined {
	return config[action] ?? (LEGACY_ACTIONS[action] ? config[LEGACY_ACTIONS[action]] : undefined);
}

function ownedOutdatedBinding(
	state: KeybindingState | undefined,
	action: string,
	observed: KeyBindingValue | undefined,
): InsertedBinding | undefined {
	if (
		observed === undefined ||
		state?.policy !== "applied" ||
		state.defaultsVersion >= JOUZU_KEYBINDING_DEFAULTS_VERSION
	) {
		return undefined;
	}
	return state.insertedBindings.find(
		(inserted) => inserted.action === action && bindingEquals(inserted.binding, observed),
	);
}

function statusFor(config: Record<string, KeyBindingValue> | undefined): KeybindingStatusKind {
	if (!config) return "uninitialized";
	return Object.entries(JOUZU_KEYBINDING_DEFAULTS).every(([action, binding]) => {
		const observed = observedBinding(config, action);
		return observed !== undefined && bindingEquals(observed, binding);
	})
		? "converged"
		: "customized";
}

const KEYBINDING_STATUS_IDS: Readonly<Record<KeybindingStatusKind, CatalogMessageId>> = Object.freeze({
	uninitialized: CatalogMessageId.keybindingsStatusUninitialized,
	converged: CatalogMessageId.keybindingsStatusConverged,
	customized: CatalogMessageId.keybindingsStatusCustomized,
});

const KEYBINDING_POLICY_IDS: Readonly<Record<KeybindingPolicy | "unset", CatalogMessageId>> = Object.freeze({
	applied: CatalogMessageId.keybindingsPolicyApplied,
	disabled: CatalogMessageId.keybindingsPolicyDisabled,
	unset: CatalogMessageId.keybindingsPolicyUnset,
});

/** The catalog identity of a keybinding status word, for the doctor field value. */
export function keybindingStatusMessage(status: KeybindingStatusKind): CatalogMessageRef {
	return catalogMessage(KEYBINDING_STATUS_IDS[status]);
}

/** The catalog identity of a keybinding policy word, for the doctor field value. */
export function keybindingPolicyMessage(policy: KeybindingPolicy | "unset"): CatalogMessageRef {
	return catalogMessage(KEYBINDING_POLICY_IDS[policy]);
}

/** The portability warning refs behind one plan's English `portabilityWarnings`. */
const PORTABILITY_WARNING_REFS = new WeakMap<readonly string[], readonly CatalogMessageRef[]>();

/** Resolve the warning refs to the English plan values and keep the refs for the renderer. */
function portabilityWarnings(refs: readonly CatalogMessageRef[]): string[] {
	const text = refs.map((ref) => catalogMessageText(defaultCatalog(), ref));
	PORTABILITY_WARNING_REFS.set(text, refs);
	return text;
}

function getPortabilityWarnings(
	options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): CatalogMessageRef[] {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const warnings: CatalogMessageRef[] = [
		catalogMessage(CatalogMessageId.keybindingsPortabilityCtrlEnter),
		catalogMessage(CatalogMessageId.keybindingsPortabilityCtrlUp),
	];
	if (platform === "darwin") {
		warnings.push(catalogMessage(CatalogMessageId.keybindingsPortabilityMacMissionControl));
	}
	if (env.TERM === "dumb") warnings.push(catalogMessage(CatalogMessageId.keybindingsPortabilityTermDumb));
	return warnings;
}

export function planKeybindings(
	paths: JouzuPaths,
	options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; catalog?: CatalogBundle } = {},
): KeybindingPlan {
	const catalog = options.catalog ?? defaultCatalog();
	try {
		validatePrivateDirectory(paths.agentDir);
		validatePrivateDirectory(paths.stateDir);
	} catch (error) {
		throw new KeybindingConfigError(error instanceof Error ? error.message : String(error));
	}
	const path = configPath(paths);
	const statePath = keybindingStatePath(paths);
	const config = readKeybindingConfig(path, catalog);
	const state = readKeybindingState(statePath, catalog);
	const actions: KeybindingPlanAction[] = [];
	for (const [action, binding] of Object.entries(JOUZU_KEYBINDING_DEFAULTS)) {
		const observed = config ? observedBinding(config, action) : undefined;
		const ownedOutdated =
			observed !== undefined && !bindingEquals(observed, binding)
				? ownedOutdatedBinding(state, action, observed)
				: undefined;
		if (observed !== undefined && !bindingEquals(observed, binding) && !ownedOutdated) {
			actions.push({ type: "conflict", action, binding, observed, reason: "user-binding-differs" });
			continue;
		}
		const conflictingAction = config ? findConflict(config, action, binding) : undefined;
		if (conflictingAction) {
			actions.push({
				type: "conflict",
				action,
				binding,
				reason: "key-claimed-by-another-editor-action",
				conflictingAction,
			});
			continue;
		}
		if (ownedOutdated) {
			actions.push({ type: "set", action, binding, observed, reason: "owned-default-upgrade" });
		} else if (observed === undefined) {
			actions.push({ type: "set", action, binding, reason: config ? "missing" : "new-config" });
		}
	}
	return {
		schemaVersion: 1,
		defaultsVersion: JOUZU_KEYBINDING_DEFAULTS_VERSION,
		configPath: path,
		statePath,
		configExists: config !== undefined,
		policy: state?.policy ?? "unset",
		status: statusFor(config),
		portabilityWarnings: portabilityWarnings(getPortabilityWarnings(options)),
		actions,
	};
}

function writeJson(path: string, value: unknown, privateRoot: string): void {
	writeFilePrivateAtomic(path, `${JSON.stringify(value, null, 2)}\n`, privateRoot);
}

function withLock<T>(options: { paths: JouzuPaths; catalog: CatalogBundle }, operation: () => T): T {
	const { paths, catalog } = options;
	const releaseLock = acquireStateLock({
		path: lockPath(paths),
		staleMs: STATE_LOCK_STALE_MS,
		describe: "keybinding",
		onBusy: (inspection) =>
			new KeybindingConfigError(
				inspection.status === "invalid"
					? "keybindings.lock is not a regular lock file"
					: catalogText(catalog, KEYBINDING_TEXT_IDS.lockBusy),
			),
	});
	try {
		return operation();
	} finally {
		releaseLock();
	}
}

function backupConfig(paths: JouzuPaths, transactionId: string, source: string): string {
	const directory = join(paths.backupDir, "keybindings", transactionId);
	copyPrivateFile(source, join(directory, "keybindings.json"), paths.stateDir);
	return directory;
}

function makeState(options: {
	policy: KeybindingPolicy;
	transactionId: string;
	createdConfig: boolean;
	insertedBindings: InsertedBinding[];
	now: Date;
}): KeybindingState {
	return {
		schemaVersion: 1,
		defaultsVersion: JOUZU_KEYBINDING_DEFAULTS_VERSION,
		policy: options.policy,
		transactionId: options.transactionId,
		updatedAt: options.now.toISOString(),
		createdConfig: options.createdConfig,
		insertedBindings: [...options.insertedBindings].sort((left, right) => left.action.localeCompare(right.action)),
	};
}

export function applyKeybindings(
	paths: JouzuPaths,
	now = new Date(),
	catalog: CatalogBundle = defaultCatalog(),
): ApplyKeybindingsResult {
	const initial = planKeybindings(paths, { catalog });
	if (initial.actions.some((action) => action.type === "conflict")) throw new KeybindingConflictError(initial);
	return withLock({ paths, catalog }, () => {
		const plan = planKeybindings(paths, { catalog });
		if (plan.actions.some((action) => action.type === "conflict")) throw new KeybindingConflictError(plan);
		const config = readKeybindingConfig(plan.configPath, catalog) ?? {};
		const previousState = readKeybindingState(plan.statePath, catalog);
		const setActions = plan.actions.filter((action) => action.type === "set");
		if (setActions.length === 0 && previousState?.policy === "applied") return { changed: false, plan };

		const transactionId = randomUUID();
		const previousBytes = existsSync(plan.configPath) ? readFileSync(plan.configPath) : undefined;
		const createdConfig = previousState?.createdConfig ?? previousBytes === undefined;
		let backupDir: string | undefined;
		if (previousBytes) backupDir = backupConfig(paths, transactionId, plan.configPath);
		const inserted = new Map(previousState?.insertedBindings.map((entry) => [entry.action, entry]) ?? []);
		for (const action of setActions) {
			if (action.binding === undefined) throw new KeybindingConfigError("keybinding set action is missing a binding");
			config[action.action] = action.binding;
			inserted.set(action.action, { action: action.action, binding: action.binding });
		}
		const state = makeState({
			policy: "applied",
			transactionId,
			createdConfig,
			insertedBindings: [...inserted.values()],
			now,
		});
		try {
			if (setActions.length > 0) writeJson(plan.configPath, config, paths.agentDir);
			writeJson(plan.statePath, state, paths.stateDir);
		} catch (error) {
			if (setActions.length > 0) {
				if (previousBytes) writeFilePrivateAtomic(plan.configPath, previousBytes, paths.agentDir);
				else rmSync(plan.configPath, { force: true });
			}
			throw error;
		}
		return {
			changed: setActions.length > 0 || previousState?.policy !== "applied",
			plan,
			transactionId,
			...(backupDir ? { backupDir } : {}),
		};
	});
}

export function resetKeybindings(
	paths: JouzuPaths,
	now = new Date(),
	catalog: CatalogBundle = defaultCatalog(),
): ApplyKeybindingsResult {
	return withLock({ paths, catalog }, () => {
		const path = configPath(paths);
		const statePath = keybindingStatePath(paths);
		const config = readKeybindingConfig(path, catalog);
		const state = readKeybindingState(statePath, catalog);
		const actions: KeybindingPlanAction[] = [];
		for (const inserted of state?.insertedBindings ?? []) {
			const observed = config?.[inserted.action];
			if (observed === undefined) continue;
			if (!bindingEquals(observed, inserted.binding)) {
				actions.push({
					type: "conflict",
					action: inserted.action,
					binding: inserted.binding,
					observed,
					reason: "jouzu-seeded-binding-was-modified",
				});
			} else {
				actions.push({ type: "remove", action: inserted.action, binding: inserted.binding, reason: "reset-default" });
			}
		}
		const plan: KeybindingPlan = {
			schemaVersion: 1,
			defaultsVersion: JOUZU_KEYBINDING_DEFAULTS_VERSION,
			configPath: path,
			statePath,
			configExists: config !== undefined,
			policy: state?.policy ?? "unset",
			status: statusFor(config),
			portabilityWarnings: portabilityWarnings(getPortabilityWarnings()),
			actions,
		};
		if (actions.some((action) => action.type === "conflict")) throw new KeybindingConflictError(plan);

		const transactionId = randomUUID();
		const previousBytes = config ? readFileSync(path) : undefined;
		let backupDir: string | undefined;
		if (previousBytes) backupDir = backupConfig(paths, transactionId, path);
		const nextConfig = { ...(config ?? {}) };
		for (const action of actions) delete nextConfig[action.action];
		const disabledState = makeState({
			policy: "disabled",
			transactionId,
			createdConfig: false,
			insertedBindings: [],
			now,
		});
		try {
			if (actions.length > 0) {
				if (Object.keys(nextConfig).length === 0 && state?.createdConfig) unlinkSync(path);
				else writeJson(path, nextConfig, paths.agentDir);
			}
			writeJson(statePath, disabledState, paths.stateDir);
		} catch (error) {
			if (previousBytes) writeFilePrivateAtomic(path, previousBytes, paths.agentDir);
			throw error;
		}
		return {
			changed: actions.length > 0 || state?.policy !== "disabled",
			plan,
			transactionId,
			...(backupDir ? { backupDir } : {}),
		};
	});
}

function upgradeOwnedKeybindings(
	paths: JouzuPaths,
	now = new Date(),
	catalog: CatalogBundle = defaultCatalog(),
): BootstrapKeybindingsResult {
	validatePrivateDirectory(paths.agentDir);
	validatePrivateDirectory(paths.stateDir);
	return withLock({ paths, catalog }, () => {
		const path = configPath(paths);
		const statePath = keybindingStatePath(paths);
		const state = readKeybindingState(statePath, catalog);
		if (state?.policy !== "applied" || state.defaultsVersion >= JOUZU_KEYBINDING_DEFAULTS_VERSION) {
			return { changed: false };
		}

		const config = readKeybindingConfig(path, catalog);
		const nextConfig = { ...(config ?? {}) };
		const nextInserted: InsertedBinding[] = [];
		const blockedUpgrades: Array<{
			action: string;
			conflictingAction: string;
			previous: KeyBindingValue;
			desired: KeyBindingValue;
		}> = [];
		let configChanged = false;
		for (const inserted of state.insertedBindings) {
			const observed = config?.[inserted.action];
			if (observed === undefined || !bindingEquals(observed, inserted.binding)) continue;
			const desired = JOUZU_KEYBINDING_DEFAULTS[inserted.action];
			if (desired === undefined) {
				delete nextConfig[inserted.action];
				configChanged = true;
				continue;
			}
			if (bindingEquals(observed, desired)) {
				nextInserted.push({ action: inserted.action, binding: desired });
				continue;
			}
			const conflictingAction = findConflict(nextConfig, inserted.action, desired);
			if (conflictingAction) {
				delete nextConfig[inserted.action];
				configChanged = true;
				blockedUpgrades.push({ action: inserted.action, conflictingAction, previous: inserted.binding, desired });
				continue;
			}
			nextConfig[inserted.action] = desired;
			nextInserted.push({ action: inserted.action, binding: desired });
			configChanged = true;
		}

		const transactionId = randomUUID();
		const previousConfig = config ? readFileSync(path) : undefined;
		if (configChanged && previousConfig) backupConfig(paths, transactionId, path);
		const nextState = makeState({
			policy: "applied",
			transactionId,
			createdConfig: state.createdConfig,
			insertedBindings: nextInserted,
			now,
		});
		try {
			if (configChanged) {
				if (Object.keys(nextConfig).length === 0 && state.createdConfig) unlinkSync(path);
				else writeJson(path, nextConfig, paths.agentDir);
			}
			writeJson(statePath, nextState, paths.stateDir);
		} catch (error) {
			if (configChanged) {
				if (previousConfig) writeFilePrivateAtomic(path, previousConfig, paths.agentDir);
				else rmSync(path, { force: true });
			}
			throw error;
		}

		const blocked = blockedUpgrades[0];
		return {
			changed: true,
			...(blocked
				? {
						message: catalogMessage(CatalogMessageId.keybindingsUpgradeRemoved, {
							previous: bindingValueText(blocked.previous),
							action: blocked.action,
							desired: bindingValueText(blocked.desired),
							conflictingAction: blocked.conflictingAction,
						}),
					}
				: {}),
		};
	});
}

export function ensureDefaultKeybindings(
	paths: JouzuPaths,
	env: NodeJS.ProcessEnv = process.env,
	catalog: CatalogBundle = defaultCatalog(),
): BootstrapKeybindingsResult {
	if (["1", "true", "yes", "on"].includes((env.JOUZU_NO_KEYBINDING_DEFAULTS ?? "").toLowerCase())) {
		return { changed: false };
	}
	try {
		const state = readKeybindingState(keybindingStatePath(paths), catalog);
		const configExists = existsSync(configPath(paths));
		if (configExists) readKeybindingConfig(configPath(paths), catalog);
		if (state?.policy === "applied" && state.defaultsVersion < JOUZU_KEYBINDING_DEFAULTS_VERSION) {
			return upgradeOwnedKeybindings(paths, undefined, catalog);
		}
		if (state || configExists) return { changed: false };
		const result = applyKeybindings(paths, undefined, catalog);
		return { changed: result.changed };
	} catch (error) {
		return {
			changed: false,
			message: catalogMessage(CatalogMessageId.keybindingsBootstrapFailed, {
				message: protectedSourceError(error instanceof Error ? error.message : String(error)),
			}),
		};
	}
}

/** A defined binding as one string; an array is joined the way the renderer joins it. */
function bindingValueText(binding: KeyBindingValue): string {
	return typeof binding === "string" ? binding : binding.join(", ");
}

function formatBinding(binding: KeyBindingValue | undefined, catalog: CatalogBundle): string {
	if (binding === undefined) return catalogText(catalog, CatalogMessageId.keybindingsBindingPiDefault);
	return typeof binding === "string"
		? binding
		: binding.length > 0
			? binding.join(", ")
			: catalogText(catalog, CatalogMessageId.keybindingsBindingUnbound);
}

function planActionEntries(plan: KeybindingPlan, catalog: CatalogBundle): CommandReportEntry[] {
	if (plan.actions.length === 0)
		return [{ status: "ok", key: "none", message: catalogText(catalog, CatalogMessageId.keybindingsNoChanges) }];
	return plan.actions.map((action) => {
		const detail = action.conflictingAction
			? catalogText(catalog, KEYBINDING_TEXT_IDS.actionConflictDetail, {
					action: action.conflictingAction,
				})
			: action.observed !== undefined
				? catalogText(catalog, KEYBINDING_TEXT_IDS.actionCurrentDetail, {
						binding: formatBinding(action.observed, catalog),
					})
				: "";
		return {
			status: action.type === "conflict" ? ("problem" as const) : ("update" as const),
			key: action.type,
			message: `${action.action} (${action.reason}${detail})`,
		};
	});
}

export function formatKeybindingPlan(plan: KeybindingPlan, options: CatalogRenderOptions = {}): string {
	const catalog = options.catalog ?? defaultCatalog();
	const text = (id: CatalogMessageId): string => catalogText(catalog, id);
	const warningRefs = PORTABILITY_WARNING_REFS.get(plan.portabilityWarnings);
	const out = new CommandReport(options);
	out.title(
		text(CatalogMessageId.keybindingsTitle),
		`defaults v${plan.defaultsVersion}`,
		catalogText(catalog, KEYBINDING_STATUS_IDS[plan.status]),
	);
	out.entries(
		text(CatalogMessageId.keybindingsNotes),
		plan.portabilityWarnings.map((warning, index) => ({
			status: "warning" as const,
			key: "portability",
			message: warningRefs?.[index] === undefined ? warning : catalogMessageText(catalog, warningRefs[index]),
		})),
	);
	if (plan.portabilityWarnings.length > 0) out.rule();
	out.section(text(CatalogMessageId.keybindingsPlan), [
		{
			label: text(CatalogMessageId.keybindingsFieldPolicy),
			value: catalogText(catalog, KEYBINDING_POLICY_IDS[plan.policy]),
		},
		{ label: text(CatalogMessageId.keybindingsFieldConfig), value: plan.configPath },
	]);
	out.section(
		text(CatalogMessageId.keybindingsDesired),
		Object.entries(JOUZU_KEYBINDING_DEFAULTS).map(([action, binding]) => ({
			label: action,
			value: formatBinding(binding, catalog),
		})),
	);
	out.entries(text(CatalogMessageId.keybindingsActions), planActionEntries(plan, catalog));
	return out.toString();
}
