import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatHelp } from "../dist/args.js";
import { CatalogSettingsComponent, composeCatalogSaveMessage } from "../dist/catalog-settings.js";
import { loadCatalogSourceRegistry } from "../dist/catalog-sources.js";
import { catalogText, CatalogMessageId as Id } from "../dist/cli-messages.js";
import { loadCatalog, resolveCatalog } from "../dist/locale-catalog.js";
import { parseAndValidateModelCatalog } from "../dist/model-catalog.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { createSessionUiStyles } from "../dist/session-ui/index.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";

const locales = ["en", "ja", "zh-Hans", "zh-Hant"];
const footerMessages = [
	[Id.helpFooterAlias, { alias: "jz", command: "jouzu" }],
	[Id.helpFooterResume, { command: "jz --session" }],
	[Id.helpFooterProfile, {}],
	[Id.helpFooterStartup, { setting: "JOUZU_NO_CLEAR=1" }],
	[Id.helpFooterPalette, { command: "/model", key: "Ctrl+L" }],
	[Id.helpFooterCatalogs, { command: "/catalogs" }],
	[Id.helpFooterSections, { nextKey: "Tab", previousKey: "Shift+Tab" }],
	[Id.helpFooterPi, { command: "jouzu pi --help" }],
];
const compact = (text) => text.replace(/\s+/gu, "");

for (const locale of locales) {
	test(`${locale} help messages are complete units and model counts select numerically`, () => {
		const catalog = loadCatalog(locale);
		assert.ok(!Object.keys(catalog.messages).some((id) => /help\.(?:footer|textguard)\.line\d/u.test(id)));
		for (const [id, args] of footerMessages) {
			const text = catalogText(catalog, id, args);
			assert.doesNotMatch(text, /\n|\{\s*\$|jouzu\.cli\./u);
			assert.match(text, /[.。]$/u, id);
			for (const value of Object.values(args)) assert.ok(text.includes(value), `${id}: ${value}`);
		}
		for (const id of [Id.settingsSavedWithCount, Id.settingsModelCount]) {
			assert.equal(catalog.messages[id].value[0].type, "select");
			assert.equal(catalog.messages[id].value[0].selector.name, "count");
			for (const count of [0, 1, 5]) {
				const text = catalog.format(id, { label: "Pool", count });
				assert.ok(text.includes(String(count)), text);
				assert.doesNotMatch(text, /\{\s*\$|jouzu\.cli\./u);
				if (locale === "en") assert.match(text, new RegExp(`\\b${count} model${count === 1 ? "" : "s"}\\b`, "u"));
				else assert.doesNotMatch(text, /\bmodels?\b/u);
			}
		}
		if (locale.startsWith("zh")) assert.equal(resolveCatalog(locale).effective, "en");
	});

	test(`${locale} save-note composition preserves complete sentences for zero, one, and multiple notes`, () => {
		const catalog = loadCatalog(locale);
		const base = catalog.format(Id.settingsSavedWithCount, { label: "Pool", count: 5 });
		const notes = [
			catalog.format(Id.settingsNoteTokenNotSet, { name: "MISSING_TOKEN" }),
			catalog.format(Id.settingsNoteTokenPrecedence, { name: "OTHER_TOKEN" }),
		];
		const separator = locale === "en" ? " " : "";
		for (const count of [0, 1, 2]) {
			const text = composeCatalogSaveMessage(catalog, base, notes.slice(0, count));
			assert.equal(text, [base, ...notes.slice(0, count)].join(separator));
			assert.doesNotMatch(text, /[.。][.。]|。\s*\.|\.\s*。/u);
			if (locale !== "en") assert.doesNotMatch(text, /\bmodels?\b|token variable|takes precedence/u);
		}
	});
}

for (const locale of ["en", "ja"]) {
	for (const columns of [48, 80, 120]) {
		test(`${locale} help wraps at ${columns} columns without losing content or splitting commands`, () => {
			const catalog = loadCatalog(locale);
			const plain = formatHelp(catalog, { stdoutIsTTY: false });
			const wrapped = formatHelp(catalog, { stdoutIsTTY: true, columns });
			assert.equal(compact(wrapped), compact(plain));
			// Usage examples are copyable command values, even when wider than the terminal.
			const usage = plain.split("\n").filter((line) => line.startsWith("  jouzu "));
			for (const line of wrapped.split("\n")) {
				assert.ok(terminalTextWidth(line) <= columns || usage.includes(line), line);
			}
			for (const command of [
				"jz --session",
				"JOUZU_NO_CLEAR=1",
				"/model",
				"Ctrl+L",
				"/catalogs",
				"Shift+Tab",
				"jouzu pi --help",
				"/textguard on",
				"/textguard strict",
				"/textguard off",
			]) {
				assert.ok(wrapped.includes(command), command);
			}
			const footer = wrapped.slice(wrapped.lastIndexOf("\n\n") + 2);
			assert.equal(
				compact(footer),
				compact(footerMessages.map(([id, args]) => catalogText(catalog, id, args)).join("")),
			);
		});
	}

	test(`${locale} non-TTY help ignores terminal width and emits one line per semantic message`, () => {
		const catalog = loadCatalog(locale);
		const narrow = formatHelp(catalog, { stdoutIsTTY: false, columns: 48 });
		assert.equal(narrow, formatHelp(catalog, { stdoutIsTTY: false, columns: 120 }));
		const lines = narrow.split("\n");
		for (const [id, args] of footerMessages) assert.ok(lines.includes(catalogText(catalog, id, args)));
		assert.ok(!narrow.includes("\x1b"));
	});

	test(`${locale} main help caller passes actual stdout dimensions and non-TTY state`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "jouzu-help-composition-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const main = new URL("../dist/main-cli.js", import.meta.url).href;
		for (const columns of [48, 80, 120]) {
			for (const stdoutIsTTY of [false, true]) {
				const result = spawnSync(
					process.execPath,
					[
						"--input-type=module",
						"-e",
						`
					Object.defineProperty(process.stdout, "isTTY", { value: ${stdoutIsTTY} });
					Object.defineProperty(process.stdout, "columns", { value: ${columns} });
					const { runMainCli } = await import(${JSON.stringify(main)});
					await runMainCli(${JSON.stringify(["--jouzu-home", root, "--jouzu-ui-locale", locale, "--help"])});
				`,
					],
					{ encoding: "utf8", timeout: 10000 },
				);
				assert.equal(result.status, 0, result.stderr);
				assert.equal(result.stdout, `${formatHelp(loadCatalog(locale), { stdoutIsTTY, columns })}\n`);
			}
		}
	});
}

const fixture = JSON.parse(
	readFileSync(new URL("../catalog/fixtures/account-snapshot-v1.json", import.meta.url), "utf8"),
);
const identityTheme = { fg: (_role, value) => value, bg: (_role, value) => value, bold: (value) => value };

function setupSettings(t, locale, count, warning) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-settings-composition-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const paths = resolveJouzuPaths({ homeOverride: join(root, "jouzu") });
	const document = parseAndValidateModelCatalog(
		JSON.stringify({
			...fixture,
			modelOfferings: Array.from({ length: count }, (_, i) => ({
				...fixture.modelOfferings[0],
				id: `ai.example.gateway/model-${i}`,
				modelId: `model-${i}`,
			})),
		}),
		{ remote: true },
	);
	const keys = { "tui.select.confirm": ["enter"], "tui.select.down": ["down"], "tui.select.cancel": ["escape"] };
	let discoveries = 0;
	const component = new CatalogSettingsComponent({
		context: {
			catalog: loadCatalog(locale),
			tui: { requestRender() {}, terminal: { rows: 60, columns: 120 } },
			theme: identityTheme,
			styles: createSessionUiStyles(identityTheme),
			keybindings: {
				matches: (data, action) => keys[action]?.includes(data) ?? false,
				getKeys: (action) => keys[action] ?? [],
			},
			close() {},
		},
		paths,
		env: warning === "precedence" ? { JOUZU_MODEL_CATALOG_TOKEN: "env-secret" } : {},
		discover: async (_input, options) => {
			discoveries++;
			assert.notEqual(warning, "missing");
			if (warning === "precedence") assert.equal(options.bearerToken, "env-secret");
			return {
				url: "https://catalog.example/v1/jouzu/model-catalog",
				document,
				text: JSON.stringify(document),
				attempts: [],
			};
		},
	});
	t.after(() => component.dispose());
	component.handleInput("a");
	component.handleInput("Pool");
	component.handleInput("down");
	component.handleInput("https://catalog.example");
	if (warning) {
		component.handleInput("down");
		component.handleInput("\x1b[C");
		if (warning === "precedence") {
			component.handleInput("down");
			component.handleInput("down");
			component.handleInput("saved-secret");
		}
	}
	return { component, paths, discoveries: () => discoveries };
}

for (const locale of ["en", "ja"]) {
	for (const count of [0, 1, 5]) {
		test(`${locale} real catalog save renders ${count} models without English count fragments`, async (t) => {
			const { component, paths } = setupSettings(t, locale, count);
			component.handleInput("enter");
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(loadCatalogSourceRegistry(paths).sources.length, 1);
			const expected =
				locale === "en"
					? `Saved Pool with ${count} model${count === 1 ? "" : "s"}.`
					: `Pool をモデル ${count} 件で保存しました。`;
			assert.deepEqual(component.message, { level: "info", text: expected });
			for (const width of [48, 80, 120]) {
				const lines = component.render(width);
				assert.ok(lines.every((line) => terminalTextWidth(line) <= width));
				assert.ok(compact(lines.join("").replace(/│/gu, "")).includes(compact(expected)));
				if (locale === "ja") assert.doesNotMatch(lines.join("\n"), /\b\d+\s+models?\b/u);
			}
		});
	}
	for (const warning of ["missing", "precedence"]) {
		test(`${locale} real catalog save composes the ${warning} token warning without doubled punctuation`, async (t) => {
			const { component, discoveries } = setupSettings(t, locale, 1, warning);
			component.handleInput("enter");
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(discoveries(), warning === "missing" ? 0 : 1);
			const catalog = loadCatalog(locale);
			const base = catalog.format(warning === "missing" ? Id.settingsSavedWithoutCheck : Id.settingsSavedWithCount, {
				label: "Pool",
				count: 1,
			});
			const note = catalog.format(warning === "missing" ? Id.settingsNoteTokenNotSet : Id.settingsNoteTokenPrecedence, {
				name: "JOUZU_MODEL_CATALOG_TOKEN",
			});
			const expected = base + (locale === "en" ? " " : "") + note;
			assert.deepEqual(component.message, { level: "warning", text: expected });
			assert.doesNotMatch(expected, /[.。][.。]|。\s*\.|\.\s*。/u);
			for (const width of [48, 80, 120]) {
				const lines = component.render(width);
				assert.ok(lines.every((line) => terminalTextWidth(line) <= width));
				assert.ok(compact(lines.join("").replace(/│/gu, "")).includes(compact(expected)));
				assert.doesNotMatch(lines.join("\n"), /env-secret|saved-secret/u);
			}
		});
	}
}

test("English TextGuard reports describe non-blocking content without approval, and sign-in names its deadline", () => {
	const catalog = loadCatalog("en");
	for (const count of [1, 5]) {
		assert.equal(
			catalog.format(Id.textguardReviewBlockedNothing, { count, command: "/textguard reports" }),
			`${count} finding${count === 1 ? "" : "s"} did not block content; see /textguard reports.`,
		);
	}
	assert.equal(
		catalog.format(Id.textguardOtherViewReports, { command: "/textguard reports" }),
		"findings did not block content · /textguard reports",
	);
	assert.equal(
		catalog.format(Id.textguardReportsEmpty),
		"TextGuard has no findings to show for content that was not blocked.",
	);
	for (const id of [Id.shisaSignInConfirmFailed, Id.shisaSignInConfirmInterrupted]) {
		assert.match(catalog.format(id), /after the confirmation deadline\./u);
		assert.doesNotMatch(catalog.format(id), /confirmation window/u);
	}
});
