import assert from "node:assert/strict";
import { test } from "node:test";

import { createSessionUiStyles, DEFAULT_SESSION_UI_STYLE_SCHEME } from "../dist/index.js";

const taggedTheme = {
	fg: (role, value) => `<${role}>${value}</${role}>`,
	getBgAnsi: (role) => `<bg:${role}>`,
};

test("maps Jouzu semantic roles to the retained Session UI color baseline", () => {
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true });
	assert.equal(styles.apply("prompt.border", "border"), "<borderMuted>border</borderMuted>");
	assert.equal(styles.apply("prompt.surface", "row"), "<bg:userMessageBg>row\u001b[49m");
	assert.equal(styles.apply("session.provider", "Codex"), "<dim>Codex</dim>");
	assert.equal(styles.apply("session.model", "gpt"), "<mdCode>gpt</mdCode>");
	assert.equal(styles.apply("status.workspace", "work"), "\u001b[38;2;215;215;255mwork\u001b[39m");
	assert.equal(styles.apply("status.git.branch", "main"), "<syntaxKeyword>main</syntaxKeyword>");
	assert.equal(styles.apply("status.git.changes", "[!]"), "<error>[!]</error>");
	assert.equal(styles.apply("status.context.normal", "19%"), "\u001b[38;2;250;204;21m19%\u001b[39m");
	assert.equal(styles.apply("status.tokens", "↑1k"), "\u001b[38;2;255;175;215m↑1k\u001b[39m");
	assert.equal(styles.apply("status.separator", " | "), "<borderMuted> | </borderMuted>");
});

test("preserves runtime-specific baseline mappings behind semantic roles", () => {
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true });
	const expected = {
		node: "success",
		deno: "syntaxType",
		bun: "warning",
		python: "warning",
		java: "warning",
		rust: "error",
		ruby: "error",
		go: "syntaxType",
		lua: "accent",
		php: "accent",
		default: "text",
	};
	for (const [runtime, token] of Object.entries(expected)) {
		assert.equal(styles.apply(`status.runtime.${runtime}`, runtime), `<${token}>${runtime}</${token}>`);
	}
});

test("maps custom RGB roles to the selected terminal color mode", () => {
	const indexed = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "256" });
	assert.equal(indexed.apply("status.workspace", "work"), "\u001b[38;5;189mwork\u001b[39m");
	const basic = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "16" });
	assert.equal(basic.apply("status.context.normal", "19%"), "\u001b[93m19%\u001b[39m");
});

test("fills a surface row with a background that survives a reset inside it", () => {
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true });
	// The editor draws its cursor as reverse video followed by a full reset.
	assert.equal(
		styles.apply("prompt.surface", "ab\u001b[7m \u001b[0mcd"),
		"<bg:userMessageBg>ab\u001b[7m \u001b[0m<bg:userMessageBg>cd\u001b[49m",
	);
});

test("styles every declared role when color is enabled", () => {
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	for (const role of Object.keys(DEFAULT_SESSION_UI_STYLE_SCHEME)) {
		assert.notEqual(styles.apply(role, "value"), "value", `${role} must style its value when color is enabled`);
	}
});

test("supports no-color output and replacement schemes without renderer changes", () => {
	const plain = createSessionUiStyles(taggedTheme, { colorEnabled: false });
	assert.equal(plain.apply("prompt.surface", "row"), "row");
	assert.equal(plain.apply("status.workspace", "work"), "work");
	const detectedPlain = createSessionUiStyles({ fg: (_role, value) => value }, { env: {} });
	assert.equal(detectedPlain.apply("prompt.surface", "row"), "row");
	const noColor = createSessionUiStyles(taggedTheme, { env: { NO_COLOR: "1" } });
	assert.equal(noColor.apply("status.workspace", "work"), "work");
	const noBackground = createSessionUiStyles({ fg: (_role, value) => value }, { colorEnabled: true });
	assert.equal(noBackground.apply("prompt.surface", "row"), "row", "a theme without backgrounds leaves the row plain");

	const scheme = {
		...DEFAULT_SESSION_UI_STYLE_SCHEME,
		"prompt.surface": { source: "themeBackground", value: "selectedBg" },
	};
	const themed = createSessionUiStyles(taggedTheme, { colorEnabled: true, scheme });
	assert.equal(themed.apply("prompt.surface", "row"), "<bg:selectedBg>row\u001b[49m");
});

test("routes Palette roles through the same capability policy as the Session UI", () => {
	const truecolor = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	// Palette roles that share the Jouzu brand accent resolve through one capability policy.
	assert.equal(
		truecolor.apply("palette.marker", "→"),
		truecolor.apply("palette.heading", "→"),
		"Palette marker and heading must resolve to the same brand accent",
	);
	assert.equal(truecolor.apply("palette.marker", "→"), "\u001b[38;2;103;232;249m→\u001b[39m");
	assert.equal(truecolor.apply("palette.section.current", "Current"), "\u001b[38;2;244;114;182mCurrent\u001b[39m");

	const indexed = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "256" });
	assert.equal(indexed.apply("palette.marker", "→"), "\u001b[38;5;81m→\u001b[39m");
	const basic = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "16" });
	assert.equal(basic.apply("palette.marker", "→"), "\u001b[96m→\u001b[39m");

	const plain = createSessionUiStyles(taggedTheme, { colorEnabled: false });
	for (const role of Object.keys(DEFAULT_SESSION_UI_STYLE_SCHEME).filter((name) => name.startsWith("palette."))) {
		assert.equal(plain.apply(role, "value"), "value", `${role} must emit no escapes without color`);
	}
});

test("maps every Palette role to a defined color", () => {
	const paletteRoles = Object.keys(DEFAULT_SESSION_UI_STYLE_SCHEME).filter((name) => name.startsWith("palette."));
	assert.ok(paletteRoles.length >= 18, "Palette roles must cover the Models view surface");
	const themed = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	for (const role of paletteRoles) {
		const color = DEFAULT_SESSION_UI_STYLE_SCHEME[role];
		assert.ok(color.source === "theme" || color.source === "rgb", `${role} must declare a color source`);
		assert.notEqual(themed.apply(role, "value"), "value", `${role} must style its value when color is enabled`);
	}
});
