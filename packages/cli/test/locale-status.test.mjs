import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOG_LOCALES, CATALOG_VERSION } from "../dist/locale-catalog.js";
import {
	CATALOG_STATUS_FILE_NAME,
	CATALOG_STATUS_VERSION,
	CATALOG_SUPPORT_STATES,
	catalogSupportState,
	catalogSupportStates,
	readCatalogStatus,
	reviewedCatalogLocales,
} from "../dist/locale-status.js";

/**
 * The status record names the source version and source digest each catalog was
 * translated from, and whether a person has recorded a review. These tests pin
 * the derived support states, including that a stale catalog is never reported
 * complete, and that a locale whose review is not recorded is never offered.
 */

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceLocales = join(cliRoot, "locales");

/** Run a callback against a writable copy of the committed locales root. */
function withLocalesCopy(callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-status-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		callback(localesRoot);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Rewrite one catalog and refresh the lock, so only the value under test changes. */
function mutateCatalog(localesRoot, locale, mutate) {
	const path = join(localesRoot, locale, "cli.ftl");
	writeFileSync(path, mutate(readFileSync(path, "utf8")));
	const lockPath = join(localesRoot, "catalog.lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	for (const name of Object.keys(lock.locales)) {
		lock.locales[name] = createHash("sha256")
			.update(readFileSync(join(localesRoot, name, "cli.ftl")))
			.digest("hex");
	}
	writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

test("the committed status record covers every locked catalog and names the source", () => {
	const record = readCatalogStatus({ localesRoot: sourceLocales });
	assert.equal(record.version, CATALOG_STATUS_VERSION);
	assert.equal(record.sourceLocale, "en");
	const lock = JSON.parse(readFileSync(join(sourceLocales, "catalog.lock.json"), "utf8"));
	assert.deepEqual(Object.keys(record.locales).sort(), Object.keys(lock.locales).sort());
	for (const [locale, entry] of Object.entries(record.locales)) {
		assert.match(entry.sourceDigest, /^[0-9a-f]{64}$/u, locale);
		assert.equal(typeof entry.sourceVersion, "string", locale);
		assert.ok(entry.sourceVersion.length > 0, locale);
		assert.equal(typeof entry.reviewed, "boolean", locale);
	}
	// Every catalog was translated against the current English source, so the
	// record and the lock agree and nothing is stale.
	assert.equal(record.locales.en.sourceDigest, lock.locales.en);
	for (const locale of Object.keys(record.locales)) {
		assert.equal(record.locales[locale].sourceDigest, lock.locales.en, locale);
	}
});

test("the state vocabulary carries all six identifiers", () => {
	assert.deepEqual(
		[...CATALOG_SUPPORT_STATES],
		["complete", "partial", "stale", "fallback", "unsupported", "upstream-owned"],
	);
});

test("the committed catalogs are complete or unsupported, never stale or partial", () => {
	assert.deepEqual(catalogSupportStates({ localesRoot: sourceLocales }), [
		{ locale: "en", state: "complete" },
		{ locale: "ja", state: "complete" },
		{ locale: "zh-Hans", state: "unsupported" },
		{ locale: "zh-Hant", state: "unsupported" },
	]);
});

test("a locale whose review is not recorded is unsupported and is not offered", () => {
	const record = readCatalogStatus({ localesRoot: sourceLocales });
	assert.equal(record.locales["zh-Hans"].reviewed, false);
	assert.equal(record.locales["zh-Hant"].reviewed, false);
	assert.equal(catalogSupportState("zh-Hans", { localesRoot: sourceLocales }), "unsupported");
	assert.equal(catalogSupportState("zh-Hant", { localesRoot: sourceLocales }), "unsupported");

	// The offered set is the product's support claim, so every offered locale has
	// a recorded review and no unreviewed locale is offered.
	const reviewed = new Set(reviewedCatalogLocales({ localesRoot: sourceLocales }));
	for (const locale of CATALOG_LOCALES) assert.ok(reviewed.has(locale), `${locale} is offered without a review`);
	for (const locale of Object.keys(record.locales)) {
		if (!record.locales[locale].reviewed) {
			assert.ok(!CATALOG_LOCALES.includes(locale), `${locale} is unreviewed but offered`);
		}
	}
});

test("a locale with no recorded catalog is unsupported", () => {
	for (const locale of ["fr", "zh", "en-XA", ""]) {
		assert.equal(catalogSupportState(locale, { localesRoot: sourceLocales }), "unsupported", locale);
	}
});

test("a source that moved after the recorded digest makes every catalog stale", () => {
	withLocalesCopy((localesRoot) => {
		// Change the English source and refresh the lock: the catalogs still load,
		// but their recorded source digest no longer describes the source.
		mutateCatalog(localesRoot, "en", (source) => `${source}\n# source changed after translation\n`);
		assert.equal(catalogSupportState("ja", { localesRoot }), "stale");
		assert.equal(catalogSupportState("en", { localesRoot }), "stale");
		assert.notEqual(catalogSupportState("ja", { localesRoot }), "complete");
	});
});

test("a stale catalog stays stale even when its own bytes are unchanged", () => {
	withLocalesCopy((localesRoot) => {
		const before = readFileSync(join(localesRoot, "ja", "cli.ftl"), "utf8");
		mutateCatalog(localesRoot, "en", (source) => `${source}\n# source changed\n`);
		assert.equal(readFileSync(join(localesRoot, "ja", "cli.ftl"), "utf8"), before);
		assert.equal(catalogSupportState("ja", { localesRoot }), "stale");
	});
});

test("a catalog that misses a source message id is partial", () => {
	withLocalesCopy((localesRoot) => {
		mutateCatalog(localesRoot, "ja", (source) =>
			source.replace("jouzu-cli-args-homeRepeated = --jouzu-home は 1 回だけ指定できます\n", ""),
		);
		// The English source did not move, so the catalog is not stale; it is
		// incomplete, which is the partial state.
		assert.equal(catalogSupportState("ja", { localesRoot }), "partial");
	});
});

test("an unreadable status record reports unsupported instead of throwing", () => {
	withLocalesCopy((localesRoot) => {
		rmSync(join(localesRoot, CATALOG_STATUS_FILE_NAME));
		assert.throws(() => readCatalogStatus({ localesRoot }));
		assert.deepEqual(catalogSupportStates({ localesRoot }), []);
		assert.equal(catalogSupportState("ja", { localesRoot }), "unsupported");
		assert.deepEqual(reviewedCatalogLocales({ localesRoot }), []);
	});
});

test("a malformed status record is refused", () => {
	withLocalesCopy((localesRoot) => {
		writeFileSync(join(localesRoot, CATALOG_STATUS_FILE_NAME), "{ not json");
		assert.throws(() => readCatalogStatus({ localesRoot }), /not valid JSON/u);
		writeFileSync(
			join(localesRoot, CATALOG_STATUS_FILE_NAME),
			JSON.stringify({ version: "1", sourceLocale: "en", locales: { ja: { sourceVersion: "1", reviewed: true } } }),
		);
		assert.throws(() => readCatalogStatus({ localesRoot }), /sourceDigest/u);
	});
});

test("the status record version matches the module constant", () => {
	// The lock and the record are separate files with separate versions; both are
	// read by the same build, so neither may drift from the constant.
	const record = readCatalogStatus({ localesRoot: sourceLocales });
	assert.equal(record.version, CATALOG_STATUS_VERSION);
	assert.equal(CATALOG_VERSION, "1");
});
