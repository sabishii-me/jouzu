import assert from "node:assert/strict";
import { test } from "node:test";

import { createSessionUiStyles, DARK_SESSION_UI_STYLE_SCHEME, LIGHT_SESSION_UI_STYLE_SCHEME } from "../dist/index.js";

const taggedTheme = {
	fg: (role, value) => `<${role}>${value}</${role}>`,
};

test("maps Jouzu semantic roles to the retained Session UI color baseline", () => {
	// The 24-bit escapes are the mapping under test, so the color mode is pinned
	// rather than detected from TERM and COLORTERM.
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	assert.equal(styles.apply("prompt.border", "border"), "<borderMuted>border</borderMuted>");
	assert.equal(styles.apply("prompt.leader", "❯"), "\u001b[38;2;103;232;249m❯\u001b[39m");
	assert.equal(styles.apply("session.provider", "Codex"), "<dim>Codex</dim>");
	assert.equal(styles.apply("session.model", "gpt"), "\u001b[38;2;103;232;249mgpt\u001b[39m");
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
	assert.equal(basic.apply("prompt.leader", "❯"), "\u001b[96m❯\u001b[39m");
});

test("detects the terminal color mode from the injected environment", () => {
	const truecolor = createSessionUiStyles(taggedTheme, {
		env: { COLORTERM: "truecolor", TERM: "xterm" },
		stdoutIsTTY: false,
	});
	assert.equal(truecolor.apply("prompt.leader", "❯"), "\u001b[38;2;103;232;249m❯\u001b[39m");
	const indexed = createSessionUiStyles(taggedTheme, { env: { TERM: "tmux-256color" }, stdoutIsTTY: false });
	assert.equal(indexed.apply("prompt.leader", "❯"), "\u001b[38;5;81m❯\u001b[39m");
	const basic = createSessionUiStyles(taggedTheme, { env: { TERM: "xterm" }, stdoutIsTTY: false });
	assert.equal(basic.apply("prompt.leader", "❯"), "\u001b[96m❯\u001b[39m");
});

test("styles every declared role when color is enabled", () => {
	const styles = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	for (const role of Object.keys(DARK_SESSION_UI_STYLE_SCHEME)) {
		assert.notEqual(styles.apply(role, "value"), "value", `${role} must style its value when color is enabled`);
	}
});

test("supports no-color output and replacement schemes without renderer changes", () => {
	const plain = createSessionUiStyles(taggedTheme, { colorEnabled: false });
	assert.equal(plain.apply("prompt.leader", "❯"), "❯");
	assert.equal(plain.apply("status.workspace", "work"), "work");
	const detectedPlain = createSessionUiStyles({ fg: (_role, value) => value }, { env: {} });
	assert.equal(detectedPlain.apply("prompt.leader", "❯"), "❯");
	const noColor = createSessionUiStyles(taggedTheme, { env: { NO_COLOR: "1" } });
	assert.equal(noColor.apply("status.workspace", "work"), "work");

	const scheme = {
		...DARK_SESSION_UI_STYLE_SCHEME,
		"prompt.leader": { source: "theme", value: "accent" },
	};
	const themed = createSessionUiStyles(taggedTheme, { colorEnabled: true, scheme });
	assert.equal(themed.apply("prompt.leader", "❯"), "<accent>❯</accent>");
});

test("routes Palette roles through the same capability policy as the Session UI", () => {
	const truecolor = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	// The Palette marker and the prompt leader share one brand accent, so a single
	// capability policy covers both surfaces.
	assert.equal(
		truecolor.apply("palette.marker", "→"),
		truecolor.apply("prompt.leader", "→"),
		"Palette marker and prompt leader must resolve to the same brand accent",
	);
	assert.equal(truecolor.apply("palette.marker", "→"), "\u001b[38;2;103;232;249m→\u001b[39m");
	assert.equal(truecolor.apply("palette.section.current", "Current"), "\u001b[38;2;244;114;182mCurrent\u001b[39m");

	const indexed = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "256" });
	assert.equal(indexed.apply("palette.marker", "→"), "\u001b[38;5;81m→\u001b[39m");
	const basic = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "16" });
	assert.equal(basic.apply("palette.marker", "→"), "\u001b[96m→\u001b[39m");

	const plain = createSessionUiStyles(taggedTheme, { colorEnabled: false });
	for (const role of Object.keys(DARK_SESSION_UI_STYLE_SCHEME).filter((name) => name.startsWith("palette."))) {
		assert.equal(plain.apply(role, "value"), "value", `${role} must emit no escapes without color`);
	}
});

test("maps every Palette role to a defined color", () => {
	const paletteRoles = Object.keys(DARK_SESSION_UI_STYLE_SCHEME).filter((name) => name.startsWith("palette."));
	assert.ok(paletteRoles.length >= 18, "Palette roles must cover the Models view surface");
	const themed = createSessionUiStyles(taggedTheme, { colorEnabled: true, colorMode: "truecolor" });
	for (const role of paletteRoles) {
		const color = DARK_SESSION_UI_STYLE_SCHEME[role];
		assert.ok(color.source === "theme" || color.source === "rgb", `${role} must declare a color source`);
		assert.notEqual(themed.apply(role, "value"), "value", `${role} must style its value when color is enabled`);
	}
});

function relativeLuminance({ red, green, blue }) {
	const channel = (value) => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(a, b) {
	const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

test("selects the light scheme when the theme reports a light appearance", () => {
	const lightTheme = { ...taggedTheme, appearance: "light" };
	const styles = createSessionUiStyles(lightTheme, { colorEnabled: true, colorMode: "truecolor" });
	assert.equal(styles.scheme, LIGHT_SESSION_UI_STYLE_SCHEME);
	assert.equal(styles.apply("prompt.leader", "❯"), "\u001b[38;2;14;116;144m❯\u001b[39m");
	assert.equal(styles.apply("status.workspace", "work"), "\u001b[38;2;67;56;202mwork\u001b[39m");
	assert.equal(styles.apply("status.context.normal", "19%"), "\u001b[38;2;180;83;9m19%\u001b[39m");
	assert.equal(styles.apply("palette.section.current", "Current"), "\u001b[38;2;190;24;93mCurrent\u001b[39m");
	assert.equal(styles.apply("prompt.border", "border"), "<borderMuted>border</borderMuted>");
});

test("follows a theme whose appearance changes after the styles are created", () => {
	const liveTheme = { ...taggedTheme, appearance: "dark" };
	const styles = createSessionUiStyles(liveTheme, { colorEnabled: true, colorMode: "truecolor" });
	assert.equal(styles.apply("prompt.leader", "❯"), "\u001b[38;2;103;232;249m❯\u001b[39m");
	liveTheme.appearance = "light";
	assert.equal(styles.apply("prompt.leader", "❯"), "\u001b[38;2;14;116;144m❯\u001b[39m");
});

test("keeps both schemes on the same roles and readable on their backgrounds", () => {
	assert.deepEqual(Object.keys(LIGHT_SESSION_UI_STYLE_SCHEME), Object.keys(DARK_SESSION_UI_STYLE_SCHEME));
	const backgrounds = {
		dark: [DARK_SESSION_UI_STYLE_SCHEME, { red: 0, green: 0, blue: 0 }],
		light: [LIGHT_SESSION_UI_STYLE_SCHEME, { red: 255, green: 255, blue: 255 }],
	};
	for (const [appearance, [scheme, background]] of Object.entries(backgrounds)) {
		for (const [role, color] of Object.entries(scheme)) {
			if (color.source !== "rgb") continue;
			const ratio = contrastRatio(color, background);
			assert.ok(ratio >= 4.5, `${appearance} ${role} contrast ${ratio.toFixed(2)} is below 4.5`);
		}
	}
});
