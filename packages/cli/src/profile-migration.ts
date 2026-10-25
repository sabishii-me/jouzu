/**
 * The reversible migration of the Japanese profile into the language settings.
 *
 * The `ja` profile installs a distribution-managed `APPEND_SYSTEM.md` whose
 * first instruction is "reply in Japanese". The language contract now owns the
 * response language as a setting, so the migration maps an explicit `ja`
 * profile choice to `responseLanguage: "ja"` and an explicit `core` choice to
 * `"auto"`, and it treats the distribution-managed prompt asset as a duplicate
 * of that setting.
 *
 * ## What the plan explains
 *
 * `planProfileMigration` reads the applied profile state (`profile-state.json`),
 * the saved first-run choice (`profile-choice.json`), the environment, and an
 * optional explicit `--profile`, and explains which profile is effective and
 * which step supplied it. The mapping is fixed: `ja` becomes
 * `responseLanguage: "ja"`, `core` becomes `"auto"`, and the display language
 * is left alone (`uiLocale: "auto"`).
 *
 * ## Temporary choices
 *
 * An explicit `--profile ja` or `JOUZU_PROFILE=ja` is temporary. The plan names
 * its source `cli` or `env`, and `applyProfileMigration` writes nothing for it:
 * a temporary choice is never auto-saved to the user-wide settings. Only a
 * saved choice (`saved`) or the absence of any choice (`default`) may persist
 * the mapped response language.
 *
 * ## The prompt asset
 *
 * Only a distribution-managed `APPEND_SYSTEM.md` is migrated. A file whose bytes
 * equal the bundled `ja` asset is `deduplicate`: the migration removes it,
 * because the response-language setting now supplies the instruction. A file
 * the user edited is `preserve`d; the plan carries a line diff that marks the
 * lines duplicating the managed instruction and a resolution, and the apply
 * never rewrites it.
 *
 * ## Safety and reuse
 *
 * The settings write reuses the language-settings parts: the same
 * `readLocalizationConfigSnapshot` compare-and-swap token, the same
 * `saveLocalizationConfig` atomic, revision-checked, lock-protected writer, and
 * the same private atomic write helper for the asset. The plan is read-only, so
 * a preview, a cancel, or a refusal changes nothing. The apply is idempotent: a
 * second run finds the setting already mapped and the managed asset already
 * gone, and reports `changed: false`.
 *
 * The receipt carries the `transactionId`, the `backupDir`, and the changed
 * file names. `rollbackProfileMigration` restores every backed-up file and
 * removes a file the migration created, returning the previous state. The
 * version 1 settings read path stays: this module never writes a settings file
 * it could not read.
 */

import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProfileId } from "./args.js";
import { type CatalogRenderOptions, catalogText, defaultCatalog } from "./cli-messages.js";
import { CommandReport, type CommandReportEntry } from "./command-report.js";
import type { ResponseLanguagePreference } from "./language-settings.js";
import type { CatalogBundle } from "./locale-catalog.js";
import type { JouzuPaths } from "./paths.js";
import {
	copyPrivateFile,
	ensurePrivateDirectory,
	validatePrivateDirectory,
	writeFilePrivateAtomic,
} from "./private-fs.js";
import { type ProfileChoice, readProfileChoice } from "./profile-choice.js";
import { type ProfileState, readProfileState } from "./profile-manager.js";
import { loadBundledProfile } from "./profiles.js";
import {
	DEFAULT_UI_LOCALE_PREFERENCE,
	LOCALIZATION_FILE_NAME,
	type LocalizationConfigSnapshot,
	type LocalizationSettings,
	readLocalizationConfigSnapshot,
	readLocalizationSettings,
	saveLocalizationConfig,
} from "./ui-locale.js";

/** The saved first-run choice file name inside `stateDir`. */
export const PROFILE_CHOICE_FILE_NAME = "profile-choice.json";
/** The distribution-managed prompt asset the migration inspects. */
export const PROFILE_MIGRATION_ASSET_TARGET = "APPEND_SYSTEM.md";
/** The backup subdirectory the migration writes into. */
export const PROFILE_MIGRATION_BACKUP_DIRECTORY = "profile-migration";

/** The profile the migration starts from. */
export type ProfileMigrationProfile = "core" | "ja";

/** Which step supplied the effective profile. */
export type ProfileMigrationSource = "cli" | "env" | "saved" | "default";

/** What the migration does with one managed prompt asset. */
export type ProfileMigrationAssetAction = "preserve" | "replace" | "deduplicate";

/** One line of the asset diff: the migration removes it, or it stays. */
export interface ProfileMigrationDiffLine {
	readonly kind: "remove" | "keep";
	readonly text: string;
}

/** How a preserved duplicate can be resolved. */
export type ProfileMigrationResolution = "keep-edits" | "reapply-profile";

/** One planned prompt-asset outcome. */
export interface ProfileMigrationAsset {
	readonly target: string;
	readonly action: ProfileMigrationAssetAction;
	readonly diff: readonly ProfileMigrationDiffLine[];
	readonly resolution?: ProfileMigrationResolution;
}

/** The read-only explanation of the effective profile and the mapped values. */
export interface ProfileMigrationPlan {
	readonly from: { readonly profile: ProfileMigrationProfile; readonly source: ProfileMigrationSource };
	readonly to: { readonly responseLanguage: "auto" | "ja"; readonly uiLocale: "auto" };
	readonly assets: readonly ProfileMigrationAsset[];
	readonly conflicts: readonly string[];
}

/** The inputs to a plan or an apply. */
export interface ProfileMigrationOptions {
	/** The explicit `--profile` value. It is a temporary choice (`cli`). */
	readonly explicitProfile?: ProfileId;
	/** The environment `JOUZU_PROFILE` is read from; `process.env` when omitted. */
	readonly env?: NodeJS.ProcessEnv;
	/** The bundled managed asset text. The bundled `ja` asset when omitted. */
	readonly managedAppendSystem?: string;
	/** The resolved catalog the human renderer reads; English when omitted. */
	readonly catalog?: CatalogBundle;
}

/** The receipt of an apply. */
export interface ProfileMigrationReceipt {
	readonly changed: boolean;
	readonly plan: ProfileMigrationPlan;
	readonly transactionId: string;
	/** Whether this source may persist the user-wide settings. */
	readonly persisted: boolean;
	readonly backupDir?: string;
	/** The file names the apply changed, relative to their owning directory. */
	readonly targets: readonly string[];
}

/** The result of a cancel: the plan, with nothing written. */
export interface ProfileMigrationCancelResult {
	readonly applied: false;
	readonly plan: ProfileMigrationPlan;
}

/** The result of a rollback. */
export interface ProfileMigrationRollbackResult {
	readonly restored: boolean;
	readonly transactionId: string;
}

/** The catalog IDs the human renderer and the conflict error read. */
const PROFILE_MIGRATION_MESSAGE_IDS = {
	planTitle: "jouzu.cli.profileMigration.title",
	section: "jouzu.cli.profileMigration.section",
	fieldFrom: "jouzu.cli.profileMigration.field.from",
	fieldTo: "jouzu.cli.profileMigration.field.to",
	fromValue: "jouzu.cli.profileMigration.fromValue",
	toValue: "jouzu.cli.profileMigration.toValue",
	assets: "jouzu.cli.profileMigration.assets",
	conflicts: "jouzu.cli.profileMigration.conflicts",
	assetDeduplicate: "jouzu.cli.profileMigration.assetDeduplicate",
	assetPreserve: "jouzu.cli.profileMigration.assetPreserve",
	assetReplace: "jouzu.cli.profileMigration.assetReplace",
	diffKind: "jouzu.cli.profileMigration.diffKind",
	resolutionKeepEdits: "jouzu.cli.profileMigration.resolution.keepEdits",
	resolutionReapplyProfile: "jouzu.cli.profileMigration.resolution.reapplyProfile",
	temporary: "jouzu.cli.profileMigration.temporary",
	conflict: "jouzu.cli.profileMigration.conflict",
} as const;

/** Raised when an apply is refused because the plan carries a conflict. */
export class ProfileMigrationConflictError extends Error {
	readonly exitCode = 3;
	readonly plan: ProfileMigrationPlan;

	constructor(plan: ProfileMigrationPlan, catalog: CatalogBundle = defaultCatalog()) {
		super(catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.conflict));
		this.name = "ProfileMigrationConflictError";
		this.plan = plan;
	}
}

/** Whether a source may persist the user-wide settings. */
export function profileMigrationPersists(plan: ProfileMigrationPlan): boolean {
	return plan.from.source === "saved" || plan.from.source === "default";
}

function isUnusableSnapshot(snapshot: LocalizationConfigSnapshot): boolean {
	return (
		snapshot.revision.kind === "rejected" || snapshot.state.status === "invalid" || snapshot.state.status === "future"
	);
}

function profileChoicePath(paths: JouzuPaths): string {
	return join(paths.stateDir, PROFILE_CHOICE_FILE_NAME);
}

function assetPath(paths: JouzuPaths): string {
	return join(paths.agentDir, PROFILE_MIGRATION_ASSET_TARGET);
}

function settingsPath(paths: JouzuPaths): string {
	return join(paths.configDir, LOCALIZATION_FILE_NAME);
}

/**
 * The bundled managed `APPEND_SYSTEM.md` text, or `undefined` when the bundled
 * profile cannot be read. The option overrides it so a caller can plan against
 * a fixture.
 */
function managedAppendSystemText(options: ProfileMigrationOptions): string | undefined {
	if (options.managedAppendSystem !== undefined) return options.managedAppendSystem;
	try {
		const profile = loadBundledProfile("ja");
		const asset = profile.assets.find((candidate) => candidate.target === PROFILE_MIGRATION_ASSET_TARGET);
		if (asset === undefined) return undefined;
		return new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes);
	} catch {
		return undefined;
	}
}

/** Read the saved choice; a damaged file is a conflict and contributes nothing. */
function safeReadProfileChoice(
	paths: JouzuPaths,
	catalog: CatalogBundle,
	conflicts: string[],
): ProfileChoice | undefined {
	try {
		return readProfileChoice(profileChoicePath(paths), catalog);
	} catch {
		conflicts.push("profile-choice-unreadable");
		return undefined;
	}
}

/** Read the applied state; a damaged file is a conflict and contributes nothing. */
function safeReadProfileState(
	paths: JouzuPaths,
	catalog: CatalogBundle,
	conflicts: string[],
): ProfileState | undefined {
	try {
		return readProfileState(paths.profileStatePath, catalog);
	} catch {
		conflicts.push("profile-state-unreadable");
		return undefined;
	}
}

function isProfileId(value: unknown): value is ProfileMigrationProfile {
	return value === "core" || value === "ja";
}

/** Resolve the effective profile and the step that supplied it. */
function resolveFrom(
	paths: JouzuPaths,
	options: ProfileMigrationOptions,
	catalog: CatalogBundle,
	conflicts: string[],
): { profile: ProfileMigrationProfile; source: ProfileMigrationSource } {
	if (options.explicitProfile !== undefined) {
		return { profile: options.explicitProfile, source: "cli" };
	}
	const env = options.env ?? process.env;
	if (isProfileId(env.JOUZU_PROFILE)) {
		return { profile: env.JOUZU_PROFILE, source: "env" };
	}
	const choice = safeReadProfileChoice(paths, catalog, conflicts);
	if (choice !== undefined) return { profile: choice.profile, source: "saved" };
	const state = safeReadProfileState(paths, catalog, conflicts);
	if (state !== undefined) return { profile: state.activeProfile, source: "saved" };
	return { profile: "core", source: "default" };
}

/** The line diff between the managed asset and an edited file. */
function assetDiff(installed: string, managed: string): ProfileMigrationDiffLine[] {
	const managedLines = new Set(
		managed
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0),
	);
	return installed.split("\n").map((text) => {
		const trimmed = text.trim();
		const duplicates = trimmed.length > 0 && managedLines.has(trimmed);
		return { kind: duplicates ? "remove" : "keep", text };
	});
}

/** Plan the asset outcome. A conflict is added when the file cannot be trusted. */
function planAssets(
	paths: JouzuPaths,
	managed: string | undefined,
	conflicts: string[],
): readonly ProfileMigrationAsset[] {
	try {
		validatePrivateDirectory(paths.agentDir);
	} catch {
		conflicts.push("agent-directory-unsafe");
		return [];
	}
	const path = assetPath(paths);
	if (!existsSync(path)) return [];
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(path);
	} catch {
		conflicts.push("asset-unreadable");
		return [];
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		conflicts.push("asset-unsafe");
		return [];
	}
	let installed: string;
	try {
		installed = readFileSync(path, "utf8");
	} catch {
		conflicts.push("asset-unreadable");
		return [];
	}
	if (managed === undefined) {
		conflicts.push("managed-asset-unavailable");
		return [];
	}
	if (installed === managed) {
		return [
			{
				target: PROFILE_MIGRATION_ASSET_TARGET,
				action: "deduplicate",
				diff: installed.split("\n").map((text) => ({ kind: "remove" as const, text })),
			},
		];
	}
	const diff = assetDiff(installed, managed);
	const hasDuplicates = diff.some((line) => line.kind === "remove");
	return [
		{
			target: PROFILE_MIGRATION_ASSET_TARGET,
			action: "preserve",
			diff,
			...(hasDuplicates ? { resolution: "keep-edits" as const } : {}),
		},
	];
}

/**
 * Build the plan. It never writes: it reads the applied state, the saved
 * choice, and the environment, explains the effective profile, and maps the
 * response language.
 */
export function planProfileMigration(paths: JouzuPaths, options: ProfileMigrationOptions = {}): ProfileMigrationPlan {
	const catalog = options.catalog ?? defaultCatalog();
	const conflicts: string[] = [];
	const from = resolveFrom(paths, options, catalog, conflicts);
	const to = {
		responseLanguage: from.profile === "ja" ? ("ja" as const) : ("auto" as const),
		uiLocale: "auto" as const,
	};
	const assets = planAssets(paths, managedAppendSystemText(options), conflicts);
	// A conflict on the settings file only matters when the source may persist.
	if (profileMigrationPersists({ from, to, assets, conflicts })) {
		const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
		if (isUnusableSnapshot(snapshot)) conflicts.push("environment-settings-unusable");
	}
	return { from, to, assets, conflicts };
}

/** The catalog action sentence for one asset. */
function assetMessage(asset: ProfileMigrationAsset, catalog: CatalogBundle): string {
	if (asset.action === "deduplicate") return catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.assetDeduplicate);
	if (asset.action === "replace") return catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.assetReplace);
	return catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.assetPreserve);
}

/** The resolution sentence for a preserved duplicate, or `undefined`. */
function resolutionMessage(asset: ProfileMigrationAsset, catalog: CatalogBundle): string | undefined {
	if (asset.resolution === "keep-edits") {
		return catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.resolutionKeepEdits);
	}
	if (asset.resolution === "reapply-profile") {
		return catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.resolutionReapplyProfile);
	}
	return undefined;
}

function assetEntries(plan: ProfileMigrationPlan, catalog: CatalogBundle): CommandReportEntry[] {
	const entries: CommandReportEntry[] = [];
	for (const asset of plan.assets) {
		const resolution = resolutionMessage(asset, catalog);
		const message =
			resolution === undefined ? assetMessage(asset, catalog) : `${assetMessage(asset, catalog)} ${resolution}`;
		entries.push({ status: asset.action === "preserve" ? "ok" : "update", key: asset.target, message });
		for (const line of asset.diff) {
			if (line.text.trim().length === 0) continue;
			entries.push({
				status: "idle",
				key: catalogText(catalog, PROFILE_MIGRATION_MESSAGE_IDS.diffKind, { kind: line.kind }),
				message: line.text,
			});
		}
	}
	return entries;
}

/**
 * Render a migration plan for a terminal. The profile, source, response
 * language, asset action, and diff lines are values; the sentences come from
 * the resolved catalog.
 */
export function formatProfileMigrationPlan(plan: ProfileMigrationPlan, options: CatalogRenderOptions = {}): string {
	const catalog = options.catalog ?? defaultCatalog();
	const text = (id: string, args?: Readonly<Record<string, string>>): string => catalogText(catalog, id, args);
	const out = new CommandReport(options);
	out.title(text(PROFILE_MIGRATION_MESSAGE_IDS.planTitle));
	out.section(text(PROFILE_MIGRATION_MESSAGE_IDS.section), [
		{
			label: text(PROFILE_MIGRATION_MESSAGE_IDS.fieldFrom),
			value: text(PROFILE_MIGRATION_MESSAGE_IDS.fromValue, {
				profile: plan.from.profile,
				source: plan.from.source,
			}),
		},
		{
			label: text(PROFILE_MIGRATION_MESSAGE_IDS.fieldTo),
			value: text(PROFILE_MIGRATION_MESSAGE_IDS.toValue, {
				responseLanguage: plan.to.responseLanguage,
				uiLocale: plan.to.uiLocale,
			}),
		},
	]);
	if (plan.assets.length > 0) {
		out.entries(text(PROFILE_MIGRATION_MESSAGE_IDS.assets), assetEntries(plan, catalog));
	}
	if (plan.conflicts.length > 0) {
		out.entries(
			text(PROFILE_MIGRATION_MESSAGE_IDS.conflicts),
			plan.conflicts.map((reason) => ({ status: "problem" as const, key: reason, message: "" })),
		);
	}
	if (!profileMigrationPersists(plan)) out.paragraph(text(PROFILE_MIGRATION_MESSAGE_IDS.temporary));
	return out.toString();
}

/** The deduplicated content after removing the managed block, or `undefined`. */
function deduplicatedContent(installed: string, managed: string): string | undefined {
	if (installed === managed) return "";
	if (!installed.includes(managed)) return undefined;
	return installed
		.split(managed)
		.join("")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
}

/**
 * Apply the migration and return the receipt.
 *
 * A plan conflict raises `ProfileMigrationConflictError` and writes nothing. A
 * temporary source (`cli` or `env`) writes nothing: it is never auto-saved to
 * the user-wide settings. A saved source persists `responseLanguage: "ja"` for
 * a `ja` profile through the shared atomic, revision-checked settings writer,
 * and removes an exactly distribution-managed `APPEND_SYSTEM.md` after backing
 * it up. The write is idempotent: a second run changes nothing.
 */
export function applyProfileMigration(
	paths: JouzuPaths,
	options: ProfileMigrationOptions = {},
): ProfileMigrationReceipt {
	const catalog = options.catalog ?? defaultCatalog();
	const plan = planProfileMigration(paths, { ...options, catalog });
	if (plan.conflicts.length > 0) throw new ProfileMigrationConflictError(plan, catalog);
	const persisted = profileMigrationPersists(plan);
	const transactionId = randomUUID();
	if (!persisted) {
		return { changed: false, plan, transactionId, persisted: false, targets: [] };
	}

	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	if (isUnusableSnapshot(snapshot)) throw new ProfileMigrationConflictError(plan, catalog);
	const settingsState = readLocalizationSettings(paths.configDir, catalog);
	const currentSettings: LocalizationSettings | undefined =
		settingsState.status === "ok" ? settingsState.settings : undefined;
	const desired: ResponseLanguagePreference = plan.to.responseLanguage;
	// Only a `ja` mapping carries an instruction to persist. A `core` mapping is
	// `auto` (no fixed language), so the migration never overwrites a response
	// language the user set directly in the Settings.
	const settingsChanged = desired === "ja" && currentSettings?.responseLanguage !== desired;

	const managed = managedAppendSystemText(options);
	const deduplicate = plan.assets.find((asset) => asset.action === "deduplicate" || asset.action === "replace");
	const installed = deduplicate === undefined ? undefined : readFileSync(assetPath(paths), "utf8");
	const nextAsset =
		installed === undefined || managed === undefined ? undefined : deduplicatedContent(installed, managed);
	const assetChanged = deduplicate !== undefined && nextAsset !== undefined && nextAsset !== installed;

	if (!settingsChanged && !assetChanged) {
		return { changed: false, plan, transactionId, persisted: true, targets: [] };
	}

	const backupDir = join(paths.backupDir, PROFILE_MIGRATION_BACKUP_DIRECTORY, transactionId);
	ensurePrivateDirectory(paths.backupDir, backupDir);
	const targets: string[] = [];
	if (settingsChanged) {
		if (existsSync(settingsPath(paths))) {
			copyPrivateFile(settingsPath(paths), join(backupDir, LOCALIZATION_FILE_NAME), paths.stateDir);
		}
		targets.push(LOCALIZATION_FILE_NAME);
	}
	if (assetChanged) {
		if (existsSync(assetPath(paths))) {
			copyPrivateFile(assetPath(paths), join(backupDir, PROFILE_MIGRATION_ASSET_TARGET), paths.stateDir);
		}
		targets.push(PROFILE_MIGRATION_ASSET_TARGET);
	}

	if (settingsChanged) {
		const uiLocale = currentSettings?.uiLocale ?? DEFAULT_UI_LOCALE_PREFERENCE;
		saveLocalizationConfig({ configDir: paths.configDir, stateDir: paths.stateDir }, uiLocale, snapshot, catalog, {
			responseLanguage: desired,
		});
	}
	if (assetChanged) {
		if (nextAsset === "") rmSync(assetPath(paths), { force: true });
		else writeFilePrivateAtomic(assetPath(paths), nextAsset ?? "", paths.agentDir);
	}

	return {
		changed: true,
		plan,
		transactionId,
		persisted: true,
		backupDir,
		targets,
	};
}

/**
 * Cancel a planned migration: return the plan and write nothing. The preview,
 * the saved settings, the prompt, and the running state are unchanged.
 */
export function cancelProfileMigration(
	paths: JouzuPaths,
	options: ProfileMigrationOptions = {},
): ProfileMigrationCancelResult {
	return { applied: false, plan: planProfileMigration(paths, options) };
}

/**
 * Roll back an applied migration from its receipt. Every backed-up file is
 * restored through the private atomic write helper; a file the migration
 * created (no backup) is removed. Returns whether anything was restored.
 */
export function rollbackProfileMigration(
	paths: JouzuPaths,
	receipt: Pick<ProfileMigrationReceipt, "transactionId" | "backupDir" | "targets">,
): ProfileMigrationRollbackResult {
	if (receipt.targets.length === 0) return { restored: false, transactionId: receipt.transactionId };
	const backupDir =
		receipt.backupDir ?? join(paths.backupDir, PROFILE_MIGRATION_BACKUP_DIRECTORY, receipt.transactionId);
	let restored = false;
	for (const target of receipt.targets) {
		const destination =
			target === LOCALIZATION_FILE_NAME ? join(paths.configDir, target) : join(paths.agentDir, target);
		const root = target === LOCALIZATION_FILE_NAME ? paths.configDir : paths.agentDir;
		const backup = join(backupDir, target);
		if (existsSync(backup)) {
			writeFilePrivateAtomic(destination, readFileSync(backup), root);
			restored = true;
		} else if (existsSync(destination)) {
			rmSync(destination, { force: true });
			restored = true;
		}
	}
	return { restored, transactionId: receipt.transactionId };
}

/** The directory a rollback reads, so a caller can inspect the backups. */
export function profileMigrationBackupDirectory(paths: JouzuPaths, transactionId: string): string {
	return join(paths.backupDir, PROFILE_MIGRATION_BACKUP_DIRECTORY, transactionId);
}
