#!/usr/bin/env node

/**
 * Validate the CLI Fluent catalogs.
 *
 * Runs in `npm run check` so a broken catalog fails CI, not only a test. The
 * checks are:
 *
 * 1. `@fluent/syntax` parses every recorded catalog with no `Junk` entries. The
 *    runtime parser in `@fluent/bundle` drops a malformed message silently, so
 *    this is the only place a syntax error is reported.
 * 2. The `en` catalog carries every `CliMessageId` value from
 *    `packages/cli/src/human-messages.ts`, every `CatalogMessageId` value from
 *    `packages/cli/src/cli-messages.ts`, and every `FlowStatusMessageId` value
 *    from `packages/cli/src/flow-control/flow-status-context.ts`; an extra ID
 *    that has no table entry is allowed, because the catalog may add catalog-only
 *    messages. Each Fluent identifier maps back to its stable dotted ID without
 *    collision, and no stable ID carries a hyphen (the dotted-to-Fluent
 *    transform would not round-trip).
 * 3. `en` and every other recorded catalog carry the same message ID set.
 * 4. For every message, `en` and every other recorded catalog reference the
 *    same argument names.
 * 5. For every argument, the structural use (a plain value, a select selector,
 *    or a function argument) is the same in every locale.
 * 6. `catalog.lock.json` records this build's `CATALOG_VERSION` and the SHA-256
 *    of every catalog file. A locale may carry additional `*.ftl` files beside
 *    `cli.ftl`; each is validated here and recorded under the lock's `extra`
 *    map as `<locale>/<file>`. A digest mismatch, or an extra file that is
 *    present but unrecorded (or recorded but missing), means a catalog changed
 *    without a regenerated lock; run `node scripts/catalog-digest.mjs` to fix it.
 * 7. No catalog value carries an ANSI escape, a control character, or a
 *    bidirectional control character. A line feed is reported by the layout
 *    check below, because a wrapped value is a layout artifact, not text.
 * 8. No catalog value carries its own Fluent key, a hard wrap, a line padded to
 *    a column, or a run of spaces that looks like a hand wrap. The renderer owns
 *    wrapping and spacing, so a value stays one logical line with single spaces.
 * 9. `catalog-status.json` records the source version, the source digest, and
 *    the review status of every catalog the lock records. The offered set
 *    (`CATALOG_LOCALES`) must be a subset of the reviewed locales, so a locale
 *    whose human review is not recorded is never offered. A stale record is a
 *    display state, not a check failure; only a malformed or inconsistent
 *    record fails here.
 *
 * Fluent does not encode an argument's JavaScript type, so the "type" checked
 * here is the AST use. A variable used as a plain value in one locale and as a
 * select selector in the other is a mismatch.
 *
 * The forbidden-character and layout checks read the parsed literal text, not
 * the raw file, so Fluent's own indentation stripping is already applied and a
 * value's rendered characters are what gets checked.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lineOffset, parse } from "@fluent/syntax";

const root = resolve(import.meta.dirname, "..");
// The locales that ship a reviewed interface catalog.
const LOCALES = ["en", "ja"];
const failures = [];

/** Resolve `--locales-root <dir>`, used by the catalog test to point at a mutated copy. */
function localesRootFromArguments(argv) {
	const index = argv.indexOf("--locales-root");
	if (index === -1) return resolve(root, "packages", "cli", "locales");
	const value = argv[index + 1];
	if (!value) throw new Error("--locales-root requires a directory");
	return resolve(value);
}

const localesRoot = localesRootFromArguments(process.argv.slice(2));

/**
 * The catalog locales recorded in `catalog.lock.json`, in lock order.
 *
 * The digest script records every catalog directory, drafts included, so the
 * lock is the set of catalogs to validate. A catalog is held to the `en`
 * contract as soon as it is recorded, but it is not offered as an interface
 * language until its review record exists; the draft stays out of
 * `CATALOG_LOCALES`.
 */
function readRecordedLocales() {
	try {
		const manifest = JSON.parse(readFileSync(resolve(localesRoot, "catalog.lock.json"), "utf8"));
		const locales = manifest?.locales;
		if (locales === null || typeof locales !== "object" || Array.isArray(locales)) return [];
		return Object.keys(locales);
	} catch {
		// A missing or unreadable lock is reported by `checkCatalogDigests`; fall
		// back to the offered set so the other checks still run.
		return [];
	}
}

const ALL_LOCALES = [...LOCALES, ...readRecordedLocales().filter((locale) => !LOCALES.includes(locale))];

function fail(message) {
	failures.push(message);
}

/** The catalog key transform, mirrored in `packages/cli/src/locale-catalog.ts`. */
function fluentId(id) {
	return id.replaceAll(".", "-");
}

/** Map a Fluent identifier back to its stable dotted ID. */
function catalogMessageId(key) {
	return key.replaceAll("-", ".");
}

/** Read `CATALOG_VERSION` from the loader, so the lock and the runtime cannot drift. */
function readCatalogVersion() {
	const path = resolve(root, "packages", "cli", "src", "locale-catalog.ts");
	const source = readFileSync(path, "utf8");
	const match = source.match(/export const CATALOG_VERSION = "([^"]+)"/u);
	if (!match) throw new Error(`could not locate CATALOG_VERSION in ${path}`);
	return match[1];
}

/** Read `CATALOG_STATUS_VERSION` from the status module, so the record and the runtime cannot drift. */
function readCatalogStatusVersion() {
	const path = resolve(root, "packages", "cli", "src", "locale-status.ts");
	const source = readFileSync(path, "utf8");
	const match = source.match(/export const CATALOG_STATUS_VERSION = "([^"]+)"/u);
	if (!match) throw new Error(`could not locate CATALOG_STATUS_VERSION in ${path}`);
	return match[1];
}

/**
 * Read the offered catalog set from the loader.
 *
 * The set is the product's claim about which interface languages it supports,
 * so the review record has to agree with it. Reading the source keeps this
 * check next to the value it protects rather than duplicating it here.
 */
function readOfferedLocales() {
	const path = resolve(root, "packages", "cli", "src", "locale-catalog.ts");
	const source = readFileSync(path, "utf8");
	const match = source.match(/export const CATALOG_LOCALES = \[([^\]]*)\]/u);
	if (!match) throw new Error(`could not locate CATALOG_LOCALES in ${path}`);
	return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

/** The `*.ftl` files of one locale, `cli.ftl` first and the rest sorted. */
function localeCatalogFiles(locale) {
	const directory = resolve(localesRoot, locale);
	let entries;
	try {
		entries = readdirSync(directory);
	} catch (error) {
		fail(`${locale}: cannot read the catalog directory ${directory}: ${error.message}`);
		return [];
	}
	return ["cli.ftl", ...entries.filter((name) => name.endsWith(".ftl") && name !== "cli.ftl").sort()];
}

/** Read and validate `catalog.lock.json` against the catalogs on disk. */
function checkCatalogDigests() {
	const path = resolve(localesRoot, "catalog.lock.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`cannot read the catalog lock ${path}: ${error.message}`);
		return;
	}
	if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
		fail(`${path}: catalog lock must be an object`);
		return;
	}
	const expectedVersion = readCatalogVersion();
	if (manifest.version !== expectedVersion) {
		fail(
			`${path}: catalog lock version ${JSON.stringify(manifest.version)} does not match CATALOG_VERSION ${expectedVersion}`,
		);
	}
	const recorded = manifest.locales;
	if (recorded === null || typeof recorded !== "object" || Array.isArray(recorded)) {
		fail(`${path}: catalog lock locales must be an object`);
		return;
	}
	const recordedExtra = manifest.extra;
	if (
		recordedExtra !== undefined &&
		(recordedExtra === null || typeof recordedExtra !== "object" || Array.isArray(recordedExtra))
	) {
		fail(`${path}: catalog lock extra must be an object`);
		return;
	}
	for (const locale of ALL_LOCALES) {
		let digest;
		try {
			digest = createHash("sha256")
				.update(readFileSync(resolve(localesRoot, locale, "cli.ftl")))
				.digest("hex");
		} catch (error) {
			fail(`${locale}: cannot read the catalog for digesting: ${error.message}`);
			continue;
		}
		if (recorded[locale] !== digest) {
			fail(`${locale}: catalog digest ${digest} does not match the lock; run "node scripts/catalog-digest.mjs"`);
		}
		// Every additional `*.ftl` file must be recorded, and every recorded entry
		// must exist: a file added or removed without regenerating the lock is a
		// failure, not a silent change.
		const present = new Set(localeCatalogFiles(locale).filter((name) => name !== "cli.ftl"));
		for (const name of present) {
			const key = `${locale}/${name}`;
			if (recordedExtra?.[key] === undefined) {
				fail(
					`${locale}: extra catalog file ${name} is not recorded in the lock; run "node scripts/catalog-digest.mjs"`,
				);
			}
		}
		for (const key of Object.keys(recordedExtra ?? {})) {
			if (!key.startsWith(`${locale}/`)) continue;
			const name = key.slice(locale.length + 1);
			if (!present.has(name)) {
				fail(`${locale}: the lock records extra catalog file ${name}, which is missing`);
				continue;
			}
			let digest;
			try {
				digest = createHash("sha256")
					.update(readFileSync(resolve(localesRoot, locale, name)))
					.digest("hex");
			} catch (error) {
				fail(`${locale}: cannot read extra catalog file ${name} for digesting: ${error.message}`);
				continue;
			}
			if (recordedExtra[key] !== digest) {
				fail(
					`${locale}: extra catalog digest ${digest} for ${name} does not match the lock; run "node scripts/catalog-digest.mjs"`,
				);
			}
		}
	}
}

/**
 * Validate `catalog-status.json` against the lock and the offered set.
 *
 * The record names, for every catalog the lock records, the source version and
 * source digest the translation was made against and whether a person has
 * recorded a review. This check does not fail on a stale record: stale is a
 * support state the product displays, not a broken build. It fails on a record
 * that cannot be trusted or that contradicts the offered set, because the
 * support stage must not claim a locale whose human review is not recorded.
 */
function checkCatalogStatus() {
	const path = resolve(localesRoot, "catalog-status.json");
	let status;
	try {
		status = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`${path}: cannot read the catalog status record: ${error.message}`);
		return;
	}
	if (status === null || typeof status !== "object" || Array.isArray(status)) {
		fail(`${path}: catalog status record must be an object`);
		return;
	}
	const expectedVersion = readCatalogStatusVersion();
	if (status.version !== expectedVersion) {
		fail(
			`${path}: catalog status version ${JSON.stringify(status.version)} does not match CATALOG_STATUS_VERSION ${expectedVersion}`,
		);
	}
	if (typeof status.sourceLocale !== "string" || status.sourceLocale.length === 0) {
		fail(`${path}: sourceLocale must be a non-empty string`);
		return;
	}
	const recorded = status.locales;
	if (recorded === null || typeof recorded !== "object" || Array.isArray(recorded)) {
		fail(`${path}: locales must be an object`);
		return;
	}

	let locked;
	try {
		locked = Object.keys(JSON.parse(readFileSync(resolve(localesRoot, "catalog.lock.json"), "utf8")).locales);
	} catch {
		// A missing or unreadable lock is already reported by `checkCatalogDigests`.
		locked = [];
	}

	const reviewed = new Set();
	for (const [locale, entry] of Object.entries(recorded)) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			fail(`${path}: ${locale} must be an object`);
			continue;
		}
		if (typeof entry.sourceVersion !== "string" || entry.sourceVersion.length === 0) {
			fail(`${path}: ${locale} sourceVersion must be a non-empty string`);
		}
		if (typeof entry.sourceDigest !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sourceDigest)) {
			fail(`${path}: ${locale} sourceDigest must be a lowercase SHA-256`);
		}
		if (typeof entry.reviewed !== "boolean") {
			fail(`${path}: ${locale} reviewed must be a boolean`);
		} else if (entry.reviewed) {
			reviewed.add(locale);
		}
		if (
			entry.reviewRecord !== undefined &&
			(typeof entry.reviewRecord !== "string" || entry.reviewRecord.length === 0)
		) {
			fail(`${path}: ${locale} reviewRecord must be a non-empty string`);
		}
		if (locked.length > 0 && !locked.includes(locale)) {
			fail(`${path}: ${locale} is recorded but the lock does not record it`);
		}
	}
	for (const locale of locked) {
		if (!Object.hasOwn(recorded, locale)) fail(`${path}: the lock records ${locale}, which the status record does not`);
	}
	if (locked.length > 0 && !Object.hasOwn(recorded, status.sourceLocale)) {
		fail(`${path}: sourceLocale ${status.sourceLocale} is not recorded`);
	}

	// The offered set is the product's support claim, so every offered locale must
	// have a recorded review. An unreviewed locale stays out of `CATALOG_LOCALES`.
	for (const locale of readOfferedLocales()) {
		if (!reviewed.has(locale)) fail(`${path}: ${locale} is offered but its review is not recorded`);
	}
}

/** Read the stable message ID list from the hand-maintained `CliMessageId` table. */
function readStableMessageIds() {
	return readIdTable("human-messages.ts", "CliMessageId");
}

/**
 * Read the catalog-only ID table. These IDs have no `human-messages.ts` entry,
 * but the identifier rule applies to them exactly as it does to the legacy
 * ones.
 */
function readCatalogMessageIds() {
	return [
		...readIdTable("cli-messages.ts", "CatalogMessageId"),
		...readIdTable("flow-control/flow-status-context.ts", "FlowStatusMessageId"),
	];
}

/** Extract the `: "..."` values of one `export const <name> = { ... } as const` table. */
function readIdTable(fileName, tableName) {
	const path = resolve(root, "packages", "cli", "src", fileName);
	const source = readFileSync(path, "utf8");
	const block = source.match(new RegExp(`export const ${tableName} = \\{([\\s\\S]*?)\\n\\} as const;`, "u"));
	if (!block) throw new Error(`could not locate the ${tableName} table in ${path}`);
	const ids = [...block[1].matchAll(/:\s*"([^"]+)"/gu)].map((match) => match[1]);
	if (ids.length === 0) throw new Error(`the ${tableName} table in ${path} listed no IDs`);
	return ids;
}

/** One AST node's role, used to compare argument use across locales. */
function expressionArguments(expression, add) {
	switch (expression.type) {
		case "VariableReference":
			add(expression.id.name, "value");
			return;
		case "SelectExpression":
			if (expression.selector.type === "VariableReference") {
				add(expression.selector.id.name, "selector");
			} else {
				expressionArguments(expression.selector, add);
			}
			for (const variant of expression.variants) {
				patternArguments(variant.value, add);
			}
			return;
		case "FunctionReference":
			for (const argument of expression.arguments.positional) {
				if (argument.type === "VariableReference") {
					add(argument.id.name, `function:${expression.id.name}`);
				} else {
					expressionArguments(argument, add);
				}
			}
			for (const argument of expression.arguments.named) {
				if (argument.value.type === "VariableReference") add(argument.value.id.name, "value");
			}
			return;
		case "TermReference":
			for (const argument of expression.arguments?.positional ?? []) {
				if (argument.type === "VariableReference") add(argument.id.name, "value");
				else expressionArguments(argument, add);
			}
			return;
		default:
			return;
	}
}

function patternArguments(pattern, add) {
	if (pattern === null) return;
	for (const element of pattern.elements) {
		if (element.type === "Placeable") expressionArguments(element.expression, add);
	}
}

/** Bidi control characters, by Unicode code point, that must never appear in catalog text. */
const BIDI_CONTROLS = new Set([
	"\u061C", // ARABIC LETTER MARK
	"\u200E", // LEFT-TO-RIGHT MARK
	"\u200F", // RIGHT-TO-LEFT MARK
	"\u202A", // LEFT-TO-RIGHT EMBEDDING
	"\u202B", // RIGHT-TO-LEFT EMBEDDING
	"\u202C", // POP DIRECTIONAL FORMATTING
	"\u202D", // LEFT-TO-RIGHT OVERRIDE
	"\u202E", // RIGHT-TO-LEFT OVERRIDE
	"\u2066", // LEFT-TO-RIGHT ISOLATE
	"\u2067", // RIGHT-TO-LEFT ISOLATE
	"\u2068", // FIRST STRONG ISOLATE
	"\u2069", // POP DIRECTIONAL ISOLATE
]);

const ANSI_ESCAPE = "\u001B";
const LINE_FEED = "\n";

/** Escape a literal string for use inside a regular expression. */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Format one code point as `U+XXXX` for a failure message. */
function codePointLabel(character) {
	return `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Every literal `TextElement` string inside a node, in source order.
 *
 * The walk is recursive so a select variant, a function argument, or an
 * attribute value is checked too, not only the top-level pattern. A catalog
 * value is everything Fluent can render from the message.
 */
function literalTexts(node, texts = []) {
	if (node === null || typeof node !== "object") return texts;
	if (Array.isArray(node)) {
		for (const item of node) literalTexts(item, texts);
		return texts;
	}
	if (node.type === "TextElement" && typeof node.value === "string") {
		texts.push(node.value);
		return texts;
	}
	for (const value of Object.values(node)) literalTexts(value, texts);
	return texts;
}

/** Every literal string of a message: its value, attributes, and nested variants. */
function messageTexts(message) {
	return literalTexts(message);
}

/**
 * Reject a value that carries a terminal escape, a control character, or a
 * bidirectional control character. A line feed is skipped here because the
 * layout check reports it as a hard wrap, which is the more specific diagnosis.
 * Each distinct offending character is reported once per message.
 */
function checkValueCharacters(locale, id, text) {
	const reported = new Set();
	for (const character of text) {
		if (character === LINE_FEED) continue;
		let kind;
		if (character === ANSI_ESCAPE) kind = "an ANSI escape";
		else if (BIDI_CONTROLS.has(character)) kind = "a bidirectional control character";
		else if (/\p{Cc}/u.test(character)) kind = "a control character";
		else continue;
		const finding = `${kind} ${codePointLabel(character)}`;
		if (reported.has(finding)) continue;
		reported.add(finding);
		fail(`${locale}: "${id}": value contains ${finding}`);
	}
}

/**
 * Reject a value that carries its own Fluent key, is hard wrapped, is padded to
 * a column, or holds a run of spaces that looks like a hand wrap. The renderer
 * owns wrapping and spacing, so these are artifacts of editing a rendered line
 * back into the catalog.
 */
function checkValueLayout(locale, id, text) {
	for (const key of [id, id.replaceAll("-", ".")]) {
		if (new RegExp(`${escapeRegExp(key)}\\s*=`, "u").test(text)) {
			fail(`${locale}: "${id}": value carries its own Fluent key "${key}"`);
			break;
		}
	}
	const padded = /\n[ ]/u.test(text) || /[ ]\n/u.test(text);
	if (padded) {
		fail(`${locale}: "${id}": value has a line padded to a column`);
	} else if (text.includes(LINE_FEED)) {
		fail(`${locale}: "${id}": value contains a hard wrap`);
	}
	if (!padded && / {2,}/u.test(text)) {
		fail(`${locale}: "${id}": value contains a run of spaces that looks like a hand-wrapped line`);
	}
}

/** Argument name -> set of structural roles, collected over the value and attributes. */
function collectArguments(message) {
	const args = new Map();
	const add = (name, role) => {
		const roles = args.get(name) ?? new Set();
		roles.add(role);
		args.set(name, roles);
	};
	patternArguments(message.value, add);
	for (const attribute of message.attributes) patternArguments(attribute.value, add);
	return args;
}

function readCatalog(locale) {
	const messages = new Map();
	for (const name of localeCatalogFiles(locale)) {
		const path = resolve(localesRoot, locale, name);
		let source;
		try {
			source = readFileSync(path, "utf8");
		} catch (error) {
			fail(`${locale}: cannot read ${path}: ${error.message}`);
			continue;
		}
		const resource = parse(source, { withSpans: true });
		for (const entry of resource.body) {
			if (entry.type === "Junk") {
				for (const annotation of entry.annotations) {
					const line = annotation.span ? lineOffset(source, annotation.span.start) : "?";
					fail(`${locale}/${name}:${line}: syntax error: ${annotation.message}`);
				}
				continue;
			}
			if (entry.type !== "Message") continue;
			const id = entry.id.name;
			if (messages.has(id)) {
				fail(`${locale}: duplicate message id "${id}"`);
				continue;
			}
			messages.set(id, entry);
		}
	}
	return messages;
}

function compareArguments(locale, id, expected, actual) {
	for (const name of expected.keys()) {
		if (!actual.has(name)) fail(`${locale}: "${id}": missing argument "$${name}"`);
	}
	for (const name of actual.keys()) {
		if (!expected.has(name)) fail(`${locale}: "${id}": extra argument "$${name}"`);
	}
	for (const [name, expectedRoles] of expected) {
		const actualRoles = actual.get(name);
		if (!actualRoles) continue;
		for (const role of expectedRoles) {
			if (!actualRoles.has(role)) {
				fail(
					`${locale}: "${id}": argument "$${name}" is used as ${role} in en but as ${[...actualRoles].join(", ")} here`,
				);
			}
		}
	}
}

const stableIds = readStableMessageIds();
const catalogIds = readCatalogMessageIds();
const catalogs = new Map(ALL_LOCALES.map((locale) => [locale, readCatalog(locale)]));

// The identifier rule applies to every table ID, legacy or catalog-only: a
// stable dotted ID must not contain a hyphen, because the dotted-to-Fluent
// transform would lose it on the way back.
for (const id of [...stableIds, ...catalogIds]) {
	if (id.includes("-")) fail(`stable ID must not contain a hyphen: ${id}`);
}

// The en catalog is the source of the ID contract: it must carry every stable
// ID. It may also carry an extra catalog-only ID, so a new message does not have to add
// a `human-messages.ts` entry for every new message.
const en = catalogs.get("en");
const seenFluentIds = new Set();
for (const id of [...stableIds, ...catalogIds]) {
	const key = fluentId(id);
	if (seenFluentIds.has(key)) fail(`en: the Fluent identifier "${key}" maps from more than one stable ID`);
	seenFluentIds.add(key);
	if (!en.has(key)) fail(`en: missing message id "${key}" for stable ID "${id}"`);
}

// Every catalog ID must round-trip through the Fluent transform, and an extra
// ID with no table entry is allowed. The round-trip check catches a hand-edited
// identifier that the dotted-to-Fluent transform cannot reproduce.
for (const key of en.keys()) {
	const stable = catalogMessageId(key);
	if (stable.includes("-")) fail(`en: "${key}" maps to a stable ID containing a hyphen: "${stable}"`);
	if (fluentId(stable) !== key) fail(`en: "${key}" does not round-trip through the Fluent transform`);
}

// Every non-`en` catalog, shipped or draft, must carry the same ID set and the
// same argument names and structural roles as `en`. A draft is held to the same
// contract so promoting it later is a review, not a translation repair.
for (const locale of ALL_LOCALES.filter((value) => value !== "en")) {
	const catalog = catalogs.get(locale);
	for (const key of en.keys()) {
		if (!catalog.has(key)) fail(`${locale}: missing message id "${key}" (present in en)`);
	}
	for (const key of catalog.keys()) {
		if (!en.has(key)) fail(`${locale}: extra message id "${key}" (absent from en)`);
	}
	for (const [key, message] of en) {
		if (!catalog.has(key)) continue;
		compareArguments(locale, key, collectArguments(message), collectArguments(catalog.get(key)));
	}
}

// Forbidden characters and layout artifacts are checked in every locale, not
// only the source, because a translation can introduce an escape or a wrap.
for (const [locale, catalog] of catalogs) {
	for (const [id, message] of catalog) {
		for (const text of messageTexts(message)) {
			checkValueCharacters(locale, id, text);
			checkValueLayout(locale, id, text);
		}
	}
}

checkCatalogDigests();
checkCatalogStatus();

if (failures.length > 0) {
	console.error(`locale check: ${failures.length} problem(s)`);
	for (const message of failures) console.error(`  ${message}`);
	process.exit(1);
}
console.log(`locale check: ${en.size} messages in ${ALL_LOCALES.join(", ")} are consistent`);
