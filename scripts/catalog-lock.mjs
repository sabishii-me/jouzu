#!/usr/bin/env node

/**
 * Validate a catalog lock against the catalogs beside it.
 *
 * `scripts/catalog-digest.mjs` writes `catalog.lock.json` for the source
 * catalogs, and `scripts/check-locales.mjs` holds the source tree to it during
 * `npm run check`. This module applies the same rules to a copied catalog tree:
 * the packed `dist/locales` directory and the `dist/locales` directory of an
 * installed package. It exists so the pack check and the updater smoke test
 * validate a shipped lock with one definition instead of re-deriving the digest
 * rules in each place.
 *
 * The lock records the schema version, the SHA-256 of each locale's `cli.ftl`
 * under `locales`, and the SHA-256 of every additional `*.ftl` file under
 * `extra` as `<locale>/<file>`. A locale directory is a catalog when it carries
 * a `cli.ftl`; a recorded locale without one, or a catalog the lock omits, is a
 * mismatch rather than a silent change.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const catalogLockFileName = "catalog.lock.json";

/** Read `CATALOG_VERSION` from a compiled or source locale loader. */
export function readRuntimeCatalogVersion(path) {
	const source = readFileSync(path, "utf8");
	const match = source.match(/CATALOG_VERSION = "([^"]+)"/u);
	if (!match) throw new Error(`could not read CATALOG_VERSION from ${path}`);
	return match[1];
}

/** The locale directories that carry a `cli.ftl`, in stable order. */
export function catalogLocales(localesDirectory) {
	return readdirSync(localesDirectory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(localesDirectory, entry.name, "cli.ftl")))
		.map((entry) => entry.name)
		.sort();
}

/** Every `*.ftl` file in one locale directory, `cli.ftl` first. */
export function catalogFiles(localesDirectory, locale) {
	const directory = join(localesDirectory, locale);
	const extra = readdirSync(directory)
		.filter((name) => name.endsWith(".ftl") && name !== "cli.ftl")
		.sort();
	return ["cli.ftl", ...extra];
}

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The digests the lock must record for the catalogs on disk. */
export function computeCatalogDigests(localesDirectory) {
	const locales = {};
	const extra = {};
	for (const locale of catalogLocales(localesDirectory)) {
		const [primary, ...additional] = catalogFiles(localesDirectory, locale);
		locales[locale] = sha256(join(localesDirectory, locale, primary));
		for (const name of additional) {
			extra[`${locale}/${name}`] = sha256(join(localesDirectory, locale, name));
		}
	}
	return { locales, extra };
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read and shape-check `catalog.lock.json`. */
export function readCatalogLock(localesDirectory, label = localesDirectory) {
	const path = join(localesDirectory, catalogLockFileName);
	let lock;
	try {
		lock = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`${label}: cannot read the catalog lock ${path}: ${error.message}`);
	}
	if (!isRecord(lock)) throw new Error(`${label}: catalog lock must be an object`);
	if (typeof lock.version !== "string" || lock.version.length === 0) {
		throw new Error(`${label}: catalog lock must record a version`);
	}
	if (!isRecord(lock.locales)) throw new Error(`${label}: catalog lock locales must be an object`);
	if (lock.extra !== undefined && !isRecord(lock.extra)) {
		throw new Error(`${label}: catalog lock extra must be an object`);
	}
	return lock;
}

/**
 * Assert that an installed package's lock matches its catalogs and loader.
 *
 * The updater smoke test calls this on the installed release before an update,
 * on the updated release, and on the release a rollback restored.
 */
export function assertInstalledCatalogLock(packageRoot, label = packageRoot) {
	assertCatalogLockMatches(join(packageRoot, "dist", "locales"), {
		runtimeVersion: readRuntimeCatalogVersion(join(packageRoot, "dist", "locale-catalog.js")),
		label,
	});
}

/**
 * Assert that the lock beside `localesDirectory` describes the catalogs in it.
 *
 * Pass `runtimeVersion` to also require that the lock version matches the
 * `CATALOG_VERSION` the shipped loader exports. Throws with the first
 * disagreement so a caller fails the gate with a precise message.
 */
export function assertCatalogLockMatches(localesDirectory, options = {}) {
	const label = options.label ?? localesDirectory;
	const lock = readCatalogLock(localesDirectory, label);
	if (options.runtimeVersion !== undefined && lock.version !== options.runtimeVersion) {
		throw new Error(
			`${label}: catalog lock version ${JSON.stringify(lock.version)} does not match CATALOG_VERSION ${options.runtimeVersion}`,
		);
	}
	const recorded = lock.locales;
	const recordedExtra = lock.extra ?? {};
	const { locales, extra } = computeCatalogDigests(localesDirectory);
	for (const locale of Object.keys(locales)) {
		if (recorded[locale] === undefined) {
			throw new Error(`${label}: catalog lock does not record catalog ${locale}`);
		}
		if (recorded[locale] !== locales[locale]) {
			throw new Error(`${label}: catalog digest for ${locale} does not match the lock`);
		}
	}
	for (const locale of Object.keys(recorded)) {
		if (locales[locale] === undefined) {
			throw new Error(`${label}: catalog lock records catalog ${locale}, which is missing`);
		}
	}
	for (const [key, digest] of Object.entries(extra)) {
		if (recordedExtra[key] === undefined) {
			throw new Error(`${label}: catalog lock does not record extra catalog file ${key}`);
		}
		if (recordedExtra[key] !== digest) {
			throw new Error(`${label}: catalog digest for ${key} does not match the lock`);
		}
	}
	for (const key of Object.keys(recordedExtra)) {
		if (extra[key] === undefined) {
			throw new Error(`${label}: catalog lock records extra catalog file ${key}, which is missing`);
		}
	}
	return lock;
}
