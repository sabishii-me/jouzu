import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOG_FIELD_LABEL_IDS, DOCTOR_FIELD_LABEL_IDS } from "../dist/cli-messages.js";
import { CommandReport, resolveDisplayContext } from "../dist/command-report.js";
import {
	CliMessageId,
	humanMessage,
	protectedDigest,
	protectedModelId,
	protectedPath,
	resolveHumanMessage,
} from "../dist/human-messages.js";
import {
	CATALOG_LOCALES,
	CATALOG_RECOVERY_TEXT,
	CATALOG_VERSION,
	canonicalCatalogLocale,
	catalogFluentId,
	catalogMessageId,
	loadCatalog,
	resolveCatalog,
	summarizeCatalog,
} from "../dist/locale-catalog.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(cliRoot, "..", "..");
const checkScript = join(repoRoot, "scripts", "check-locales.mjs");
const sourceLocales = join(cliRoot, "locales");

const STABLE_IDS = Object.values(CliMessageId);

/** Every variable a runtime Fluent pattern references, in order of first use. */
function patternVariables(pattern, found = []) {
	if (pattern === null || typeof pattern === "string") return found;
	for (const element of pattern) {
		if (typeof element === "string") continue;
		const expression = element;
		switch (expression.type) {
			case "var":
				found.push(expression.name);
				break;
			case "select":
				patternVariables([expression.selector], found);
				for (const variant of expression.variants) patternVariables(variant.value, found);
				break;
			case "func":
				for (const argument of expression.args) {
					if (typeof argument === "object" && argument.type === "var") found.push(argument.name);
				}
				break;
			default:
				break;
		}
	}
	return found;
}

function variablesOf(message) {
	return [...new Set(patternVariables(message.value))];
}

function sampleArgs(message) {
	return Object.fromEntries(variablesOf(message).map((name) => [name, `sample-${name}`]));
}

test("both catalogs load with the CatalogBundle shape", () => {
	for (const locale of CATALOG_LOCALES) {
		const bundle = loadCatalog(locale);
		assert.equal(bundle.locale, locale);
		assert.equal(bundle.version, CATALOG_VERSION);
		assert.match(bundle.digest, /^[0-9a-f]{64}$/u);
		assert.equal(typeof bundle.format, "function");
	}
});

test("the digest is the sha256 of the catalog file bytes", () => {
	for (const locale of CATALOG_LOCALES) {
		const bundle = loadCatalog(locale);
		const bytes = readFileSync(join(cliRoot, "dist", "locales", locale, "cli.ftl"));
		assert.equal(bundle.digest, createHash("sha256").update(bytes).digest("hex"));
	}
});

test("the en catalog carries every CliMessageId and the ja catalog carries the same set", () => {
	const bundle = loadCatalog("en");
	const ids = Object.keys(bundle.messages);
	for (const id of STABLE_IDS) assert.ok(ids.includes(id), `en catalog is missing ${id}`);
	const ja = loadCatalog("ja");
	assert.deepEqual(Object.keys(ja.messages).sort(), ids.sort());
});

test("the Fluent identifier transform round-trips and does not collide", () => {
	const seen = new Set();
	for (const id of STABLE_IDS) {
		assert.equal(catalogMessageId(catalogFluentId(id)), id);
		assert.ok(!id.includes("-"), `stable ID must not contain a hyphen: ${id}`);
		assert.ok(!seen.has(catalogFluentId(id)), `duplicate Fluent identifier for ${id}`);
		seen.add(catalogFluentId(id));
	}
});

test("en and ja reference the same argument names per message", () => {
	const en = loadCatalog("en");
	const ja = loadCatalog("ja");
	for (const id of STABLE_IDS) {
		assert.deepEqual(
			variablesOf(ja.messages[id]).sort(),
			variablesOf(en.messages[id]).sort(),
			`arguments differ for ${id}`,
		);
	}
});

test("every migrated English message renders byte-identically to the existing table", () => {
	// The pre-catalog output is `resolveHumanMessage` over the `EN_MESSAGES`
	// table in human-messages.ts. This is the English regression: the
	// catalog `format` and the no-wrap `render` must both reproduce it exactly
	// for every stable ID, so migrating a message into the catalog cannot move
	// the English bytes. The width coverage in the Japanese-locale tests pins the wrapping path.
	const bundle = loadCatalog("en");
	let compared = 0;
	for (const id of STABLE_IDS) {
		const message = bundle.messages[id];
		assert.ok(message, `en catalog is missing ${id}`);
		const args = sampleArgs(message);
		const expected = resolveHumanMessage(humanMessage(id, args));
		assert.equal(bundle.format(id, args), expected, `catalog text differs from the existing English table for ${id}`);
		// A very wide column removes every break, so the renderer returns the
		// plain text and any loss or spacing change becomes visible.
		assert.deepEqual(bundle.render(id, args, { columns: 100_000 }), [expected], `catalog render differs for ${id}`);
		compared += 1;
	}
	assert.equal(compared, STABLE_IDS.length, "every stable ID was compared");
});

test("the pre-runtime path imports the catalog without the Pi agent runtime", () => {
	const srcDir = join(cliRoot, "src");
	// The catalog is wired into the default startup path: the pre-runtime
	// modules reach it through `cli-messages.ts`, which is the intended seam.
	assert.match(readFileSync(join(srcDir, "cli-messages.ts"), "utf8"), /from "\.\/locale-catalog\.js"/u);
	assert.match(readFileSync(join(srcDir, "args.ts"), "utf8"), /from "\.\/cli-messages\.js"/u);
	// The catalog must still load without the Pi agent runtime, so no module on
	// the pre-runtime path statically imports `@earendil-works/pi-coding-agent`.
	for (const entry of [
		"args.ts",
		"cli-messages.ts",
		"locale-catalog.ts",
		"command-report.ts",
		"human-messages.ts",
		"pre-runtime.ts",
	]) {
		const source = readFileSync(join(srcDir, entry), "utf8");
		assert.ok(
			!/^\s*import\s+(?!type\b)[^;]*from\s+"@earendil-works\/pi-coding-agent"/mu.test(source),
			`${entry} imports the Pi agent runtime`,
		);
	}
});

function runCheck(localesRoot) {
	return spawnSync(process.execPath, [checkScript, "--locales-root", localesRoot], { encoding: "utf8" });
}

/** Copy the committed catalogs and lock into a temporary locales root. */
function withCatalogRoot(callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-catalog-root-"));
	try {
		cpSync(sourceLocales, join(dir, "locales"), { recursive: true });
		callback(join(dir, "locales"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("resolveCatalog follows exact, then canonical, then English", () => {
	// Step 1: an exact locale match carries no fallback. The absence of a fallback
	// for a bare language is what fixes exact matching ahead of canonicalization.
	const exactEn = resolveCatalog("en");
	assert.equal(exactEn.effective, "en");
	assert.equal(exactEn.fallback, undefined);
	const exactJa = resolveCatalog("ja");
	assert.equal(exactJa.effective, "ja");
	assert.equal(exactJa.fallback, undefined);

	// Step 2: a region or POSIX form canonicalizes to a shipped language.
	const canonicalJa = resolveCatalog("ja-JP");
	assert.equal(canonicalJa.effective, "ja");
	assert.equal(canonicalJa.bundle.locale, "ja");
	// The canonical reason is formatted from the catalog of the locale it selects,
	// so a ja session reads it in Japanese.
	assert.match(canonicalJa.fallback?.reason ?? "", /正規ロケール "ja"/u);
	assert.equal(resolveCatalog("ja_JP.UTF-8").effective, "ja");
	const canonicalEn = resolveCatalog("en-US");
	assert.equal(canonicalEn.effective, "en");
	// Under an English effective locale the canonical reason is byte-identical to
	// the literal it replaced.
	assert.equal(canonicalEn.fallback?.reason, 'no exact catalog for "en-US"; using the canonical locale "en"');

	// Step 3: everything else is English.
	const unsupported = resolveCatalog("not a locale");
	assert.equal(unsupported.effective, "en");
	assert.match(unsupported.fallback?.reason ?? "", /using English/u);

	// These reasons are resolved from the English catalog, so the exact bytes the
	// doctor report carries are unchanged by moving them onto the catalog.
	assert.equal(unsupported.fallback?.reason, 'unsupported locale "not a locale"; using English');
	assert.equal(
		resolveCatalog("fr-CA").fallback?.reason,
		'no catalog for "fr-CA" (canonical locale "fr"); using English',
	);

	// Deterministic: the same input yields the same effective locale and reason.
	for (const request of ["en", "ja", "ja-JP", "zh-Hans", "fr-FR", "not a locale"]) {
		const first = resolveCatalog(request);
		const second = resolveCatalog(request);
		assert.equal(first.effective, second.effective);
		assert.equal(first.fallback?.reason, second.fallback?.reason);
	}
});

test("zh-Hans and zh-Hant fall back to English and never to each other", () => {
	// Canonicalization preserves the script, so the two tags can never collapse
	// onto one locale even if a zh catalog ships later.
	assert.equal(canonicalCatalogLocale("zh-Hans"), "zh-Hans");
	assert.equal(canonicalCatalogLocale("zh-Hant"), "zh-Hant");
	assert.notEqual(canonicalCatalogLocale("zh-Hans"), canonicalCatalogLocale("zh-Hant"));
	assert.equal(canonicalCatalogLocale("zh-Hant-CN"), "zh-Hant");

	const hans = resolveCatalog("zh-Hans");
	const hant = resolveCatalog("zh-Hant");
	assert.equal(hans.effective, "en");
	assert.equal(hant.effective, "en");
	assert.match(hans.fallback?.reason ?? "", /canonical locale "zh-Hans"/u);
	assert.match(hant.fallback?.reason ?? "", /canonical locale "zh-Hant"/u);
});

test("summarizeCatalog carries the version, digest, and fallback reason", () => {
	const summary = summarizeCatalog(resolveCatalog("zh-Hant"));
	assert.equal(summary.requested, "zh-Hant");
	assert.equal(summary.effective, "en");
	assert.equal(summary.version, CATALOG_VERSION);
	assert.match(summary.digest, /^[0-9a-f]{64}$/u);
	assert.match(summary.fallbackReason ?? "", /zh-Hant/u);

	const exact = summarizeCatalog(resolveCatalog("ja"));
	assert.equal(exact.fallbackReason, undefined);
	assert.equal(exact.version, CATALOG_VERSION);
});

test("the committed catalog lock matches the catalogs and CATALOG_VERSION", () => {
	const lock = JSON.parse(readFileSync(join(sourceLocales, "catalog.lock.json"), "utf8"));
	assert.equal(lock.version, CATALOG_VERSION);
	for (const locale of CATALOG_LOCALES) {
		const bytes = readFileSync(join(sourceLocales, locale, "cli.ftl"));
		assert.equal(lock.locales[locale], createHash("sha256").update(bytes).digest("hex"));
	}
});

test("a corrupt or truncated catalog falls back to English without throwing", () => {
	withCatalogRoot((localesRoot) => {
		const jaPath = join(localesRoot, "ja", "cli.ftl");
		writeFileSync(jaPath, readFileSync(jaPath, "utf8").slice(0, 120));
		const resolution = resolveCatalog("ja", { localesRoot });
		assert.equal(resolution.effective, "en");
		assert.equal(resolution.bundle.locale, "en");
		assert.equal(resolution.fallback?.reason, CATALOG_RECOVERY_TEXT);
		// The English catalog still renders, so startup is not stopped.
		assert.equal(resolution.bundle.format("jouzu.cli.error.generic", { message: "x" }), "Jouzu failed: x");
	});
});

test("an unreadable catalog falls back to English", () => {
	withCatalogRoot((localesRoot) => {
		rmSync(join(localesRoot, "ja", "cli.ftl"));
		const resolution = resolveCatalog("ja", { localesRoot });
		assert.equal(resolution.effective, "en");
		assert.equal(resolution.fallback?.reason, CATALOG_RECOVERY_TEXT);
	});
});

test("the catalog-independent recovery text is used when no catalog can be read", () => {
	withCatalogRoot((localesRoot) => {
		rmSync(join(localesRoot, "en", "cli.ftl"));
		rmSync(join(localesRoot, "ja", "cli.ftl"));
		const resolution = resolveCatalog("ja", { localesRoot });
		assert.equal(resolution.effective, "en");
		assert.equal(resolution.fallback?.reason, CATALOG_RECOVERY_TEXT);
		assert.equal(resolution.bundle.format("jouzu.cli.error.generic", { message: "x" }), CATALOG_RECOVERY_TEXT);
		// The recovery bundle still renders, so a display path never goes blank.
		const lines = resolution.bundle.render("jouzu.cli.error.generic", { message: "x" }, { columns: 48 });
		assert.ok(lines.length > 1, "the recovery sentence wraps at 48 columns");
		assert.ok(lines.join(" ").includes("Jouzu could not read its interface catalog"), lines.join("\n"));
	});
});

test("the check fails when a catalog changes without a regenerated lock", () => {
	withMutatedJa(
		(source) => `${source}\n# digest change\n`,
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(
				result.stderr,
				/ja: catalog digest [0-9a-f]{64} does not match the lock; run "node scripts\/catalog-digest\.mjs"/u,
			);
		},
	);
});

function withMutatedJa(mutate, callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-catalog-"));
	try {
		cpSync(sourceLocales, join(dir, "locales"), { recursive: true });
		const jaPath = join(dir, "locales", "ja", "cli.ftl");
		writeFileSync(jaPath, mutate(readFileSync(jaPath, "utf8")));
		callback(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Copy the committed locales root, rewrite the status record, and run the check. */
function withMutatedStatus(mutate, callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-status-check-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		const statusPath = join(localesRoot, "catalog-status.json");
		writeFileSync(statusPath, `${JSON.stringify(mutate(JSON.parse(readFileSync(statusPath, "utf8"))), null, 2)}\n`);
		callback(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// The status record and the offered set must agree: a locale whose human review
// is not recorded is never offered, and the record covers every locked catalog.

test("the check fails when an offered locale has no recorded review", () => {
	withMutatedStatus(
		(status) => ({ ...status, locales: { ...status.locales, ja: { ...status.locales.ja, reviewed: false } } }),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /ja is offered but its review is not recorded/u);
		},
	);
});

test("the check fails when the status record omits a locked catalog", () => {
	withMutatedStatus(
		(status) => {
			const { "zh-Hant": _omitted, ...locales } = status.locales;
			return { ...status, locales };
		},
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /the lock records zh-Hant, which the status record does not/u);
		},
	);
});

test("the check fails when a status entry is malformed", () => {
	withMutatedStatus(
		(status) => ({
			...status,
			locales: { ...status.locales, ja: { ...status.locales.ja, sourceDigest: "not-a-digest" } },
		}),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /ja sourceDigest must be a lowercase SHA-256/u);
		},
	);
});

test("the check accepts a stale record, because stale is a displayed state", () => {
	// Move the English source and refresh the lock without updating the recorded
	// source digest. The catalogs still load and the check still passes; `doctor`
	// reports the catalogs stale.
	const dir = mkdtempSync(join(tmpdir(), "jouzu-status-stale-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		const enPath = join(localesRoot, "en", "cli.ftl");
		writeFileSync(enPath, `${readFileSync(enPath, "utf8")}\n# source changed\n`);
		const lockPath = join(localesRoot, "catalog.lock.json");
		const lock = JSON.parse(readFileSync(lockPath, "utf8"));
		lock.locales.en = createHash("sha256").update(readFileSync(enPath)).digest("hex");
		writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
		const result = runCheck(localesRoot);
		assert.equal(result.status, 0, result.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Mutate `ja` and regenerate the lock, so the value check under test is the
 * only failure. Without the regenerated lock every mutation would also trip the
 * digest check and the assertion could not name the check that fired.
 */
function withMutatedJaAndLock(mutate, callback) {
	withMutatedJa(mutate, (dir) => {
		const localesRoot = join(dir, "locales");
		const lockPath = join(localesRoot, "catalog.lock.json");
		const lock = JSON.parse(readFileSync(lockPath, "utf8"));
		for (const locale of ["en", "ja"]) {
			const bytes = readFileSync(join(localesRoot, locale, "cli.ftl"));
			lock.locales[locale] = createHash("sha256").update(bytes).digest("hex");
		}
		writeFileSync(lockPath, JSON.stringify(lock));
		callback(dir);
	});
}

const HOME_REPEATED_JA = "jouzu-cli-args-homeRepeated = --jouzu-home は 1 回だけ指定できます";

/** Replace the Japanese `homeRepeated` value and assert the check output. */
function assertValueCheckFails(replacement, pattern) {
	withMutatedJaAndLock(
		(source) => source.replace(HOME_REPEATED_JA, `jouzu-cli-args-homeRepeated = ${replacement}`),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, pattern);
		},
	);
}

test("the check passes for the committed catalogs", () => {
	const result = runCheck(sourceLocales);
	assert.equal(result.status, 0, result.stderr);
});

test("the check fails on a missing ID", () => {
	withMutatedJa(
		(source) => source.replace("jouzu-cli-args-doctorUnexpectedToken = doctor は { $token } を受け付けません\n", ""),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /ja: missing message id "jouzu-cli-args-doctorUnexpectedToken"/u);
		},
	);
});

test("the check fails on an extra ID", () => {
	withMutatedJa(
		(source) => `${source}\njouzu-cli-args-extra = extra\n`,
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /ja: extra message id "jouzu-cli-args-extra"/u);
		},
	);
});

test("the check allows an extra catalog-only ID present in every checked locale", () => {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-catalog-extra-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		const lockPath = join(localesRoot, "catalog.lock.json");
		const lock = JSON.parse(readFileSync(lockPath, "utf8"));
		// The checker validates every catalog the lock records, drafts included, so
		// the extra ID is added to all of them and the lock is regenerated.
		for (const locale of Object.keys(lock.locales)) {
			const path = join(localesRoot, locale, "cli.ftl");
			writeFileSync(path, `${readFileSync(path, "utf8")}\njouzu-cli-extra-message = extra\n`);
			lock.locales[locale] = createHash("sha256").update(readFileSync(path)).digest("hex");
		}
		writeFileSync(lockPath, JSON.stringify(lock));
		const result = runCheck(localesRoot);
		assert.equal(result.status, 0, result.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the check fails on a missing argument", () => {
	withMutatedJa(
		(source) =>
			source.replace(
				"jouzu-cli-error-generic = Jouzu の実行に失敗しました: { $message }",
				"jouzu-cli-error-generic = Jouzu の実行に失敗しました:",
			),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /"jouzu-cli-error-generic": missing argument "\$message"/u);
		},
	);
});

test("the check fails on an extra argument", () => {
	withMutatedJa(
		(source) =>
			source.replace(
				"jouzu-cli-args-homeRepeated = --jouzu-home は 1 回だけ指定できます",
				"jouzu-cli-args-homeRepeated = --jouzu-home は 1 回だけ指定できます { $extra }",
			),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /"jouzu-cli-args-homeRepeated": extra argument "\$extra"/u);
		},
	);
});

test("the check fails on an argument type mismatch", () => {
	withMutatedJa(
		(source) =>
			source.replace(
				"jouzu-cli-error-generic = Jouzu の実行に失敗しました: { $message }",
				"jouzu-cli-error-generic =\n    { $message ->\n        [one] one\n       *[other] other\n    }",
			),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /"jouzu-cli-error-generic": argument "\$message" is used as value in en/u);
		},
	);
});

// Forbidden characters and layout artifacts in a catalog value.

test("the check fails on an ANSI escape in a value", () => {
	assertValueCheckFails(
		"--jouzu-home \u001b[31m は 1 回だけ指定できます",
		/ja: "jouzu-cli-args-homeRepeated": value contains an ANSI escape U\+001B/u,
	);
});

test("the check fails on a control character in a value", () => {
	assertValueCheckFails(
		"--jouzu-home \u0007 は 1 回だけ指定できます",
		/ja: "jouzu-cli-args-homeRepeated": value contains a control character U\+0007/u,
	);
});

test("the check fails on a bidirectional control character in a value", () => {
	assertValueCheckFails(
		"--jouzu-home \u202e は 1 回だけ指定できます",
		/ja: "jouzu-cli-args-homeRepeated": value contains a bidirectional control character U\+202E/u,
	);
});

test("the check fails when a value carries its own Fluent key", () => {
	assertValueCheckFails(
		"jouzu-cli-args-homeRepeated = oops",
		/ja: "jouzu-cli-args-homeRepeated": value carries its own Fluent key "jouzu-cli-args-homeRepeated"/u,
	);
});

test("the check fails on a value padded to a column", () => {
	// Fluent strips the common indentation, so the second line keeps one extra
	// leading space: the value is padded to a column, not hard wrapped.
	assertValueCheckFails(
		"first\n    second\n     third",
		/ja: "jouzu-cli-args-homeRepeated": value has a line padded to a column/u,
	);
});

test("the check fails on a hard-wrapped value", () => {
	assertValueCheckFails("first\n    second", /ja: "jouzu-cli-args-homeRepeated": value contains a hard wrap/u);
});

test("the check fails on a run of spaces that looks like a hand wrap", () => {
	assertValueCheckFails(
		"--jouzu-home  は 1 回だけ指定できます",
		/ja: "jouzu-cli-args-homeRepeated": value contains a run of spaces that looks like a hand-wrapped line/u,
	);
});

test("the value checks reach into a select variant", () => {
	// A value is everything Fluent can render from the message, so a forbidden
	// character inside a select variant must be found too. This mutation also
	// changes $plan from a value to a selector; the assertion names the character
	// check, which is the point of the test.
	withMutatedJaAndLock(
		(source) =>
			source.replace(
				"jouzu-cli-error-keybindingConflict = { $plan }",
				"jouzu-cli-error-keybindingConflict =\n    { $plan ->\n        [one] safe\n       *[other] \u202e bad\n    }",
			),
		(dir) => {
			const result = runCheck(join(dir, "locales"));
			assert.notEqual(result.status, 0);
			assert.match(
				result.stderr,
				/ja: "jouzu-cli-error-keybindingConflict": value contains a bidirectional control character U\+202E/u,
			);
		},
	);
});

test("the value checks accept the legitimate spaces and backticks in the shipped catalogs", () => {
	// `usage-hint` carries the ASCII space inside Run "jouzu --help", and the
	// Japanese recovery sentence uses backticks as its code-span notation. The
	// single spaces, quotes, and backticks are text, not a hard wrap, padding,
	// key notation, or a forbidden character, so the committed catalogs pass.
	const result = runCheck(sourceLocales);
	assert.equal(result.status, 0, result.stderr);
	assert.match(readFileSync(join(sourceLocales, "ja", "cli.ftl"), "utf8"), /`jouzu profile plan`/u);
});

// Japanese and pseudo-locale width coverage. The renderer is the
// catalog seam. It reuses the width calculation and the protected-value rule
// from `command-report.ts` and the `wrapHumanText` line-breaking rules from
// the display seam, so these tests pin behavior rather than a second implementation.

const ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

function stripAnsi(value) {
	return value.replace(ANSI_SEQUENCE, "");
}

const GOLDEN_MESSAGE_ID = "jouzu.cli.error.profileState.recovery";

/**
 * The four-locale width matrix. The `en`, `ja`, and `zh-Hans` goldens are the
 * literals below; the `zh-Hant` golden is the literal in
 * `zh-hant-catalog.test.mjs`, so the suite fixes all four locales at 48, 80, and
 * 120 columns. Each golden is a literal, so it depends only on the catalog bytes
 * and not on the machine's locale or terminal.
 */
const WIDTH_GOLDEN_LOCALES = ["en", "ja", "zh-Hans", "zh-Hant"];
const WIDTH_GOLDEN_COLUMNS = [48, 80, 120];

/** The reviewed 48/80/120-column English rendering, fixed as literals. */
const GOLDEN_LINES_EN = {
	48: [
		"Recovery: repair or remove the profile state",
		'file, then run "jouzu profile plan" and "jouzu',
		'profile apply" again.',
	],
	80: [
		'Recovery: repair or remove the profile state file, then run "jouzu profile plan"',
		'and "jouzu profile apply" again.',
	],
	120: [
		'Recovery: repair or remove the profile state file, then run "jouzu profile plan" and "jouzu profile apply" again.',
	],
};

/** The reviewed 48/80/120-column rendering, fixed as literals. */
const GOLDEN_LINES = {
	48: [
		"復旧: プロファイル状態ファイルを修復または削除し",
		"てから、`jouzu profile plan` と `jouzu profile",
		"apply` を再度実行してください。",
	],
	80: [
		"復旧: プロファイル状態ファイルを修復または削除してから、`jouzu profile plan` と",
		"`jouzu profile apply` を再度実行してください。",
	],
	120: [
		"復旧: プロファイル状態ファイルを修復または削除してから、`jouzu profile plan` と `jouzu profile apply` を再度実行してくだ",
		"さい。",
	],
};

const LINE_START_PROHIBITED =
	"、。，．：；？！）］｝〕〉》」』】〙〗〟｠»ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶゝゞヽヾ々ー";
const LINE_END_PROHIBITED = "（［｛〔〈《「『【〘〖〝｟«";

function firstCharacter(value) {
	return [...value][0];
}

function lastCharacter(value) {
	return [...value].at(-1);
}

test("Japanese goldens are fixed at 48, 80, and 120 columns", () => {
	const ja = loadCatalog("ja");
	for (const columns of [48, 80, 120]) {
		assert.deepEqual(
			ja.render(GOLDEN_MESSAGE_ID, undefined, { columns }),
			GOLDEN_LINES[columns],
			`the ${columns}-column golden changed`,
		);
	}
});

test("the Japanese goldens respect width, the prohibitions, and the catalog text", () => {
	const ja = loadCatalog("ja");
	const source = ja.format(GOLDEN_MESSAGE_ID);
	for (const columns of [48, 80, 120]) {
		const lines = GOLDEN_LINES[columns];
		// Wrapping may drop the ASCII space at a break, so compare the text
		// without spaces: no non-space character may go missing.
		assert.equal(lines.join("").replaceAll(" ", ""), source.replaceAll(" ", ""), `text changed at ${columns}`);
		for (const line of lines) {
			assert.ok(terminalTextWidth(line) <= columns, `${JSON.stringify(line)} is over ${columns} columns`);
			assert.ok(
				!LINE_START_PROHIBITED.includes(firstCharacter(line)),
				`${JSON.stringify(line)} begins with a prohibited character`,
			);
			assert.ok(
				!LINE_END_PROHIBITED.includes(lastCharacter(line)),
				`${JSON.stringify(line)} ends with a prohibited character`,
			);
		}
	}
});

test("the English goldens are fixed at 48, 80, and 120 columns", () => {
	const en = loadCatalog("en");
	for (const columns of WIDTH_GOLDEN_COLUMNS) {
		assert.deepEqual(
			en.render(GOLDEN_MESSAGE_ID, undefined, { columns }),
			GOLDEN_LINES_EN[columns],
			`the English ${columns}-column golden changed`,
		);
	}
});

test("the English goldens respect width and keep the catalog text", () => {
	const en = loadCatalog("en");
	const source = en.format(GOLDEN_MESSAGE_ID);
	for (const columns of WIDTH_GOLDEN_COLUMNS) {
		const lines = GOLDEN_LINES_EN[columns];
		// The English wrapper drops the ASCII space at a break, so compare the
		// text without spaces: no non-space character may go missing.
		assert.equal(lines.join("").replaceAll(" ", ""), source.replaceAll(" ", ""), `text changed at ${columns}`);
		for (const line of lines) {
			assert.ok(terminalTextWidth(line) <= columns, `${JSON.stringify(line)} is over ${columns} columns`);
		}
	}
});

test("every locale and column width in the width matrix renders within its column", () => {
	// The golden literals above and in `zh-hant-catalog.test.mjs` pin the text;
	// this asserts the full four-locale by three-width matrix exists and that no
	// rendering breaks its column.
	for (const locale of WIDTH_GOLDEN_LOCALES) {
		const bundle = loadCatalog(locale);
		for (const columns of WIDTH_GOLDEN_COLUMNS) {
			const lines = bundle.render(GOLDEN_MESSAGE_ID, undefined, { columns });
			assert.ok(lines.length > 0, `${locale} at ${columns} columns rendered nothing`);
			for (const line of lines) {
				assert.ok(
					terminalTextWidth(line) <= columns,
					`${locale} at ${columns}: ${JSON.stringify(line)} is over ${columns} columns`,
				);
			}
		}
	}
});

// The Simplified Chinese draft catalog. It is checked but not
// selected at runtime, so these tests load it directly from the locales root.

/** The reviewed 48/80/120-column zh-Hans rendering, fixed as literals. */
const GOLDEN_LINES_ZH_HANS = {
	48: ["恢复：修复或删除配置档案状态文件，然后再次运行", '"jouzu profile plan" 和 "jouzu profile apply"。'],
	80: ['恢复：修复或删除配置档案状态文件，然后再次运行 "jouzu profile plan" 和 "jouzu', 'profile apply"。'],
	120: ['恢复：修复或删除配置档案状态文件，然后再次运行 "jouzu profile plan" 和 "jouzu profile apply"。'],
};

test("the zh-Hans draft catalog loads and matches the en ID set", () => {
	const en = loadCatalog("en");
	const zhHans = loadCatalog("zh-Hans");
	assert.equal(zhHans.locale, "zh-Hans");
	assert.equal(zhHans.version, CATALOG_VERSION);
	assert.match(zhHans.digest, /^[0-9a-f]{64}$/u);
	assert.deepEqual(Object.keys(zhHans.messages).sort(), Object.keys(en.messages).sort());
});

test("the zh-Hans goldens are fixed at 48, 80, and 120 columns", () => {
	const zhHans = loadCatalog("zh-Hans");
	for (const columns of [48, 80, 120]) {
		assert.deepEqual(
			zhHans.render(GOLDEN_MESSAGE_ID, undefined, { columns }),
			GOLDEN_LINES_ZH_HANS[columns],
			`the zh-Hans ${columns}-column golden changed`,
		);
	}
});

test("the zh-Hans goldens respect width, the prohibitions, and the catalog text", () => {
	const zhHans = loadCatalog("zh-Hans");
	const source = zhHans.format(GOLDEN_MESSAGE_ID);
	for (const columns of [48, 80, 120]) {
		const lines = GOLDEN_LINES_ZH_HANS[columns];
		// Wrapping may drop the ASCII space at a break, so compare the text
		// without spaces: no non-space character may go missing.
		assert.equal(lines.join("").replaceAll(" ", ""), source.replaceAll(" ", ""), `text changed at ${columns}`);
		for (const line of lines) {
			assert.ok(terminalTextWidth(line) <= columns, `${JSON.stringify(line)} is over ${columns} columns`);
			assert.ok(
				!LINE_START_PROHIBITED.includes(firstCharacter(line)),
				`${JSON.stringify(line)} begins with a prohibited character`,
			);
			assert.ok(
				!LINE_END_PROHIBITED.includes(lastCharacter(line)),
				`${JSON.stringify(line)} ends with a prohibited character`,
			);
		}
	}
});

test("zh-Hans catalog meaning never depends on color", () => {
	const zhHans = loadCatalog("zh-Hans");
	const message = zhHans.render("jouzu.cli.error.generic", { message: "x" }, { columns: 48 }).join(" ");
	const build = (context) =>
		new CommandReport(context).entries("Notes", [{ status: "problem", key: "runtime", message }]).toString();

	const plain = build(
		resolveDisplayContext({
			columns: 48,
			locale: "zh-Hans",
			colorEnabled: false,
			env: { NO_COLOR: "1" },
			stdoutIsTTY: true,
		}),
	);
	assert.equal(plain.includes(ESCAPE), false);
	assert.ok(plain.includes("✗ runtime"), plain);
	assert.ok(plain.includes(message), plain);
	for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
		const context = resolveDisplayContext({ columns: 48, locale: "zh-Hans", env, stdoutIsTTY: true });
		assert.equal(context.colorMode, "none", JSON.stringify(env));
		assert.equal(context.colorEnabled, false, JSON.stringify(env));
		assert.equal(build(context), plain, JSON.stringify(env));
	}

	const colored = build(
		resolveDisplayContext({
			columns: 48,
			locale: "zh-Hans",
			colorEnabled: true,
			colorMode: "16",
			env: { TERM: "xterm-256color" },
		}),
	);
	assert.ok(colored.includes(ESCAPE));
	assert.equal(stripAnsi(colored), plain);
});

test("combining marks, full-width spaces, variant characters, and emoji keep a correct width in every locale", () => {
	// The width calculation is the shipped one: a combining mark and a
	// variation selector add nothing, and a wide glyph counts as two columns.
	assert.equal(terminalTextWidth("か\u3099"), 2, "a combining dakuten is zero width");
	assert.equal(terminalTextWidth("\u3000"), 2, "an ideographic space is two columns");
	assert.equal(terminalTextWidth("邊"), 2, "a variant character is two columns");
	assert.equal(terminalTextWidth("\uF900"), 2, "a compatibility ideograph is two columns");
	assert.equal(terminalTextWidth("🦁"), 2, "an emoji is two columns");
	assert.equal(terminalTextWidth("❤\ufe0f"), 2, "a variation selector is zero width");
	assert.equal(terminalTextWidth("👨‍👩‍👧"), 2, "a ZWJ emoji sequence is one wide glyph");

	const unit = "か\u3099\u3000邊\u3000髙\u3000🦁\ufe0f\u3000❤\ufe0f\u3000👨‍👩‍👧\u3000🇯🇵\u3000Ａ\u3000Ｂ";
	for (const locale of WIDTH_GOLDEN_LOCALES) {
		// English breaks at ASCII spaces only, so its sample joins the units with
		// an ASCII space; the CJK locales also break between CJK characters, so
		// they join with an ideographic space.
		const separator = locale === "en" ? " " : "\u3000";
		const sample = Array.from({ length: 8 }, () => unit).join(separator);
		assert.ok(terminalTextWidth(sample) > 120, `the sample must wrap at every golden width for ${locale}`);
		const bundle = loadCatalog(locale);
		for (const columns of WIDTH_GOLDEN_COLUMNS) {
			const lines = bundle.render("jouzu.cli.error.keybindingConflict", { plan: sample }, { columns });
			assert.ok(lines.length > 1, `${locale}: expected a wrap at ${columns} columns`);
			// A break may drop the separator, so compare without separators: no
			// other character may go missing.
			assert.equal(
				lines.join("").replaceAll(separator, ""),
				sample.replaceAll(separator, ""),
				`${locale}: text was lost at ${columns} columns`,
			);
			for (const line of lines) {
				assert.ok(terminalTextWidth(line) <= columns, `${locale}: ${JSON.stringify(line)} is over ${columns} columns`);
			}
		}
	}
});

/** A test-only pseudo-localization: accent the vowels and bracket the text. */
function pseudoExpand(value) {
	return `[!! ${value.replace(/[aeiou]/gu, (character) => ({ a: "á", e: "é", i: "í", o: "ó", u: "ú" })[character])} !!]`;
}

/**
 * Write a test-only `en-XA` catalog into a temporary locales root and load it.
 * Nothing is written into the repository and nothing extra ships: the shipped
 * `CATALOG_LOCALES`, `catalog.lock.json`, and validation stay `en` and `ja`.
 */
function withPseudoCatalog(source, callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-pseudo-"));
	try {
		const localesRoot = join(dir, "locales");
		mkdirSync(join(localesRoot, "en-XA"), { recursive: true });
		writeFileSync(join(localesRoot, "en-XA", "cli.ftl"), source);
		const digest = createHash("sha256").update(source).digest("hex");
		writeFileSync(
			join(localesRoot, "catalog.lock.json"),
			JSON.stringify({ version: CATALOG_VERSION, locales: { "en-XA": digest } }),
		);
		callback(loadCatalog("en-XA", { localesRoot }));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("a test-only pseudo-locale expands the English text and still wraps", () => {
	const english = loadCatalog("en").format(GOLDEN_MESSAGE_ID);
	const pseudo = pseudoExpand(english);
	assert.ok(terminalTextWidth(pseudo) > 120, "the expansion must be long enough to wrap");
	withPseudoCatalog(`jouzu-cli-error-profileState-recovery = ${pseudo}\n`, (bundle) => {
		assert.equal(bundle.locale, "en-XA");
		for (const columns of [48, 80, 120]) {
			const lines = bundle.render(GOLDEN_MESSAGE_ID, undefined, { columns });
			assert.ok(lines.length > 1, `expected a wrap at ${columns} columns`);
			assert.equal(lines.join(" "), pseudo, `text was lost at ${columns} columns`);
			for (const line of lines) {
				assert.ok(terminalTextWidth(line) <= columns, `${JSON.stringify(line)} is over ${columns} columns`);
			}
		}
	});
});

test("the offered catalog set stays en and ja; the zh-Hans and zh-Hant drafts are recorded but not offered", () => {
	// `CATALOG_LOCALES` is the set the product offers and resolves. It stays at
	// `en` and `ja` until a Chinese review record exists, so adding the drafts
	// does not change what the product claims to support.
	assert.deepEqual([...CATALOG_LOCALES], ["en", "ja"]);
	// The lock records the drafts too, so the locale check and `loadCatalog` can
	// validate them; a recorded-but-unoffered catalog is the draft state.
	const lock = JSON.parse(readFileSync(join(sourceLocales, "catalog.lock.json"), "utf8"));
	assert.deepEqual(Object.keys(lock.locales).sort(), ["en", "ja", "zh-Hans", "zh-Hant"]);
	for (const locale of ["en", "ja", "zh-Hans", "zh-Hant"]) {
		const bytes = readFileSync(join(sourceLocales, locale, "cli.ftl"));
		assert.equal(lock.locales[locale], createHash("sha256").update(bytes).digest("hex"), locale);
	}
});

test("a long path, a digest, and a model ID each stay on one line", () => {
	const path = "/home/user/.local/state/jouzu/sessions/2026-09-13/long-session-name";
	const digest = "a".repeat(64);
	const modelId = "shisa/deepseek-v4-flash-preview-2026-09-13";
	const cases = [
		["path", path, protectedPath(path)],
		["digest", digest, protectedDigest(digest)],
		["model-id", modelId, protectedModelId(modelId)],
	];
	for (const locale of ["en", "ja"]) {
		const bundle = loadCatalog(locale);
		for (const [kind, text, value] of cases) {
			// The value is wider than the column, so a split would be visible.
			assert.ok(terminalTextWidth(text) > 40, `${kind} must be wider than the column`);
			const lines = bundle.render("jouzu.cli.error.generic", { message: value }, { columns: 40 });
			assert.ok(lines.includes(text), `${locale} ${kind} was split: ${JSON.stringify(lines)}`);
			for (const line of lines) {
				if (line === text || line.trim() === "") continue;
				assert.ok(!text.includes(line), `${locale} ${kind} left the fragment ${JSON.stringify(line)}`);
			}
		}
	}
});

test("catalog meaning never depends on color", () => {
	const ja = loadCatalog("ja");
	const message = ja.render("jouzu.cli.error.generic", { message: "x" }, { columns: 48 }).join(" ");
	const build = (context) =>
		new CommandReport(context).entries("Notes", [{ status: "problem", key: "runtime", message }]).toString();

	// The no-color mechanisms resolve to no color, and the marker plus the
	// catalog text still carry the meaning.
	const plain = build(
		resolveDisplayContext({
			columns: 48,
			locale: "ja",
			colorEnabled: false,
			env: { NO_COLOR: "1" },
			stdoutIsTTY: true,
		}),
	);
	assert.equal(plain.includes(ESCAPE), false);
	assert.ok(plain.includes("✗ runtime"), plain);
	assert.ok(plain.includes(message), plain);
	for (const env of [{ NO_COLOR: "1" }, { TERM: "dumb" }]) {
		const context = resolveDisplayContext({ columns: 48, locale: "ja", env, stdoutIsTTY: true });
		assert.equal(context.colorMode, "none", JSON.stringify(env));
		assert.equal(context.colorEnabled, false, JSON.stringify(env));
		assert.equal(build(context), plain, JSON.stringify(env));
	}

	// Color adds escape sequences but removes no text.
	const colored = build(
		resolveDisplayContext({
			columns: 48,
			locale: "ja",
			colorEnabled: true,
			colorMode: "16",
			env: { TERM: "xterm-256color" },
		}),
	);
	assert.ok(colored.includes(ESCAPE));
	assert.equal(stripAnsi(colored), plain);
});

test("every doctor and catalog field-label ID exists in both catalogs", () => {
	const en = loadCatalog("en");
	const ja = loadCatalog("ja");
	const ids = [...Object.values(DOCTOR_FIELD_LABEL_IDS), ...Object.values(CATALOG_FIELD_LABEL_IDS)];
	assert.ok(ids.length > 0, "the field-label maps are not empty");
	for (const id of ids) {
		assert.ok(en.messages[id], `en catalog is missing ${id}`);
		assert.ok(ja.messages[id], `ja catalog is missing ${id}`);
	}
});
