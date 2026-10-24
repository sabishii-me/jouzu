#!/usr/bin/env node

/**
 * Render every message of one catalog at a fixed width.
 *
 * The confirmation checks for the Chinese catalogs need a rendering of the
 * whole catalog, because those locales are not offered and cannot be selected
 * through `jz`. This script loads the catalog bundle directly and prints every
 * message in id order, wrapped to the requested width, so the output can be
 * measured line by line. Without an explicit width it uses the terminal width,
 * which is what makes a run inside a real terminal or tmux pane a terminal
 * check.
 *
 * Usage: node scripts/cjk-catalog-render.mjs <locale> [columns]
 *
 * The last line is a `#` summary: the locale, the width, the number of ids, the
 * number rendered, the number that need arguments, the line count, and the
 * number of rendered messages whose text differs from the catalog value. It
 * never prints a value that differs only in whitespace.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadCatalog } = require("../packages/cli/dist/locale-catalog.js");

const locale = process.argv[2];
if (!locale) {
	process.stderr.write("usage: node scripts/cjk-catalog-render.mjs <locale> [columns]\n");
	process.exit(2);
}
const explicit = process.argv[3] === undefined ? null : Number(process.argv[3]);
if (explicit !== null && (!Number.isInteger(explicit) || explicit < 1)) {
	process.stderr.write(`invalid columns: ${process.argv[3]}\n`);
	process.exit(2);
}
const columns = explicit ?? process.stdout.columns ?? 80;

const bundle = loadCatalog(locale);
const ids = Object.keys(bundle.messages).sort();
const lines = [];
let rendered = 0;
let needsArguments = 0;
let textMismatch = 0;

for (const id of ids) {
	let out;
	try {
		out = bundle.render(id, undefined, { columns });
	} catch {
		needsArguments += 1;
		continue;
	}
	rendered += 1;
	lines.push(...out);
	const value = bundle.messages[id]?.value;
	if (typeof value === "string" && value.replace(/\s+/gu, "") !== out.join("").replace(/\s+/gu, "")) {
		textMismatch += 1;
	}
}

process.stdout.write(`${lines.join("\n")}\n`);
process.stdout.write(
	`# locale=${locale} columns=${columns} ids=${ids.length} rendered=${rendered} needsArguments=${needsArguments} lines=${lines.length} textMismatch=${textMismatch}\n`,
);
