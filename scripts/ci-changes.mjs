#!/usr/bin/env node
// Classify a pull request's changed files into the CI tiers it needs. See docs/ci.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Packaging, installation, update, dependency, native, and workflow changes need full qualification.
const full = [
	/^package(-lock)?\.json$/,
	/^packages\/[^/]+\/package(-lock)?\.json$/,
	/^packages\/cli\/camoufox-runtime\//,
	/^packages\/cli\/release-extensions\.json$/,
	/^packages\/cli\/src\/(updater|camoufox-adapter|release-extensions)\.ts$/,
	/^packaging\//,
	/^apps\//,
	/^python\//,
	/^upstream\//,
	/^\.github\//,
	/^scripts\/(pack|prepare|install|test-packed|test-auto-update|publish|published|release|verify|build|copy|configure|apply-|windows-ci|ci-)/,
];

// Flow-control changes also need the production-limit endurance cases.
const endurance = [
	/^packages\/cli\/src\/flow-control\//,
	/^packages\/cli\/test\/(flow-|fixtures\/)/,
	/^scripts\/fixtures\//,
];

export function classify(files, labels = []) {
	const needsFull = labels.includes("full-ci") || files.some((file) => full.some((pattern) => pattern.test(file)));
	return {
		full: needsFull,
		endurance: needsFull || files.some((file) => endurance.some((pattern) => pattern.test(file))),
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [list, labels = ""] = process.argv.slice(2);
	if (!list) {
		console.error("Usage: node scripts/ci-changes.mjs CHANGED_FILES_LIST [comma-separated labels]");
		process.exit(2);
	}
	const files = readFileSync(list, "utf8").split("\n").filter(Boolean);
	const result = classify(files, labels.split(",").filter(Boolean));
	console.error(`[ci-changes] ${files.length} changed files: full=${result.full} endurance=${result.endurance}`);
	console.log(`full=${result.full}\nendurance=${result.endurance}`);
}
