/**
 * The recorded source version and review status of each shipped catalog.
 *
 * `locales/catalog-status.json` records, for every catalog in
 * `locales/catalog.lock.json`, the source version the translation was made
 * against, the SHA-256 of the source `cli.ftl` at that time, and whether a
 * person has recorded a review. The lock answers "are these bytes the ones we
 * shipped?"; this record answers "what were these bytes translated from, and
 * has the source moved since?".
 *
 * ## The support state
 *
 * A locale's support state is derived, never stored, so the record cannot
 * claim a state the catalogs contradict. The states are the identifiers
 * `complete`, `partial`, `stale`, `fallback`, `unsupported`, and
 * `upstream-owned`. They stay in English in every locale: they are machine
 * vocabulary a user reads in `jz doctor`, like an error code.
 *
 * This module derives the per-catalog states. `fallback` is not a catalog
 * state: it is what the resolver does at request time when the requested
 * locale has no offered catalog, and `resolveCatalog` already reports it.
 * `upstream-owned` is not a catalog state either: it is the disposition of a
 * display surface owned by the pinned Pi or a third-party extension, recorded
 * by the upstream boundary record.
 *
 * Precedence, highest first:
 *
 * 1. `unsupported` — the locale has no recorded catalog, its review is not
 *    recorded, or its catalog cannot be loaded. It is not offered.
 * 2. `stale` — the source `cli.ftl` digest differs from the recorded one, so
 *    the source changed after the translation was made.
 * 3. `partial` — the catalog carries fewer message IDs than the source. The
 *    locale check requires equal sets, so a committed catalog is never
 *    partial; the state is a diagnostic for a catalog that has not been
 *    checked.
 * 4. `complete` — reviewed, offered, and matching the recorded source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_LOCALES, loadCatalog, readCatalogManifest } from "./locale-catalog.js";

/** The status record file name inside a locales root. */
export const CATALOG_STATUS_FILE_NAME = "catalog-status.json";

/** The status record schema version. Bump it when the record shape changes. */
export const CATALOG_STATUS_VERSION = "1";

/**
 * The support-state vocabulary. `complete`, `partial`, and `stale` describe one
 * catalog; `fallback` describes a resolved request; `unsupported` describes a
 * locale that is not offered; `upstream-owned` describes a display surface
 * owned outside Jouzu.
 */
export const CATALOG_SUPPORT_STATES = [
	"complete",
	"partial",
	"stale",
	"fallback",
	"unsupported",
	"upstream-owned",
] as const;
export type CatalogSupportState = (typeof CATALOG_SUPPORT_STATES)[number];

/** One catalog's recorded translation source and review status. */
export interface CatalogStatusEntry {
	/** The Jouzu and Pi version the translation was made against, e.g. `0.1.19`. */
	readonly sourceVersion: string;
	/** SHA-256 of the source `cli.ftl` when the translation was made, lowercase hex. */
	readonly sourceDigest: string;
	/** Whether a person has recorded a review for this catalog. */
	readonly reviewed: boolean;
	/** Where the review is recorded, when there is one. */
	readonly reviewRecord?: string;
}

/** The parsed `catalog-status.json`. */
export interface CatalogStatusRecord {
	readonly version: string;
	/** The locale whose catalog is the source every other locale is translated from. */
	readonly sourceLocale: string;
	readonly locales: Readonly<Record<string, CatalogStatusEntry>>;
}

/** One locale's derived support state. */
export interface CatalogSupportEntry {
	readonly locale: string;
	readonly state: CatalogSupportState;
}

export interface CatalogStatusLoadOptions {
	/** Directory holding `<locale>/cli.ftl`, `catalog.lock.json`, and the record. Defaults to the bundled `dist/locales`. */
	readonly localesRoot?: string;
}

function localesRootFromOptions(localesRoot?: string): string {
	return localesRoot ?? fileURLToPath(new URL("./locales", import.meta.url));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCatalogStatus(source: string): CatalogStatusRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		throw new Error("catalog status is not valid JSON");
	}
	if (!isPlainObject(parsed)) throw new Error("catalog status must be an object");
	if (typeof parsed.version !== "string" || parsed.version.length === 0) {
		throw new Error("catalog status version must be a non-empty string");
	}
	if (typeof parsed.sourceLocale !== "string" || parsed.sourceLocale.length === 0) {
		throw new Error("catalog status sourceLocale must be a non-empty string");
	}
	if (!isPlainObject(parsed.locales)) throw new Error("catalog status locales must be an object");
	const locales: Record<string, CatalogStatusEntry> = {};
	for (const [locale, value] of Object.entries(parsed.locales)) {
		if (!isPlainObject(value)) throw new Error(`catalog status entry for ${locale} must be an object`);
		const { sourceVersion, sourceDigest, reviewed, reviewRecord } = value;
		if (typeof sourceVersion !== "string" || sourceVersion.length === 0) {
			throw new Error(`catalog status sourceVersion for ${locale} must be a non-empty string`);
		}
		if (typeof sourceDigest !== "string" || !/^[0-9a-f]{64}$/u.test(sourceDigest)) {
			throw new Error(`catalog status sourceDigest for ${locale} must be a lowercase SHA-256`);
		}
		if (typeof reviewed !== "boolean") throw new Error(`catalog status reviewed for ${locale} must be a boolean`);
		if (reviewRecord !== undefined && (typeof reviewRecord !== "string" || reviewRecord.length === 0)) {
			throw new Error(`catalog status reviewRecord for ${locale} must be a non-empty string`);
		}
		locales[locale] = {
			sourceVersion,
			sourceDigest,
			reviewed,
			...(typeof reviewRecord === "string" ? { reviewRecord } : {}),
		};
	}
	return { version: parsed.version, sourceLocale: parsed.sourceLocale, locales };
}

/**
 * Read and schema-validate `catalog-status.json`.
 *
 * Throws for a missing, unreadable, or malformed record. `catalogSupportStates`
 * and `catalogSupportState` catch that and report every locale `unsupported`,
 * so a broken record never stops `doctor`.
 */
export function readCatalogStatus(options: CatalogStatusLoadOptions = {}): CatalogStatusRecord {
	const path = join(localesRootFromOptions(options.localesRoot), CATALOG_STATUS_FILE_NAME);
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch {
		throw new Error("catalog status could not be read");
	}
	return parseCatalogStatus(source);
}

/** The current source digest and message-ID count, read once per state pass. */
interface StatusContext {
	readonly record: CatalogStatusRecord;
	/** The current source `cli.ftl` digest, or undefined when the lock cannot be read. */
	readonly sourceDigest: string | undefined;
	/** The source message IDs, or undefined when the source catalog cannot be parsed. */
	readonly sourceMessageIds: ReadonlySet<string> | undefined;
}

function loadStatusContext(options: CatalogStatusLoadOptions): StatusContext | undefined {
	let record: CatalogStatusRecord;
	try {
		record = readCatalogStatus(options);
	} catch {
		return undefined;
	}
	let sourceDigest: string | undefined;
	try {
		sourceDigest = readCatalogManifest(options.localesRoot).locales[record.sourceLocale];
	} catch {
		sourceDigest = undefined;
	}
	let sourceMessageIds: ReadonlySet<string> | undefined;
	if (isOfferedCatalogLocale(record.sourceLocale)) {
		try {
			sourceMessageIds = new Set(Object.keys(loadCatalog(record.sourceLocale, options).messages));
		} catch {
			sourceMessageIds = undefined;
		}
	}
	return { record, sourceDigest, sourceMessageIds };
}

function isOfferedCatalogLocale(locale: string): locale is (typeof CATALOG_LOCALES)[number] {
	return (CATALOG_LOCALES as readonly string[]).includes(locale);
}

function stateForEntry(
	locale: string,
	entry: CatalogStatusEntry,
	context: StatusContext,
	options: CatalogStatusLoadOptions,
): CatalogSupportState {
	// A locale whose review is not recorded is not offered, whatever its bytes say.
	if (!entry.reviewed) return "unsupported";
	// A reviewed but unoffered catalog is not part of the support stage either.
	if (!isOfferedCatalogLocale(locale)) return "unsupported";
	// Without a readable source digest the record cannot be verified; the
	// catalog is not offered rather than silently reported complete.
	if (context.sourceDigest === undefined) return "unsupported";
	if (entry.sourceDigest !== context.sourceDigest) return "stale";
	// The message-set check needs both catalogs; when the source cannot be parsed
	// the digest check above is the whole comparison.
	if (context.sourceMessageIds === undefined) return "complete";
	let messageIds: ReadonlySet<string>;
	try {
		messageIds = new Set(Object.keys(loadCatalog(locale, options).messages));
	} catch {
		return "unsupported";
	}
	for (const id of context.sourceMessageIds) {
		if (!messageIds.has(id)) return "partial";
	}
	return "complete";
}

/**
 * The derived support state of every recorded locale, in record order.
 *
 * Returns an empty list when the record cannot be read, so a caller reports
 * `unavailable` rather than inventing a state.
 */
export function catalogSupportStates(options: CatalogStatusLoadOptions = {}): readonly CatalogSupportEntry[] {
	const context = loadStatusContext(options);
	if (context === undefined) return [];
	const entries: CatalogSupportEntry[] = [];
	for (const locale of Object.keys(context.record.locales)) {
		const entry = context.record.locales[locale];
		entries.push({ locale, state: stateForEntry(locale, entry, context, options) });
	}
	return entries;
}

/**
 * The derived support state of one locale.
 *
 * A locale with no recorded catalog is `unsupported`; the empty list from
 * `catalogSupportStates` is not a state, so an unreadable record is reported
 * as `unsupported` here rather than as a missing entry.
 */
export function catalogSupportState(locale: string, options: CatalogStatusLoadOptions = {}): CatalogSupportState {
	const context = loadStatusContext(options);
	if (context === undefined) return "unsupported";
	const entry = context.record.locales[locale];
	if (entry === undefined) return "unsupported";
	return stateForEntry(locale, entry, context, options);
}

/** The recorded locales whose review is complete, in record order. */
export function reviewedCatalogLocales(options: CatalogStatusLoadOptions = {}): readonly string[] {
	let record: CatalogStatusRecord;
	try {
		record = readCatalogStatus(options);
	} catch {
		return [];
	}
	return Object.keys(record.locales).filter((locale) => record.locales[locale].reviewed);
}
