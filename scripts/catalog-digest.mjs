#!/usr/bin/env node

/**
 * Regenerate packages/cli/locales/catalog.lock.json.
 *
 * Run `node scripts/catalog-digest.mjs` after editing any catalog. The lock
 * records the catalog schema version, the SHA-256 of each `cli.ftl`, and the
 * SHA-256 of every additional `*.ftl` file as `<locale>/<file>`. A locale may
 * carry several `*.ftl` files; the loader reads all of them and merges them into
 * one bundle. `scripts/check-locales.mjs` runs in `npm run check` and fails when
 * a catalog's bytes no longer match the recorded digest, so a changed catalog
 * without a regenerated lock fails CI instead of shipping a stale expectation.
 *
 * The version is read from `CATALOG_VERSION` in
 * `packages/cli/src/locale-catalog.ts` so the lock and the runtime cannot drift.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const localesRoot = resolve(root, "packages", "cli", "locales");
// Every locale directory that carries a `cli.ftl`, whether it ships as a
// reviewed catalog or is an unreviewed draft. The lock records the draft too,
// so `loadCatalog` and the locale check can validate it.
const locales = readdirSync(localesRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(resolve(localesRoot, entry.name, "cli.ftl")))
	.map((entry) => entry.name)
	.sort();

function readCatalogVersion() {
	const source = readFileSync(resolve(root, "packages", "cli", "src", "locale-catalog.ts"), "utf8");
	const match = source.match(/export const CATALOG_VERSION = "([^"]+)"/u);
	if (!match) throw new Error("could not read CATALOG_VERSION from packages/cli/src/locale-catalog.ts");
	return match[1];
}

const version = readCatalogVersion();
const digests = {};
const extra = {};
for (const locale of locales) {
	const directory = resolve(localesRoot, locale);
	digests[locale] = createHash("sha256")
		.update(readFileSync(resolve(directory, "cli.ftl")))
		.digest("hex");
	const extraFiles = readdirSync(directory)
		.filter((name) => name.endsWith(".ftl") && name !== "cli.ftl")
		.sort();
	for (const name of extraFiles) {
		extra[`${locale}/${name}`] = createHash("sha256")
			.update(readFileSync(resolve(directory, name)))
			.digest("hex");
	}
}

const lock = `${JSON.stringify({ version, locales: digests, extra }, null, 2)}\n`;
writeFileSync(resolve(localesRoot, "catalog.lock.json"), lock);
console.log(`wrote catalog.lock.json (version ${version})`);
for (const locale of locales) console.log(`  ${locale}: ${digests[locale]}`);
for (const [key, digest] of Object.entries(extra)) console.log(`  ${key}: ${digest}`);
