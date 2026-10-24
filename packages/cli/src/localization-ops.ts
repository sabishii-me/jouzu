/**
 * The plan, apply, and reset operations for the language settings.
 *
 * This module sits on the existing settings layer. It reads
 * `<configDir>/localization.json` through `readLocalizationConfigSnapshot` and
 * `readLocalizationSettings`, writes it through `saveLocalizationConfig`, and
 * reuses the private atomic write helper and the state lock for the session
 * store. It does not open the settings file a second way.
 *
 * ## Two stores
 *
 * The environment save and the session override are separate:
 *
 * - The environment save is `<configDir>/localization.json`. It is the saved
 *   default for this Jouzu environment. `saveLocalizationConfig` persists the
 *   display language and preserves the rest of the language contract.
 * - The session override is `<stateDir>/localization-session.json`, a map from
 *   session id to the values that session asked for. It applies to that
 *   process only and never rewrites the environment save.
 *
 * The values resolve in the documented order. The display language takes the
 * session override first (when it is a fixed locale), then `JOUZU_UI_LOCALE`,
 * the saved setting, the OS candidate, and the built-in default, which is the
 * order `resolveUiLocale` implements. The response language takes the session
 * override, then the saved setting, then the built-in default
 * (`resolveResponseLanguage`). The artifact policy takes the session override,
 * then the saved setting, then the built-in default (`resolveArtifactPolicy`).
 *
 * ## Scope
 *
 * `applyLocalization` with `scope: "session"` records the request in the
 * session store only. With `scope: "environment"` it persists the display
 * language to the environment save, drops that session's display-language
 * override so the saved value reaches the current session, records the
 * requested response language and artifact policy in the current session's
 * override, and returns a notice for every other known session. It never edits
 * another session's override, so another session's input is unchanged.
 *
 * The shared writer persists the display language. Environment-wide
 * persistence of the response language and the artifact policy belongs to the
 * profile migration, which reuses these plan and apply parts.
 *
 * ## Safety
 *
 * A write is atomic, goes through `saveLocalizationConfig` or
 * `writeFilePrivateAtomic`, and compares the file against the revision read
 * before the operation. A settings file that cannot be read (a symlink, a
 * non-regular file, an oversized file, malformed content, or a newer schema) is
 * never overwritten: the plan reports a conflict and the previous values stay
 * on disk.
 *
 * ## Receipt
 *
 * `applyLocalization` and `resetLocalization` return a receipt: `changed`, the
 * `plan`, a `transactionId`, the `backupDir` when a file was replaced, and the
 * notices for other sessions. `resetLocalization` returns every language
 * setting to its default: it clears the current session's override and resets
 * the saved display language to `auto`.
 */

import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { defaultCatalog } from "./cli-messages.js";
import {
	ARTIFACT_POLICY_FIELDS,
	formatArtifactPolicy,
	isResponseLanguagePreference,
	type PartialArtifactPolicy,
	parseArtifactPolicy,
	type ResolvedArtifactPolicy,
	type ResolvedResponseLanguage,
	type ResponseLanguagePreference,
	resolveArtifactPolicy,
	resolveResponseLanguage,
} from "./language-settings.js";
import type { CatalogBundle } from "./locale-catalog.js";
import type { JouzuPaths } from "./paths.js";
import { copyPrivateFile, validatePrivateDirectory, writeFilePrivateAtomic } from "./private-fs.js";
import { acquireStateLock } from "./state-lock.js";
import {
	DEFAULT_UI_LOCALE_PREFERENCE,
	isUiLocalePreference,
	LOCALIZATION_FILE_NAME,
	LOCALIZATION_MAX_BYTES,
	type LocalizationConfigSnapshot,
	type LocalizationConfigState,
	type LocalizationSettings,
	osLocaleCandidates,
	readLocalizationConfigSnapshot,
	readLocalizationSettings,
	resolveUiLocale,
	saveLocalizationConfig,
	type UiLocale,
	type UiLocalePreference,
} from "./ui-locale.js";

/** Where a planned change lands. */
export type LocalizationScope = "session" | "environment";

/** One language setting. */
export type LocalizationField = "uiLocale" | "responseLanguage" | "artifactPolicy";

/** The saved session override file name inside `stateDir`. */
export const LOCALIZATION_SESSION_FILE_NAME = "localization-session.json";
/** The state lock that serializes session-override writes. */
export const LOCALIZATION_SESSION_LOCK_FILE_NAME = "localization-session.lock";
/** The schema version this build writes and understands for the session store. */
export const LOCALIZATION_SESSION_SCHEMA_VERSION = 1;

/** The values one session asked for. An absent field keeps the lower source. */
export interface LocalizationSessionOverride {
	readonly uiLocale?: UiLocalePreference;
	readonly responseLanguage?: ResponseLanguagePreference;
	readonly artifactPolicy?: PartialArtifactPolicy;
}

/** A requested change to the language settings. */
export interface LocalizationRequest {
	readonly uiLocale?: UiLocalePreference;
	readonly responseLanguage?: ResponseLanguagePreference;
	readonly artifactPolicy?: PartialArtifactPolicy;
}

/** Which step supplied an effective display language. */
export type LocalizationSource = "cli" | "env" | "session" | "config" | "os" | "builtin";

/** The outcome of resolving the display language, including the session override. */
export interface ResolvedLocalizationUiLocale {
	readonly requested: UiLocalePreference;
	readonly effective: UiLocale;
	readonly source: LocalizationSource;
	readonly fallback?: {
		readonly requested: string;
		readonly effective: UiLocale;
		readonly reason: string;
	};
}

/** The effective values of the three language settings for one session. */
export interface ResolvedLocalization {
	readonly uiLocale: ResolvedLocalizationUiLocale;
	readonly responseLanguage: ResolvedResponseLanguage;
	readonly artifactPolicy: ResolvedArtifactPolicy;
}

/** One planned change or one reason a plan cannot be applied. */
export interface LocalizationPlanAction {
	readonly type: "set" | "clear" | "conflict";
	readonly scope: LocalizationScope;
	readonly field: LocalizationField;
	readonly reason: string;
	readonly value?: string;
}

/** A preview of what an apply would change, and the effective values. */
export interface LocalizationPlan {
	readonly scope: LocalizationScope;
	readonly sessionId: string;
	readonly actions: readonly LocalizationPlanAction[];
	readonly effective: ResolvedLocalization;
	readonly conflicts: readonly LocalizationPlanAction[];
}

/** A change another session should be told about. It never edits that session. */
export interface LocalizationNotice {
	readonly sessionId: string;
	readonly change: "environment-settings";
	readonly scope: LocalizationScope;
}

/** The receipt of an apply or a reset. */
export interface LocalizationApplyResult {
	readonly changed: boolean;
	readonly plan: LocalizationPlan;
	readonly transactionId: string;
	readonly backupDir?: string;
	readonly notices: readonly LocalizationNotice[];
}

/** The inputs to `planLocalization` and `applyLocalization`. */
export interface LocalizationPlanOptions {
	readonly sessionId: string;
	readonly scope: LocalizationScope;
	readonly request?: LocalizationRequest;
	readonly catalog?: CatalogBundle;
	readonly env?: NodeJS.ProcessEnv;
	readonly os?: readonly (string | undefined)[];
}

/** The inputs to `resetLocalization`. */
export interface LocalizationResetOptions {
	readonly sessionId: string;
	readonly catalog?: CatalogBundle;
	readonly env?: NodeJS.ProcessEnv;
	readonly os?: readonly (string | undefined)[];
}

/** Raised when a language-settings operation cannot read or write its store. */
export class LocalizationConfigError extends Error {
	readonly exitCode = 5;

	constructor(message: string) {
		super(message);
		this.name = "LocalizationConfigError";
	}
}

/** Raised when an apply or reset is refused because the plan carries a conflict. */
export class LocalizationConflictError extends LocalizationConfigError {
	readonly plan: LocalizationPlan;

	constructor(plan: LocalizationPlan) {
		super("localization plan contains conflicts");
		this.name = "LocalizationConflictError";
		this.plan = plan;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SESSION_STORE_FIELDS = new Set(["schemaVersion", "sessions"]);
const SESSION_OVERRIDE_FIELDS = new Set(["uiLocale", "responseLanguage", "artifactPolicy"]);

/** Whether a snapshot must never be overwritten. */
function isUnusableSnapshot(snapshot: LocalizationConfigSnapshot): boolean {
	return (
		snapshot.revision.kind === "rejected" || snapshot.state.status === "invalid" || snapshot.state.status === "future"
	);
}

function sessionStorePath(stateDir: string): string {
	return join(stateDir, LOCALIZATION_SESSION_FILE_NAME);
}

function sessionLockPath(stateDir: string): string {
	return join(stateDir, LOCALIZATION_SESSION_LOCK_FILE_NAME);
}

/** Parse one stored session override against the strict schema. */
function parseSessionOverride(value: unknown): LocalizationSessionOverride | undefined {
	if (!isPlainObject(value)) return undefined;
	if (!Object.keys(value).every((key) => SESSION_OVERRIDE_FIELDS.has(key))) return undefined;
	const override: {
		uiLocale?: UiLocalePreference;
		responseLanguage?: ResponseLanguagePreference;
		artifactPolicy?: PartialArtifactPolicy;
	} = {};
	const uiLocale = value.uiLocale;
	if (uiLocale !== undefined) {
		if (typeof uiLocale !== "string" || !isUiLocalePreference(uiLocale)) return undefined;
		override.uiLocale = uiLocale;
	}
	const responseLanguage = value.responseLanguage;
	if (responseLanguage !== undefined) {
		if (typeof responseLanguage !== "string" || !isResponseLanguagePreference(responseLanguage)) return undefined;
		override.responseLanguage = responseLanguage;
	}
	const artifactPolicy = value.artifactPolicy;
	if (artifactPolicy !== undefined) {
		const parsed = parseArtifactPolicy(artifactPolicy);
		if (parsed === undefined) return undefined;
		override.artifactPolicy = parsed;
	}
	return override;
}

function parseSessionStore(contents: string): Record<string, LocalizationSessionOverride> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch {
		throw new LocalizationConfigError("localization session overrides are not valid JSON");
	}
	if (!isPlainObject(parsed)) {
		throw new LocalizationConfigError("localization session overrides are not an object");
	}
	if (!Object.keys(parsed).every((key) => SESSION_STORE_FIELDS.has(key))) {
		throw new LocalizationConfigError("localization session overrides carry unknown fields");
	}
	if (parsed.schemaVersion !== LOCALIZATION_SESSION_SCHEMA_VERSION) {
		throw new LocalizationConfigError("localization session overrides use an unsupported schema version");
	}
	const sessions = parsed.sessions;
	if (!isPlainObject(sessions)) {
		throw new LocalizationConfigError("localization session overrides carry no sessions object");
	}
	const overrides: Record<string, LocalizationSessionOverride> = {};
	for (const [sessionId, value] of Object.entries(sessions)) {
		const override = parseSessionOverride(value);
		if (override === undefined) {
			throw new LocalizationConfigError("localization session override entry is invalid");
		}
		overrides[sessionId] = override;
	}
	return overrides;
}

/**
 * Read the session overrides. An absent store is empty. A store that cannot be
 * read (a symlink, a non-regular file, an oversized file, malformed content, or
 * an unknown schema) throws, so a caller never overwrites it.
 */
export function readLocalizationSessionOverrides(stateDir: string): Record<string, LocalizationSessionOverride> {
	validatePrivateDirectory(stateDir);
	const path = sessionStorePath(stateDir);
	if (!existsSync(path)) return {};
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new LocalizationConfigError("localization session overrides are not a regular file");
	}
	if (metadata.size > LOCALIZATION_MAX_BYTES) {
		throw new LocalizationConfigError("localization session overrides exceed the size limit");
	}
	let contents: string;
	try {
		contents = readFileSync(path, "utf8");
	} catch {
		throw new LocalizationConfigError("localization session overrides could not be read");
	}
	return parseSessionStore(contents);
}

/** Read the override for one session, or an empty object when it has none. */
export function readLocalizationSessionOverride(stateDir: string, sessionId: string): LocalizationSessionOverride {
	return readLocalizationSessionOverrides(stateDir)[sessionId] ?? {};
}

function serializeSessionStore(overrides: Record<string, LocalizationSessionOverride>): string {
	const sessions: Record<string, LocalizationSessionOverride> = {};
	for (const sessionId of Object.keys(overrides).sort()) {
		const override = overrides[sessionId];
		if (override === undefined) continue;
		const entry: {
			uiLocale?: UiLocalePreference;
			responseLanguage?: ResponseLanguagePreference;
			artifactPolicy?: PartialArtifactPolicy;
		} = {};
		if (override.uiLocale !== undefined) entry.uiLocale = override.uiLocale;
		if (override.responseLanguage !== undefined) entry.responseLanguage = override.responseLanguage;
		if (override.artifactPolicy !== undefined) entry.artifactPolicy = override.artifactPolicy;
		sessions[sessionId] = entry;
	}
	return `${JSON.stringify({ schemaVersion: LOCALIZATION_SESSION_SCHEMA_VERSION, sessions }, null, 2)}\n`;
}

function writeSessionStore(stateDir: string, overrides: Record<string, LocalizationSessionOverride>): void {
	const contents = serializeSessionStore(overrides);
	if (Buffer.byteLength(contents) > LOCALIZATION_MAX_BYTES) {
		throw new LocalizationConfigError("localization session overrides exceed the size limit");
	}
	writeFilePrivateAtomic(sessionStorePath(stateDir), contents, stateDir);
}

function withSessionLock<T>(paths: JouzuPaths, operation: () => T): T {
	const release = acquireStateLock({
		path: sessionLockPath(paths.stateDir),
		describe: "localization-session",
		onBusy: () => new LocalizationConfigError("localization session overrides are locked by another process"),
	});
	try {
		return operation();
	} finally {
		release();
	}
}

function artifactPolicyEquals(
	left: PartialArtifactPolicy | undefined,
	right: PartialArtifactPolicy | undefined,
): boolean {
	return ARTIFACT_POLICY_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function overrideEquals(left: LocalizationSessionOverride, right: LocalizationSessionOverride): boolean {
	return (
		left.uiLocale === right.uiLocale &&
		left.responseLanguage === right.responseLanguage &&
		artifactPolicyEquals(left.artifactPolicy, right.artifactPolicy)
	);
}

function storesEqual(
	left: Record<string, LocalizationSessionOverride>,
	right: Record<string, LocalizationSessionOverride>,
): boolean {
	const leftIds = Object.keys(left);
	const rightIds = Object.keys(right);
	if (leftIds.length !== rightIds.length) return false;
	return leftIds.every((sessionId) => {
		const leftOverride = left[sessionId];
		const rightOverride = right[sessionId];
		return leftOverride !== undefined && rightOverride !== undefined && overrideEquals(leftOverride, rightOverride);
	});
}

/** Drop an override that carries no field, so an empty session leaves no entry. */
function cleanOverride(override: LocalizationSessionOverride): LocalizationSessionOverride | undefined {
	if (
		override.uiLocale === undefined &&
		override.responseLanguage === undefined &&
		override.artifactPolicy === undefined
	) {
		return undefined;
	}
	return override;
}

function backupLocalizationFile(
	paths: JouzuPaths,
	category: "environment" | "session",
	transactionId: string,
	source: string,
): string {
	const directory = join(paths.backupDir, "localization", category, transactionId);
	copyPrivateFile(source, join(directory, basename(source)), paths.stateDir);
	return directory;
}

function conflict(scope: LocalizationScope, field: LocalizationField, reason: string): LocalizationPlanAction {
	return { type: "conflict", scope, field, reason };
}

function setAction(
	scope: LocalizationScope,
	field: LocalizationField,
	reason: string,
	value: string,
): LocalizationPlanAction {
	return { type: "set", scope, field, reason, value };
}

function clearAction(scope: LocalizationScope, field: LocalizationField, reason: string): LocalizationPlanAction {
	return { type: "clear", scope, field, reason };
}

function resolveEffectiveLocalization(input: {
	override: LocalizationSessionOverride;
	snapshot: LocalizationConfigSnapshot;
	settings: LocalizationSettings | undefined;
	env: NodeJS.ProcessEnv | undefined;
	os: readonly (string | undefined)[] | undefined;
	catalog: CatalogBundle;
}): ResolvedLocalization {
	const configState: LocalizationConfigState = input.snapshot.state;
	let uiLocale: ResolvedLocalizationUiLocale;
	if (input.override.uiLocale !== undefined && input.override.uiLocale !== "auto") {
		uiLocale = {
			requested: input.override.uiLocale,
			effective: input.override.uiLocale,
			source: "session",
		};
	} else {
		const resolved = resolveUiLocale(
			{
				env: input.env?.JOUZU_UI_LOCALE,
				config: configState,
				os: input.os ?? osLocaleCandidates(input.env ?? process.env),
				builtin: DEFAULT_UI_LOCALE_PREFERENCE,
			},
			input.catalog,
		);
		uiLocale = {
			requested: resolved.requested,
			effective: resolved.effective,
			source: resolved.source,
			...(resolved.fallback ? { fallback: resolved.fallback } : {}),
		};
	}
	const responseLanguage = resolveResponseLanguage(
		{
			session: input.override.responseLanguage,
			config: input.settings?.responseLanguage,
		},
		input.catalog,
	);
	const artifactPolicy = resolveArtifactPolicy({
		session: input.override.artifactPolicy,
		config: input.settings?.artifactPolicy,
	});
	return { uiLocale, responseLanguage, artifactPolicy };
}

function readSettingsForResolution(configDir: string, catalog: CatalogBundle): LocalizationSettings | undefined {
	const state = readLocalizationSettings(configDir, catalog);
	return state.status === "ok" ? state.settings : undefined;
}

/**
 * Build the plan for a requested change.
 *
 * A conflict means the operation must not run: an unsupported requested value,
 * or an environment save whose settings file cannot be read. The plan never
 * writes; the effective values reflect the current session override and the
 * saved settings.
 */
export function planLocalization(paths: JouzuPaths, options: LocalizationPlanOptions): LocalizationPlan {
	const catalog = options.catalog ?? defaultCatalog();
	const request = options.request ?? {};
	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	const settings = readSettingsForResolution(paths.configDir, catalog);
	const overrides = readLocalizationSessionOverrides(paths.stateDir);
	const override = overrides[options.sessionId] ?? {};
	const effective = resolveEffectiveLocalization({
		override,
		snapshot,
		settings,
		env: options.env,
		os: options.os,
		catalog,
	});

	const conflicts: LocalizationPlanAction[] = [];
	const actions: LocalizationPlanAction[] = [];
	if (request.uiLocale !== undefined && !isUiLocalePreference(request.uiLocale)) {
		conflicts.push(conflict(options.scope, "uiLocale", "unsupported-value"));
	}
	if (request.responseLanguage !== undefined && !isResponseLanguagePreference(request.responseLanguage)) {
		conflicts.push(conflict(options.scope, "responseLanguage", "unsupported-value"));
	}
	if (request.artifactPolicy !== undefined && parseArtifactPolicy(request.artifactPolicy) === undefined) {
		conflicts.push(conflict(options.scope, "artifactPolicy", "unsupported-value"));
	}
	if (options.scope === "environment" && isUnusableSnapshot(snapshot)) {
		conflicts.push(conflict("environment", "uiLocale", "environment-settings-unusable"));
	}

	if (conflicts.length === 0) {
		if (options.scope === "session") {
			if (request.uiLocale !== undefined && request.uiLocale !== override.uiLocale) {
				actions.push(setAction("session", "uiLocale", "session-override", request.uiLocale));
			}
			if (request.responseLanguage !== undefined && request.responseLanguage !== override.responseLanguage) {
				actions.push(setAction("session", "responseLanguage", "session-override", request.responseLanguage));
			}
			if (
				request.artifactPolicy !== undefined &&
				!artifactPolicyEquals(request.artifactPolicy, override.artifactPolicy)
			) {
				actions.push(
					setAction("session", "artifactPolicy", "session-override", formatArtifactPolicy(request.artifactPolicy)),
				);
			}
		} else {
			const configPreference = snapshot.state.status === "ok" ? snapshot.state.preference : undefined;
			if (request.uiLocale !== undefined && request.uiLocale !== configPreference) {
				actions.push(setAction("environment", "uiLocale", "environment-default", request.uiLocale));
			}
			if (override.uiLocale !== undefined) {
				actions.push(clearAction("session", "uiLocale", "environment-default"));
			}
			if (request.responseLanguage !== undefined && request.responseLanguage !== override.responseLanguage) {
				actions.push(setAction("session", "responseLanguage", "environment-current-session", request.responseLanguage));
			}
			if (
				request.artifactPolicy !== undefined &&
				!artifactPolicyEquals(request.artifactPolicy, override.artifactPolicy)
			) {
				actions.push(
					setAction(
						"session",
						"artifactPolicy",
						"environment-current-session",
						formatArtifactPolicy(request.artifactPolicy),
					),
				);
			}
		}
	}

	return { scope: options.scope, sessionId: options.sessionId, actions, effective, conflicts };
}

function noticesFor(
	overrides: Record<string, LocalizationSessionOverride>,
	currentSessionId: string,
): LocalizationNotice[] {
	return Object.keys(overrides)
		.filter((sessionId) => sessionId !== currentSessionId)
		.sort()
		.map((sessionId) => ({ sessionId, change: "environment-settings", scope: "environment" }));
}

function applySessionScope(
	paths: JouzuPaths,
	options: LocalizationPlanOptions,
	plan: LocalizationPlan,
): LocalizationApplyResult {
	const request = options.request ?? {};
	const transactionId = randomUUID();
	return withSessionLock(paths, () => {
		const overrides = readLocalizationSessionOverrides(paths.stateDir);
		const current = overrides[options.sessionId] ?? {};
		const nextOverride: LocalizationSessionOverride = {
			...(request.uiLocale !== undefined ? { uiLocale: request.uiLocale } : {}),
			...(request.responseLanguage !== undefined ? { responseLanguage: request.responseLanguage } : {}),
			...(request.artifactPolicy !== undefined ? { artifactPolicy: request.artifactPolicy } : {}),
			...(request.uiLocale === undefined && current.uiLocale !== undefined ? { uiLocale: current.uiLocale } : {}),
			...(request.responseLanguage === undefined && current.responseLanguage !== undefined
				? { responseLanguage: current.responseLanguage }
				: {}),
			...(request.artifactPolicy === undefined && current.artifactPolicy !== undefined
				? { artifactPolicy: current.artifactPolicy }
				: {}),
		};
		const nextStore = { ...overrides };
		const cleaned = cleanOverride(nextOverride);
		if (cleaned === undefined) delete nextStore[options.sessionId];
		else nextStore[options.sessionId] = cleaned;
		const changed = !storesEqual(overrides, nextStore);
		let backupDir: string | undefined;
		if (changed) {
			const store = sessionStorePath(paths.stateDir);
			if (existsSync(store)) backupDir = backupLocalizationFile(paths, "session", transactionId, store);
			writeSessionStore(paths.stateDir, nextStore);
		}
		return {
			changed,
			plan,
			transactionId,
			...(backupDir ? { backupDir } : {}),
			notices: [],
		};
	});
}

function applyEnvironmentScope(
	paths: JouzuPaths,
	options: LocalizationPlanOptions,
	plan: LocalizationPlan,
	catalog: CatalogBundle,
): LocalizationApplyResult {
	const request = options.request ?? {};
	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	if (isUnusableSnapshot(snapshot)) {
		throw new LocalizationConfigError("refusing to write localization settings that could not be read");
	}
	const transactionId = randomUUID();
	const settingsPath = join(paths.configDir, LOCALIZATION_FILE_NAME);
	const location = { configDir: paths.configDir, stateDir: paths.stateDir };
	return withSessionLock(paths, () => {
		const overrides = readLocalizationSessionOverrides(paths.stateDir);
		const current = overrides[options.sessionId] ?? {};
		const nextOverride: LocalizationSessionOverride = {
			...(current.responseLanguage !== undefined ? { responseLanguage: current.responseLanguage } : {}),
			...(current.artifactPolicy !== undefined ? { artifactPolicy: current.artifactPolicy } : {}),
			...(request.responseLanguage !== undefined ? { responseLanguage: request.responseLanguage } : {}),
			...(request.artifactPolicy !== undefined ? { artifactPolicy: request.artifactPolicy } : {}),
		};
		const nextStore = { ...overrides };
		const cleaned = cleanOverride(nextOverride);
		if (cleaned === undefined) delete nextStore[options.sessionId];
		else nextStore[options.sessionId] = cleaned;
		const storeChanged = !storesEqual(overrides, nextStore);

		const uiLocale = request.uiLocale;
		const settingsChanged =
			uiLocale !== undefined && (snapshot.state.status !== "ok" || snapshot.state.preference !== uiLocale);

		let backupDir: string | undefined;
		if (settingsChanged && existsSync(settingsPath)) {
			backupDir = backupLocalizationFile(paths, "environment", transactionId, settingsPath);
		}
		if (settingsChanged && uiLocale !== undefined) {
			saveLocalizationConfig(location, uiLocale, snapshot, catalog);
		}
		if (storeChanged) {
			const store = sessionStorePath(paths.stateDir);
			if (backupDir === undefined && existsSync(store)) {
				backupDir = backupLocalizationFile(paths, "session", transactionId, store);
			}
			writeSessionStore(paths.stateDir, nextStore);
		}
		return {
			changed: settingsChanged || storeChanged,
			plan,
			transactionId,
			...(backupDir ? { backupDir } : {}),
			notices: noticesFor(nextStore, options.sessionId),
		};
	});
}

/**
 * Apply a requested change and return the receipt.
 *
 * The plan runs first; a conflict raises `LocalizationConflictError` and writes
 * nothing. A session-scoped apply writes only the current session's override.
 * An environment-scoped apply persists the display language, drops the current
 * session's display-language override, records the requested response language
 * and artifact policy in the current session's override, and returns a notice
 * for every other known session. The write is atomic and compares the file
 * against the revision read before the operation.
 */
export function applyLocalization(paths: JouzuPaths, options: LocalizationPlanOptions): LocalizationApplyResult {
	const catalog = options.catalog ?? defaultCatalog();
	const plan = planLocalization(paths, { ...options, catalog });
	if (plan.conflicts.length > 0) throw new LocalizationConflictError(plan);
	if (options.scope === "session") return applySessionScope(paths, options, plan);
	return applyEnvironmentScope(paths, options, plan, catalog);
}

function planReset(paths: JouzuPaths, options: LocalizationResetOptions, catalog: CatalogBundle): LocalizationPlan {
	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	const settings = readSettingsForResolution(paths.configDir, catalog);
	const overrides = readLocalizationSessionOverrides(paths.stateDir);
	const override = overrides[options.sessionId] ?? {};
	const effective = resolveEffectiveLocalization({
		override,
		snapshot,
		settings,
		env: options.env,
		os: options.os,
		catalog,
	});
	const conflicts: LocalizationPlanAction[] = [];
	if (isUnusableSnapshot(snapshot)) {
		conflicts.push(conflict("environment", "uiLocale", "environment-settings-unusable"));
	}
	const actions: LocalizationPlanAction[] = [];
	if (conflicts.length === 0) {
		if (override.uiLocale !== undefined) actions.push(clearAction("session", "uiLocale", "reset-default"));
		if (override.responseLanguage !== undefined) {
			actions.push(clearAction("session", "responseLanguage", "reset-default"));
		}
		if (override.artifactPolicy !== undefined) {
			actions.push(clearAction("session", "artifactPolicy", "reset-default"));
		}
		if (snapshot.state.status === "ok" && snapshot.state.preference !== DEFAULT_UI_LOCALE_PREFERENCE) {
			actions.push(setAction("environment", "uiLocale", "reset-default", DEFAULT_UI_LOCALE_PREFERENCE));
		}
	}
	return { scope: "environment", sessionId: options.sessionId, actions, effective, conflicts };
}

/**
 * Reset every language setting to its default.
 *
 * The current session's override is cleared, and the saved display language is
 * reset to `auto`. The saved response language and artifact policy are
 * preserved by the shared writer; the migration issue owns their environment
 * reset. A settings file that cannot be read keeps its previous values and
 * raises `LocalizationConflictError`. Every other known session receives a
 * notice; its override is not edited.
 */
export function resetLocalization(paths: JouzuPaths, options: LocalizationResetOptions): LocalizationApplyResult {
	const catalog = options.catalog ?? defaultCatalog();
	const plan = planReset(paths, options, catalog);
	if (plan.conflicts.length > 0) throw new LocalizationConflictError(plan);
	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	if (isUnusableSnapshot(snapshot)) {
		throw new LocalizationConfigError("refusing to write localization settings that could not be read");
	}
	const transactionId = randomUUID();
	const settingsPath = join(paths.configDir, LOCALIZATION_FILE_NAME);
	const location = { configDir: paths.configDir, stateDir: paths.stateDir };
	return withSessionLock(paths, () => {
		const overrides = readLocalizationSessionOverrides(paths.stateDir);
		const nextStore = { ...overrides };
		delete nextStore[options.sessionId];
		const storeChanged = !storesEqual(overrides, nextStore);
		const settingsChanged =
			snapshot.state.status === "ok" && snapshot.state.preference !== DEFAULT_UI_LOCALE_PREFERENCE;

		let backupDir: string | undefined;
		if (settingsChanged && existsSync(settingsPath)) {
			backupDir = backupLocalizationFile(paths, "environment", transactionId, settingsPath);
		}
		if (settingsChanged) {
			saveLocalizationConfig(location, DEFAULT_UI_LOCALE_PREFERENCE, snapshot, catalog);
		}
		if (storeChanged) {
			const store = sessionStorePath(paths.stateDir);
			if (backupDir === undefined && existsSync(store)) {
				backupDir = backupLocalizationFile(paths, "session", transactionId, store);
			}
			writeSessionStore(paths.stateDir, nextStore);
		}
		return {
			changed: settingsChanged || storeChanged,
			plan,
			transactionId,
			...(backupDir ? { backupDir } : {}),
			notices: noticesFor(nextStore, options.sessionId),
		};
	});
}
