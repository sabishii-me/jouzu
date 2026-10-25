/**
 * The Fluent locale catalog loader for the Jouzu CLI.
 *
 * One namespace per locale lives at `locales/<locale>/cli.ftl` in the source
 * tree and at `dist/locales/<locale>/cli.ftl` in a build, next to
 * `locales/catalog.lock.json`. This module is the only reader of those files.
 * A locale may carry additional `*.ftl` files beside `cli.ftl`; the loader
 * reads every one of them in sorted order and merges them into one bundle, so a
 * parallel change can add a namespace without editing `cli.ftl`. The manifest's
 * `locales` entry keeps the `cli.ftl` digest, and its optional `extra` map
 * records the digest of each additional file as `<locale>/<file>`.
 * It is deliberately not imported at runtime from the default startup path:
 * `doctor` reaches it through a dynamic `import()` so Fluent stays out of the
 * startup module graph until a later issue wires the catalog in.
 *
 * The Fluent identifier is the stable dotted message ID with each `.` replaced
 * by `-`, because Fluent identifiers cannot contain a period. `catalogFluentId`
 * and `catalogMessageId` are the two halves of that transform; the catalog test
 * asserts the round trip for every `CliMessageId`.
 *
 * ## Trust and recovery
 *
 * `catalog.lock.json` records the catalog schema version and the SHA-256 of
 * each shipped catalog file. `loadCatalog` refuses a file whose bytes do not
 * match its recorded digest, so a corrupt or truncated catalog is detected even
 * though the Fluent runtime parser drops malformed messages silently.
 * `resolveCatalog` turns any load failure into the English fallback and the
 * catalog-independent `CATALOG_RECOVERY_TEXT`; it never throws for a missing or
 * damaged catalog. Run `node scripts/catalog-digest.mjs` to regenerate the lock
 * after editing a catalog.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FluentBundle, FluentResource, type FluentVariable, type Message } from "@fluent/bundle";
import { type HumanTextSegment, wrapHumanText } from "./command-report.js";
import type { ProtectedValue } from "./human-messages.js";

/** The locales that ship a CLI catalog. */
export const CATALOG_LOCALES = ["en", "ja"] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

/** The catalog schema version. Bump it when the ID or argument contract changes. */
export const CATALOG_VERSION = "2";

/** The catalog manifest file name inside a locales root. */
export const CATALOG_MANIFEST_FILE_NAME = "catalog.lock.json";

/**
 * The catalog-independent recovery sentence.
 *
 * It is a literal and is never read from a catalog, because it is shown when no
 * catalog can be read. It stays one short English sentence so a reader learns
 * what happened and what to do next without any locale data.
 */
export const CATALOG_RECOVERY_TEXT =
	'Jouzu could not read its interface catalog, so it is showing English; reinstall or repair Jouzu, then run "jouzu doctor".';

/**
 * The catalog IDs for the locale-selection reasons that replace the requested
 * locale. They are local to this module rather than added to the shared
 * `CatalogMessageId` table, so a parallel migration of another surface does
 * not conflict on that file; `scripts/check-locales.mjs` allows a catalog-only
 * ID present in both locales. The reasons stay diagnostics: they are resolved
 * from the effective `en` catalog and keep the English bytes the doctor report
 * already carries.
 */
const FALLBACK_NO_CATALOG_ID = "jouzu.cli.catalog.fallback.noCatalog";
const FALLBACK_UNSUPPORTED_ID = "jouzu.cli.catalog.fallback.unsupported";
const FALLBACK_CANONICAL_ID = "jouzu.cli.catalog.fallback.canonical";

/**
 * A catalog argument: a plain Fluent value, or a value the renderer must keep
 * whole. `ProtectedValue` is the same type the command report uses, so the
 * non-splitting rule has a single definition.
 */
export type CatalogArgument = FluentVariable | ProtectedValue;

/** Options for {@link CatalogBundle.render}. */
export interface CatalogRenderOptions {
	/** The terminal width in columns. */
	readonly columns: number;
}

/**
 * One resolved locale catalog.
 *
 * `messages` is keyed by the stable dotted ID and holds the runtime Fluent
 * message, so `render` can walk the pattern to keep protected values whole.
 * `format` is the plain string renderer for callers that do not need
 * segments; `render` is the display renderer that wraps a message at a width.
 */
export interface CatalogBundle {
	readonly locale: CatalogLocale;
	readonly version: string;
	/** SHA-256 of the catalog file bytes, lowercase hex. */
	readonly digest: string;
	readonly messages: Readonly<Record<string, Message>>;
	format(id: string, args?: Readonly<Record<string, FluentVariable>>): string;
	/**
	 * Render one message into display lines at `options.columns`.
	 *
	 * The catalog locale chooses the `wrapHumanText` line-breaking rules. A
	 * `ProtectedValue` argument is one segment, so it stays on a single line
	 * even when it is wider than the column, matching the
	 * `command-report.ts` non-splitting rule.
	 */
	render(
		id: string,
		args: Readonly<Record<string, CatalogArgument>> | undefined,
		options: CatalogRenderOptions,
	): string[];
}

/** The checked-in expected version and per-locale content digests. */
export interface CatalogManifest {
	readonly version: string;
	/** The `cli.ftl` digest for each locale. */
	readonly locales: Readonly<Record<string, string>>;
	/** The digest of each additional `*.ftl` file, keyed by `<locale>/<file>`. */
	readonly extra?: Readonly<Record<string, string>>;
}

export interface CatalogLoadOptions {
	/** Directory holding `<locale>/cli.ftl` and `catalog.lock.json`. Defaults to the bundled `dist/locales`. */
	localesRoot?: string;
}

/**
 * Raised when a catalog cannot be trusted: unreadable, corrupt, truncated, or
 * built against a different manifest. `reason` is a fixed English phrase, never
 * catalog content, so a recovery diagnostic can carry it safely.
 */
export class CatalogLoadError extends Error {
	readonly locale: CatalogLocale;
	readonly reason: string;

	constructor(locale: CatalogLocale, reason: string) {
		super(`catalog ${locale} could not be loaded: ${reason}`);
		this.name = "CatalogLoadError";
		this.locale = locale;
		this.reason = reason;
	}
}

/** Map a stable dotted message ID to its Fluent identifier. */
export function catalogFluentId(id: string): string {
	return id.replaceAll(".", "-");
}

/** Map a Fluent identifier back to its stable dotted message ID. */
export function catalogMessageId(fluentId: string): string {
	return fluentId.replaceAll("-", ".");
}

function localesRootFromOptions(localesRoot?: string): string {
	return localesRoot ?? fileURLToPath(new URL("./locales", import.meta.url));
}

/** Whether an argument is a value the wrapper must not split. */
function isProtectedValue(value: unknown): value is ProtectedValue {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { kind?: unknown }).kind === "string" &&
		typeof (value as { value?: unknown }).value === "string"
	);
}

/** Replace protected arguments with their text so Fluent can format a fallback element. */
function plainArguments(
	args: Readonly<Record<string, CatalogArgument>> | undefined,
): Record<string, FluentVariable> | undefined {
	if (args === undefined) return undefined;
	const plain: Record<string, FluentVariable> = {};
	for (const [name, value] of Object.entries(args)) {
		plain[name] = isProtectedValue(value) ? value.value : value;
	}
	return plain;
}

/**
 * Walk a parsed Fluent pattern into display segments.
 *
 * A literal and a placeholder Fluent formats itself (a number, a select, a
 * function, or a term) become text. A `ProtectedValue` argument becomes its own
 * segment so the wrapper keeps it whole. Each placeable is handed to Fluent on
 * its own, so its plural and number formatting still applies.
 */
function patternToSegments(
	bundle: FluentBundle,
	message: Message,
	args: Readonly<Record<string, CatalogArgument>> | undefined,
): HumanTextSegment[] {
	const pattern = message.value;
	if (pattern === null) throw new Error(`catalog message ${message.id} has no value`);
	const elements = typeof pattern === "string" ? [pattern] : pattern;
	const plain = plainArguments(args);
	const segments: HumanTextSegment[] = [];
	let literal = "";
	const flush = (): void => {
		if (literal !== "") {
			segments.push(literal);
			literal = "";
		}
	};
	for (const element of elements) {
		if (typeof element === "string") {
			literal += element;
			continue;
		}
		if (element.type === "var") {
			const value = args?.[element.name];
			if (isProtectedValue(value)) {
				flush();
				segments.push(value);
				continue;
			}
		}
		const errors: Error[] = [];
		literal += bundle.formatPattern([element], plain, errors);
		if (errors.length > 0) {
			throw new Error(`catalog message ${message.id}: ${errors.map((error) => error.message).join("; ")}`);
		}
	}
	flush();
	return segments;
}

/** The absolute path of one locale's primary catalog file. */
export function catalogFilePath(locale: CatalogLocale, localesRoot?: string): string {
	return join(localesRootFromOptions(localesRoot), locale, "cli.ftl");
}

/**
 * The additional `*.ftl` file names beside `cli.ftl` in one locale directory,
 * sorted so the load order and the recorded digests are deterministic.
 */
export function extraCatalogFiles(locale: CatalogLocale, localesRoot?: string): readonly string[] {
	const directory = join(localesRootFromOptions(localesRoot), locale);
	let entries: readonly string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return [];
	}
	return entries.filter((name) => name.endsWith(".ftl") && name !== "cli.ftl").sort();
}

/** The absolute path of the catalog manifest for a locales root. */
export function catalogManifestPath(localesRoot?: string): string {
	return join(localesRootFromOptions(localesRoot), CATALOG_MANIFEST_FILE_NAME);
}

function parseCatalogManifest(source: string): CatalogManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error("catalog manifest is not valid JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("catalog manifest must be an object");
	}
	const manifest = parsed as { version?: unknown; locales?: unknown; extra?: unknown };
	if (typeof manifest.version !== "string" || manifest.version.length === 0) {
		throw new Error("catalog manifest version must be a non-empty string");
	}
	if (typeof manifest.locales !== "object" || manifest.locales === null || Array.isArray(manifest.locales)) {
		throw new Error("catalog manifest locales must be an object");
	}
	const locales: Record<string, string> = {};
	for (const [locale, digest] of Object.entries(manifest.locales)) {
		if (typeof digest !== "string") throw new Error(`catalog manifest digest for ${locale} must be a string`);
		locales[locale] = digest;
	}
	let extra: Record<string, string> | undefined;
	if (manifest.extra !== undefined) {
		if (typeof manifest.extra !== "object" || manifest.extra === null || Array.isArray(manifest.extra)) {
			throw new Error("catalog manifest extra must be an object");
		}
		extra = {};
		for (const [key, digest] of Object.entries(manifest.extra)) {
			if (typeof digest !== "string") throw new Error(`catalog manifest extra digest for ${key} must be a string`);
			extra[key] = digest;
		}
	}
	return { version: manifest.version, locales, ...(extra ? { extra } : {}) };
}

/**
 * Whether a catalog locale uses the CJK line-breaking rules.
 *
 * The `ja` wrap rules split a CJK run at every character boundary and apply the
 * CJK line-start and line-end prohibitions. A Chinese catalog needs the same
 * rules, so `zh-Hans` and `zh-Hant` reuse them; only the wrap locale changes,
 * not the catalog identity.
 */
function isCjkCatalogLocale(locale: string): boolean {
	return locale === "ja" || locale === "zh-Hans" || locale === "zh-Hant";
}

/** Read and schema-validate `catalog.lock.json` without loading a catalog. */
export function readCatalogManifest(localesRoot?: string): CatalogManifest {
	const path = catalogManifestPath(localesRoot);
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch {
		throw new Error("catalog manifest could not be read");
	}
	return parseCatalogManifest(source);
}

/**
 * Read one locale catalog from disk.
 *
 * The file must match the digest recorded in `catalog.lock.json` and the
 * manifest must carry this build's `CATALOG_VERSION`; otherwise a
 * `CatalogLoadError` is raised. The digest check is what catches a corrupt or
 * truncated catalog, because the Fluent runtime parser drops a malformed
 * message silently. The build and check path runs `scripts/check-locales.mjs`
 * first, so a catalog that changed without regenerating the lock fails CI.
 */
export function loadCatalog(locale: CatalogLocale, options: CatalogLoadOptions = {}): CatalogBundle {
	let manifest: CatalogManifest;
	try {
		manifest = readCatalogManifest(options.localesRoot);
	} catch (error) {
		throw new CatalogLoadError(
			locale,
			error instanceof Error ? error.message : "the catalog manifest could not be read",
		);
	}
	if (manifest.version !== CATALOG_VERSION) {
		throw new CatalogLoadError(
			locale,
			`the catalog manifest version ${manifest.version} does not match this build (${CATALOG_VERSION})`,
		);
	}
	const expected = manifest.locales[locale];
	if (expected === undefined) {
		throw new CatalogLoadError(locale, "the catalog manifest records no digest");
	}
	const path = catalogFilePath(locale, options.localesRoot);
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch {
		throw new CatalogLoadError(locale, "the catalog file could not be read");
	}
	const digest = createHash("sha256").update(source).digest("hex");
	if (digest !== expected) {
		throw new CatalogLoadError(locale, "the catalog file does not match its recorded digest");
	}
	// Read every additional `*.ftl` file beside `cli.ftl`. Each must be recorded
	// in the manifest, so a file added without regenerating the lock is refused
	// rather than merged unverified.
	const extraFiles = extraCatalogFiles(locale, options.localesRoot);
	const discovered = new Set(extraFiles.map((name) => `${locale}/${name}`));
	for (const key of Object.keys(manifest.extra ?? {})) {
		if (key.startsWith(`${locale}/`) && !discovered.has(key)) {
			throw new CatalogLoadError(locale, `the recorded extra catalog file ${key} is missing`);
		}
	}
	const extraSources: Array<{ key: string; source: string }> = [];
	for (const name of extraFiles) {
		const key = `${locale}/${name}`;
		const recorded = manifest.extra?.[key];
		if (recorded === undefined) {
			throw new CatalogLoadError(locale, `the extra catalog file ${name} is not recorded in the manifest`);
		}
		let extraSource: string;
		try {
			extraSource = readFileSync(join(localesRootFromOptions(options.localesRoot), locale, name), "utf8");
		} catch {
			throw new CatalogLoadError(locale, `the extra catalog file ${name} could not be read`);
		}
		if (createHash("sha256").update(extraSource).digest("hex") !== recorded) {
			throw new CatalogLoadError(locale, `the extra catalog file ${name} does not match its recorded digest`);
		}
		extraSources.push({ key, source: extraSource });
	}
	const bundle = new FluentBundle(locale, { useIsolating: false });
	const messages: Record<string, Message> = {};
	const addSource = (label: string, text: string): void => {
		const resource = new FluentResource(text);
		const errors = bundle.addResource(resource);
		if (errors.length > 0) {
			throw new CatalogLoadError(
				locale,
				`the catalog file ${label} is not valid Fluent (${errors.length} message error(s))`,
			);
		}
		for (const entry of resource.body) {
			if (entry.id.startsWith("-")) continue; // A Fluent term, not a message ID.
			const id = catalogMessageId(entry.id);
			if (messages[id] !== undefined) {
				throw new CatalogLoadError(locale, `the catalog file ${label} redefines the message id ${id}`);
			}
			messages[id] = entry;
		}
	};
	addSource("cli.ftl", source);
	for (const extra of extraSources) addSource(extra.key, extra.source);
	return {
		locale,
		version: CATALOG_VERSION,
		digest,
		messages,
		format(id, args) {
			const message = messages[id];
			if (message?.value === null || message?.value === undefined) {
				throw new Error(`unknown catalog message id: ${id}`);
			}
			const formatErrors: Error[] = [];
			const text = bundle.formatPattern(message.value, args, formatErrors);
			if (formatErrors.length > 0) {
				throw new Error(`catalog ${locale} message ${id}: ${formatErrors.map((error) => error.message).join("; ")}`);
			}
			return text;
		},
		render(id, args, options) {
			const message = messages[id];
			if (message?.value === null || message?.value === undefined) {
				throw new Error(`unknown catalog message id: ${id}`);
			}
			return wrapHumanText(patternToSegments(bundle, message, args), {
				columns: options.columns,
				locale: isCjkCatalogLocale(locale) ? "ja" : "en",
			});
		},
	};
}

/**
 * Canonicalize a locale tag to its language, or language plus script, form.
 *
 * The script is preserved, so `zh-Hans` and `zh-Hant` stay distinct and can
 * never resolve to each other. A POSIX codeset or modifier is stripped and a
 * bare language is lowercased; anything without a 2-3 letter language is
 * undefined.
 */
export function canonicalCatalogLocale(raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;
	const base = trimmed.replace(/[.@].*$/u, "").replace(/_/gu, "-");
	const parts = base.split("-").filter((part) => part.length > 0);
	const language = parts[0]?.toLowerCase();
	if (!language || !/^[a-z]{2,3}$/u.test(language)) return undefined;
	const scriptPart = parts.slice(1).find((part) => /^[a-z]{4}$/iu.test(part));
	if (!scriptPart) return language;
	const script = `${scriptPart[0].toUpperCase()}${scriptPart.slice(1).toLowerCase()}`;
	return `${language}-${script}`;
}

function isCatalogLocale(value: string): value is CatalogLocale {
	return (CATALOG_LOCALES as readonly string[]).includes(value);
}

/** Why a requested catalog locale was replaced by another catalog. */
export interface CatalogFallback {
	/** The raw value that was requested, before normalization. */
	readonly requested: string;
	/** The locale whose catalog was used instead. */
	readonly effective: string;
	/** A human-readable reason, kept for diagnostics. */
	readonly reason: string;
}

/** The outcome of resolving a requested locale to a shipped catalog. */
export interface CatalogResolution {
	/** What was asked for. */
	readonly requested: string;
	/** The locale whose catalog is in `bundle`. */
	readonly effective: CatalogLocale;
	/** The loaded catalog, or the catalog-independent recovery bundle. */
	readonly bundle: CatalogBundle;
	/** Present only when the request did not match a catalog exactly. */
	readonly fallback?: CatalogFallback;
}

/**
 * The minimal catalog-independent bundle. It carries no messages and its
 * `format` returns the recovery sentence, so a caller still renders English
 * when even the `en` catalog cannot be read.
 */
function recoveryBundle(): CatalogBundle {
	return {
		locale: "en",
		version: CATALOG_VERSION,
		digest: "unavailable",
		messages: {},
		format() {
			return CATALOG_RECOVERY_TEXT;
		},
		render(_id, _args, options) {
			return wrapHumanText(CATALOG_RECOVERY_TEXT, { columns: options.columns, locale: "en" });
		},
	};
}

/**
 * Resolve a requested locale to a shipped catalog in the fixed order:
 *
 * 1. an exact locale match (`ja`);
 * 2. the canonical language or script locale (`ja-JP` -> `ja`, `zh-Hans` ->
 *    `zh-Hans`), which is then looked up as a catalog;
 * 3. English.
 *
 * The script is preserved during canonicalization, so `zh-Hans` and `zh-Hant`
 * each fall through to English and never to each other.
 *
 * A catalog that is missing, corrupt, or truncated never throws. The English
 * catalog is used instead, and when even that fails the catalog-independent
 * recovery bundle keeps the process alive; either way `fallback.reason` carries
 * `CATALOG_RECOVERY_TEXT`.
 */
export function resolveCatalog(locale: string, options: CatalogLoadOptions = {}): CatalogResolution {
	const requested = locale;
	const exact = requested.trim().toLowerCase();
	let effective: CatalogLocale;
	let reason: string | undefined;
	let reasonId: string | undefined;
	let reasonArgs: Record<string, string> | undefined;
	if (isCatalogLocale(exact)) {
		effective = exact;
	} else {
		const canonical = canonicalCatalogLocale(requested);
		if (canonical && isCatalogLocale(canonical)) {
			effective = canonical;
			reasonId = FALLBACK_CANONICAL_ID;
			reasonArgs = { requested, canonical };
		} else {
			effective = "en";
			if (canonical) {
				reasonId = FALLBACK_NO_CATALOG_ID;
				reasonArgs = { requested, canonical };
			} else {
				reasonId = FALLBACK_UNSUPPORTED_ID;
				reasonArgs = { requested };
			}
		}
	}
	try {
		const bundle = loadCatalog(effective, options);
		if (reasonId !== undefined) reason = bundle.format(reasonId, reasonArgs);
		return {
			requested,
			effective,
			bundle,
			...(reason ? { fallback: { requested, effective, reason } } : {}),
		};
	} catch {
		let bundle: CatalogBundle;
		try {
			bundle = loadCatalog("en", options);
		} catch {
			bundle = recoveryBundle();
		}
		return {
			requested,
			effective: "en",
			bundle,
			fallback: { requested, effective: "en", reason: CATALOG_RECOVERY_TEXT },
		};
	}
}

/** The locale catalog facts `doctor` renders without carrying a live bundle. */
export interface CatalogSummary {
	readonly requested: string;
	readonly effective: CatalogLocale;
	readonly version: string;
	readonly digest: string;
	readonly fallbackReason?: string;
}

/** Reduce a resolution to the plain values diagnostics need. */
export function summarizeCatalog(resolution: CatalogResolution): CatalogSummary {
	return {
		requested: resolution.requested,
		effective: resolution.effective,
		version: resolution.bundle.version,
		digest: resolution.bundle.digest,
		...(resolution.fallback ? { fallbackReason: resolution.fallback.reason } : {}),
	};
}
