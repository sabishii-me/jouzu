import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/language-runtime-wiring.mjs", import.meta.url));
const settings = { uiLocale: "en", responseLanguage: "en", artifactPolicy: { commits: "en" } };

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
	assert.equal(observed.profile, "core");
	assert.equal(observed.initial.contract.taskLanguage, "zh-Hant");
	assert.equal(observed.initial.contract.artifactPolicy.commits, "en", "the untrusted project contributes nothing");
	assert.match(observed.initialPrompt, /Response language: Traditional Chinese \(zh-Hant\)/u);
	assert.match(observed.initialPrompt, /commits: Use English \(en\)/u);
	assert.equal(JSON.parse(observed.settingsAfter).localization.uiLocale, "ja");
	assert.equal(JSON.parse(observed.settingsAfter).localization.responseLanguage, "zh-Hant");
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
	["CLI over environment", { cliLocale: "en", envLocale: "ja" }, "en"],
	["environment over saved choice", { envLocale: "en" }, "en"],
	["CLI auto over saved choice", { cliLocale: "auto", envLocale: "ja" }, "en"],
]) {
	test(`first-run re-resolution preserves ${name}`, (t) => {
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

test("RPC startup bypasses first-run interaction and preserves machine stdout", (t) => {
	const observed = run(t, { machine: true, choice: { uiLocale: "ja", responseLanguage: "ja" } });
	assert.equal(observed.prompts, 0);
	assert.equal(observed.settingsAfter, undefined);
	assert.equal(observed.profileChoiceExists, false);
	assert.equal(observed.stdout, "");
	assert.equal(observed.stderr, "");
	assert.deepEqual(observed.piArgs.slice(-3), ["--no-extensions", "--mode", "rpc"]);
});

for (const environmentScope of [false, true]) {
	test(`main and picker deliver successful Settings ${environmentScope ? "environment" : "session"} Apply to the next prompt`, (t) => {
		const observed = run(t, { settings, action: "apply", environmentScope });
		assert.deepEqual(observed.preview, observed.initial);
		assert.deepEqual(observed.applied, observed.initial, "Apply only stages the contract");
		assert.equal(observed.callbacks.length, 1);
		assert.equal(observed.callbacks[0].persisted.responseLanguage, "ja", "persistence precedes the callback");
		assert.equal(observed.callbacks[0].language.responseLanguage.source, "session");
		assert.equal(observed.next.epochs, observed.initial.epochs + 1);
		assert.equal(observed.next.contract.taskLanguage, "ja");
		assert.equal(observed.next.contract.artifactPolicy.commits, "preserve");
		assert.match(observed.nextPrompt, /Response language: Japanese \(ja\)/u);
		assert.match(observed.nextPrompt, /commits: Preserve the existing language/u);
		assert.equal(observed.settingsAfter, observed.settingsBefore, "response/artifact choices remain session-scoped");
	});
}

for (const action of ["cancel", "failure", "ui-only"]) {
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

test("Settings reset notifies the main contract after clearing the session override", (t) => {
	const observed = run(t, { settings, action: "reset" });
	assert.equal(observed.callbacks.length, 2);
	assert.deepEqual(observed.callbacks[1].persisted, {});
	assert.deepEqual(observed.resetStaged, observed.next);
	assert.equal(observed.reset.contract.taskLanguage, "en");
	assert.equal(observed.reset.contract.artifactPolicy.commits, "en");
	assert.match(observed.resetPrompt, /Response language: English \(en\)/u);
});
