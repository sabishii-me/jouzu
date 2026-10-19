#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export function resolveDefuddleSource(webaioRoot) {
	const require = createRequire(realpathSync(resolve(webaioRoot, "package.json")));
	return resolve(dirname(require.resolve("defuddle")), "defuddle.js");
}

/**
 * Defuddle is intentionally a fallback extractor, but some versions log
 * recoverable parse failures with console.error. In a Pi TUI that writes over
 * the terminal instead of becoming tool output. Keep the fallback result while
 * silencing only Defuddle's own diagnostic calls in the bundled dependency.
 */
export function transformDefuddleDiagnostics(source) {
	const marker = "console.error(";
	const count = source.split(marker).length - 1;
	if (count === 0) throw new Error("Defuddle diagnostic anchors are missing");
	return source.replaceAll(marker, "if (false) console.error(");
}

export function applyDefuddleDiagnosticGuard(sourcePath, readFile, writeFile) {
	const source = readFile(sourcePath);
	const transformed = transformDefuddleDiagnostics(source);
	writeFile(sourcePath, transformed);
	return transformed !== source;
}
