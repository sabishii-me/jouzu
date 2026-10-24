/**
 * The Settings wiring for the catalog language view.
 *
 * These tests drive the compiled `dist/catalog-settings.js` Language view. They
 * pin the issue #76 acceptance items: a confirmed change goes through
 * `planLocalization` and `applyLocalization` and writes atomically with a
 * backup; the session and saved-setting scopes are respected; reset returns to
 * the defaults and shows the recovery; a change during each deferral condition
 * changes nothing and shows the reason; the receipt names the backup and the
 * transaction; and cancelling a preview writes nothing.
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
import { LOCALIZATION_FILE_NAME, readLocalizationSettings } from "../dist/ui-locale.js";

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
		env: {},
		sessionId: "s1",
		...(options.activity ? { activity: options.activity } : {}),
		...(options.onLanguageChanged ? { onLanguageChanged: options.onLanguageChanged } : {}),
	});
}

/** Focus the Display-language row. */
function focusDisplay(component) {
	component.route({ view: "settings", query: "language" });
	component.handleInput("down");
}

/** Focus the Response-language row. */
function focusResponse(component) {
	component.route({ view: "settings", query: "language" });
	component.handleInput("down");
	component.handleInput("down");
}

test("a confirmed session change applies through the operations and leaves the saved setting alone", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	writeSettings(f.paths, { uiLocale: "ja" });
	const component = componentFor(f.paths, f.context);
	focusDisplay(component);
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[C");
	assert.match(component.render(90).join("\n"), /Display language.*English.*preview/u);

	component.handleInput("enter");
	let rendered = component.render(90).join("\n");
	assert.match(rendered, /Apply language change/u);
	assert.match(rendered, /This session only/u);
	assert.match(rendered, /previous settings are backed up/u);

	component.handleInput("enter");
	rendered = component.render(90).join("\n");
	assert.match(rendered, /Transaction:/u);
	assert.match(rendered, /Applied to This session only/u);
	assert.match(rendered, /English.*session/u);

	const override = readLocalizationSessionOverride(f.paths.stateDir, "s1");
	assert.equal(override.uiLocale, "en");
	const saved = JSON.parse(readFileSync(settingsPath(f.paths), "utf8"));
	assert.equal(saved.localization.uiLocale, "ja", "a session change leaves the saved setting alone");
});

test("a session response-language change is recorded without a settings write", (t) => {
	const f = setup();
	t.after(() => rmSync(f.root, { recursive: true, force: true }));
	const component = componentFor(f.paths, f.context);
	focusResponse(component);
	component.handleInput("\u001b[C");
	component.handleInput("\u001b[C");
	assert.match(component.render(90).join("\n"), /Response language.*日本語.*preview/u);
	component.handleInput("enter");
	component.handleInput("enter");
	assert.match(component.render(90).join("\n"), /日本語.*session/u);
	assert.equal(readLocalizationSessionOverride(f.paths.stateDir, "s1").responseLanguage, "ja");
	assert.equal(existsSync(settingsPath(f.paths)), false);
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
	component.handleInput("\u001b[C");
	assert.match(component.render(90).join("\n"), /Saved setting/u);
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
	component.handleInput("\u001b[C");
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
		assert.ok(component.languageConfirm, "the effective Japanese value can enter scope confirmation");
		assert.match(component.render(90).join("\n"), /This session only/u);
		component.handleInput("\u001b[C");
		const rendered = component.render(90).join("\n");
		assert.match(rendered, /Saved setting/u);
		assert.match(rendered, /Response language.*English.*日本語/u);
		assert.deepEqual(component.languageConfirm.request, { responseLanguage: "ja" });
		for (const width of [48, 80]) assert.ok(component.render(width).every((row) => terminalTextWidth(row) <= width));
		component.handleInput("cancel");
		assert.equal(readFileSync(settingsPath(f.paths), "utf8"), settingsBefore);
		assert.equal(readFileSync(sessionStorePath(f.paths), "utf8"), sessionBefore);
		assert.equal(callbacks.length, 0);
		component.handleInput("save");
		component.handleInput("\u001b[C");
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
	component.handleInput("\u001b[C");
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
	component.handleInput("\u001b[C");
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
	component.handleInput("\u001b[C");
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
				component.handleInput("\u001b[C");
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

test("reset returns every language setting to its default and shows the recovery", (t) => {
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
	assert.match(rendered, /Reset every language setting to its default/u);
	assert.match(rendered, /previous settings are backed up/u);

	component.handleInput("enter");
	rendered = component.render(90).join("\n");
	assert.match(rendered, /Reset to the defaults/u);
	assert.match(rendered, /Transaction:/u);

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
		assert.ok(rows.length <= Math.min(Math.floor(16 * 0.82), 14), "render stays inside the overlay budget");
	}
	component.handleInput("escape");
	component.handleInput("r");
	for (const width of [48, 80]) {
		const rows = component.render(width);
		assert.ok(
			rows.every((row) => terminalTextWidth(row) <= width),
			`reset render fits ${width}`,
		);
		assert.ok(rows.length <= Math.min(Math.floor(16 * 0.82), 14));
	}
});
