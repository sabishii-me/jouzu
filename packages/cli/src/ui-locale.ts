/**
 * The UI locale value set and its resolution types.
 *
 * The UI locale controls the language of Jouzu's own interface text. It is
 * deliberately independent of the response language, the profile, the model,
 * the provider, and the region: nothing in this module reads or writes any of
 * them.
 *
 * This module implements the value set, normalization, the read-only schema
 * validation of `<configDir>/localization.json`, the five-step resolution
 * order (explicit option, Jouzu environment variable, saved setting, OS `auto`,
 * built-in default), and the atomic, conflict-checked save of the settings
 * file. Reading never writes; a save goes through the private atomic write
 * helper and refuses to overwrite settings it could not read.
 *
 * The settings file also carries the language contract (`responseLanguage` and
 * `artifactPolicy`). This module validates and preserves those fields, and
 * reads a `schemaVersion: 1` file as the version 2 shape in memory, but it does
 * not resolve them: `language-settings.ts` owns the resolution order. A read
 * never rewrites a file only to change its version.
 *
 * ## Prototype record: reading the UI language on Windows
 *
 * Candidate APIs, what each returns, and what was verified on this Linux
 * machine (Node v24.21.0, full ICU 78.3):
 *
 * 1. `Intl.DateTimeFormat().resolvedOptions().locale` (and the same field from
 *    any `Intl` object). Returns the runtime's default BCP-47 locale, e.g.
 *    `en-US`, `ja-JP`, `zh-CN`, `zh-TW`, and sometimes extensions such as
 *    `en-US-x-lvariant-euro` or a bare `zh`. Verified here: on POSIX the value
 *    follows `LC_ALL` > `LC_MESSAGES` > `LANG`; `C`, `POSIX`, `C.UTF-8`, and an
 *    unset environment resolve to `en-US`; an empty `LC_ALL` resolves to `und`.
 *    NOT verified on Windows: Node documents that its ICU default comes from
 *    the OS on Windows, not from `LC_*`, but this prototype could not observe
 *    which Win32 call populates it. It is a locale candidate, not proof of the
 *    MUI display language: a user can keep a Japanese user locale with an
 *    English UI.
 * 2. `process.env.LANG` / `LC_ALL` / `LC_MESSAGES`. On POSIX these are the
 *    documented `auto` inputs. On Windows they are normally unset; a Git Bash
 *    or MSYS environment may set them, so they cannot be the primary source.
 * 3. PowerShell `[System.Globalization.CultureInfo]::CurrentUICulture.Name` and
 *    `Get-UICulture`. Returns the .NET UI culture name (e.g. `ja-JP`,
 *    `zh-Hans-CN`). Requires spawning PowerShell; NOT verified here.
 * 4. PowerShell `Get-WinUserLanguageList` (Windows 10+). Returns the ordered
 *    user language list; the first entry's `LanguageTag` is the preferred UI
 *    language. Requires PowerShell; NOT verified here.
 * 5. Win32 `GetUserDefaultUILanguage()` (a LANGID such as `0x0411`),
 *    `GetUserPreferredUILanguages()` (the ordered MUI list), and
 *    `GetUserDefaultLocaleName()` (the user locale, not the UI language). No
 *    built-in Node binding; a native addon or FFI is required. A LANGID is not
 *    a BCP-47 tag and would need `LCIDToLocaleName` before normalization. NOT
 *    verified here.
 * 6. Registry `HKCU\Control Panel\International\User Profile` (`Languages`,
 *    `MultiUILanguageId`) and `HKCU\Control Panel\International\LocaleName`.
 *    Readable through registry APIs or `reg query`; NOT verified here.
 *
 * Mapping onto the supported values: candidates 1, 3, and 4 already yield tags
 * `normalizeUiLocale` accepts (`ja-JP` -> `ja`, `en-US` -> `en`, `zh-CN` ->
 * `zh-Hans`, `zh-TW` -> `zh-Hant`; a bare `zh` is rejected as ambiguous).
 * Candidate 5 needs a LANGID-to-tag conversion first. No Windows method is
 * asserted as correct by this issue.
 */

import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import { type HumanLocale, protectedSourceError } from "./human-messages.js";
import {
	describeInvalidArtifactField,
	isResponseLanguagePreference,
	type PartialArtifactPolicy,
	parseArtifactPolicy,
	type ResponseLanguagePreference,
} from "./language-settings.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { validatePrivateDirectory, writeFilePrivateAtomic } from "./private-fs.js";
import { acquireStateLock } from "./state-lock.js";

/** The supported UI locale values. This is the same set the display context carries. */
export const UI_LOCALES = ["en", "ja", "zh-Hans", "zh-Hant"] as const satisfies readonly HumanLocale[];
export type UiLocale = (typeof UI_LOCALES)[number];

/** A stored or requested preference: a supported value, or `auto` to follow the OS. */
export const UI_LOCALE_PREFERENCES = ["auto", ...UI_LOCALES] as const;
export type UiLocalePreference = (typeof UI_LOCALE_PREFERENCES)[number];

/** Which step of the resolution order supplied the effective locale. */
export const UI_LOCALE_SOURCES = ["cli", "env", "config", "os", "builtin"] as const;
export type UiLocaleSource = (typeof UI_LOCALE_SOURCES)[number];

/** The built-in fallback when no source supplies a supported value. */
export const DEFAULT_UI_LOCALE: UiLocale = "en";
/** The built-in preference, so the default follows the OS until the user chooses. */
export const DEFAULT_UI_LOCALE_PREFERENCE: UiLocalePreference = "auto";

/** The `localization.json` schema version this build writes and understands. */
export const LOCALIZATION_SCHEMA_VERSION = 2;
/** The earlier schema version this build still reads and migrates in memory. */
export const LOCALIZATION_LEGACY_SCHEMA_VERSION = 1;
/** The saved UI-locale settings file name inside `configDir`. */
export const LOCALIZATION_FILE_NAME = "localization.json";
/** The state lock that serializes concurrent localization saves. */
export const LOCALIZATION_LOCK_FILE_NAME = "localization.lock";
/** The largest accepted `localization.json`, so a damaged or hostile file cannot exhaust memory. */
export const LOCALIZATION_MAX_BYTES = 4096;

/**
 * The catalog IDs for the localization-settings diagnostics.
 *
 * They are local to this module rather than added to the shared
 * `CatalogMessageId` table, so a parallel migration of another surface does
 * not conflict on that file; `scripts/check-locales.mjs` allows a catalog-only
 * ID present in both locales.
 *
 * Every one of these strings is read by a user: a `reason` is rendered by
 * `jouzu.cli.localization.invalid` in `main-cli.ts` and as the doctor's
 * localization fallback field, and the two lock messages are the
 * `UiLocaleConfigError` text a save reports. A caller that has a resolved
 * catalog passes it in, and the default keeps the English bytes this module
 * already produced. The settings keys, the schema version, the byte limit, and
 * the raw source error are protected: they are arguments, and the numeric ones
 * are passed as strings so Fluent never adds locale grouping separators.
 */
const UI_LOCALE_MESSAGE_IDS = {
	configNotInspected: "jouzu.cli.localization.config.notInspected",
	configNotRegularFile: "jouzu.cli.localization.config.notRegularFile",
	configTooLarge: "jouzu.cli.localization.config.tooLarge",
	configInvalidJson: "jouzu.cli.localization.config.invalidJson",
	configNotObject: "jouzu.cli.localization.config.notObject",
	configUnknownFields: "jouzu.cli.localization.config.unknownFields",
	configSchemaVersionInvalid: "jouzu.cli.localization.config.schemaVersionInvalid",
	configLocalizationNotObject: "jouzu.cli.localization.config.localizationNotObject",
	configUnknownLocalizationFields: "jouzu.cli.localization.config.unknownLocalizationFields",
	uiLocaleNotString: "jouzu.cli.localization.uiLocaleNotString",
	uiLocaleUnsupported: "jouzu.cli.localization.uiLocaleUnsupported",
	responseLanguageNotString: "jouzu.cli.localization.responseLanguageNotString",
	responseLanguageUnsupported: "jouzu.cli.localization.responseLanguageUnsupported",
	artifactPolicyNotObject: "jouzu.cli.localization.artifactPolicyNotObject",
	artifactPolicyFieldInvalid: "jouzu.cli.localization.artifactPolicyFieldInvalid",
	osCandidateUnsupported: "jouzu.cli.localization.osCandidateUnsupported",
	lockNotRegularFile: "jouzu.cli.localization.lockNotRegularFile",
	lockBusy: "jouzu.cli.localization.lockBusy",
} as const;

/** Raised when a saved preference cannot be written because it is unsupported. */
export class UiLocaleConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UiLocaleConfigError";
	}
}

/**
 * Raised when a save would overwrite a change made after the snapshot was read.
 * The caller re-reads the settings and decides whether to retry; the save never
 * silently discards another session's update.
 */
export class UiLocaleConflictError extends UiLocaleConfigError {
	constructor() {
		super("localization settings changed since they were read; re-read before saving again");
		this.name = "UiLocaleConflictError";
	}
}

/**
 * Raised when an explicit option value is not a supported preference.
 *
 * `args.ts` rejects the value first, so this is the resolver's defensive
 * boundary. It carries the same exit code as the argument `UsageError`.
 */
export class UiLocaleUsageError extends Error {
	readonly exitCode = 2;

	constructor(value: string) {
		super(`--jouzu-ui-locale must be one of: ${UI_LOCALE_PREFERENCES.join(", ")} (got ${value})`);
		this.name = "UiLocaleUsageError";
	}
}

/**
 * The read-only state of `<configDir>/localization.json`.
 *
 * `absent` means there is no saved preference. `ok` carries a validated
 * preference. `future` means the file was written by a newer schema version,
 * which this build must not interpret or rewrite. `invalid` means the file is
 * unreadable, malformed, or carries an unsupported value; a reader must leave
 * it untouched.
 */
export type LocalizationConfigState =
	| { readonly status: "absent" }
	| { readonly status: "ok"; readonly preference: UiLocalePreference }
	| { readonly status: "future"; readonly schemaVersion: number }
	| { readonly status: "invalid"; readonly reason: string };

/**
 * The language-contract settings parsed from `localization.json`.
 *
 * `schemaVersion` is the effective version this build writes. `migratedFrom` is
 * present only when a `schemaVersion: 1` file was read and interpreted as the
 * version 2 shape in memory. `responseLanguage` and `artifactPolicy` are absent
 * when the file did not set them, so resolution falls through to the built-in
 * default rather than treating a missing value as an explicit one.
 */
export interface LocalizationSettings {
	readonly schemaVersion: number;
	readonly migratedFrom?: number;
	readonly uiLocale: UiLocalePreference;
	readonly responseLanguage?: ResponseLanguagePreference;
	readonly artifactPolicy?: PartialArtifactPolicy;
}

/**
 * The full read-only state of `localization.json`, including the language
 * contract. `ok` carries both the legacy `preference` projection (so the UI
 * locale resolver is unchanged) and the parsed settings.
 */
export type LocalizationSettingsState =
	| { readonly status: "absent" }
	| { readonly status: "ok"; readonly preference: UiLocalePreference; readonly settings: LocalizationSettings }
	| { readonly status: "future"; readonly schemaVersion: number }
	| { readonly status: "invalid"; readonly reason: string };

/**
 * The exact on-disk state of the settings file captured at read time, used as
 * the compare-and-swap token for a save. `file` carries the raw bytes so a save
 * can detect any change since the snapshot, and `rejected` records a file that
 * must never be overwritten.
 */
export type LocalizationConfigRevision =
	| { readonly kind: "absent" }
	| { readonly kind: "file"; readonly contents: string }
	| { readonly kind: "rejected"; readonly reason: string };

/** A read of the settings file that also carries the compare-and-swap token. */
export interface LocalizationConfigSnapshot {
	readonly state: LocalizationConfigState;
	readonly revision: LocalizationConfigRevision;
}

/** The two Jouzu-owned directories the save path needs. */
export interface LocalizationConfigLocation {
	readonly configDir: string;
	readonly stateDir: string;
}

/** Why a requested value did not become the effective locale. */
export interface UiLocaleFallback {
	/** The raw value that was rejected, before normalization. */
	readonly requested: string;
	/** The supported value used instead. */
	readonly effective: UiLocale;
	/** A human-readable reason, kept for diagnostics. */
	readonly reason: string;
}

/** The outcome of resolving a UI locale request. */
export interface ResolvedUiLocale {
	/** What was asked for: `auto` or a supported value. */
	readonly requested: UiLocalePreference;
	/** The supported value to display in. */
	readonly effective: UiLocale;
	/** Which step supplied the effective value. */
	readonly source: UiLocaleSource;
	/** Present only when a rejected raw value was replaced. */
	readonly fallback?: UiLocaleFallback;
}

const HANS_REGIONS = new Set(["CN", "SG"]);
const HANT_REGIONS = new Set(["TW", "HK", "MO"]);

/** Whether a value is one of the supported UI locales. */
export function isSupportedUiLocale(value: string): value is UiLocale {
	return (UI_LOCALES as readonly string[]).includes(value);
}

/** Whether a value is `auto` or one of the supported UI locales. */
export function isUiLocalePreference(value: string): value is UiLocalePreference {
	return value === "auto" || isSupportedUiLocale(value);
}

/**
 * Validate a value before saving it. `auto` is stored as an intent; any other
 * value must be one of the supported locales. A save path calls this and refuses
 * to write when it throws, so an unsupported value never reaches disk.
 */
export function assertWritableUiLocalePreference(value: string): UiLocalePreference {
	if (isUiLocalePreference(value)) return value;
	throw new UiLocaleConfigError(`unsupported UI locale preference: ${value}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawLocalizationRead =
	| { readonly kind: "absent" }
	| { readonly kind: "file"; readonly contents: string }
	| { readonly kind: "rejected"; readonly reason: string };

/** Read the settings file as bytes, refusing anything that must not be trusted. */
function readLocalizationRaw(configDir: string, catalog: CatalogBundle): RawLocalizationRead {
	const path = join(configDir, LOCALIZATION_FILE_NAME);
	if (!existsSync(path)) return { kind: "absent" };
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(path);
	} catch {
		return { kind: "rejected", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configNotInspected) };
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		return { kind: "rejected", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configNotRegularFile) };
	}
	if (metadata.size > LOCALIZATION_MAX_BYTES) {
		return {
			kind: "rejected",
			reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configTooLarge, {
				maxBytes: String(LOCALIZATION_MAX_BYTES),
			}),
		};
	}
	let contents: string;
	try {
		contents = readFileSync(path, "utf8");
	} catch (error) {
		// Keep the pre-existing diagnostic wording for an unreadable file so the
		// startup message does not change.
		return {
			kind: "rejected",
			reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configInvalidJson, {
				message: protectedSourceError(error instanceof Error ? error.message : String(error)),
			}),
		};
	}
	return { kind: "file", contents };
}

/**
 * The result of parsing `localization.json` against the strict saved schema.
 * `ok` carries the migrated settings; `future` and `invalid` are the same
 * non-usable states the legacy reader reports.
 */
type LocalizationParse =
	| { readonly kind: "ok"; readonly settings: LocalizationSettings }
	| { readonly kind: "future"; readonly schemaVersion: number }
	| { readonly kind: "invalid"; readonly reason: string };

/** The localization keys the version 1 schema accepts. */
const LOCALIZATION_V1_KEYS: readonly string[] = ["uiLocale"];
/** The localization keys the version 2 schema accepts. */
const LOCALIZATION_V2_KEYS: readonly string[] = ["uiLocale", "responseLanguage", "artifactPolicy"];

/**
 * Parse already-read bytes against the strict saved schema and migrate a
 * `schemaVersion: 1` file into the version 2 shape in memory.
 *
 * The migration never writes: reading a version 1 file yields
 * `schemaVersion: 2` with `migratedFrom: 1`, the existing `uiLocale`, and no
 * response language or artifact policy, so those fall through to the built-in
 * default. A file is only ever rewritten by an explicit save.
 */
function parseLocalizationContents(contents: string, catalog: CatalogBundle): LocalizationParse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		return {
			kind: "invalid",
			reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configInvalidJson, {
				message: protectedSourceError(error instanceof Error ? error.message : String(error)),
			}),
		};
	}
	if (!isPlainObject(parsed)) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configNotObject) };
	}
	if (!Object.keys(parsed).every((key) => key === "schemaVersion" || key === "localization")) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configUnknownFields) };
	}
	const schemaVersion = parsed.schemaVersion;
	if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configSchemaVersionInvalid) };
	}
	if (schemaVersion > LOCALIZATION_SCHEMA_VERSION) return { kind: "future", schemaVersion };
	if (schemaVersion !== LOCALIZATION_LEGACY_SCHEMA_VERSION && schemaVersion !== LOCALIZATION_SCHEMA_VERSION) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configSchemaVersionInvalid) };
	}
	const localization = parsed.localization;
	if (!isPlainObject(localization)) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configLocalizationNotObject) };
	}
	const allowedKeys =
		schemaVersion === LOCALIZATION_LEGACY_SCHEMA_VERSION ? LOCALIZATION_V1_KEYS : LOCALIZATION_V2_KEYS;
	if (!Object.keys(localization).every((key) => allowedKeys.includes(key))) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.configUnknownLocalizationFields) };
	}
	const rawUiLocale = localization.uiLocale;
	if (rawUiLocale !== undefined && typeof rawUiLocale !== "string") {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.uiLocaleNotString) };
	}
	if (rawUiLocale !== undefined && !isUiLocalePreference(rawUiLocale)) {
		return {
			kind: "invalid",
			reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.uiLocaleUnsupported, { value: rawUiLocale }),
		};
	}
	// The version 1 schema required `uiLocale`; the version 2 schema leaves it
	// optional, and an omitted value keeps the `auto` intent that follows the OS.
	if (schemaVersion === LOCALIZATION_LEGACY_SCHEMA_VERSION && rawUiLocale === undefined) {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.uiLocaleNotString) };
	}
	const rawResponseLanguage = localization.responseLanguage;
	if (rawResponseLanguage !== undefined && typeof rawResponseLanguage !== "string") {
		return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.responseLanguageNotString) };
	}
	if (rawResponseLanguage !== undefined && !isResponseLanguagePreference(rawResponseLanguage)) {
		return {
			kind: "invalid",
			reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.responseLanguageUnsupported, {
				value: rawResponseLanguage,
			}),
		};
	}
	let artifactPolicy: PartialArtifactPolicy | undefined;
	const rawArtifactPolicy = localization.artifactPolicy;
	if (rawArtifactPolicy !== undefined) {
		if (!isPlainObject(rawArtifactPolicy)) {
			return { kind: "invalid", reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.artifactPolicyNotObject) };
		}
		artifactPolicy = parseArtifactPolicy(rawArtifactPolicy);
		if (artifactPolicy === undefined) {
			return {
				kind: "invalid",
				reason: catalogText(
					catalog,
					UI_LOCALE_MESSAGE_IDS.artifactPolicyFieldInvalid,
					describeInvalidArtifactField(rawArtifactPolicy),
				),
			};
		}
	}
	return {
		kind: "ok",
		settings: {
			schemaVersion: LOCALIZATION_SCHEMA_VERSION,
			...(schemaVersion === LOCALIZATION_LEGACY_SCHEMA_VERSION
				? { migratedFrom: LOCALIZATION_LEGACY_SCHEMA_VERSION }
				: {}),
			uiLocale: rawUiLocale ?? DEFAULT_UI_LOCALE_PREFERENCE,
			...(rawResponseLanguage !== undefined ? { responseLanguage: rawResponseLanguage } : {}),
			...(artifactPolicy !== undefined ? { artifactPolicy } : {}),
		},
	};
}

/** Project a parse result onto the legacy state the UI-locale resolver reads. */
function validateLocalizationContents(contents: string, catalog: CatalogBundle): LocalizationConfigState {
	const parse = parseLocalizationContents(contents, catalog);
	if (parse.kind === "ok") return { status: "ok", preference: parse.settings.uiLocale };
	if (parse.kind === "future") return { status: "future", schemaVersion: parse.schemaVersion };
	return { status: "invalid", reason: parse.reason };
}

/** Project a parse result onto the full settings state the language contract reads. */
function settingsStateForParse(parse: LocalizationParse): LocalizationSettingsState {
	if (parse.kind === "ok") {
		return { status: "ok", preference: parse.settings.uiLocale, settings: parse.settings };
	}
	if (parse.kind === "future") return { status: "future", schemaVersion: parse.schemaVersion };
	return { status: "invalid", reason: parse.reason };
}

function settingsStateForRawRead(raw: RawLocalizationRead, catalog: CatalogBundle): LocalizationSettingsState {
	if (raw.kind === "absent") return { status: "absent" };
	if (raw.kind === "rejected") return { status: "invalid", reason: raw.reason };
	return settingsStateForParse(parseLocalizationContents(raw.contents, catalog));
}

function stateForRawRead(raw: RawLocalizationRead, catalog: CatalogBundle): LocalizationConfigState {
	if (raw.kind === "absent") return { status: "absent" };
	if (raw.kind === "rejected") return { status: "invalid", reason: raw.reason };
	return validateLocalizationContents(raw.contents, catalog);
}

/**
 * Read and schema-validate `<configDir>/localization.json` without writing.
 *
 * The schema is strict: unknown top-level fields, unknown `localization`
 * fields, a wrong `schemaVersion`, and a non-string or unsupported `uiLocale`
 * all fail validation. A higher `schemaVersion` is reported as `future` so the
 * caller can fall back to English and leave the file intact. A file that is not
 * a regular file, or that exceeds the size limit, is reported as `invalid`.
 *
 * `catalog` supplies the `invalid` reason text; the default keeps English.
 */
export function readLocalizationConfig(
	configDir: string,
	catalog: CatalogBundle = defaultCatalog(),
): LocalizationConfigState {
	return stateForRawRead(readLocalizationRaw(configDir, catalog), catalog);
}

/**
 * Read and schema-validate `<configDir>/localization.json` into the full
 * settings state, including the language contract, without writing.
 *
 * This shares the strict reader and size/symlink rules with
 * `readLocalizationConfig`. A `schemaVersion: 1` file is migrated in memory to
 * the version 2 shape, so its `uiLocale` survives and its absent response
 * language and artifact policy fall through to the built-in default; the file
 * bytes are left unchanged. A higher `schemaVersion` is reported as `future`,
 * and a malformed or unsupported file as `invalid`.
 *
 * `catalog` supplies the `invalid` reason text; the default keeps English.
 */
export function readLocalizationSettings(
	configDir: string,
	catalog: CatalogBundle = defaultCatalog(),
): LocalizationSettingsState {
	return settingsStateForRawRead(readLocalizationRaw(configDir, catalog), catalog);
}

/**
 * Read the settings file together with the compare-and-swap token a later save
 * needs. Like `readLocalizationConfig`, this never writes; the token is the
 * exact bytes that were read (or the absence of the file).
 *
 * A save must use the same `catalog` for its snapshot and for the save, because
 * a rejected file's revision records the rendered reason text.
 */
export function readLocalizationConfigSnapshot(
	configDir: string,
	catalog: CatalogBundle = defaultCatalog(),
): LocalizationConfigSnapshot {
	const raw = readLocalizationRaw(configDir, catalog);
	if (raw.kind === "absent") return { state: { status: "absent" }, revision: { kind: "absent" } };
	if (raw.kind === "rejected") {
		return { state: { status: "invalid", reason: raw.reason }, revision: { kind: "rejected", reason: raw.reason } };
	}
	return {
		state: validateLocalizationContents(raw.contents, catalog),
		revision: { kind: "file", contents: raw.contents },
	};
}

function serializeLocalizationSettings(settings: LocalizationSettings): string {
	const localization: Record<string, unknown> = { uiLocale: settings.uiLocale };
	if (settings.responseLanguage !== undefined) localization.responseLanguage = settings.responseLanguage;
	if (settings.artifactPolicy !== undefined) localization.artifactPolicy = settings.artifactPolicy;
	return `${JSON.stringify({ schemaVersion: LOCALIZATION_SCHEMA_VERSION, localization }, null, 2)}\n`;
}

function revisionEquals(current: LocalizationConfigRevision, expected: LocalizationConfigRevision): boolean {
	if (current.kind !== expected.kind) return false;
	if (current.kind === "file" && expected.kind === "file") return current.contents === expected.contents;
	if (current.kind === "rejected" && expected.kind === "rejected") return current.reason === expected.reason;
	return true;
}

function isUnusable(state: LocalizationConfigState, revision: LocalizationConfigRevision): boolean {
	return revision.kind === "rejected" || state.status === "invalid" || state.status === "future";
}

function acquireLocalizationConfigLock(location: LocalizationConfigLocation, catalog: CatalogBundle): () => void {
	return acquireStateLock({
		path: join(location.stateDir, LOCALIZATION_LOCK_FILE_NAME),
		describe: "localization settings",
		onBusy: (inspection) =>
			new UiLocaleConfigError(
				inspection.status === "invalid"
					? catalogText(catalog, UI_LOCALE_MESSAGE_IDS.lockNotRegularFile)
					: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.lockBusy),
			),
	});
}

/**
 * Restore the exact pre-save bytes after a dependent write fails. This is
 * compensation, not a multi-file transaction: readers may have observed the
 * saved revision. The settings lock and revision comparison prevent recovery
 * from overwriting a later save. An absent original file is removed only when
 * its current bytes still match the revision this operation wrote.
 */
export function restoreLocalizationConfig(
	location: LocalizationConfigLocation,
	previous: LocalizationConfigSnapshot,
	written: LocalizationConfigSnapshot,
	catalog: CatalogBundle = defaultCatalog(),
): void {
	if (isUnusable(previous.state, previous.revision) || isUnusable(written.state, written.revision)) {
		throw new UiLocaleConfigError("refusing to overwrite localization settings that could not be read");
	}
	const release = acquireLocalizationConfigLock(location, catalog);
	try {
		validatePrivateDirectory(location.configDir);
		const current = readLocalizationConfigSnapshot(location.configDir, catalog);
		if (!revisionEquals(current.revision, written.revision)) throw new UiLocaleConflictError();
		const path = join(location.configDir, LOCALIZATION_FILE_NAME);
		if (previous.revision.kind === "file") {
			writeFilePrivateAtomic(path, previous.revision.contents, location.configDir);
		} else if (previous.revision.kind === "absent" && current.revision.kind === "file") {
			unlinkSync(path);
		}
	} finally {
		release();
	}
}

/**
 * An optional change to apply alongside the UI-locale save. An absent response
 * language or artifact field leaves its saved value untouched. The first-run
 * choice and Settings use this patch to save requested fields atomically.
 */
export interface LocalizationSavePatch {
	readonly responseLanguage?: ResponseLanguagePreference;
	readonly artifactPolicy?: PartialArtifactPolicy;
}

/**
 * Save the UI locale preference to `<configDir>/localization.json`.
 *
 * The write goes through `writeFilePrivateAtomic`, so a failure leaves the
 * previous file in place and a reader never observes a partial file. The save
 * runs under the state lock and compares the file against the revision captured
 * by `readLocalizationConfigSnapshot`: a change made after that read raises
 * `UiLocaleConflictError` instead of silently overwriting another session.
 *
 * A file that could not be read (a symlink, a non-regular file, an oversized
 * file, malformed content, or a newer schema) is never overwritten, following
 * the "if it cannot be read, do not write" policy.
 *
 * `patch` carries values written together with the UI locale; a caller that
 * passes only a preference preserves the rest of the contract.
 *
 * `catalog` supplies the lock diagnostic text. The same `catalog` must be used
 * to read the snapshot, because a rejected file's revision records the rendered
 * reason text.
 */
export function saveLocalizationConfig(
	location: LocalizationConfigLocation,
	preference: string,
	snapshot: LocalizationConfigSnapshot,
	catalog: CatalogBundle = defaultCatalog(),
	patch: LocalizationSavePatch = {},
): LocalizationConfigSnapshot {
	// Validate before any I/O so an unsupported value never reaches disk.
	const validated = assertWritableUiLocalePreference(preference);
	if (patch.responseLanguage !== undefined && !isResponseLanguagePreference(patch.responseLanguage)) {
		throw new UiLocaleConfigError(`unsupported response language preference: ${patch.responseLanguage}`);
	}
	const artifactPolicy = patch.artifactPolicy === undefined ? undefined : parseArtifactPolicy(patch.artifactPolicy);
	if (patch.artifactPolicy !== undefined && artifactPolicy === undefined) {
		throw new UiLocaleConfigError("unsupported artifact policy");
	}
	if (isUnusable(snapshot.state, snapshot.revision)) {
		throw new UiLocaleConfigError("refusing to overwrite localization settings that could not be read");
	}
	const release = acquireLocalizationConfigLock(location, catalog);
	try {
		// Check and replace under the lock, so two sessions cannot both pass the
		// comparison and then both write, which would drop one update.
		const current = readLocalizationConfigSnapshot(location.configDir, catalog);
		if (!revisionEquals(current.revision, snapshot.revision)) throw new UiLocaleConflictError();
		if (isUnusable(current.state, current.revision)) {
			throw new UiLocaleConfigError("refusing to overwrite localization settings that could not be read");
		}
		// Preserve the response language and artifact policy the file already
		// carries; a UI-locale save must not drop the rest of the contract. A
		// version 1 file contributes its migrated `uiLocale` only.
		const currentSettings = readLocalizationSettings(location.configDir, catalog);
		const base: LocalizationSettings =
			currentSettings.status === "ok"
				? currentSettings.settings
				: { schemaVersion: LOCALIZATION_SCHEMA_VERSION, uiLocale: DEFAULT_UI_LOCALE_PREFERENCE };
		const contents = serializeLocalizationSettings({
			...base,
			uiLocale: validated,
			...(patch.responseLanguage !== undefined ? { responseLanguage: patch.responseLanguage } : {}),
			...(artifactPolicy !== undefined && Object.keys(artifactPolicy).length > 0
				? { artifactPolicy: { ...base.artifactPolicy, ...artifactPolicy } }
				: {}),
		});
		if (Buffer.byteLength(contents) > LOCALIZATION_MAX_BYTES) {
			throw new UiLocaleConfigError(`localization settings exceed ${LOCALIZATION_MAX_BYTES} bytes`);
		}
		writeFilePrivateAtomic(join(location.configDir, LOCALIZATION_FILE_NAME), contents, location.configDir);
		return { state: { status: "ok", preference: validated }, revision: { kind: "file", contents } };
	} finally {
		release();
	}
}

/** The POSIX OS locale candidates in priority order: `LC_ALL`, `LC_MESSAGES`, `LANG`. */
export function osLocaleCandidates(env: NodeJS.ProcessEnv = process.env): readonly (string | undefined)[] {
	return [env.LC_ALL, env.LC_MESSAGES, env.LANG];
}

/**
 * Normalize a raw locale tag into a supported UI locale.
 *
 * The input may be a POSIX locale (`ja_JP.UTF-8`), a BCP-47 tag (`ja-JP`), or
 * one of the `C`/`POSIX` sentinels. Returns `undefined` when the value is
 * unsupported or ambiguous; the caller decides the fallback policy (the CLI
 * rejects, the saved setting is refused, and an OS candidate falls back to
 * `en` with a reason).
 *
 * Table:
 * - `C`, `POSIX`, `C.UTF-8`, `POSIX.UTF-8`, the empty string, and whitespace -> `en`
 * - any `en` tag (`en`, `en-US`, `en_GB`, `en_US.UTF-8`) -> `en`
 * - any `ja` tag (`ja`, `ja_JP`, `ja_JP.UTF-8`, `ja-JP`) -> `ja`
 * - `zh-Hans-*` and `zh-Hant-*` keep the script
 * - `zh-CN`, `zh-SG` -> `zh-Hans`; `zh-TW`, `zh-HK`, `zh-MO` -> `zh-Hant`
 * - a bare `zh`, an unknown `zh` region, and every other language -> `undefined`
 */
export function normalizeUiLocale(raw: string): UiLocale | undefined {
	if (typeof raw !== "string") return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return "en";
	// Strip the POSIX codeset and modifier (`ja_JP.UTF-8@modifier`).
	const base = trimmed.replace(/[.@].*$/u, "");
	if (base.length === 0) return undefined;
	if (/^(?:c|posix)$/iu.test(base)) return "en";
	const parts = base
		.replace(/_/gu, "-")
		.split("-")
		.filter((part) => part.length > 0);
	const language = parts[0]?.toLowerCase();
	if (language === "en") return "en";
	if (language === "ja") return "ja";
	if (language !== "zh") return undefined;
	const script = parts
		.slice(1)
		.find((part) => /^[a-z]{4}$/iu.test(part))
		?.toLowerCase();
	if (script === "hans") return "zh-Hans";
	if (script === "hant") return "zh-Hant";
	const region = parts
		.slice(1)
		.find((part) => /^(?:[a-z]{2}|[0-9]{3})$/iu.test(part))
		?.toUpperCase();
	if (region && HANS_REGIONS.has(region)) return "zh-Hans";
	if (region && HANT_REGIONS.has(region)) return "zh-Hant";
	return undefined;
}

/**
 * The inputs to the five-step resolution order: raw candidates, the validated
 * saved state, and the built-in default.
 */
export interface UiLocaleResolutionInput {
	/** The explicit option value, already validated by `args.ts`. */
	readonly cli?: string;
	/** The Jouzu environment variable value. */
	readonly env?: string;
	/** The saved state read from `<configDir>/localization.json`. */
	readonly config?: LocalizationConfigState;
	/** The OS locale candidates in priority order (`LC_ALL`, `LC_MESSAGES`, `LANG`). */
	readonly os?: readonly (string | undefined)[];
	/** The built-in default preference. */
	readonly builtin?: UiLocalePreference;
}

function fallbackResult(source: UiLocaleSource, raw: string, reason: string): ResolvedUiLocale {
	return {
		requested: DEFAULT_UI_LOCALE,
		effective: DEFAULT_UI_LOCALE,
		source,
		fallback: { requested: raw, effective: DEFAULT_UI_LOCALE, reason },
	};
}

function resolveAuto(
	requested: UiLocalePreference,
	os: readonly (string | undefined)[],
	builtin: UiLocalePreference,
	catalog: CatalogBundle,
): ResolvedUiLocale {
	for (const candidate of os) {
		if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
		const normalized = normalizeUiLocale(candidate);
		if (normalized) return { requested, effective: normalized, source: "os" };
		return {
			requested,
			effective: DEFAULT_UI_LOCALE,
			source: "os",
			fallback: {
				requested: candidate,
				effective: DEFAULT_UI_LOCALE,
				reason: catalogText(catalog, UI_LOCALE_MESSAGE_IDS.osCandidateUnsupported, { candidate }),
			},
		};
	}
	const effective = builtin === "auto" ? DEFAULT_UI_LOCALE : (normalizeUiLocale(builtin) ?? DEFAULT_UI_LOCALE);
	return { requested, effective, source: "builtin" };
}

/**
 * Resolve the UI locale in the fixed order: explicit option, `JOUZU_UI_LOCALE`,
 * the saved setting, the OS (`auto`), then the built-in default.
 *
 * Per-source policy for an unsupported raw value:
 * - an explicit option is a usage error (`UiLocaleUsageError`);
 * - the environment and the OS fall back to English, keeping the raw value and
 *   the reason in `fallback`;
 * - a saved setting that is unsupported, malformed, or from a future schema
 *   version falls back to English and is reported by the reader as `invalid`
 *   or `future`, so no write path ever rewrites it.
 *
 * `requested` is the resolved preference; when a raw value is unsupported,
 * `fallback.requested` carries the original raw string.
 *
 * `catalog` supplies the OS-candidate fallback reason; the default keeps
 * English.
 */
export function resolveUiLocale(
	input: UiLocaleResolutionInput = {},
	catalog: CatalogBundle = defaultCatalog(),
): ResolvedUiLocale {
	const builtin = input.builtin ?? DEFAULT_UI_LOCALE_PREFERENCE;
	const os = input.os ?? [];

	// 1. Explicit option.
	if (input.cli !== undefined) {
		if (input.cli === "auto") return resolveAuto("auto", os, builtin, catalog);
		if (isSupportedUiLocale(input.cli)) return { requested: input.cli, effective: input.cli, source: "cli" };
		throw new UiLocaleUsageError(input.cli);
	}

	// 2. Jouzu environment variable.
	if (input.env !== undefined && input.env.trim().length > 0) {
		if (input.env === "auto") return resolveAuto("auto", os, builtin, catalog);
		const normalized = normalizeUiLocale(input.env);
		if (normalized) return { requested: normalized, effective: normalized, source: "env" };
		return fallbackResult("env", input.env, `unsupported JOUZU_UI_LOCALE value: ${input.env}`);
	}

	// 3. Saved setting.
	const config = input.config ?? { status: "absent" };
	if (config.status === "ok") {
		if (config.preference === "auto") return resolveAuto("auto", os, builtin, catalog);
		return { requested: config.preference, effective: config.preference, source: "config" };
	}
	if (config.status === "future") {
		return fallbackResult(
			"config",
			`schemaVersion ${config.schemaVersion}`,
			`saved localization settings use schemaVersion ${config.schemaVersion}, which this build does not understand`,
		);
	}
	if (config.status === "invalid") {
		return fallbackResult("config", "unreadable", `saved localization settings are unusable: ${config.reason}`);
	}

	// 4. OS `auto`, then 5. the built-in default.
	return resolveAuto(builtin === "auto" ? "auto" : builtin, os, builtin, catalog);
}
