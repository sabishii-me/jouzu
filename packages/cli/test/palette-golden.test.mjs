import assert from "node:assert/strict";
import { test } from "node:test";

import { CatalogMessageId, catalogText } from "../dist/cli-messages.js";
import { resolveDisplayContext } from "../dist/command-report.js";
import { loadCatalog } from "../dist/locale-catalog.js";
import {
	JouzuPaletteSurfaceHost,
	paletteChoice,
	paletteInnerWidth,
	renderPaletteDivider,
	renderPaletteField,
	renderPaletteHeading,
	renderPaletteKeyBar,
	renderPaletteTabs,
} from "../dist/palette.js";
import { createSessionUiStyles, detectTerminalColorMode } from "../dist/session-ui/index.js";
import {
	fitTerminalText,
	renderTerminalFrameBorder,
	renderTerminalFrameRow,
	renderTerminalFrameTitle,
	terminalTextWidth,
} from "../dist/terminal-layout.js";

// The identity theme reports no color support, so the golden is a plain-text
// frame and a translation change cannot hide behind an escape sequence.
const identityTheme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
};

const NO_COLOR_STYLES = createSessionUiStyles(identityTheme, { colorEnabled: false });

/**
 * One fixed, small Palette state: the shell tabs, a heading, three Settings
 * field rows, and the key bar. It is composed from the same production
 * renderers the Models and Settings views use, so a change to the Palette
 * layout or to a catalog label moves this frame. Nothing here reads a live
 * session, so unrelated behaviour cannot change the golden.
 */
function paletteFrame({ catalog, styles, theme }, width) {
	const innerWidth = paletteInnerWidth(width);
	const text = (id) => catalogText(catalog, id);
	const border = (value) => styles.apply("palette.border", value);
	const line = (value = "") => renderTerminalFrameRow(value, width, { border });
	const field = (label, value) =>
		renderPaletteField({ label, value, labelWidth: 14, innerWidth, selected: false, theme, styles });
	const lines = [
		renderTerminalFrameTitle(`JOUZU · ${text(CatalogMessageId.paletteTabModels)}`, width, { border }),
		line(renderPaletteTabs("models", theme, styles, catalog)),
		renderPaletteDivider(width, styles),
		line(renderPaletteHeading(text(CatalogMessageId.settingsLabelAccount), innerWidth, theme, styles, "1")),
		line(field(text(CatalogMessageId.settingsFieldUrl), "https://example.test")),
		line(field(text(CatalogMessageId.settingsFieldAuth), paletteChoice(text(CatalogMessageId.settingsAuthBearer)))),
		line(field(text(CatalogMessageId.settingsFieldToken), "…")),
		...renderPaletteKeyBar(
			[
				{ key: "Enter", label: text(CatalogMessageId.settingsHintSave) },
				{ key: "Esc", label: text(CatalogMessageId.settingsHintCancel) },
			],
			innerWidth,
			theme,
			styles,
		).map(line),
		renderTerminalFrameBorder(width, { border, left: "╰", right: "╯" }),
	];
	return lines.map((value) => fitTerminalText(value, width));
}

function frameFor(locale, width) {
	return paletteFrame({ catalog: loadCatalog(locale), styles: NO_COLOR_STYLES, theme: identityTheme }, width);
}

/**
 * The reviewed Palette goldens at 48, 80, and 120 columns in English, Japanese,
 * Simplified Chinese, and Traditional Chinese. They are literals so a
 * translation change that drops a label or breaks the frame fails here rather
 * than in a user's narrow terminal. The frame is rendered with the identity
 * theme, so the same literal is the no-color golden for every combination.
 */
const PALETTE_GOLDEN = {
	"en-48": [
		"╭─ JOUZU · Models ─────────────────────────────╮",
		"│ [Models]   Workflow    Settings              │",
		"├──────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────── 1 │",
		"│   URL or host    https://example.test        │",
		"│   Authentication ‹ Bearer token ›            │",
		"│   Token          …                           │",
		"│  Enter save  Esc cancel                      │",
		"╰──────────────────────────────────────────────╯",
	],
	"en-80": [
		"╭─ JOUZU · Models ─────────────────────────────────────────────────────────────╮",
		"│ [Models]   Workflow    Settings                                              │",
		"├──────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────── 1 │",
		"│   URL or host    https://example.test                                        │",
		"│   Authentication ‹ Bearer token ›                                            │",
		"│   Token          …                                                           │",
		"│  Enter save  Esc cancel                                                      │",
		"╰──────────────────────────────────────────────────────────────────────────────╯",
	],
	"en-120": [
		"╭─ JOUZU · Models ─────────────────────────────────────────────────────────────────────────────────────────────────────╮",
		"│ [Models]   Workflow    Settings                                                                                      │",
		"├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────────────────────────────────────────────── 1 │",
		"│   URL or host    https://example.test                                                                                │",
		"│   Authentication ‹ Bearer token ›                                                                                    │",
		"│   Token          …                                                                                                   │",
		"│  Enter save  Esc cancel                                                                                              │",
		"╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
	],
	"ja-48": [
		"╭─ JOUZU · モデル ─────────────────────────────╮",
		"│ [モデル]   ワークフロー    設定              │",
		"├──────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────── 1 │",
		"│   URL またはホスト https://example.test      │",
		"│   認証           ‹ bearer トークン ›         │",
		"│   トークン       …                           │",
		"│  Enter 保存  Esc キャンセル                  │",
		"╰──────────────────────────────────────────────╯",
	],
	"ja-80": [
		"╭─ JOUZU · モデル ─────────────────────────────────────────────────────────────╮",
		"│ [モデル]   ワークフロー    設定                                              │",
		"├──────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────── 1 │",
		"│   URL またはホスト https://example.test                                      │",
		"│   認証           ‹ bearer トークン ›                                         │",
		"│   トークン       …                                                           │",
		"│  Enter 保存  Esc キャンセル                                                  │",
		"╰──────────────────────────────────────────────────────────────────────────────╯",
	],
	"ja-120": [
		"╭─ JOUZU · モデル ─────────────────────────────────────────────────────────────────────────────────────────────────────╮",
		"│ [モデル]   ワークフロー    設定                                                                                      │",
		"├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────────────────────────────────────────────── 1 │",
		"│   URL またはホスト https://example.test                                                                              │",
		"│   認証           ‹ bearer トークン ›                                                                                 │",
		"│   トークン       …                                                                                                   │",
		"│  Enter 保存  Esc キャンセル                                                                                          │",
		"╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
	],
	"zh-Hans-48": [
		"╭─ JOUZU · 模型 ───────────────────────────────╮",
		"│ [模型]   工作流    设置                      │",
		"├──────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────── 1 │",
		"│   URL 或主机     https://example.test        │",
		"│   认证           ‹ Bearer 令牌 ›             │",
		"│   令牌           …                           │",
		"│  Enter 保存  Esc 取消                        │",
		"╰──────────────────────────────────────────────╯",
	],
	"zh-Hans-80": [
		"╭─ JOUZU · 模型 ───────────────────────────────────────────────────────────────╮",
		"│ [模型]   工作流    设置                                                      │",
		"├──────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────── 1 │",
		"│   URL 或主机     https://example.test                                        │",
		"│   认证           ‹ Bearer 令牌 ›                                             │",
		"│   令牌           …                                                           │",
		"│  Enter 保存  Esc 取消                                                        │",
		"╰──────────────────────────────────────────────────────────────────────────────╯",
	],
	"zh-Hans-120": [
		"╭─ JOUZU · 模型 ───────────────────────────────────────────────────────────────────────────────────────────────────────╮",
		"│ [模型]   工作流    设置                                                                                              │",
		"├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────────────────────────────────────────────── 1 │",
		"│   URL 或主机     https://example.test                                                                                │",
		"│   认证           ‹ Bearer 令牌 ›                                                                                     │",
		"│   令牌           …                                                                                                   │",
		"│  Enter 保存  Esc 取消                                                                                                │",
		"╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
	],
	"zh-Hant-48": [
		"╭─ JOUZU · 模型 ───────────────────────────────╮",
		"│ [模型]   工作流程    設定                    │",
		"├──────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────── 1 │",
		"│   URL 或主機     https://example.test        │",
		"│   驗證           ‹ Bearer 權杖 ›             │",
		"│   權杖           …                           │",
		"│  Enter 儲存  Esc 取消                        │",
		"╰──────────────────────────────────────────────╯",
	],
	"zh-Hant-80": [
		"╭─ JOUZU · 模型 ───────────────────────────────────────────────────────────────╮",
		"│ [模型]   工作流程    設定                                                    │",
		"├──────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────── 1 │",
		"│   URL 或主機     https://example.test                                        │",
		"│   驗證           ‹ Bearer 權杖 ›                                             │",
		"│   權杖           …                                                           │",
		"│  Enter 儲存  Esc 取消                                                        │",
		"╰──────────────────────────────────────────────────────────────────────────────╯",
	],
	"zh-Hant-120": [
		"╭─ JOUZU · 模型 ───────────────────────────────────────────────────────────────────────────────────────────────────────╮",
		"│ [模型]   工作流程    設定                                                                                            │",
		"├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤",
		"│ Shisa AI ───────────────────────────────────────────────────────────────────────────────────────────────────────── 1 │",
		"│   URL 或主機     https://example.test                                                                                │",
		"│   驗證           ‹ Bearer 權杖 ›                                                                                     │",
		"│   權杖           …                                                                                                   │",
		"│  Enter 儲存  Esc 取消                                                                                                │",
		"╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
	],
};

const PALETTE_GOLDEN_LOCALES = ["en", "ja", "zh-Hans", "zh-Hant"];
const PALETTE_GOLDEN_WIDTHS = [48, 80, 120];

test("the Palette frame is fixed at 48, 80, and 120 columns in all four locales", () => {
	for (const locale of PALETTE_GOLDEN_LOCALES) {
		for (const width of PALETTE_GOLDEN_WIDTHS) {
			assert.deepEqual(frameFor(locale, width), PALETTE_GOLDEN[`${locale}-${width}`], `${locale} at ${width} columns`);
		}
	}
});

test("every Palette frame fills its column and a required field label survives at 48 columns", () => {
	const requiredLabels = {
		en: ["Shisa AI", "URL or host", "Authentication", "Bearer token", "Token", "save", "cancel"],
		ja: ["Shisa AI", "URL またはホスト", "認証", "bearer トークン", "トークン", "保存", "キャンセル"],
		"zh-Hans": ["Shisa AI", "URL 或主机", "认证", "Bearer 令牌", "令牌", "保存", "取消"],
		"zh-Hant": ["Shisa AI", "URL 或主機", "驗證", "Bearer 權杖", "權杖", "儲存", "取消"],
	};
	for (const locale of PALETTE_GOLDEN_LOCALES) {
		for (const width of PALETTE_GOLDEN_WIDTHS) {
			for (const line of frameFor(locale, width)) {
				assert.equal(terminalTextWidth(line), width, `${locale} at ${width}: ${JSON.stringify(line)}`);
			}
		}
		const narrow = frameFor(locale, 48).join("\n");
		for (const label of requiredLabels[locale]) {
			assert.ok(narrow.includes(label), `${locale} at 48 columns dropped the required label ${JSON.stringify(label)}`);
		}
	}
});

const ESCAPE = String.fromCharCode(27);
const SGR = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");
const stripSgr = (value) => value.replace(SGR, "");

/** A theme that reports colour support, so the capability cases exercise the Palette RGB roles. */
const colorTheme = {
	fg: (role, value) => `\u001b[38;5;${role.length % 200}m${value}\u001b[39m`,
	bg: (_role, value) => value,
	bold: (value) => value,
};

/** Render the fixed Palette frame under one capability configuration. */
function paletteUnder(styles, { theme = colorTheme, locale = "en", width = 48 } = {}) {
	return paletteFrame({ catalog: loadCatalog(locale), styles, theme }, width);
}

test("Palette meaning does not depend on color", () => {
	for (const locale of PALETTE_GOLDEN_LOCALES) {
		for (const width of PALETTE_GOLDEN_WIDTHS) {
			const colored = paletteUnder(createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "truecolor" }), {
				locale,
				width,
			});
			assert.ok(colored.join("\n").includes(ESCAPE), `${locale} at ${width}: the color lane emits escape sequences`);
			assert.deepEqual(
				colored.map(stripSgr),
				PALETTE_GOLDEN[`${locale}-${width}`],
				`${locale} at ${width}: color removed no text`,
			);
		}
	}
});

test("the Palette truecolor capability renders 24-bit escapes and keeps the text", () => {
	const frame = paletteUnder(
		createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "truecolor", env: {} }),
	);
	assert.ok(frame.join("\n").includes("\u001b[38;2;"), "truecolor uses 38;2 escapes");
	assert.deepEqual(frame.map(stripSgr), PALETTE_GOLDEN["en-48"]);
});

test("the Palette 256-colour capability renders indexed escapes and keeps the text", () => {
	const frame = paletteUnder(createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "256", env: {} }));
	assert.ok(frame.join("\n").includes("\u001b[38;5;"), "256 uses 38;5 escapes");
	assert.ok(!frame.join("\n").includes("38;2;"), "256 does not use 24-bit escapes");
	assert.deepEqual(frame.map(stripSgr), PALETTE_GOLDEN["en-48"]);
});

test("the Palette 16-colour capability renders basic escapes and keeps the text", () => {
	const styles = createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "16", env: {} });
	const basic = new RegExp(`^${ESCAPE}\\[(3[0-7]|9[0-7])m→${ESCAPE}\\[39m$`, "u");
	assert.match(styles.apply("palette.marker", "→"), basic, "16 colours uses a basic colour code");
	assert.deepEqual(paletteUnder(styles).map(stripSgr), PALETTE_GOLDEN["en-48"]);
});

test("the Palette no-colour capability keeps the text identical to the coloured frame", () => {
	const colored = paletteUnder(
		createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "truecolor", env: {} }),
	);
	const plain = paletteUnder(createSessionUiStyles(colorTheme, { colorEnabled: false, env: {} }));
	assert.ok(!plain.join("\n").includes(ESCAPE), "no colour carries no escapes");
	assert.deepEqual(plain, PALETTE_GOLDEN["en-48"]);
	assert.deepEqual(plain, colored.map(stripSgr), "no-colour text equals the coloured text without escapes");
});

test("the Palette TERM=dumb capability keeps the text identical to the coloured frame", () => {
	const colored = paletteUnder(
		createSessionUiStyles(colorTheme, { colorEnabled: true, colorMode: "truecolor", env: {} }),
	);
	const dumb = paletteUnder(createSessionUiStyles(colorTheme, { env: { TERM: "dumb" } }));
	assert.equal(detectTerminalColorMode({ env: { TERM: "dumb" } }), "none");
	assert.ok(!dumb.join("\n").includes(ESCAPE), "a dumb terminal carries no escapes");
	assert.deepEqual(dumb, PALETTE_GOLDEN["en-48"]);
	assert.deepEqual(dumb, colored.map(stripSgr), "dumb-terminal text equals the coloured text without escapes");
});

test("the Palette non-TTY capability is detected as no colour and a monochrome theme emits none", () => {
	assert.equal(detectTerminalColorMode({ env: {}, stdoutIsTTY: false }), "none");
	const display = resolveDisplayContext({ env: {}, stdoutIsTTY: false });
	assert.equal(display.colorMode, "none");
	assert.equal(display.colorEnabled, false);
	// The Palette only mounts in TUI mode; on a redirected stream it renders
	// through the monochrome identity theme, which emits no escapes.
	const plain = paletteUnder(createSessionUiStyles(identityTheme, { env: {}, stdoutIsTTY: false }), {
		theme: identityTheme,
	});
	assert.ok(!plain.join("\n").includes(ESCAPE), "a non-TTY monochrome rendering carries no escapes");
	assert.deepEqual(plain, PALETTE_GOLDEN["en-48"]);
});

/** A minimal interactive surface that captures the component the host builds. */
function fakeSurface() {
	let component;
	let close;
	const ctx = {
		mode: "tui",
		ui: {
			custom(factory) {
				return new Promise((resolve) => {
					close = resolve;
					component = factory({ requestRender() {}, terminal: { columns: 100, rows: 30 } }, identityTheme, {}, () =>
						resolve(),
					);
				});
			},
		},
	};
	return {
		ctx,
		get component() {
			return component;
		},
		close: () => close?.(),
	};
}

test("the Palette host injects the resolved catalog into the view it renders", async () => {
	const surface = fakeSurface();
	const host = new JouzuPaletteSurfaceHost({ catalog: loadCatalog("ja") });
	const opened = host.open(surface.ctx, { view: "models" }, (context) => ({
		route() {},
		invalidate() {},
		render: (width) => paletteFrame(context, width),
	}));
	await Promise.resolve();
	assert.ok(surface.component, "the host built the component through the PaletteComponentContext");
	assert.deepEqual(surface.component.render(48), PALETTE_GOLDEN["ja-48"]);
	surface.close();
	assert.equal(await opened, true);
});
