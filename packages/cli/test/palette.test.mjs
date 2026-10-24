import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { loadCatalog } from "../dist/locale-catalog.js";
import {
	DEFAULT_PALETTE_OVERLAY_OPTIONS,
	JouzuPaletteRouter,
	JouzuPaletteSurfaceHost,
	paletteHeightBudget,
	paletteScrollbarMarker,
	paletteViewport,
	renderPaletteField,
	renderPaletteKeyBar,
	renderPaletteScrollbarRow,
	renderPaletteTabs,
	selectPalettePresentation,
} from "../dist/palette.js";

const identityTheme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
};

test("Palette tabs localize labels while preserving active markers and default callers", () => {
	const styles = { apply: (_role, value) => value };
	assert.match(renderPaletteTabs("models", identityTheme, styles), /\[Models\].*Workflow.*Settings/u);
	for (const [locale, labels] of [
		["en", ["Models", "Workflow", "Settings"]],
		["ja", ["モデル", "ワークフロー", "設定"]],
		["zh-Hans", ["模型", "工作流", "设置"]],
		["zh-Hant", ["模型", "工作流程", "設定"]],
	]) {
		const catalog = loadCatalog(locale);
		for (const [index, view] of ["models", "workflow", "settings"].entries()) {
			const tabs = renderPaletteTabs(view, identityTheme, styles, catalog);
			assert.ok(tabs.includes(`[${labels[index]}]`));
			assert.ok(labels.every((label) => tabs.includes(label)));
			assert.ok(visibleWidth(tabs) <= 44, `${locale} tabs fit a 48-column frame`);
		}
	}
});

test("Palette height matches the overlay cap and stays bounded on replacement terminals", () => {
	assert.equal(DEFAULT_PALETTE_OVERLAY_OPTIONS.maxHeight, "90%");
	for (const rows of [1, 2, 4, 8, 12, 16, 24, 30, 80]) {
		assert.equal(paletteHeightBudget(rows), Math.max(1, Math.min(rows - 2, Math.floor(rows * 0.9))));
		assert.ok(paletteHeightBudget(rows) <= rows);
	}
	for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
		assert.equal(paletteHeightBudget(invalid), paletteHeightBudget(24));
});

test("Palette viewport centers the selection and reports hidden rows", () => {
	const styles = { apply: (_role, value) => value };
	assert.deepEqual(paletteViewport(100, 0, 10), {
		start: 0,
		end: 10,
		capacity: 10,
		visible: 10,
		hasAbove: false,
		hasBelow: true,
	});
	assert.deepEqual(paletteViewport(100, 50, 10), {
		start: 45,
		end: 55,
		capacity: 10,
		visible: 10,
		hasAbove: true,
		hasBelow: true,
	});
	assert.deepEqual(paletteViewport(100, 99, 10), {
		start: 90,
		end: 100,
		capacity: 10,
		visible: 10,
		hasAbove: true,
		hasBelow: false,
	});
	assert.deepEqual(paletteViewport(3, 2, 10), {
		start: 0,
		end: 3,
		capacity: 10,
		visible: 3,
		hasAbove: false,
		hasBelow: false,
	});
	const top = paletteViewport(100, 0, 10);
	assert.equal(paletteScrollbarMarker(0, top, 100), "█");
	assert.equal(paletteScrollbarMarker(9, top, 100), "▼");
	const middle = paletteViewport(100, 50, 1);
	assert.equal(paletteScrollbarMarker(0, middle, 100), "↕");
	const bottom = paletteViewport(100, 99, 10);
	assert.equal(paletteScrollbarMarker(0, bottom, 100), "▲");
	assert.equal(visibleWidth(renderPaletteScrollbarRow("row", 48, styles, "▼")), 48);
});

test("key bars wrap CJK and rebound keys without clipping primary or cancel actions", () => {
	const styles = { apply: (_role, value) => value };
	const hints = [
		{ key: "Ctrl+Shift+Enter", label: "選択してプロジェクトに保存" },
		{ key: "Ctrl+Shift+F", label: "お気に入り" },
		{ key: "Esc/Ctrl+C", label: "キャンセル" },
	];
	for (const width of [24, 48, 80, 120]) {
		const bar = renderPaletteKeyBar(hints, width - 4, identityTheme, styles);
		assert.ok(bar.every((line) => visibleWidth(line) <= width - 4));
		const text = bar.join("").replaceAll(/\s/gu, "");
		for (const hint of hints) assert.ok(text.includes(`${hint.key}${hint.label}`));
	}
	const bounded = renderPaletteKeyBar(hints, 44, identityTheme, styles, 2).join("\n");
	assert.match(bounded, /Ctrl\+Shift\+Enter.*選択してプロジェクトに保存/u);
	assert.match(bounded, /Esc\/Ctrl\+C.*キャンセル/u);
	assert.doesNotMatch(bounded, /お気に入り/u);
	const compact = renderPaletteKeyBar(hints, 20, identityTheme, styles, 2);
	assert.equal(compact.length, 2);
	assert.ok(compact.every((line) => visibleWidth(line) <= 20));
	assert.match(compact.join("\n"), /Ctrl\+Shift\+Enter 選/u);
	assert.match(compact.join("\n"), /Esc\/Ctrl\+C キャンセ/u);
});

test("field metadata truncates before a required value and right-aligns", () => {
	const field = (value, meta) =>
		renderPaletteField({
			label: "coder",
			labelRole: "palette.identity",
			...(value ? { value } : {}),
			...(meta ? { meta } : {}),
			labelWidth: 8,
			innerWidth: 44,
			selected: false,
			theme: identityTheme,
			styles: { apply: (_role, value) => value },
		});
	for (const status of ["queued", "starting", "running", "completed", "failed", "cancelled", "interrupted"]) {
		const statusLine = field(status, "\u9577\u3044\u5272\u308a\u5f53\u3066\u3002".repeat(12));
		assert.ok(statusLine.includes(status), `${status} is not hidden by unbounded metadata`);
		assert.ok(visibleWidth(statusLine) <= 44, `${status}: ${statusLine}`);
	}
	const disclosure = field("p/very-long-model-name-that-fills-the-value-column", "\u203a");
	assert.ok(disclosure.includes("\u203a"), "a short disclosure chevron survives beside a long value");
	assert.ok(visibleWidth(disclosure) <= 44, `${disclosure}`);
	assert.match(
		field("failed", "\u9577\u3044\u5272\u308a\u5f53\u3066\u3002".repeat(12)).trimEnd(),
		/\u9577\u3044\u5272\u308a\u5f53\u3066\u3002$/u,
		"metadata right-aligns against the frame",
	);
});

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fakeContext(mode = "tui", tui = { requestRender() {}, terminal: { columns: 100, rows: 30 } }) {
	const calls = [];
	const handles = [];
	let component;
	let close;
	const ctx = {
		mode,
		ui: {
			custom(factory, options) {
				const completion = deferred();
				close = completion.resolve;
				const handle = {
					focusCalls: 0,
					focus() {
						this.focusCalls += 1;
					},
				};
				handles.push(handle);
				options?.onHandle?.(handle);
				component = factory(tui, identityTheme, {}, () => completion.resolve());
				calls.push({ factory, options });
				return completion.promise;
			},
		},
	};
	return {
		ctx,
		calls,
		handles,
		get component() {
			return component;
		},
		close: () => close?.(),
	};
}

function componentFactory(routes) {
	return (_context, route) => ({
		route(next) {
			routes.push(next);
		},
		render() {
			return [route.view];
		},
		invalidate() {},
	});
}

test("presentation selection floats over inline images only when it can hide them", () => {
	assert.equal(selectPalettePresentation({ columns: 120, rows: 30, env: {} }), "floating");
	assert.equal(selectPalettePresentation({ columns: 50, rows: 30, env: {} }), "replace");
	assert.equal(selectPalettePresentation({ columns: 120, rows: 12, env: {} }), "replace");
	assert.equal(
		selectPalettePresentation({ columns: 120, rows: 30, env: { KITTY_WINDOW_ID: "1" } }),
		"floating",
		"the installed Pi TUI exposes the overlay compositor that image hiding wraps",
	);
	assert.equal(selectPalettePresentation({ columns: 120, rows: 30, env: { TERM_PROGRAM: "ghostty" } }), "floating");
	assert.equal(
		selectPalettePresentation({ columns: 120, rows: 30, env: { KITTY_WINDOW_ID: "1" }, imageHiding: false }),
		"replace",
	);
	assert.equal(
		selectPalettePresentation({ columns: 120, rows: 30, env: { TERM_PROGRAM: "iTerm.app" }, imageHiding: false }),
		"replace",
	);
	assert.equal(
		selectPalettePresentation({
			columns: 120,
			rows: 30,
			env: { KITTY_WINDOW_ID: "1", TMUX: "/tmp/tmux" },
			imageHiding: false,
		}),
		"floating",
	);
	assert.equal(
		selectPalettePresentation({ columns: 40, rows: 10, env: { JOUZU_PALETTE_PRESENTATION: "floating" } }),
		"floating",
	);
});

test("floating Palette blanks inline image lines while open and restores them on close", async () => {
	const kittyLine = "\u001b_Ga=T,f=100,q=2;AAAA\u001b\\";
	const itermLine = "\u001b]1337;File=inline=1:AAAA\u0007";
	let overlayVisible = true;
	let renders = 0;
	const tui = {
		terminal: { columns: 100, rows: 30 },
		requestRender() {
			renders += 1;
		},
		hasOverlay: () => overlayVisible,
		compositeOverlays(lines) {
			return lines;
		},
	};
	const base = ["text", kittyLine, itermLine];
	const host = new JouzuPaletteSurfaceHost();
	const surface = fakeContext("tui", tui);
	const opened = host.open(surface.ctx, { view: "models" }, componentFactory([]), { presentation: "floating" });
	await Promise.resolve();
	assert.deepEqual(tui.compositeOverlays(base, 100, 30), ["text", "", ""], "images are hidden under the Palette");

	overlayVisible = false;
	assert.deepEqual(tui.compositeOverlays(base, 100, 30), base, "a hidden overlay leaves images visible");
	overlayVisible = true;

	surface.close();
	assert.equal(await opened, true);
	assert.deepEqual(tui.compositeOverlays(base, 100, 30), base, "images return once the Palette closes");
	assert.ok(renders > 0, "closing requests a redraw that restores images");

	const replacement = fakeContext("tui", tui);
	const replaced = host.open(replacement.ctx, { view: "models" }, componentFactory([]), { presentation: "replace" });
	await Promise.resolve();
	assert.deepEqual(tui.compositeOverlays(base, 100, 30), base, "the replacement presentation leaves images alone");
	replacement.close();
	await replaced;
});

test("floating backend routes one active Palette instance and restores focus", async () => {
	const host = new JouzuPaletteSurfaceHost();
	const surface = fakeContext();
	const routes = [];
	const first = host.open(surface.ctx, { view: "models", query: "sonnet" }, componentFactory(routes), {
		presentation: "floating",
	});
	await Promise.resolve();
	assert.equal(host.isOpen(), true);
	assert.equal(surface.calls.length, 1);
	assert.equal(surface.calls[0].options.overlay, true);
	assert.deepEqual(surface.calls[0].options.overlayOptions, DEFAULT_PALETTE_OVERLAY_OPTIONS);

	const second = host.open(surface.ctx, { view: "models", query: "opus" }, componentFactory(routes));
	await Promise.resolve();
	assert.deepEqual(routes, [{ view: "models", query: "opus" }]);
	assert.equal(surface.calls.length, 1);
	assert.equal(surface.handles[0].focusCalls, 1);

	surface.close();
	assert.equal(await first, true);
	assert.equal(await second, true);
	assert.equal(host.isOpen(), false);
});

test("replacement backend omits overlay options and non-TUI modes decline", async () => {
	const replacementHost = new JouzuPaletteSurfaceHost();
	const replacement = fakeContext();
	const opened = replacementHost.open(replacement.ctx, { view: "models" }, componentFactory([]), {
		presentation: "replace",
	});
	await Promise.resolve();
	assert.equal(replacement.calls[0].options, undefined);
	replacement.close();
	assert.equal(await opened, true);

	const rpcHost = new JouzuPaletteSurfaceHost();
	const rpc = fakeContext("rpc");
	assert.equal(await rpcHost.open(rpc.ctx, { view: "models" }, componentFactory([])), false);
	assert.equal(rpc.calls.length, 0);
});

test("Palette router switches between Models and Settings and disposes replaced views", () => {
	const routes = [];
	const disposed = [];
	const renders = [];
	const context = {
		tui: { requestRender() {} },
		theme: identityTheme,
		keybindings: {
			matches() {
				return false;
			},
		},
		styles: { apply: (_role, value) => value },
		close() {},
	};
	const router = new JouzuPaletteRouter({
		context,
		initialRoute: { view: "models" },
		factories: {
			models: (_ctx, route) => ({
				render: () => {
					renders.push(route.view);
					return ["models"];
				},
				invalidate() {},
				route(next) {
					routes.push(next);
				},
				dispose() {
					disposed.push("models");
				},
			}),
			settings: () => ({
				render: () => ["settings"],
				invalidate() {},
				route(next) {
					routes.push(next);
				},
				dispose() {
					disposed.push("settings");
				},
			}),
		},
	});
	assert.deepEqual(router.render(80), ["models"]);
	router.handleInput("\u001b[44;5u");
	assert.deepEqual(router.render(80), ["models"], "Ctrl+, is not a Palette shortcut");
	router.handleInput("\t");
	assert.deepEqual(router.render(80), ["settings"]);
	assert.deepEqual(disposed, ["models"]);
	router.route({ view: "settings" });
	assert.deepEqual(routes, [{ view: "settings" }]);
	router.handleInput("\u001b[Z");
	assert.deepEqual(router.render(80), ["models"]);
	assert.deepEqual(disposed, ["models", "settings"]);
	router.route({ view: "models", query: "qwen" });
	assert.deepEqual(routes, [{ view: "settings" }, { view: "models", query: "qwen" }]);
	router.dispose();
	assert.deepEqual(disposed, ["models", "settings", "models"]);
});

test("Palette tabs expose the active top-level view without relying on color", () => {
	const styles = { apply: (_role, value) => value };
	assert.match(renderPaletteTabs("models", identityTheme, styles), /\[Models\].*Settings/u);
	assert.match(renderPaletteTabs("settings", identityTheme, styles), /Models.*\[Settings\]/u);
});

test("Palette router pauses global Tab navigation while a view is editing", () => {
	const inputs = [];
	const context = {
		tui: { requestRender() {} },
		theme: identityTheme,
		keybindings: {},
		styles: { apply: (_role, value) => value },
		close() {},
	};
	const router = new JouzuPaletteRouter({
		context,
		initialRoute: { view: "settings" },
		factories: {
			models: componentFactory([]),
			settings: () => ({
				allowsGlobalNavigation: () => false,
				handleInput: (data) => inputs.push(data),
				render: () => ["settings"],
				invalidate() {},
				route() {},
			}),
		},
	});

	router.handleInput("\t");
	assert.deepEqual(router.render(80), ["settings"]);
	assert.deepEqual(inputs, ["\t"]);
});

test("the Palette host supplies Jouzu semantic styles to every view", () => {
	const { ctx } = fakeContext();
	const host = new JouzuPaletteSurfaceHost();
	let received;
	void host.open(ctx, { view: "models" }, (componentContext) => {
		received = componentContext;
		return { render: () => [], invalidate() {}, route() {} };
	});

	assert.ok(received, "the view factory receives a component context");
	assert.equal(typeof received.styles?.apply, "function", "views are given a styles object, not a raw theme");
	// The identity theme reports no color support, so roles pass their value through.
	assert.equal(received.styles.apply("palette.border", "─"), "─");
	assert.ok(received.styles.scheme["palette.marker"], "the Palette roles are present in the supplied scheme");
});
