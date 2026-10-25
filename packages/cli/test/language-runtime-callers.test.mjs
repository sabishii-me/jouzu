import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/language-runtime-wiring.mjs", import.meta.url));
const settings = { uiLocale: "en", responseLanguage: "en", artifactPolicy: { commits: "en" } };

function assertRpcStderr(stderr) {
	// Node 22 emits this runtime warning on import; all other stderr remains an error.
	const sqliteWarning =
		/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n/u;
	assert.equal(stderr.replace(sqliteWarning, ""), "");
}

function run(t, scenario = {}) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-language-callers-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, "jouzu");
	const output = join(root, "observed.json");
	mkdirSync(join(root, ".jouzu"));
	// This untrusted project must not override the saved artifact policy.
	writeFileSync(
		join(root, ".jouzu", "localization.json"),
		JSON.stringify({ localization: { artifactPolicy: { commits: "ja" } } }),
	);
	const inheritedAgentDir = join(root, "inherited-pi");
	mkdirSync(inheritedAgentDir);
	const authFile = join(inheritedAgentDir, "auth.json");
	writeFileSync(authFile, "{}\n");
	const result = spawnSync(process.execPath, [fixture, JSON.stringify({ ...scenario, home, output })], {
		cwd: root,
		encoding: "utf8",
		timeout: 30_000,
		env: {
			PATH: process.env.PATH,
			...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
			HOME: root,
			USERPROFILE: root,
			TERM: "xterm",
			NO_COLOR: "1",
			LANG: "en_US.UTF-8",
			LC_ALL: "en_US.UTF-8",
			PI_OFFLINE: "1",
			JOUZU_FLOW_CONTROL: "0",
			PI_CODING_AGENT_DIR: inheritedAgentDir,
			...(scenario.envLocale ? { JOUZU_UI_LOCALE: scenario.envLocale } : {}),
		},
	});
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const observed = JSON.parse(readFileSync(output, "utf8"));
	assert.equal(observed.networkRequests, 0);
	assert.equal(observed.agentDir, join(home, "agent"));
	assert.equal(readFileSync(authFile, "utf8"), "{}\n", "the inherited Pi credential file is untouched");
	return { ...observed, stdout: result.stdout, stderr: result.stderr };
}

test("main applies first-run display and independent response choices in the same launch", (t) => {
	const observed = run(t, { settings, choice: { uiLocale: "ja", responseLanguage: "zh-Hant" } });
	assert.equal(observed.prompts, 1);
	assert.deepEqual(Object.values(observed.catalogs), ["ja", "ja", "ja", "ja", "ja"]);
	assert.equal(observed.shortcutHint, "Ctrl+L モデル · Ctrl+P お気に入り · Ctrl+/ ヘルプ");
	assert.equal(observed.profile, "core");
	assert.equal(observed.initial.contract.taskLanguage, "zh-Hant");
	assert.equal(observed.initial.contract.artifactPolicy.commits, "en", "the untrusted project contributes nothing");
	assert.match(observed.initialPrompt, /Response language: Traditional Chinese \(zh-Hant\)/u);
	assert.match(observed.initialPrompt, /commits: Use English \(en\)/u);
	assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "ja");
	assert.equal(JSON.parse(observed.settingsAfter).localization.responseLanguage, "zh-Hant");
});

test("an unbound model shortcut uses the active catalog and falls back to English", (t) => {
	const ja = run(t, { choice: { uiLocale: "ja", responseLanguage: "ja" }, missingCycleKey: true });
	assert.equal(ja.shortcutHint, "Ctrl+L モデル · 未バインド お気に入り · Ctrl+/ ヘルプ");
	const en = run(t, { settings, missingCycleKey: true });
	assert.equal(en.shortcutHint, "Ctrl+L models · unbound favorites · Ctrl+/ help");
});

test("Japanese first-run UI with Automatic responses does not install a Japanese-response profile", (t) => {
	const observed = run(t, { choice: { uiLocale: "ja", responseLanguage: "auto" } });
	assert.ok(Object.values(observed.catalogs).every((locale) => locale === "ja"));
	assert.equal(observed.profile, "core");
	assert.equal(observed.initial.contract.taskLanguage, "preserve");
	assert.doesNotMatch(observed.initialPrompt, /Response language:|Write user-facing explanations in Japanese/u);
	assert.equal(JSON.parse(observed.settingsAfter).localization.responseLanguage, "auto");
	assert.equal(observed.installedAppendSystem, undefined, "onboarding must not install a fixed response profile");
});

test("an explicitly chosen Japanese profile remains independent of the display language", (t) => {
	const observed = run(t, { cliProfile: "ja", cliLocale: "en" });
	assert.equal(observed.prompts, 0);
	assert.equal(observed.profile, "ja");
	assert.match(observed.installedAppendSystem, /Jouzu Japanese-First Policy/u);
	assert.ok(Object.values(observed.catalogs).every((locale) => locale === "en"));
});

for (const [name, overrides, expected] of [
	["CLI and environment", { cliLocale: "en", envLocale: "ja" }, "ja"],
	["environment", { envLocale: "en" }, "ja"],
	["CLI auto", { cliLocale: "auto", envLocale: "ja" }, "ja"],
]) {
	test(`first-run confirmed choice overrides ${name}`, (t) => {
		const observed = run(t, { ...overrides, choice: { uiLocale: "ja", responseLanguage: "ja" } });
		assert.ok(Object.values(observed.catalogs).every((locale) => locale === expected));
		assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "ja");
		assert.equal(
			observed.initial.contract.taskLanguage,
			"ja",
			"display precedence does not change the response choice",
		);
	});
}

test("first-run cancellation keeps saved language bytes and the launch contract unchanged", (t) => {
	const observed = run(t, { settings });
	assert.equal(observed.prompts, 1);
	assert.equal(observed.settingsAfter, observed.settingsBefore);
	assert.equal(observed.profileChoiceExists, false);
	assert.equal(observed.initial.contract.taskLanguage, "en");
	assert.ok(Object.values(observed.catalogs).every((locale) => locale === "en"));
});

test("a refused first-run save does not apply the unsaved choices", (t) => {
	const rawSettings = '{"schemaVersion":999,"localization":{"uiLocale":"en"}}\n';
	const observed = run(t, { rawSettings, choice: { uiLocale: "ja", responseLanguage: "ja" } });
	assert.equal(observed.settingsAfter, rawSettings);
	assert.equal(observed.profileChoiceExists, false);
	assert.equal(observed.initial.contract.taskLanguage, "preserve");
	assert.ok(Object.values(observed.catalogs).every((locale) => locale === "en"));
});

test("RPC stderr permits only the exact Node SQLite experimental warning", () => {
	const warning =
		"(node:123) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n" +
		"(Use `node --trace-warnings ...` to show where the warning was created)\n";
	for (const stderr of ["", warning, warning.replaceAll("\n", "\r\n")]) assertRpcStderr(stderr);
	for (const stderr of [
		"unexpected diagnostic\n",
		`unexpected diagnostic\n${warning}`,
		`${warning}unexpected diagnostic\n`,
		warning.replace("SQLite", "Another API"),
		warning.replace("ExperimentalWarning", "Warning"),
		warning.split("\n")[0],
		`${warning}${warning}`,
		`${warning}\n`,
	]) {
		assert.throws(() => assertRpcStderr(stderr), { code: "ERR_ASSERTION" });
	}
});

test("RPC startup bypasses first-run interaction and preserves machine stdout", (t) => {
	const observed = run(t, { machine: true, choice: { uiLocale: "ja", responseLanguage: "ja" } });
	assert.equal(observed.prompts, 0);
	assert.equal(observed.settingsAfter, undefined);
	assert.equal(observed.profileChoiceExists, false);
	assert.equal(observed.stdout, "");
	assertRpcStderr(observed.stderr);
	assert.deepEqual(observed.piArgs.slice(-3), ["--no-extensions", "--mode", "rpc"]);
});

test("main and picker persist Settings Apply before staging the next prompt", (t) => {
	const observed = run(t, { settings, action: "apply" });
	assert.deepEqual(observed.preview, observed.initial);
	assert.deepEqual(observed.applied, observed.initial, "Apply only stages the contract");
	assert.equal(observed.callbacks.length, 1);
	const callback = observed.callbacks[0];
	assert.equal(callback.language.responseLanguage.source, "config");
	assert.deepEqual(callback.persisted, {}, "no session override shadows the saved values");
	assert.equal(callback.saved.settings.responseLanguage, "ja", "persistence precedes the callback");
	assert.equal(callback.saved.settings.artifactPolicy.commits, "preserve");
	const fresh = run(t, { rawSettings: observed.settingsAfter });
	assert.equal(fresh.initial.contract.taskLanguage, "ja", "a new launch resolves the saved response language");
	assert.deepEqual(fresh.initial.contract.artifactPolicy, observed.next.contract.artifactPolicy);
	assert.equal(fresh.sessionFile, undefined, "fresh resolution needs no session store");
	assert.equal(observed.next.epochs, observed.initial.epochs + 1);
	assert.equal(observed.next.contract.taskLanguage, "ja");
	assert.equal(observed.next.contract.artifactPolicy.commits, "preserve");
	assert.match(observed.nextPrompt, /Response language: Japanese \(ja\)/u);
	assert.match(observed.nextPrompt, /commits: Preserve the existing language/u);
});

for (const action of ["cancel", "failure"]) {
	test(`Settings ${action} does not stage a response contract`, (t) => {
		const observed = run(t, { settings, action });
		assert.equal(observed.callbacks.length, 0);
		assert.deepEqual(observed.next, observed.initial);
		assert.equal(observed.settingsAfter, observed.settingsBefore);
		if (action === "cancel") assert.equal(observed.sessionFile, undefined);
		if (action === "failure") {
			assert.equal(observed.sessionFile, "{invalid\n");
			assert.match(observed.rendered, /The language change was not saved:/u);
		}
	});
}

test("confirmed Automatic overrides launch inputs and follows the OS on the next launch", (t) => {
	const observed = run(t, {
		settings: { ...settings, uiLocale: "ja" },
		cliLocale: "ja",
		envLocale: "ja",
		action: "ui-only",
	});
	assert.equal(observed.activeUiLocale, "en");
	assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "auto");
	const fresh = run(t, { rawSettings: observed.settingsAfter, cliLocale: "ja", envLocale: "ja" });
	assert.ok(Object.values(fresh.catalogs).every((locale) => locale === "en"));
});

for (const launchOverride of [{ cliLocale: "ja" }, { envLocale: "ja" }]) {
	test(`confirmed English overrides ${Object.keys(launchOverride)[0]} and refreshes shared UI text`, (t) => {
		const observed = run(t, { settings: { ...settings, uiLocale: "ja" }, ...launchOverride, action: "ui-english" });
		assert.ok(Object.values(observed.catalogs).every((locale) => locale === "ja"));
		assert.match(observed.confirmation, /日本語\s*→\s*English/u);
		assert.doesNotMatch(observed.confirmation, /→\s*(Automatic|自動)/u);
		assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "en");
		assert.equal(observed.activeUiLocale, "en");
		assert.match(observed.activeShortcutHint, /models/u);
		assert.doesNotMatch(observed.activeShortcutHint, /モデル/u);
		assert.equal(observed.callbacks.length, 0, "display changes do not change response instructions");
		assert.deepEqual(observed.next, observed.initial);
		const fresh = run(t, { rawSettings: observed.settingsAfter, ...launchOverride });
		assert.ok(Object.values(fresh.catalogs).every((locale) => locale === "en"));
	});
}

test("display-only Apply saves the choice without changing the response contract", (t) => {
	const observed = run(t, { settings, action: "ui-only" });
	assert.equal(observed.callbacks.length, 0);
	assert.deepEqual(observed.next, observed.initial);
	assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "ja");
	assert.equal(observed.activeUiLocale, "ja");
});

for (const action of ["defer-stream", "defer-tool"]) {
	test(`the production picker ${action} activity blocks persistence and contract staging until idle`, (t) => {
		const observed = run(t, { settings, action });
		assert.equal(observed.deferred.callbacks, 0);
		assert.equal(observed.deferred.sessionFileExists, false);
		assert.deepEqual(observed.deferred.contract, observed.initial.contract);
		assert.match(observed.deferred.rendered, /Language change deferred/u);
		assert.equal(observed.callbacks.length, 1);
		assert.equal(observed.next.contract.taskLanguage, "ja");
	});
}

test("Settings artifact-only Apply reaches the main prompt without fixing Automatic responses", (t) => {
	const observed = run(t, { settings: { ...settings, responseLanguage: "auto" }, action: "artifact-only" });
	assert.equal(observed.next.contract.taskLanguage, "preserve");
	assert.notEqual(observed.next.contract.contractId, observed.initial.contract.contractId);
	assert.match(observed.nextPrompt, /commits: Preserve the existing language/u);
	assert.doesNotMatch(observed.nextPrompt, /Response language:|Write user-facing explanations in/u);
});

test("Settings display reset preserves saved response and artifact preferences", (t) => {
	const observed = run(t, { settings, action: "reset" });
	assert.equal(observed.callbacks.length, 1, observed.resetRendered);
	assert.deepEqual(observed.resetStaged, observed.next);
	assert.equal(observed.reset.contract.taskLanguage, "ja");
	assert.equal(observed.reset.contract.artifactPolicy.commits, "preserve");
	assert.match(observed.resetPrompt, /Response language: Japanese \(ja\)/u);
	assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "auto");
});
