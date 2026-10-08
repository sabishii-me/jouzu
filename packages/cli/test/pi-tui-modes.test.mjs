import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createInteractiveTui } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js";
// The renderer imports the pi-tui instance nested under the installed Pi package. Class checks and
// capability overrides only apply to that instance, so the helpers come from the same copy.
import {
	Container,
	KeybindingsManager,
	setCapabilities,
	stripTerminalSequences,
	TuiAltScreen,
	TuiMainScreen,
	visibleWidth,
} from "../../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js";

import {
	DEFAULT_PALETTE_OVERLAY_OPTIONS,
	JouzuPaletteSurfaceHost,
	renderPaletteDivider,
	renderPaletteField,
	renderPaletteHeading,
	renderPaletteTabs,
} from "../dist/palette.js";
import { createSessionUiExtension } from "../dist/session-ui/index.js";

// Pi resolves terminal capabilities once per process. Pin them so both modes take the same text
// path whatever terminal runs the suite; image protocols add capability queries and screen swaps.
setCapabilities({ images: null, trueColor: false, hyperlinks: false });

const COLUMNS = 100;
const ROWS = 30;
const FRAME_START = "\u001b[?2026h";
const FRAME_END = "\u001b[?2026l";
const PALETTE_WIDTH = 82;
const PALETTE_INNER = 78;
const DRAFT = Array.from({ length: 9 }, (_value, index) => `draft line ${index + 1}`).join("\n");

// One identity theme serves both roles: Jouzu reads `fg`/`bg`/`bold` for its styles, and Pi's editor
// reads `borderColor`/`selectList` for the prompt frame.
const theme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
	borderColor: (value) => value,
	selectList: {
		selectedPrefix: (value) => value,
		selectedText: (value) => value,
		description: (value) => value,
		scrollInfo: (value) => value,
		noMatch: (value) => value,
	},
};

/**
 * In-memory stand-in for the terminal Pi writes to. It records the bytes the real renderer emits;
 * it is not an emulator, so this file proves renderer integration, not physical terminal behavior.
 */
class RecordingTerminal {
	columns = COLUMNS;
	rows = ROWS;
	kittyProtocolActive = false;
	output = "";
	started = false;
	stopped = false;
	onInput;
	onResize;

	start(onInput, onResize) {
		this.started = true;
		this.onInput = onInput;
		this.onResize = onResize;
	}

	stop() {
		this.stopped = true;
	}

	async drainInput() {}

	write(data) {
		this.output += data;
	}

	moveBy() {}

	hideCursor() {}

	showCursor() {}

	clearLine() {}

	clearFromCursor() {}

	clearScreen() {}

	setTitle() {}

	setProgress() {}
}

/**
 * Read the rows of the most recent full frame from the recorded writes. Both renderers write one frame
 * between the synchronized-output markers, and `renderNow(true)` resets their diff state, so that frame
 * holds every row rather than only the rows that changed.
 */
function renderedRows(terminal, tuiMode) {
	const frame = terminal.output.slice(terminal.output.lastIndexOf(FRAME_START), terminal.output.lastIndexOf(FRAME_END));
	const rows = [];
	if (tuiMode === "fullscreen") {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the row prefix is one of the renderer's escape sequences.
		const prefixes = [...frame.matchAll(/\x1b\[(\d+);1H\x1b\[2K/g)];
		for (const [index, match] of prefixes.entries()) {
			const end = index + 1 < prefixes.length ? prefixes[index + 1].index : frame.length;
			rows[Number(match[1]) - 1] = frame.slice(match.index + match[0].length, end);
		}
	} else {
		// The main-screen renderer writes a full frame as plain rows separated by CRLF.
		rows.push(...frame.split("\r\n"));
	}
	// Content carries styling only; drop the private-mode and cursor-move sequences around it.
	return rows.map((row) =>
		// biome-ignore lint/suspicious/noControlCharactersInRegex: these match terminal control sequences, not text.
		stripTerminalSequences(row.replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\[\d*[ABCDG]/g, "")),
	);
}

/** Mount the components the Session UI extension installs, through Pi's own editor and footer slots. */
async function mountSessionUi(tui, cwd) {
	const handlers = new Map();
	const calls = { footers: [], editors: [] };
	const extension = createSessionUiExtension({
		colorEnabled: false,
		getHints: () => [{ id: "palette", text: "/model choose", priority: 10, role: "muted" }],
	});
	extension.factory({
		on(name, handler) {
			handlers.set(name, handler);
		},
		async exec(command) {
			return command === "git"
				? { stdout: "# branch.head main\n# branch.ab +2 -1\n? notes.md\n", stderr: "", code: 0, killed: false }
				: { stdout: "v24.16.0\n", stderr: "", code: 0, killed: false };
		},
	});
	const ctx = {
		mode: "tui",
		cwd,
		model: { provider: "codex", id: "gpt-5", name: "GPT-5", contextWindow: 200_000 },
		thinkingLevel: "high",
		scopedModels: [],
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 38_000, contextWindow: 200_000, percent: 19 }),
		sessionManager: {
			getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 124_000, output: 9000 } } }],
		},
		ui: {
			theme,
			setFooter: (factory) => calls.footers.push(factory),
			setEditorComponent: (factory) => calls.editors.push(factory),
		},
	};
	await handlers.get("session_start")({}, ctx);
	const footerData = { getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} };
	const statusBar = calls.footers.at(-1)(tui, theme, footerData);
	const editor = calls.editors.at(-1)(tui, theme, new KeybindingsManager({}));
	// The extension refreshes Git and runtime facts through Pi's command runner and a real directory
	// read, so wait for the Status Bar to publish them instead of assuming a queue depth.
	const refreshed = () => {
		const line = statusBar.render(COLUMNS)[0];
		return line.includes("main") && line.includes("node v24.16.0");
	};
	const deadline = Date.now() + 2000;
	while (Date.now() < deadline && !refreshed()) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	return { editor, handlers, ctx, statusBar, calls };
}

/**
 * Implement the Palette surface the way Pi's InteractiveMode does: an overlay through the renderer's
 * overlay stack, or a replacement of the editor inside its own container. Every call below is a real
 * renderer API.
 */
function paletteSurface(tui, editorSlot, editor) {
	const surfaces = [];
	let handle;
	return {
		surfaces,
		get handle() {
			return handle;
		},
		ctx: {
			mode: "tui",
			ui: {
				custom(factory, options) {
					const savedText = editor.getText();
					return new Promise((resolve) => {
						let component;
						let closed = false;
						const close = (result) => {
							if (closed) return;
							closed = true;
							if (options?.overlay) {
								tui.hideOverlay();
							} else {
								editorSlot.clear();
								editorSlot.addChild(editor);
								editor.setText(savedText);
								tui.setFocus(editor);
							}
							resolve(result);
							component?.dispose?.();
							tui.requestRender();
						};
						component = factory(tui, theme, new KeybindingsManager({}), close);
						if (options?.overlay) {
							handle = tui.showOverlay(component, options.overlayOptions);
							options.onHandle?.(handle);
						} else {
							editorSlot.clear();
							editorSlot.addChild(component);
							tui.setFocus(component);
						}
						surfaces.push({ component, options });
						tui.requestRender();
					});
				},
			},
		},
	};
}

/** Render a Palette view from Jouzu's own row builders, recording the rows for comparison. */
function paletteFactory(route, rendered) {
	return (context) => {
		const view = route.view === "settings" ? "settings" : "models";
		const models = ["claude-sonnet-4.5", "gpt-5.1", "qwen3-coder", "deepseek-v4", "kimi-k2", "glm-4.6"];
		const rows = [
			renderPaletteTabs(view, theme, context.styles),
			renderPaletteHeading(view === "models" ? "Models" : "Settings", PALETTE_INNER, theme, context.styles, "6"),
			...models.map((model, index) =>
				renderPaletteField({
					label: model,
					labelWidth: 18,
					innerWidth: PALETTE_INNER,
					selected: index === 0,
					theme,
					styles: context.styles,
				}),
			),
			renderPaletteDivider(PALETTE_WIDTH, context.styles),
		];
		rendered.push(rows);
		return {
			render: () => rows,
			invalidate() {},
			route() {},
			dispose() {},
			// A Palette view closes itself through the context the host handed it.
			close: () => context.close(),
			handleInput: (data) => {
				if (data === "\u001b") context.close();
			},
		};
	};
}

async function exerciseMode(tuiMode) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-pi-tui-modes-"));
	const workspace = join(root, "workspace");
	// The runtime fact needs a project marker in the workspace, as it does in a real session.
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(workspace, "package.json"), "{}\n");
	const terminal = new RecordingTerminal();
	const tui = createInteractiveTui({ terminal, tuiMode, showHardwareCursor: false, logDirectory: root });
	try {
		assert.ok(tuiMode === "fullscreen" ? tui instanceof TuiAltScreen : tui instanceof TuiMainScreen);
		assert.equal(tui.mode, tuiMode);
		tui.start();
		assert.equal(terminal.started, true, "the renderer starts the terminal it was given");

		const { editor, statusBar, handlers, ctx, calls } = await mountSessionUi(tui, workspace);
		// Pi keeps the editor in its own container between the chat view and the footer.
		const editorSlot = new Container();
		editorSlot.addChild(editor);
		tui.addChild(editorSlot);
		tui.addChild(statusBar);
		tui.setFocus(editor);
		editor.setText(DRAFT);
		tui.renderNow(true);

		const base = renderedRows(terminal, tuiMode);
		assert.equal(tui.getFocusedComponent(), editor, "the renderer focuses the mounted prompt editor");
		assert.equal(tui.hasOverlay(), false);
		// Session Line + 9 draft rows + two frame borders + Status Bar; fullscreen pads to the viewport.
		assert.equal(base.length, tuiMode === "fullscreen" ? ROWS : 13, "the mounted components render their rows");
		for (const [row, line] of base.entries()) {
			assert.ok(visibleWidth(line) <= COLUMNS, `row ${row} fits the terminal width: ${visibleWidth(line)}`);
		}
		const baseText = base.join("\n");
		assert.match(baseText, /\/model choose/, "the Session Line renders above the prompt frame");
		assert.match(baseText, /❯ draft line \d/, "the prompt frame leads the visible draft");
		assert.match(baseText, /main \[\?⇕\]/, "the Status Bar renders the refreshed Git fact");
		assert.match(baseText, /19%\/200k/, "the Status Bar renders the context fact");
		assert.match(baseText, /node v24\.16\.0/, "the Status Bar renders the refreshed runtime fact");

		const surface = paletteSurface(tui, editorSlot, editor);
		const host = new JouzuPaletteSurfaceHost();
		const rendered = [];
		const opened = host.open(surface.ctx, { view: "models" }, paletteFactory({ view: "models" }, rendered), {
			presentation: "floating",
		});
		await Promise.resolve();
		assert.equal(host.isOpen(), true);
		assert.equal(surface.surfaces[0].options?.overlay, true, "the floating surface uses the overlay stack");
		assert.deepEqual(surface.surfaces[0].options.overlayOptions, DEFAULT_PALETTE_OVERLAY_OPTIONS);
		tui.renderNow(true);

		const bounds = surface.handle.getBounds();
		const paletteRows = rendered.at(-1);
		assert.ok(bounds, "the renderer reports the bounds it composited the overlay into");
		assert.equal(bounds.width, PALETTE_WIDTH, "the overlay honors the requested width");
		assert.equal(bounds.height, paletteRows.length, "the renderer keeps every row the Palette view rendered");
		assert.equal(bounds.col, Math.floor((COLUMNS - PALETTE_WIDTH) / 2), "the overlay is centered");
		assert.ok(bounds.row > 0 && bounds.row + bounds.height < ROWS, `the overlay keeps its margin: ${bounds.row}`);
		assert.equal(surface.handle.isFocused(), true, "the overlay takes focus from the renderer");
		assert.equal(tui.getFocusedComponent(), surface.surfaces[0].component);
		assert.equal(tui.hasOverlay(), true);

		const overlaid = renderedRows(terminal, tuiMode);
		const region = (row) => (overlaid[row] ?? "").padEnd(COLUMNS).slice(bounds.col, bounds.col + bounds.width);
		for (const [row, line] of base.entries()) {
			const padded = line.padEnd(COLUMNS);
			if (row >= bounds.row && row < bounds.row + bounds.height) {
				assert.equal(
					overlaid[row].slice(0, bounds.col),
					padded.slice(0, bounds.col),
					`row ${row} keeps base content left of the overlay`,
				);
				assert.equal(
					overlaid[row].slice(bounds.col + bounds.width),
					padded.slice(bounds.col + bounds.width),
					`row ${row} keeps base content right of the overlay`,
				);
				continue;
			}
			assert.equal(overlaid[row], line, `row ${row} is untouched outside the overlay`);
		}
		for (const [index, row] of paletteRows.entries()) {
			assert.equal(
				region(bounds.row + index),
				row.padEnd(PALETTE_WIDTH),
				`the renderer composites Palette row ${index} at the reported bounds`,
			);
		}
		assert.match(region(bounds.row), /^\[Models\]/u, "the overlay starts with the Palette tabs");

		// The renderer routes input to the focused overlay, so Escape closes the Palette, not the prompt.
		let promptEscapes = 0;
		editor.onEscape = () => {
			promptEscapes += 1;
		};
		terminal.onInput("\u001b");
		assert.equal(await opened, true, "closing the Palette resolves the surface");
		assert.equal(promptEscapes, 0, "the focused overlay owns input, not the prompt editor");
		assert.equal(host.isOpen(), false);
		assert.equal(tui.hasOverlay(), false, "the renderer drops the overlay on close");
		assert.equal(surface.handle.isFocused(), false);
		assert.equal(tui.getFocusedComponent(), editor, "the renderer restores prompt focus");
		tui.renderNow(true);
		assert.deepEqual(renderedRows(terminal, tuiMode), base, "the screen returns to the prompt frame alone");

		const replaced = host.open(surface.ctx, { view: "settings" }, paletteFactory({ view: "settings" }, rendered), {
			presentation: "replace",
		});
		await Promise.resolve();
		const replacement = surface.surfaces.at(-1).component;
		assert.equal(host.isOpen(), true);
		assert.equal(tui.hasOverlay(), false, "the replacement surface does not use the overlay stack");
		assert.equal(editorSlot.children.includes(editor), false, "the replacement takes the editor slot");
		assert.equal(editorSlot.children.includes(replacement), true);
		assert.equal(tui.getFocusedComponent(), replacement);
		tui.renderNow(true);
		const replacedRows = renderedRows(terminal, tuiMode);
		const replacedText = replacedRows.join("\n");
		assert.match(replacedText, /\[Settings\]/, "the replacement renders the Palette view");
		assert.match(replacedText, /→ claude-sonnet-4\.5/u);
		assert.doesNotMatch(replacedText, /❯/, "the prompt frame is not rendered behind a replacement");

		replacement.close();
		assert.equal(await replaced, true);
		assert.equal(host.isOpen(), false);
		assert.equal(editorSlot.children.includes(editor), true, "closing the replacement restores the editor slot");
		assert.equal(editorSlot.children.includes(replacement), false);
		assert.equal(tui.getFocusedComponent(), editor, "the renderer restores prompt focus");
		assert.equal(editor.getText(), DRAFT, "the restored editor keeps the draft");
		tui.renderNow(true);
		assert.deepEqual(renderedRows(terminal, tuiMode), base, "the screen returns to the prompt frame alone");

		await handlers.get("session_shutdown")({}, ctx);
		assert.equal(calls.footers.at(-1), undefined, "shutdown unregisters the Status Bar");
		assert.equal(calls.editors.at(-1), undefined, "shutdown unregisters the prompt editor");

		tui.stop();
		assert.equal(terminal.stopped, true);
		if (tuiMode === "fullscreen") {
			assert.ok(terminal.output.includes("\u001b[?1049h"), "the fullscreen renderer enters the alternate screen");
			assert.ok(terminal.output.includes("\u001b[?1049l"), "the fullscreen renderer leaves the alternate screen");
		} else {
			assert.equal(terminal.output.includes("\u001b[?1049h"), false, "the regular renderer stays on the main screen");
		}
	} finally {
		tui.stop();
		rmSync(root, { recursive: true, force: true });
	}
}

test("drives the Session Frame and Palette through Pi's fullscreen renderer", async () => {
	await exerciseMode("fullscreen");
});

test("drives the Session Frame and Palette through Pi's regular renderer", async () => {
	await exerciseMode("regular");
});
