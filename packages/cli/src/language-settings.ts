/**
 * The response-language and artifact-policy value sets, their resolution order,
 * and the trusted project-policy reader.
 *
 * This module is the language contract's independent layer. It resolves the
 * response language and the artifact policy without reading the operating
 * system locale or the UI locale: the resolution inputs have no field for
 * either, so a UI-locale change cannot move them. The UI locale itself stays in
 * `ui-locale.ts`; the two only meet in the settings file, where each field is
 * validated on its own.
 *
 * The response language resolves in the order explicit CLI value, session
 * value, saved settings, built-in default. The artifact policy resolves per
 * field in the order task-explicit value, trusted project policy, session
 * value, saved settings, built-in default.
 *
 * The project policy is read from `<repository root>/.jouzu/localization.json`
 * and only when the caller reports that repository as trusted. A repository
 * whose trust cannot be established is treated as untrusted, so an untrusted
 * file is never opened and can never change a resolution or the global
 * settings.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import { protectedSourceError } from "./human-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";

/** The fixed response languages, in the same tag set as the UI locales. */
export const RESPONSE_LANGUAGES = ["en", "ja", "zh-Hans", "zh-Hant"] as const;
export type ResponseLanguage = (typeof RESPONSE_LANGUAGES)[number];

/** A requested response language: a fixed language, or `auto` for no instruction. */
export const RESPONSE_LANGUAGE_PREFERENCES = ["auto", ...RESPONSE_LANGUAGES] as const;
export type ResponseLanguagePreference = (typeof RESPONSE_LANGUAGE_PREFERENCES)[number];

/** Which step of the response-language order supplied the effective value. */
export const RESPONSE_LANGUAGE_SOURCES = ["cli", "session", "config", "builtin"] as const;
export type ResponseLanguageSource = (typeof RESPONSE_LANGUAGE_SOURCES)[number];

/** The built-in response language: no fixed instruction. */
export const DEFAULT_RESPONSE_LANGUAGE: ResponseLanguagePreference = "auto";

/** The artifact languages, ordered from "keep as-is" to a specific language. */
export const ARTIFACT_LANGUAGES = ["preserve", "project", "en", "ja", "zh-Hans", "zh-Hant"] as const;
export type ArtifactLanguage = (typeof ARTIFACT_LANGUAGES)[number];

/** The artifact policy fields. Each resolves independently through the same order. */
export const ARTIFACT_POLICY_FIELDS = ["comments", "documentation", "commits", "reviews"] as const;
export type ArtifactPolicyField = (typeof ARTIFACT_POLICY_FIELDS)[number];

/** A complete artifact policy: one artifact language per field. */
export type ArtifactPolicy = { readonly [field in ArtifactPolicyField]: ArtifactLanguage };

/** A partial artifact policy, as one source may supply it. */
export type PartialArtifactPolicy = { readonly [field in ArtifactPolicyField]?: ArtifactLanguage };

/** Which step of the artifact-policy order supplied a field. */
export const ARTIFACT_POLICY_SOURCES = ["task", "project", "session", "config", "builtin"] as const;
export type ArtifactPolicySource = (typeof ARTIFACT_POLICY_SOURCES)[number];

/**
 * The built-in artifact policy.
 *
 * Comments are preserved as written; documentation, commit messages, and
 * review text follow the project's existing language.
 */
export const DEFAULT_ARTIFACT_POLICY: ArtifactPolicy = Object.freeze({
	comments: "preserve",
	documentation: "project",
	commits: "project",
	reviews: "project",
});

/** The project-policy directory inside a repository root. */
export const PROJECT_POLICY_DIRECTORY = ".jouzu";
/** The project-policy file name inside the project directory. */
export const PROJECT_POLICY_FILE_NAME = "localization.json";
/** The largest accepted project-policy file, so a hostile file cannot exhaust memory. */
export const PROJECT_POLICY_MAX_BYTES = 4096;

/**
 * The catalog IDs for the project-policy diagnostics.
 *
 * They stay local to this module instead of joining the shared message table,
 * which keeps the project-policy diagnostics together. `check-locales.mjs`
 * accepts a catalog-only ID that is present in both locales.
 */
const PROJECT_POLICY_MESSAGE_IDS = {
	notInspected: "jouzu.cli.projectPolicy.notInspected",
	notRegularFile: "jouzu.cli.projectPolicy.notRegularFile",
	tooLarge: "jouzu.cli.projectPolicy.tooLarge",
	invalidJson: "jouzu.cli.projectPolicy.invalidJson",
	notObject: "jouzu.cli.projectPolicy.notObject",
	artifactPolicyNotObject: "jouzu.cli.projectPolicy.artifactPolicyNotObject",
} as const;

/**
 * Raised when a resolution input carries an unsupported explicit
 * response-language value. It carries the same exit code as an argument
 * `UsageError`.
 */
export class ResponseLanguageUsageError extends Error {
	readonly exitCode = 2;

	constructor(value: string) {
		super(`the response language must be one of: ${RESPONSE_LANGUAGE_PREFERENCES.join(", ")} (got ${value})`);
		this.name = "ResponseLanguageUsageError";
	}
}

/** Whether a value is a fixed response language. */
export function isResponseLanguage(value: string): value is ResponseLanguage {
	return (RESPONSE_LANGUAGES as readonly string[]).includes(value);
}

/** Whether a value is `auto` or a fixed response language. */
export function isResponseLanguagePreference(value: string): value is ResponseLanguagePreference {
	return value === "auto" || isResponseLanguage(value);
}

/** Whether a value is a supported artifact language. */
export function isArtifactLanguage(value: string): value is ArtifactLanguage {
	return (ARTIFACT_LANGUAGES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read an artifact policy out of an untrusted value.
 *
 * Unknown keys are rejected so a typo cannot silently drop a setting, and every
 * present field must be a supported artifact language. An absent field stays
 * absent, so a source supplies only what it defines. Returns `undefined` when
 * the value is not an object or carries an invalid field.
 */
export function parseArtifactPolicy(value: unknown): PartialArtifactPolicy | undefined {
	if (!isPlainObject(value)) return undefined;
	if (!Object.keys(value).every((key) => (ARTIFACT_POLICY_FIELDS as readonly string[]).includes(key))) {
		return undefined;
	}
	const policy: Partial<Record<ArtifactPolicyField, ArtifactLanguage>> = {};
	for (const field of ARTIFACT_POLICY_FIELDS) {
		const raw = value[field];
		if (raw === undefined) continue;
		if (typeof raw !== "string" || !isArtifactLanguage(raw)) return undefined;
		policy[field] = raw;
	}
	return policy;
}

/** Whether a partial policy supplies at least one field. */
export function hasArtifactPolicyFields(policy: PartialArtifactPolicy | undefined): policy is PartialArtifactPolicy {
	return policy !== undefined && ARTIFACT_POLICY_FIELDS.some((field) => policy[field] !== undefined);
}

/** Render a policy as stable `field=value` pairs, in the canonical field order. */
export function formatArtifactPolicy(policy: PartialArtifactPolicy | undefined): string {
	if (policy === undefined) return "";
	return ARTIFACT_POLICY_FIELDS.filter((field) => policy[field] !== undefined)
		.map((field) => `${field}=${policy[field]}`)
		.join(" ");
}

/**
 * The outcome of resolving a response language.
 *
 * `requested` is the preference the winning source supplied; `effective` is the
 * value that applies (`auto` means no fixed language instruction). `fallback`
 * is present only when a rejected raw session value was replaced.
 */
export interface ResolvedResponseLanguage {
	readonly requested: ResponseLanguagePreference;
	readonly effective: ResponseLanguagePreference;
	readonly source: ResponseLanguageSource;
	readonly fallback?: {
		readonly requested: string;
		readonly effective: ResponseLanguagePreference;
		readonly reason: string;
	};
}

/** The inputs to the response-language order. There is no OS or UI input by design. */
export interface ResponseLanguageResolutionInput {
	/** The explicit CLI option value. */
	readonly cli?: string;
	/** The session-scoped value. */
	readonly session?: string;
	/** The value saved in `<configDir>/localization.json`. */
	readonly config?: ResponseLanguagePreference;
	/** The built-in default preference. */
	readonly builtin?: ResponseLanguagePreference;
}

function responseFallback(raw: string, catalog: CatalogBundle): ResolvedResponseLanguage {
	return {
		requested: DEFAULT_RESPONSE_LANGUAGE,
		effective: DEFAULT_RESPONSE_LANGUAGE,
		source: "session",
		fallback: {
			requested: raw,
			effective: DEFAULT_RESPONSE_LANGUAGE,
			reason: catalogText(catalog, "jouzu.cli.localization.responseLanguageUnsupported", { value: raw }),
		},
	};
}

/**
 * Resolve the response language in the fixed order: explicit CLI value,
 * session value, saved setting, built-in default.
 *
 * An unsupported explicit value is a usage error. An unsupported session value
 * falls back to the built-in default with the raw value and reason in
 * `fallback`. The OS locale and the UI locale are never consulted: the input
 * has no field for them.
 */
export function resolveResponseLanguage(
	input: ResponseLanguageResolutionInput = {},
	catalog: CatalogBundle = defaultCatalog(),
): ResolvedResponseLanguage {
	const builtin = input.builtin ?? DEFAULT_RESPONSE_LANGUAGE;

	// 1. Explicit CLI value.
	if (input.cli !== undefined) {
		if (isResponseLanguagePreference(input.cli)) {
			return { requested: input.cli, effective: input.cli, source: "cli" };
		}
		throw new ResponseLanguageUsageError(input.cli);
	}

	// 2. Session value.
	if (input.session !== undefined && input.session.trim().length > 0) {
		if (isResponseLanguagePreference(input.session)) {
			return { requested: input.session, effective: input.session, source: "session" };
		}
		return responseFallback(input.session, catalog);
	}

	// 3. Saved setting.
	if (input.config !== undefined && isResponseLanguagePreference(input.config)) {
		return { requested: input.config, effective: input.config, source: "config" };
	}

	// 4. Built-in default.
	const effective = isResponseLanguagePreference(builtin) ? builtin : DEFAULT_RESPONSE_LANGUAGE;
	return { requested: effective, effective, source: "builtin" };
}

/**
 * The outcome of resolving an artifact policy.
 *
 * `requested` is the partial policy the dominant source supplied; `effective`
 * is the full policy after the per-field merge. `fieldSources` records which
 * source supplied each effective field, so a partial project policy stays
 * visible.
 */
export interface ResolvedArtifactPolicy {
	readonly requested: PartialArtifactPolicy;
	readonly effective: ArtifactPolicy;
	readonly source: ArtifactPolicySource;
	readonly fieldSources: Readonly<Record<ArtifactPolicyField, ArtifactPolicySource>>;
}

/** The inputs to the artifact-policy order, from highest to lowest priority. */
export interface ArtifactPolicyResolutionInput {
	/** The task's explicit policy. */
	readonly task?: PartialArtifactPolicy;
	/** The policy from a trusted project's `.jouzu/localization.json`. */
	readonly project?: PartialArtifactPolicy;
	/** The session-scoped policy. */
	readonly session?: PartialArtifactPolicy;
	/** The policy saved in `<configDir>/localization.json`. */
	readonly config?: PartialArtifactPolicy;
	/** The built-in default policy. */
	readonly builtin?: ArtifactPolicy;
}

const ARTIFACT_SOURCE_ORDER: readonly ArtifactPolicySource[] = ARTIFACT_POLICY_SOURCES;

/**
 * Resolve the artifact policy per field in the order task, trusted project,
 * session, saved setting, built-in default.
 *
 * Each field takes the first source in that order that defines it. `source` is
 * the highest-priority source that defined any field, and `requested` is that
 * source's partial policy. An untrusted project contributes nothing: the caller
 * passes no `project` value for it, so its file is never consulted here.
 */
export function resolveArtifactPolicy(input: ArtifactPolicyResolutionInput = {}): ResolvedArtifactPolicy {
	const builtin = input.builtin ?? DEFAULT_ARTIFACT_POLICY;
	const supplied: Readonly<Record<ArtifactPolicySource, PartialArtifactPolicy | undefined>> = {
		task: input.task,
		project: input.project,
		session: input.session,
		config: input.config,
		builtin,
	};
	const effective: Record<ArtifactPolicyField, ArtifactLanguage> = { ...builtin };
	const fieldSources = {} as Record<ArtifactPolicyField, ArtifactPolicySource>;
	for (const field of ARTIFACT_POLICY_FIELDS) {
		for (const source of ARTIFACT_SOURCE_ORDER) {
			const value = supplied[source]?.[field];
			if (value !== undefined) {
				effective[field] = value;
				fieldSources[field] = source;
				break;
			}
		}
	}
	const dominant = ARTIFACT_SOURCE_ORDER.find((source) => hasArtifactPolicyFields(supplied[source]));
	const source = dominant ?? "builtin";
	return {
		requested: { ...(supplied[source] ?? {}) },
		effective,
		source,
		fieldSources,
	};
}

/** The resolved path of the project policy for a repository root. */
export function projectPolicyPath(repositoryRoot: string): string {
	return join(repositoryRoot, PROJECT_POLICY_DIRECTORY, PROJECT_POLICY_FILE_NAME);
}

/**
 * The read-only state of a repository's project policy.
 *
 * `untrusted` means the caller did not report the repository as trusted, so the
 * file was never opened. `absent` means there is no file. `ok` carries the
 * partial policy the file defined. `invalid` means the file is unreadable,
 * malformed, or carries an unsupported field; a reader must leave it untouched.
 */
export type ProjectPolicyState =
	| { readonly status: "untrusted" }
	| { readonly status: "absent" }
	| { readonly status: "ok"; readonly artifactPolicy: PartialArtifactPolicy }
	| { readonly status: "invalid"; readonly reason: string };

/**
 * Read a repository's project policy, honoring only `localization.artifactPolicy`.
 *
 * The file is opened only when `options.trusted` is true; an untrusted or
 * unknown repository returns `untrusted` without touching the filesystem, so a
 * repository cannot influence a resolution by placing a file. `responseLanguage`
 * and `uiLocale` in the file are ignored: the project policy carries no
 * response language. This reader never writes, and it never touches the global
 * settings file.
 */
export function readProjectArtifactPolicy(
	repositoryRoot: string,
	options: { readonly trusted: boolean },
	catalog: CatalogBundle = defaultCatalog(),
): ProjectPolicyState {
	if (!options.trusted) return { status: "untrusted" };
	const path = projectPolicyPath(repositoryRoot);
	if (!existsSync(path)) return { status: "absent" };
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(path);
	} catch {
		return { status: "invalid", reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.notInspected) };
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		return { status: "invalid", reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.notRegularFile) };
	}
	if (metadata.size > PROJECT_POLICY_MAX_BYTES) {
		return {
			status: "invalid",
			reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.tooLarge, {
				maxBytes: String(PROJECT_POLICY_MAX_BYTES),
			}),
		};
	}
	let contents: string;
	try {
		contents = readFileSync(path, "utf8");
	} catch (error) {
		return {
			status: "invalid",
			reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.invalidJson, {
				message: protectedSourceError(error instanceof Error ? error.message : String(error)),
			}),
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		return {
			status: "invalid",
			reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.invalidJson, {
				message: protectedSourceError(error instanceof Error ? error.message : String(error)),
			}),
		};
	}
	if (!isPlainObject(parsed)) {
		return { status: "invalid", reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.notObject) };
	}
	// Only `localization.artifactPolicy` is honored. `responseLanguage` and
	// `uiLocale` are ignored, so a repository cannot set the response language.
	const localization = parsed.localization;
	if (!isPlainObject(localization)) return { status: "absent" };
	const rawPolicy = localization.artifactPolicy;
	if (rawPolicy === undefined) return { status: "absent" };
	if (!isPlainObject(rawPolicy)) {
		return { status: "invalid", reason: catalogText(catalog, PROJECT_POLICY_MESSAGE_IDS.artifactPolicyNotObject) };
	}
	const policy = parseArtifactPolicy(rawPolicy);
	if (policy === undefined) {
		return {
			status: "invalid",
			reason: catalogText(
				catalog,
				"jouzu.cli.localization.artifactPolicyFieldInvalid",
				describeInvalidArtifactField(rawPolicy),
			),
		};
	}
	if (!hasArtifactPolicyFields(policy)) return { status: "absent" };
	return { status: "ok", artifactPolicy: policy };
}

/**
 * Name the first invalid artifact-policy field and value, for a diagnostic.
 * Exported so the settings-file parser reports the same detail.
 */
export function describeInvalidArtifactField(value: Record<string, unknown>): { field: string; value: string } {
	for (const field of ARTIFACT_POLICY_FIELDS) {
		const raw = value[field];
		if (raw === undefined) continue;
		if (typeof raw !== "string" || !isArtifactLanguage(raw)) {
			return { field, value: typeof raw === "string" ? raw : String(raw) };
		}
	}
	const unknown = Object.keys(value).find((key) => !(ARTIFACT_POLICY_FIELDS as readonly string[]).includes(key));
	return { field: unknown ?? "artifactPolicy", value: String(JSON.stringify(value)) };
}
