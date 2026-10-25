import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import {
	LANGUAGE_CANDIDATES,
	languageSelfName,
	parseLanguageCandidateAnswer,
	promptForLanguageChoice,
	saveLanguageChoice,
	suggestedUiLocale,
} from "../dist/language-choice.js";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { readLocalizationSettings } from "../dist/ui-locale.js";

function temporaryPaths() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-language-choice-"));
	return { root, paths: resolveJouzuPaths({ homeOverride: join(root, "jouzu") }) };
}

function capture() {
	let output = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			output += chunk.toString();
			callback();
		},
	});
	return {
		stream,
		text: () => output,
	};
}

function settingsPath(paths) {
	return join(paths.configDir, "localization.json");
}

/**
 * Feed one answer per question. readline drops a buffered second line when the
 * first question resolves, so each line waits for the next question to attach.
 */
function answers(...values) {
	return Readable.from(
		(async function* () {
			for (const value of values) {
				yield `${value}\n`;
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		})(),
	);
}

test("the four candidates carry each language's self-name and its shipped flag", () => {
	assert.deepEqual(
		LANGUAGE_CANDIDATES.map((candidate) => candidate.tag),
		["en", "ja", "zh-Hans", "zh-Hant"],
	);
	assert.deepEqual(
		LANGUAGE_CANDIDATES.map((candidate) => candidate.shipped),
		[true, true, false, false],
	);
	const catalog = resolveCatalog("en").bundle;
	assert.deepEqual(
		LANGUAGE_CANDIDATES.map((candidate) => languageSelfName(candidate.tag, catalog)),
		["English", "日本語", "简体中文", "繁體中文"],
	);
});

test("the OS candidate is a suggestion only: it marks a row and is never committed", () => {
	assert.equal(suggestedUiLocale({ LANG: "ja_JP.UTF-8" }), "ja");
	assert.equal(suggestedUiLocale({ LANG: "zh_CN.UTF-8" }), "zh-Hans");
	assert.equal(suggestedUiLocale({}), undefined);
});

test("a skip leaves the saved settings byte-identical", async () => {
	const { root, paths } = temporaryPaths();
	try {
		const out = capture();
		const choice = await promptForLanguageChoice(Readable.from(["\n"]), out.stream, {
			env: { LANG: "ja_JP.UTF-8" },
		});
		assert.equal(choice, undefined);
		assert.equal(existsSync(settingsPath(paths)), false, "a skip wrote the settings");
		// The four self-names and the suggestion are shown; nothing is committed.
		assert.match(out.text(), /English/u);
		assert.match(out.text(), /日本語 \(suggested\)/u);
		assert.match(out.text(), /简体中文 \(not available in this build\)/u);
		assert.match(out.text(), /繁體中文 \(not available in this build\)/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a non-interactive run reads nothing and writes nothing", async () => {
	const { root, paths } = temporaryPaths();
	try {
		const out = capture();
		let read = false;
		const input = new Readable({
			read() {
				read = true;
			},
		});
		const choice = await promptForLanguageChoice(input, out.stream, { interactive: false });
		assert.equal(choice, undefined);
		assert.equal(read, false, "the non-interactive run read from input");
		assert.equal(out.text(), "", "the non-interactive run wrote a prompt");
		assert.equal(existsSync(settingsPath(paths)), false, "a non-interactive run wrote the settings");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an unshipped locale is shown but cannot be selected", async () => {
	const { root, paths } = temporaryPaths();
	try {
		const out = capture();
		// Choose zh-Hans, then skip the retry.
		const choice = await promptForLanguageChoice(answers("3", ""), out.stream);
		assert.equal(choice, undefined);
		assert.match(out.text(), /not available in 简体中文 in this build/u);
		assert.equal(existsSync(settingsPath(paths)), false, "an unshipped locale was written");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the interface language and the response language are confirmed separately", async () => {
	const { root, paths } = temporaryPaths();
	try {
		const out = capture();
		// Interface 日本語, response English.
		const choice = await promptForLanguageChoice(answers("2", "1"), out.stream);
		assert.deepEqual(choice, { uiLocale: "ja", responseLanguage: "en" });
		assert.match(out.text(), /Choose the interface language/u);
		assert.match(out.text(), /Choose the language Jouzu writes replies in/u);
		saveLanguageChoice(paths, choice);
		const saved = readLocalizationSettings(paths.configDir);
		assert.equal(saved.status, "ok");
		assert.equal(saved.settings.uiLocale, "ja");
		assert.equal(saved.settings.responseLanguage, "en");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a self-name answer works in any interface language, so a wrong choice is recoverable", () => {
	// The self-names are identical in every catalog, so a user who cannot read the
	// current interface can still type their own language's name.
	for (const locale of ["en", "ja"]) {
		const catalog = resolveCatalog(locale).bundle;
		assert.equal(parseLanguageCandidateAnswer("日本語", LANGUAGE_CANDIDATES, catalog)?.tag, "ja");
		assert.equal(parseLanguageCandidateAnswer("English", LANGUAGE_CANDIDATES, catalog)?.tag, "en");
		assert.equal(parseLanguageCandidateAnswer("zh-Hant", LANGUAGE_CANDIDATES, catalog)?.tag, "zh-Hant");
	}
});

test("the choice is written atomically and preserves an existing artifact policy", async () => {
	const { root, paths } = temporaryPaths();
	try {
		mkdirSync(paths.configDir, { recursive: true });
		writeFileSync(
			settingsPath(paths),
			`${JSON.stringify({
				schemaVersion: 2,
				localization: { uiLocale: "en", artifactPolicy: { comments: "preserve", documentation: "ja" } },
			})}\n`,
		);
		saveLanguageChoice(paths, { uiLocale: "ja", responseLanguage: "ja" });
		const saved = readLocalizationSettings(paths.configDir);
		assert.equal(saved.status, "ok");
		assert.equal(saved.settings.uiLocale, "ja");
		assert.equal(saved.settings.responseLanguage, "ja");
		assert.deepEqual(saved.settings.artifactPolicy, { comments: "preserve", documentation: "ja" });
		assert.match(readFileSync(settingsPath(paths), "utf8"), /"schemaVersion": 2/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
