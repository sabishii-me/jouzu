import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CommandReport, resolveDisplayContext } from "../dist/command-report.js";
import { isShippedUiLocale, LANGUAGE_CANDIDATES } from "../dist/language-choice.js";
import {
	CATALOG_LOCALES,
	CATALOG_VERSION,
	canonicalCatalogLocale,
	loadCatalog,
	resolveCatalog,
} from "../dist/locale-catalog.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";

/**
 * The `zh-Hant` catalog is added as an unreviewed draft. It is validated against
 * `en` exactly like a shipped locale, but it is not in `CATALOG_LOCALES`, so the
 * product does not offer it and a request for it falls back to English. These
 * tests pin the draft contract, the width and no-color goldens, and the
 * cross-script fallback.
 *
 * The paired cross-script assertion, that a request for either Chinese script
 * resolves to `en` and never to the other, is in `locale-catalog.test.mjs`.
 */

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceLocales = join(cliRoot, "locales");
const DRAFT_LOCALE = "zh-Hant";

test("the zh-Hant draft loads with the CatalogBundle shape and a recorded digest", () => {
	const bundle = loadCatalog(DRAFT_LOCALE);
	assert.equal(bundle.locale, DRAFT_LOCALE);
	assert.equal(bundle.version, CATALOG_VERSION);
	assert.match(bundle.digest, /^[0-9a-f]{64}$/u);
	const lock = JSON.parse(readFileSync(join(sourceLocales, "catalog.lock.json"), "utf8"));
	const bytes = readFileSync(join(sourceLocales, DRAFT_LOCALE, "cli.ftl"));
	assert.equal(lock.locales[DRAFT_LOCALE], createHash("sha256").update(bytes).digest("hex"));
});

test("the zh-Hant draft carries every en message ID, so a missing key cannot ship", () => {
	const en = loadCatalog("en");
	const zhHant = loadCatalog(DRAFT_LOCALE);
	const enIds = Object.keys(en.messages).sort();
	const zhIds = Object.keys(zhHant.messages).sort();
	assert.deepEqual(zhIds, enIds);
});

test("the zh-Hant draft references the same argument names as en", () => {
	const en = loadCatalog("en");
	const zhHant = loadCatalog(DRAFT_LOCALE);
	// `format` throws when an argument a message references is missing, so
	// formatting every en message with its own argument names exercises the
	// contract. The locale check compares the structural roles; this pins the
	// names at runtime.
	for (const id of Object.keys(en.messages)) {
		const enMessage = en.messages[id];
		const zhMessage = zhHant.messages[id];
		const variables = [...new Set(patternVariables(enMessage.value))];
		const args = Object.fromEntries(variables.map((name) => [name, `sample-${name}`]));
		assert.equal(
			variables.length,
			[...new Set(patternVariables(zhMessage.value))].length,
			`argument count differs for ${id}`,
		);
		assert.doesNotThrow(() => zhHant.format(id, args), `zh-Hant failed to format ${id}`);
	}
});

/** Every variable a runtime Fluent pattern references. */
function patternVariables(pattern, found = []) {
	if (pattern === null || typeof pattern === "string") return found;
	for (const element of pattern) {
		if (typeof element === "string") continue;
		switch (element.type) {
			case "var":
				found.push(element.name);
				break;
			case "select":
				patternVariables([element.selector], found);
				for (const variant of element.variants) patternVariables(variant.value, found);
				break;
			case "func":
				for (const argument of element.args) {
					if (typeof argument === "object" && argument.type === "var") found.push(argument.name);
				}
				break;
			default:
				break;
		}
	}
	return found;
}

const GOLDEN_MESSAGE_ID = "jouzu.cli.error.profileState.recovery";

/** The reviewed 48/80/120-column rendering, fixed as literals. */
const GOLDEN_LINES = {
	48: ["復原: 請修復或移除設定檔狀態檔，然後再次執行", "`jouzu profile plan` 與 `jouzu profile apply`。"],
	80: ["復原: 請修復或移除設定檔狀態檔，然後再次執行 `jouzu profile plan` 與 `jouzu", "profile apply`。"],
	120: ["復原: 請修復或移除設定檔狀態檔，然後再次執行 `jouzu profile plan` 與 `jouzu profile apply`。"],
};

test("zh-Hant goldens are fixed at 48, 80, and 120 columns", () => {
	const zhHant = loadCatalog(DRAFT_LOCALE);
	for (const columns of [48, 80, 120]) {
		assert.deepEqual(
			zhHant.render(GOLDEN_MESSAGE_ID, undefined, { columns }),
			GOLDEN_LINES[columns],
			`the ${columns}-column golden changed`,
		);
	}
});

test("the zh-Hant goldens respect width and keep the catalog text", () => {
	const zhHant = loadCatalog(DRAFT_LOCALE);
	const source = zhHant.format(GOLDEN_MESSAGE_ID);
	for (const columns of [48, 80, 120]) {
		const lines = GOLDEN_LINES[columns];
		// Wrapping may drop the ASCII space at a break, so compare the text
		// without spaces: no non-space character may go missing.
		assert.equal(lines.join("").replaceAll(" ", ""), source.replaceAll(" ", ""), `text changed at ${columns}`);
		for (const line of lines) {
			assert.ok(terminalTextWidth(line) <= columns, `${JSON.stringify(line)} is over ${columns} columns`);
		}
	}
});

test("zh-Hant renders the CJK line-start and line-end prohibitions", () => {
	// The Chinese catalogs reuse the CJK wrap rules: a line never begins with a
	// closing mark and never ends with an opening mark.
	const zhHant = loadCatalog(DRAFT_LOCALE);
	const lines = zhHant.render(GOLDEN_MESSAGE_ID, undefined, { columns: 48 });
	for (const line of lines) {
		assert.ok(!"]）」』".includes([...line][0]), `${JSON.stringify(line)} begins with a closing mark`);
		assert.ok(!"[（「『".includes([...line].at(-1)), `${JSON.stringify(line)} ends with an opening mark`);
	}
});

test("zh-Hant meaning never depends on color", () => {
	const zhHant = loadCatalog(DRAFT_LOCALE);
	const message = zhHant.render("jouzu.cli.error.generic", { message: "x" }, { columns: 48 }).join(" ");
	const build = (context) =>
		new CommandReport(context).entries("Notes", [{ status: "problem", key: "runtime", message }]).toString();
	const escapeCharacter = String.fromCharCode(27);

	const plain = build(
		resolveDisplayContext({
			columns: 48,
			locale: DRAFT_LOCALE,
			colorEnabled: false,
			env: { NO_COLOR: "1" },
			stdoutIsTTY: true,
		}),
	);
	assert.equal(plain.includes(escapeCharacter), false);
	assert.ok(plain.includes(message), plain);
	for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
		const context = resolveDisplayContext({ columns: 48, locale: DRAFT_LOCALE, env, stdoutIsTTY: true });
		assert.equal(context.colorMode, "none", JSON.stringify(env));
		assert.equal(context.colorEnabled, false, JSON.stringify(env));
		assert.equal(build(context), plain, JSON.stringify(env));
	}

	const colored = build(
		resolveDisplayContext({
			columns: 48,
			locale: DRAFT_LOCALE,
			colorEnabled: true,
			colorMode: "16",
			env: { TERM: "xterm-256color" },
		}),
	);
	assert.ok(colored.includes(escapeCharacter));
	assert.equal(colored.replace(new RegExp(`${escapeCharacter}\\[[0-9;]*m`, "gu"), ""), plain);
});

test("a protected path, digest, and model ID each stay on one line in zh-Hant", () => {
	const path = "/home/user/.local/state/jouzu/sessions/2026-09-13/long-session-name";
	const digest = "a".repeat(64);
	const modelId = "shisa/deepseek-v4-flash-preview-2026-09-13";
	const zhHant = loadCatalog(DRAFT_LOCALE);
	for (const text of [path, digest, modelId]) {
		assert.ok(terminalTextWidth(text) > 40, "the value must be wider than the column");
		const lines = zhHant.render("jouzu.cli.error.generic", { message: text }, { columns: 40 });
		assert.ok(lines.includes(text), `zh-Hant split ${JSON.stringify(text)}: ${JSON.stringify(lines)}`);
	}
});

test("zh-Hans and zh-Hant never fall back to each other", () => {
	// Canonicalization preserves the script, so the two tags stay distinct.
	assert.equal(canonicalCatalogLocale("zh-Hans"), "zh-Hans");
	assert.equal(canonicalCatalogLocale("zh-Hant"), "zh-Hant");
	assert.notEqual(canonicalCatalogLocale("zh-Hans"), canonicalCatalogLocale("zh-Hant"));

	// In this branch only `zh-Hant` ships a draft catalog, and it is not offered,
	// so both requests resolve to English and neither resolves to the other
	// script. The paired test that both resolve to their own catalog belongs with
	// the merge that brings the two Chinese catalogs together.
	for (const requested of ["zh-Hant", "zh-Hant-CN", "zh-Hant-TW"]) {
		const resolution = resolveCatalog(requested);
		assert.equal(resolution.effective, "en", requested);
		assert.notEqual(resolution.effective, "zh-Hans", requested);
		assert.match(resolution.fallback?.reason ?? "", /zh-Hant/u, requested);
	}
	for (const requested of ["zh-Hans", "zh-Hans-CN", "zh-Hans-SG"]) {
		const resolution = resolveCatalog(requested);
		assert.equal(resolution.effective, "en", requested);
		assert.notEqual(resolution.effective, "zh-Hant", requested);
		assert.match(resolution.fallback?.reason ?? "", /zh-Hans/u, requested);
	}
});

test("a missing zh-Hant catalog falls back to the English bundle", () => {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-zh-hant-missing-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		rmSync(join(localesRoot, DRAFT_LOCALE, "cli.ftl"));
		// The draft loader refuses the missing file instead of throwing at the
		// call site, and the resolver returns English, never `zh-Hans`.
		assert.throws(() => loadCatalog(DRAFT_LOCALE, { localesRoot }));
		const resolution = resolveCatalog(DRAFT_LOCALE, { localesRoot });
		assert.equal(resolution.effective, "en");
		assert.equal(resolution.bundle.locale, "en");
		assert.notEqual(resolution.effective, "zh-Hans");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the zh-Hant draft is recorded but not offered as an interface language", () => {
	// The product keeps claiming English and Japanese until the review record
	// exists: the draft is not in the offered catalog set, the first-run choice
	// does not offer it, and the support stage is unchanged.
	assert.deepEqual([...CATALOG_LOCALES], ["en", "ja"]);
	assert.equal(isShippedUiLocale(DRAFT_LOCALE), false);
	assert.equal(isShippedUiLocale("zh-Hans"), false);
	assert.deepEqual(
		LANGUAGE_CANDIDATES.map((candidate) => candidate.shipped),
		[true, true, false, false],
	);
	const stage = loadCatalog("en").format("jouzu.cli.doctor.value.upstreamSupportStage");
	assert.match(stage, /English and Japanese/u);
	assert.doesNotMatch(stage, /Chinese|zh-Hant|zh-Hans/u);
});
