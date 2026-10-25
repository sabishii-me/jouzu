import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { parseStrictJson } from "./model-catalog.js";
import type { JouzuPaths } from "./paths.js";
import { writeFilePrivateAtomic } from "./private-fs.js";

/**
 * A ceiling on the context window Jouzu reports for every model. Pi derives
 * its compaction threshold, the footer percentage, and the picker fit check
 * from the model's `contextWindow`, so the clamp is applied when provider
 * models are registered rather than at the compaction call site.
 */
export interface ContextPolicyFile {
	schemaVersion: 1;
	maxContextTokens: number;
}

export interface LoadedContextPolicy {
	/** Absent when the clamp is off or the file could not be read. */
	maxContextTokens?: number;
	/** Present when a stored file exists but was rejected. */
	error?: string;
}

/** Preset ceilings, in decimal tokens so every value renders as a round label. */
export const CONTEXT_CLAMP_CHOICES: readonly number[] = [
	128_000, 192_000, 256_000, 384_000, 512_000, 768_000, 1_000_000,
];

const POLICY_MAX_BYTES = 8 * 1024;
const POLICY_MIN_TOKENS = 1_024;
const POLICY_MAX_TOKENS = 100_000_000;
const POLICY_SCHEMA_VERSION = 1;

/**
 * The catalog IDs for the stored-context-policy diagnostics.
 *
 * They are local to this module rather than added to the shared
 * `CatalogMessageId` table, so a parallel migration of another surface does
 * not conflict on that file; `scripts/check-locales.mjs` allows a catalog-only
 * ID present in both locales. The Settings view renders `error` inside
 * `jouzu.cli.settings.contextLimitNotApplied`, so the text is user-facing; a
 * caller that has a resolved catalog passes it in, and the default keeps the
 * English bytes the module already produced.
 *
 * The byte limits, the schema version, and the token bounds are protected
 * values passed as string arguments, so Fluent never reformats them (a number
 * argument would gain locale grouping separators).
 */
const CONTEXT_POLICY_MESSAGE_IDS = {
	notBoundedFile: "jouzu.cli.context.policy.notBoundedFile",
	notObject: "jouzu.cli.context.policy.notObject",
	unknownKeys: "jouzu.cli.context.policy.unknownKeys",
	schemaVersionRequired: "jouzu.cli.context.policy.schemaVersionRequired",
	maxTokensRange: "jouzu.cli.context.policy.maxTokensRange",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function contextPolicyPath(paths: JouzuPaths): string {
	return join(paths.configDir, "context-policy.json");
}

/**
 * Read the stored clamp. A rejected file reports an error and behaves as off.
 *
 * `catalog` supplies the diagnostic text, so a caller with a resolved bundle
 * (the Settings view) renders the cause in the active locale. The default is
 * the English bundle, which keeps the previous English bytes.
 */
export function loadContextPolicy(paths: JouzuPaths, catalog: CatalogBundle = defaultCatalog()): LoadedContextPolicy {
	const path = contextPolicyPath(paths);
	if (!existsSync(path)) return {};
	try {
		const metadata = lstatSync(path);
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > POLICY_MAX_BYTES) {
			return { error: catalogText(catalog, CONTEXT_POLICY_MESSAGE_IDS.notBoundedFile) };
		}
		const value = parseStrictJson(readFileSync(path, "utf8"));
		if (!isRecord(value)) return { error: catalogText(catalog, CONTEXT_POLICY_MESSAGE_IDS.notObject) };
		const unknown = Object.keys(value).filter((key) => key !== "schemaVersion" && key !== "maxContextTokens");
		if (unknown.length > 0) {
			return { error: catalogText(catalog, CONTEXT_POLICY_MESSAGE_IDS.unknownKeys, { keys: unknown.join(", ") }) };
		}
		if (value.schemaVersion !== POLICY_SCHEMA_VERSION) {
			return {
				error: catalogText(catalog, CONTEXT_POLICY_MESSAGE_IDS.schemaVersionRequired, {
					version: String(POLICY_SCHEMA_VERSION),
				}),
			};
		}
		const maxContextTokens = value.maxContextTokens;
		if (maxContextTokens === undefined) return {};
		if (
			typeof maxContextTokens !== "number" ||
			!Number.isInteger(maxContextTokens) ||
			maxContextTokens < POLICY_MIN_TOKENS ||
			maxContextTokens > POLICY_MAX_TOKENS
		) {
			return {
				error: catalogText(catalog, CONTEXT_POLICY_MESSAGE_IDS.maxTokensRange, {
					min: String(POLICY_MIN_TOKENS),
					max: String(POLICY_MAX_TOKENS),
				}),
			};
		}
		return { maxContextTokens };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/** Store the clamp, or remove the file when the ceiling is off. */
export function writeContextPolicy(paths: JouzuPaths, maxContextTokens: number | undefined): void {
	const path = contextPolicyPath(paths);
	if (maxContextTokens === undefined) {
		rmSync(path, { force: true });
		return;
	}
	const file: ContextPolicyFile = { schemaVersion: POLICY_SCHEMA_VERSION, maxContextTokens };
	writeFilePrivateAtomic(path, `${JSON.stringify(file, null, 2)}\n`, paths.configDir);
}

/**
 * The clamp read for model composition. A rejected file is reported by the
 * Settings view through `loadContextPolicy`, not by failing registration.
 */
export function activeContextClamp(paths: JouzuPaths | undefined): number | undefined {
	if (!paths) return undefined;
	return loadContextPolicy(paths).maxContextTokens;
}

export function clampContextWindow(contextWindow: number | undefined, clamp: number | undefined): number | undefined {
	if (clamp === undefined || contextWindow === undefined || contextWindow <= clamp) return contextWindow;
	return clamp;
}

export function clampModelContextWindow<T extends { contextWindow?: number }>(model: T, clamp: number | undefined): T {
	const contextWindow = clampContextWindow(model.contextWindow, clamp);
	return contextWindow === model.contextWindow ? model : { ...model, contextWindow };
}

export function modelsExceedContextClamp(
	models: readonly { contextWindow?: number }[],
	clamp: number | undefined,
): boolean {
	if (clamp === undefined) return false;
	return models.some((model) => model.contextWindow !== undefined && model.contextWindow > clamp);
}

/** Step through the preset ladder; an off clamp enters at the first preset. */
export function stepContextClamp(current: number | undefined, direction: -1 | 1): number | undefined {
	if (current === undefined) return direction === 1 ? CONTEXT_CLAMP_CHOICES[0] : undefined;
	const next =
		direction === 1
			? CONTEXT_CLAMP_CHOICES.find((choice) => choice > current)
			: [...CONTEXT_CLAMP_CHOICES].reverse().find((choice) => choice < current);
	return next;
}

export function formatContextClamp(maxContextTokens: number | undefined): string {
	if (maxContextTokens === undefined) return "Off";
	if (maxContextTokens >= 1_000_000) return `${Math.round(maxContextTokens / 100_000) / 10}M`;
	return `${Math.round(maxContextTokens / 1_000)}K`;
}
