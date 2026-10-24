/**
 * The Settings wiring for the catalog language view.
 *
 * These tests drive the compiled `dist/catalog-settings.js` Language view. They
 * pin the unified Settings acceptance items: a confirmed change always persists
 * to `localization.json`; a saved fixed display language wins over a launch
 * option, an environment value, and an older session override; preview and
 * cancel write nothing; reset restores the saved display language and keeps
 * saved response/artifact choices; and the confirmation has no scope chooser.
 *
 * The Display-language preview switches the Settings panel's own catalog, so a
 * test that keeps English assertions previews `en` from a saved `ja` (or
 * previews the Response-language item, which does not change the panel
 * language).
 *
 * `npm run build` must run first: the tests import `dist`.
 */

import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CatalogSettingsComponent } from "../dist/catalog-settings.js";
import { createLanguageContractExtension } from "../dist/language-contract.js";
import { resolveArtifactPolicy, resolveResponseLanguage } from "../dist/language-settings.js";
import {
	applyLocalization,
	LOCALIZATION_SESSION_FILE_NAME,
	readLocalizationSessionOverride,
} from "../dist/localization-ops.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { createSessionUiStyles } from "../dist/session-ui/index.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";
import {
	LOCALIZATION_FILE_NAME,
	readLocalizationConfig,
	readLocalizationSettings,
	resolveUiLocale,
} from "../dist/ui-locale.js";

const identityTheme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
};

function fakeKeybindings(overrides = {}) {
	const keys = {
		"tui.select.cancel": ["escape", "ctrl+c"],
		"tui.select.confirm": ["enter"],
		"tui.select.up": ["up"],
		"tui.select.down": ["down"],
		"tui.select.pageUp": ["pageUp"],
		"tui.select.pageDown": ["pageDown"],
		...overrides,
	};
	return {
		matches(data, action) {
			return keys[action]?.includes(data) ?? false;
		},
		getKeys(action) {
			return [...(keys[action] ?? [])];
		},
	};
}

function setup(options = {}) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-language-apply-"));
	const paths = resolveJouzuPaths({ homeOverride: join(root, "jouzu") });
	mkdirSync(paths.configDir, { recursive: true });
	mkdirSync(paths.stateDir, { recursive: true });
	const closes = [];
	const context = {
		tui: {
			requestRender() {},
			terminal: { rows: options.rows ?? 32, columns: options.columns ?? 100 },
		},
		theme: identityTheme,
		keybindings: options.keybindings ?? fakeKeybindings(),
		styles: createSessionUiStyles(identityTheme),
		close() {
			closes.push(true);
		},
	};
	return { root, paths, context, closes };
}

function settingsPath(paths) {
	return join(paths.configDir, LOCALIZATION_FILE_NAME);
}

function sessionStorePath(paths) {
	return join(paths.stateDir, LOCALIZATION_SESSION_FILE_NAME);
}

function writeSettings(paths, localization) {
	writeFileSync(settingsPath(paths), `${JSON.stringify({ schemaVersion: 2, localization }, null, 2)}\n`);
}

function componentFor(paths, context, options = {}) {
	return new CatalogSettingsComponent({
		context,
		paths,
		env: options.env ?? {},
		sessionId: "s1",
		...(options.uiLocaleCli ? { uiLocaleCli: options.uiLocaleCli } : {}),
		...(options.activity ? { activity: options.activity } : {}),
		...(options.onLanguageChanged ? { onLanguageChanged: options.onLanguageChanged } : {}),
		...(options.onUiLocaleChanged ? { onUiLocaleChanged: options.onUiLocaleChanged } : {}),
	});
}

/** Focus the Display-language row. `/language` opens on it. */
function focusDisplay(component) {
	component.route({ view: "settings", query: "language" });
}

/** Focus the Response-language row. */
function focusResponse(component) {
	component.route({ view: "settings", query: "language" });
	component.handleInput("down");
}

test("short language confirmations keep every summary and recovery row reachable", (t) => {
	const f = setup({ rows: 8, columns: 48 });
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "en", responseLanguage: "en" });
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("enter");
	const expected = component.renderLanguageConfirm(48, (value) => value, 100);
	let seen = "";
	for (let page = 0; page < 25; page++) {
		const lines = component.render(48);
		assert.ok(lines.length <= 6, lines.join("\n"));
		seen += lines.join("\n");
		component.handleInput("pageDown");
	}
	for (const row of expected) assert.ok(seen.includes(row.trim()), `reachable confirmation row: ${row}`);
	assert.match(seen, /↑ \d+/u);
	assert.equal(readLocalizationSettings(f.paths.configDir).settings.responseLanguage, "en");
	component.handleInput("escape");
});

for (const launch of [
	{
		name: "--jouzu-ui-locale",
		options: { uiLocaleCli: "ja" },
		fresh: (paths) => resolveUiLocale({ cli: "ja", config: readLocalizationConfig(paths.configDir), os: [] }),
	},
	{
		name: "JOUZU_UI_LOCALE",
		options: { env: { JOUZU_UI_LOCALE: "ja" } },
		fresh: (paths) => resolveUiLocale({ env: "ja", config: readLocalizationConfig(paths.configDir), os: [] }),
	},
]) {
	test(`a confirmed English choice persists over ${launch.name} and is not masked`, (t) => {
		const f = setup();
		t.after(() => rmSync(f.root, { recursive: true, force: true }));
		const changed = [];
		const component = componentFor(f.paths, f.context, {
			...launch.options,
			onUiLocaleChanged: (locale) => changed.push(locale),
		});
		focusDisplay(component);
		assert.match(component.render(90).join("\n"), /Display language.*日本語.*(?:cli|env)/u);

		// From Japanese the preference cycle reaches Automatic and then English.
		component.handleInput("\u001b[C");
		component.handleInput("\u001b[C");
		assert.match(component.render(90).join("\n"), /Display language.*English.*preview/u);

		component.handleInput("enter");
		let rendered = component.render(90).join("\n");
		assert.match(rendered, /Save language change/u);
		assert.match(rendered, /Display language.*日本語.*English/u);
		assert.doesNotMatch(rendered, /This session only|Saved setting|Apply range/u);

		// The confirmation has no scope chooser: left/right changes nothing.
		component.handleInput("\u001b[D");
		assert.match(component.render(90).join("\n"), /Display language.*日本語.*English/u);

		component.handleInput("enter");
		rendered = component.render(90).join("\n");
		assert.match(rendered, /Saved for future sessions/u);
		assert.match(rendered, /English.*config/u);
		assert.match(rendered, /restart Jouzu/u);
		assert.deepEqual(changed, ["en"], "the host is told the post-save effective locale");
		assert.equal(
			JSON.parse(readFileSync(settingsPath(f.paths), "utf8")).localization.uiLocale,
			"en",
			"the confirmed display language is written",
		);
		assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), {});

		const fresh = launch.fresh(f.paths);
		assert.equal(fresh.effective, "en", "a fresh resolution uses the saved fixed preference");
		assert.equal(fresh.source, "config");
		assert.equal(fresh.requested, "en");
	});
}

test("a confirmed response-language change persists instead of creating a session override", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[C");
	assert.match(component.render(90).join("\n"), /Response language.*日本語.*preview/u);
	component.handleInput("enter");
	assert.match(component.render(90).join("\n"), /Response language.*Automatic.*日本語/u);
	component.handleInput("enter");
	const rendered = component.render(90).join("\n");
	assert.match(rendered, /Saved for future sessions/u);
	assert.match(rendered, /日本語.*config/u);
	assert.equal(readLocalizationSessionOverride(f.paths.stateDir, "s1").responseLanguage, undefined);
	assert.equal(
		JSON.parse(readFileSync(settingsPath(f.paths), "utf8")).localization.responseLanguage,
		"ja",
		"the confirmed response language is written",
	);
});

test("a saved-setting change applies to the current session and backs up the previous file", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "ja" });
	const component = componentFor(f.paths, f.context);
	focusDisplay(component);
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[C");

	component.handleInput("enter");
	component.handleInput("enter");

	const lines = component.render(90);
	const rendered = lines.join("\n");
	// Long temp paths (Windows) wrap mid-segment, so match the path with the box borders removed.
	const unwrapped = lines.map((line) => line.replace(/^│ ?|\s*│$/gu, "")).join("");
	assert.match(rendered, /Transaction:/u);
	assert.match(unwrapped, /Backup:\s*\S*localization[\\/]environment/u);
	assert.match(rendered, /English.*config/u);

	const saved = JSON.parse(readFileSync(settingsPath(f.paths), "utf8"));
	assert.equal(saved.localization.uiLocale, "en", "the saved display language is written");
	assert.equal(
		readLocalizationSessionOverride(f.paths.stateDir, "s1").uiLocale,
		undefined,
		"the environment save drops the session display-language override",
	);
	assert.equal(
		readLocalizationSettings(f.paths.configDir).settings.uiLocale,
		"en",
		"the saved-setting change reaches the current session",
	);
});

test("Saved response and artifact choices persist before staging the next turn", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "en", responseLanguage: "en", artifactPolicy: { commits: "en" } });
	const handlers = new Map();
	const contract = createLanguageContractExtension({
		responseLanguage: resolveResponseLanguage({ config: "en" }),
		artifactPolicy: resolveArtifactPolicy({ config: { commits: "en" } }),
	});
	contract.extension.factory({ on: (event, handler) => handlers.set(event, handler), appendEntry() {} });
	handlers.get("session_start")({ reason: "startup" }, { sessionManager: { getEntries: () => [] } });
	const before = contract.currentContract();
	const callbacks = [];
	const component = componentFor(f.paths, f.context, {
		onLanguageChanged(language) {
			callbacks.push(language);
			const saved = readLocalizationSettings(f.paths.configDir).settings;
			assert.equal(saved.responseLanguage, "ja");
			assert.equal(saved.artifactPolicy.commits, "preserve");
			assert.equal(language.responseLanguage.source, "config");
			contract.applyLanguage(language.responseLanguage, language.artifactPolicy);
		},
	});
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("down");
	component.handleInput("\u001b[C");
	assert.equal(existsSync(sessionStorePath(f.paths)), false, "previews do not write");
	component.handleInput("enter");
	component.handleInput("enter");
	assert.equal(callbacks.length, 1);
	assert.equal(contract.currentContract(), before, "Apply does not change an in-progress turn");
	assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), {});
	handlers.get("before_agent_start")();
	assert.equal(contract.currentContract().taskLanguage, "ja");
	assert.equal(contract.currentContract().artifactPolicy.commits, "preserve");
	assert.match(contract.currentSection(), /Response language: Japanese/u);
});

for (const preview of [false, true]) {
	test(`Settings promotes a session response to Saved setting ${preview ? "after previewing the same value" : "from the focused row"}`, (t) => {
		const f = setup({
			keybindings: fakeKeybindings({ "tui.select.confirm": ["save"], "tui.select.cancel": ["cancel"] }),
		});
		t.after(() => rmSync(f.root, { recursive: true, force: true }));
		const saved = {
			uiLocale: "en",
			responseLanguage: "en",
			artifactPolicy: { commits: "zh-Hant", comments: "preserve" },
		};
		writeSettings(f.paths, saved);
		applyLocalization(f.paths, {
			sessionId: "s1",
			scope: "session",
			request: { responseLanguage: "ja", artifactPolicy: { reviews: "ja" } },
		});
		const settingsBefore = readFileSync(settingsPath(f.paths), "utf8");
		const sessionBefore = readFileSync(sessionStorePath(f.paths), "utf8");
		const callbacks = [];
		const component = componentFor(f.paths, f.context, { onLanguageChanged: (language) => callbacks.push(language) });
		focusResponse(component);
		if (preview) {
			component.handleInput("\u001b[C");
			component.handleInput("\u001b[D");
		}
		component.handleInput("save");
		assert.ok(component.languageConfirm, "the active Japanese value can enter confirmation");
		const rendered = component.render(90).join("\n");
		assert.doesNotMatch(rendered, /This session only|Saved setting/u);
		assert.match(rendered, /Response language.*日本語.*日本語/u);
		assert.deepEqual(component.languageConfirm.request, { responseLanguage: "ja" });
		for (const width of [48, 80]) assert.ok(component.render(width).every((row) => terminalTextWidth(row) <= width));
		component.handleInput("cancel");
		assert.equal(readFileSync(settingsPath(f.paths), "utf8"), settingsBefore);
		assert.equal(readFileSync(sessionStorePath(f.paths), "utf8"), sessionBefore);
		assert.equal(callbacks.length, 0);
		component.handleInput("save");
		component.handleInput("save");
		assert.deepEqual(JSON.parse(readFileSync(settingsPath(f.paths), "utf8")).localization, {
			...saved,
			responseLanguage: "ja",
		});
		assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), { artifactPolicy: { reviews: "ja" } });
		assert.equal(callbacks.length, 1);
		assert.equal(callbacks[0].responseLanguage.effective, "ja");
		assert.equal(callbacks[0].responseLanguage.source, "config");
	});
}

test("Settings promotes only the focused partial artifact override", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const saved = {
		uiLocale: "en",
		responseLanguage: "en",
		artifactPolicy: { comments: "preserve", documentation: "zh-Hans", commits: "en", reviews: "project" },
	};
	writeSettings(f.paths, saved);
	applyLocalization(f.paths, {
		sessionId: "s1",
		scope: "session",
		request: { responseLanguage: "ja", artifactPolicy: { commits: "ja" } },
	});
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("down");
	component.handleInput("enter");
	assert.ok(component.languageConfirm);
	assert.deepEqual(component.languageConfirm.request, { artifactPolicy: { commits: "ja" } });
	component.handleInput("enter");
	assert.deepEqual(JSON.parse(readFileSync(settingsPath(f.paths), "utf8")).localization, {
		...saved,
		artifactPolicy: { ...saved.artifactPolicy, commits: "ja" },
	});
	assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), { responseLanguage: "ja" });
});

test("Settings promotes only the focused display-language override", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const saved = { uiLocale: "ja", responseLanguage: "zh-Hant", artifactPolicy: { reviews: "en" } };
	writeSettings(f.paths, saved);
	applyLocalization(f.paths, {
		sessionId: "s1",
		scope: "session",
		request: { uiLocale: "en", responseLanguage: "ja" },
	});
	const component = componentFor(f.paths, f.context);
	focusDisplay(component);
	component.handleInput("enter");
	assert.ok(component.languageConfirm);
	assert.deepEqual(component.languageConfirm.request, { uiLocale: "en" });
	assert.match(component.render(90).join("\n"), /Display language.*日本語.*English/u);
	component.handleInput("enter");
	assert.deepEqual(JSON.parse(readFileSync(settingsPath(f.paths), "utf8")).localization, { ...saved, uiLocale: "en" });
	assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), { responseLanguage: "ja" });
});

test("Settings can save the default artifact preset from a mixed effective policy", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "en", responseLanguage: "auto", artifactPolicy: { commits: "zh-Hant" } });
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("down");
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[D");
	component.handleInput("enter");
	assert.ok(component.languageConfirm);
	component.handleInput("enter");
	assert.deepEqual(readLocalizationSettings(f.paths.configDir).settings, {
		schemaVersion: 2,
		uiLocale: "en",
		responseLanguage: "auto",
		artifactPolicy: { comments: "preserve", documentation: "project", commits: "project", reviews: "project" },
	});
});

for (const operation of ["save", "reset"]) {
	for (const recoveryFails of [false, true]) {
		test(`Settings ${operation} reports ${recoveryFails ? "incomplete recovery" : "failure after recovery"} when the session-store rename fails`, (t) => {
			const f = setup();
			t.after(() => rmSync(f.root, { recursive: true, force: true }));
			writeSettings(f.paths, { uiLocale: "en", responseLanguage: "en" });
			applyLocalization(f.paths, { sessionId: "s1", scope: "session", request: { responseLanguage: "ja" } });
			const settingsBefore = readFileSync(settingsPath(f.paths), "utf8");
			const sessionBefore = readFileSync(sessionStorePath(f.paths), "utf8");
			const callbacks = [];
			const component = componentFor(f.paths, f.context, { onLanguageChanged: (language) => callbacks.push(language) });
			focusResponse(component);
			if (operation === "reset") component.handleInput("r");
			else {
				component.handleInput("\u001b[C");
				component.handleInput("enter");
			}
			const rename = fs.renameSync;
			const targets = [];
			let secondFailed = false;
			t.mock.method(fs, "renameSync", (source, target) => {
				targets.push(target);
				if (target === sessionStorePath(f.paths)) {
					secondFailed = true;
					throw new Error("session-store rename failed");
				}
				if (recoveryFails && secondFailed) throw new Error("restore rename failed");
				return rename(source, target);
			});
			syncBuiltinESMExports();
			try {
				component.handleInput("enter");
			} finally {
				t.mock.restoreAll();
				syncBuiltinESMExports();
			}
			assert.deepEqual(targets.slice(0, 2), [settingsPath(f.paths), sessionStorePath(f.paths)]);
			assert.equal(readFileSync(sessionStorePath(f.paths), "utf8"), sessionBefore);
			assert.equal(callbacks.length, 0, "failed persistence must not stage a new language contract");
			assert.ok(
				operation === "reset" ? component.languageResetConfirm : component.languageConfirm,
				"confirmation is retained",
			);
			if (recoveryFails) {
				assert.notEqual(readFileSync(settingsPath(f.paths), "utf8"), settingsBefore);
				assert.match(component.message.text, /could not be restored/u);
				assert.doesNotMatch(component.message.text, /was not saved|was not reset/u);
			} else {
				assert.equal(readFileSync(settingsPath(f.paths), "utf8"), settingsBefore);
				assert.match(component.message.text, /session-store rename failed/u);
			}
			for (const width of [48, 80]) assert.ok(component.render(width).every((row) => terminalTextWidth(row) <= width));
			component.handleInput("enter");
			assert.equal(callbacks.length, 1, "a successful retry stages the contract once");
		});
	}
}

test("reset restores the saved display language and keeps saved response/artifact choices", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "ja", responseLanguage: "ja" });
	writeFileSync(
		sessionStorePath(f.paths),
		`${JSON.stringify({
			schemaVersion: 1,
			sessions: { s1: { uiLocale: "ja", responseLanguage: "ja", artifactPolicy: { commits: "ja" } } },
		})}\n`,
	);
	const component = componentFor(f.paths, f.context);
	focusDisplay(component);

	component.handleInput("r");
	let rendered = component.render(90).join("\n");
	assert.match(rendered, /Reset language settings/u);
	assert.match(rendered, /Reset the saved display language to Automatic/u);
	assert.match(rendered, /Saved response and artifact choices are kept/u);
	assert.match(rendered, /previous settings are backed up/u);

	component.handleInput("enter");
	rendered = component.render(90).join("\n");
	assert.match(rendered, /Saved display language reset to Automatic/u);
	assert.match(rendered, /Transaction:/u);
	assert.match(rendered, /restart Jouzu/u);

	assert.deepEqual(readLocalizationSessionOverride(f.paths.stateDir, "s1"), {}, "the session override is cleared");
	const saved = JSON.parse(readFileSync(settingsPath(f.paths), "utf8"));
	assert.equal(saved.localization.uiLocale, "auto", "the saved display language returns to auto");
	const state = readLocalizationSettings(f.paths.configDir);
	assert.equal(state.status, "ok");
	assert.equal(state.settings.responseLanguage, "ja", "the response language is preserved by reset");
	assert.match(component.render(90).join("\n"), /Display language.*English.*builtin/u);
});

for (const [name, activity] of [
	["IME composition", { imeComposing: true }],
	["streaming output", { streaming: true }],
	["a running tool", { runningTool: true }],
	["an update", { updating: true }],
	["a destructive confirmation", { destructiveConfirmation: true }],
]) {
	test(`a change during ${name} changes nothing and shows the reason`, (t) => {
		const f = setup();
		t.after(() => rmSync(f.root, { recursive: true, force: true }));
		let state = {};
		const component = componentFor(f.paths, f.context, { activity: () => state });
		focusResponse(component);
		component.handleInput("\u001b[C");
		assert.ok(component.render(90).join("\n").includes("preview"), "a preview is pending before the deferral");

		state = activity;
		component.handleInput("enter");
		const rendered = component.render(90).join("\n");
		assert.match(rendered, /Language change deferred/u);
		assert.equal(component.languageConfirm, undefined, "the confirmation does not open while deferred");
		assert.equal(existsSync(settingsPath(f.paths)), false, "no settings file is written");
		assert.equal(existsSync(sessionStorePath(f.paths)), false, "no session store is written");
	});
}

test("a deferral that starts while the confirmation is open blocks the apply", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	let state = {};
	const component = componentFor(f.paths, f.context, { activity: () => state });
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("enter");
	assert.ok(component.languageConfirm, "the confirmation opens while idle");

	state = { imeComposing: true };
	component.handleInput("enter");
	const rendered = component.render(90).join("\n");
	assert.match(rendered, /Language change deferred/u);
	assert.ok(component.languageConfirm, "the confirmation stays open after a deferred apply");
	assert.equal(existsSync(settingsPath(f.paths)), false);
	assert.equal(existsSync(sessionStorePath(f.paths)), false);
});

test("cancelling the confirmation keeps the preview and writes nothing", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[C");
	component.handleInput("enter");
	assert.ok(component.languageConfirm);
	component.handleInput("escape");
	assert.equal(component.languageConfirm, undefined, "Esc cancels the confirmation");
	assert.match(component.render(90).join("\n"), /日本語.*preview/u, "the preview is kept");
	assert.equal(existsSync(settingsPath(f.paths)), false);
	assert.equal(existsSync(sessionStorePath(f.paths)), false);

	component.handleInput("escape");
	assert.match(component.render(90).join("\n"), /Preview canceled/u);
	assert.equal(existsSync(settingsPath(f.paths)), false);
	assert.equal(existsSync(sessionStorePath(f.paths)), false);
});

test("applying without a preview names the no-change state", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const component = componentFor(f.paths, f.context);
	focusDisplay(component);
	component.handleInput("enter");
	assert.equal(component.languageConfirm, undefined);
	assert.match(component.render(90).join("\n"), /Choose a different value/u);
	assert.equal(existsSync(settingsPath(f.paths)), false);
	assert.equal(existsSync(sessionStorePath(f.paths)), false);
});

test("the confirmation and hints render inside 48 columns and the overlay budget", (t) => {
	const f = setup({ rows: 16 });
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("enter");
	for (const width of [48, 80]) {
		const rows = component.render(width);
		assert.ok(
			rows.every((row) => terminalTextWidth(row) <= width),
			`render fits ${width}`,
		);
		assert.ok(rows.length <= Math.min(14, Math.floor(16 * 0.9)), "render stays inside the overlay budget");
	}
	component.handleInput("escape");
	component.handleInput("r");
	for (const width of [48, 80]) {
		const rows = component.render(width);
		assert.ok(
			rows.every((row) => terminalTextWidth(row) <= width),
			`reset render fits ${width}`,
		);
		assert.ok(rows.length <= Math.min(14, Math.floor(16 * 0.9)));
	}
});
