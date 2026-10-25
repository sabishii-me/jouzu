import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CURSOR_MARKER,
	KeybindingsManager,
	stripTerminalSequences,
	TUI_KEYBINDINGS,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { JouzuPaletteRouter, paletteHeightBudget } from "../dist/palette.js";
import { defaultAgentConfig, digest, parseAgentConfig } from "../dist/subagents/roles.js";
import { WorkflowComponent } from "../dist/workflow.js";

function fixture(catalog, options = {}) {
	let config = defaultAgentConfig();
	let writes = 0;
	let enabled = options.enabled ?? true;
	let closes = 0;
	let update = () => {};
	const launches = [];
	const context = {
		catalog,
		tui: { requestRender() {}, terminal: { rows: 32, columns: 90 } },
		keybindings: new KeybindingsManager(TUI_KEYBINDINGS),
		theme: { bg: (_role, text) => text, fg: (_role, text) => text, bold: (text) => text },
		styles: { apply: (_role, text) => text },
		close() {
			closes++;
		},
	};
	const service = {
		subagentsEnabled: () => enabled,
		setSubagentsEnabled: async (value) => {
			enabled = value;
		},
		cwd: () => "/workspace/parent",
		roles: () => ({ config: structuredClone(config), revision: digest(config) }),
		save: (snapshot) => {
			config = parseAgentConfig(snapshot.config);
			writes++;
		},
		models: () => [{ provider: "test", id: "日本語-model", name: "Test" }],
		runs: () => [],
		activeRole: () => undefined,
		subscribe: (listener) => {
			update = listener;
			return () => {};
		},
		activate: async () => {},
		launch: async () => {},
		read: () => ({ text: "", nextOffset: null, totalBytes: 0 }),
	};
	const view = new WorkflowComponent(context, service);
	view.focused = true;
	return {
		view,
		context,
		service,
		update: () => update(),
		get writes() {
			return writes;
		},
		get launches() {
			return launches;
		},
		get closes() {
			return closes;
		},
		get config() {
			return config;
		},
		text: (width = 48) => view.render(width).join("\n"),
	};
}
const down = (view, n = 1) => {
	for (let i = 0; i < n; i++) view.handleInput("\x1b[B");
};
const pageDown = (view, n = 1) => {
	for (let i = 0; i < n; i++) view.handleInput("\x1b[6~");
};
const pageUp = (view, n = 1) => {
	for (let i = 0; i < n; i++) view.handleInput("\x1b[5~");
};
const home = (view) => view.handleInput("\x1b[H");
const end = (view) => view.handleInput("\x1b[F");
const ctrlHome = (view) => view.handleInput("\x1b[1;5H");
const ctrlEnd = (view) => view.handleInput("\x1b[1;5F");
const enter = (view) => view.handleInput("\r");
const cancel = (view) => view.handleInput("\x1b");
const indicator = (text) => text.split("\n").find((line) => /\d+-\d+\/\d+/u.test(line)) ?? "";
/**
 * Move the selection to a row by label so adding settings rows does not
 * silently repoint every browse-level test at a different control.
 */
const select = (f, label) => {
	f.view.handleInput("\x1b[H");
	for (let i = 0; i <= 64; i++) {
		if (f.text(120).includes(`→ ${label}`)) return;
		f.view.handleInput("\x1b[B");
	}
	throw new Error(`the ${label} row was not reachable`);
};

test("Workflow localizes navigation, nested headings, and actions without changing role IDs", () => {
	const f = fixture(resolveCatalog("ja").bundle);
	for (const width of [24, 48, 80, 120]) {
		const lines = f.view.render(width);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		assert.doesNotMatch(lines.join("\n"), /Workflow|Models|Settings|change|close/u);
		if (width >= 48) {
			assert.match(stripTerminalSequences(lines[0]), /JOUZU · ワークフロー/u);
			assert.match(lines[1], /モデル.*\[ワークフロー\].*設定/u);
		}
	}
	assert.equal(f.view.render(11)[0], "ワークフロ");
	select(f, "coder");
	enter(f.view);
	assert.match(f.text(), /Enter 保存/u);
	down(f.view, 2);
	enter(f.view);
	assert.match(f.text(), /検索/u);
	assert.doesNotMatch(f.text(), /Search/u);
	cancel(f.view);
	cancel(f.view);
	f.view.handleInput("\x1b[H");
	f.service.runs = () => [{ id: "active", status: "running", role: { id: "coder" }, task: "task" }];
	enter(f.view);
	assert.match(f.text(), /確認/u);
	assert.doesNotMatch(f.text(), /Confirm/u);
	cancel(f.view);
	assert.equal(f.writes, 0);
	f.view.dispose();
});

test("Workflow renders the same-as-session model label from the active catalog", () => {
	for (const [locale, label] of [
		["ja", "このセッションと同じ"],
		["en", "Same as this session"],
	]) {
		const f = fixture(resolveCatalog(locale).bundle);
		assert.ok(f.text(120).includes(label), `${locale} browse rows use the catalog label`);
		select(f, "coder");
		enter(f.view);
		assert.ok(f.text(120).includes(label), `${locale} role form uses the catalog label`);
		f.view.dispose();
	}
});

test("the same-as-session search alias follows the active catalog", () => {
	const f = fixture(resolveCatalog("ja").bundle);
	select(f, "coder");
	enter(f.view);
	down(f.view, 2);
	enter(f.view);
	f.view.handleInput("このセッション");
	assert.match(f.text(120), /このセッションと同じ/);
	f.view.dispose();
});

test("Workflow uses tall terminals and keeps selected actions and rebound hints inside short frames", () => {
	for (const locale of ["en", "ja"]) {
		const f = fixture(resolveCatalog(locale).bundle);
		const config = structuredClone(f.config);
		config.roles = Array.from({ length: 100 }, (_, index) => ({ ...config.roles[0], id: `agent-${index}` }));
		f.service.roles = () => ({ config: structuredClone(config), revision: digest(config) });
		f.context.tui.terminal.rows = 80;
		f.context.keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
			"tui.select.confirm": ["ctrl+shift+enter"],
		});
		for (const width of [24, 48, 80, 120]) {
			const lines = f.view.render(width);
			assert.ok(lines.length <= paletteHeightBudget(80));
			assert.ok(lines.filter((line) => /agent-\d/u.test(line)).length > 12);
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
		}
		f.view.handleInput("\x1b[F");
		for (const rows of [80, 24, 16, 12, 8, 4, 1, 80]) {
			f.context.tui.terminal.rows = rows;
			for (const width of [24, 48, 80, 120]) {
				const lines = f.view.render(width);
				assert.ok(lines.length <= paletteHeightBudget(rows));
				assert.ok(lines.every((line) => visibleWidth(line) <= width));
				if (rows >= 12) {
					assert.match(lines.join("\n"), /→ \+ /u);
					assert.match(lines.join("\n"), /Ctrl\+Shift\+Enter/u);
					assert.match(lines.join("\n"), /Esc\/Ctrl\+C/u);
					assert.ok(lines.at(-1).startsWith("╰"));
				}
			}
		}
		f.view.dispose();
	}
});

test("Workflow reserves run details, wrapped messages, and output controls before paging", () => {
	const f = fixture();
	f.context.tui.terminal.rows = 12;
	const run = {
		id: "bounded-run",
		status: "completed",
		role: f.config.roles[0],
		model: { provider: "test", id: "日本語-model" },
		cwd: "/workspace",
		task: "task",
		context: { mode: "summary", parentLookup: true },
		result: "A completed result",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	};
	f.service.runs = () => [run];
	f.service.read = () => ({ text: Array.from({ length: 100 }, (_, i) => `出力 ${i}`).join("\n"), nextOffset: null });
	f.view.route({ view: "workflow", query: "runs" });
	enter(f.view);
	for (const width of [24, 48, 80, 120]) {
		const lines = f.view.render(width);
		assert.ok(lines.length <= paletteHeightBudget(12));
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
		assert.match(lines.join("\n"), /→ Read output/u);
		assert.match(lines.join("\n"), /Esc\/Ctrl\+C/u);
	}
	enter(f.view);
	for (const rows of [12, 24, 80]) {
		f.context.tui.terminal.rows = rows;
		const before = f.view.render(48);
		assert.ok(before.length <= paletteHeightBudget(rows));
		assert.match(before.join("\n"), /(?:PgDn|PageDown) next/u);
		f.view.handleInput("\x1b[6~");
		const after = f.view.render(48);
		assert.ok(after.length <= paletteHeightBudget(rows));
		assert.match(after.join("\n"), /Esc\/Ctrl\+C back/u);
	}
	f.view.dispose();
});

test("Runs keeps the selected child when new runs are inserted", () => {
	const f = fixture();
	const run = (id) => ({
		id,
		status: "running",
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: `/workspace/${id}`,
		task: id,
		usage: {},
	});
	let runs = [run("chosen"), run("other")];
	f.service.runs = () => runs;
	f.view.route({ view: "workflow", query: "runs" });
	f.text();
	down(f.view);
	runs = [run("new"), ...runs];
	f.update();
	enter(f.view);
	assert.match(f.text(100), /Workspace.*\/workspace\/other/);
	f.view.dispose();
});

test("a fresh open lands on active runs while keeping definitions above them", () => {
	const f = fixture();
	const run = (id, status, createdAt) => ({
		id,
		status,
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: "/workspace",
		task: id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		createdAt,
	});
	f.service.runs = () => [
		run("finished", "completed", "2026-01-02T00:00:00.000Z"),
		run("working", "running", "2026-01-01T00:00:00.000Z"),
	];
	const view = new WorkflowComponent(f.context, f.service);
	view.focused = true;
	const text = view.render(100).join("\n");
	assert.match(text, /1 running · 2 in session/);
	assert.match(text, /→ working/, "the active run is selected");
	assert.ok(text.indexOf("working") < text.indexOf("finished"), "active runs lead the list");
	assert.ok(text.indexOf("orchestrator") < text.indexOf("working"), "definitions stay above runs");
	assert.ok(text.indexOf("orchestrator") < text.indexOf("reviewer"), "every editable role remains visible");
	assert.doesNotMatch(text, /View:/, "the mutually exclusive Agents/Runs switch is gone");
	view.dispose();
});

test("definitions stay editable above active and historical runs, including when subagents are off", () => {
	const run = (id, status, createdAt) => ({
		id,
		status,
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: "/workspace",
		task: id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		createdAt,
	});
	for (const enabled of [true, false]) {
		const f = fixture(undefined, { enabled });
		f.service.runs = () => [
			run("history", "completed", "2026-01-02T00:00:00.000Z"),
			run("live", "running", "2026-01-01T00:00:00.000Z"),
		];
		const text = f.text(120);
		assert.match(text, /orchestrator/);
		assert.match(text, /reviewer/);
		assert.match(text, /\+ Add agent/);
		assert.match(text, /Runs/);
		assert.match(text, /live/);
		assert.match(text, /history/);
		assert.doesNotMatch(text, /View:/);
		assert.ok(text.indexOf("orchestrator") < text.indexOf("reviewer"), "roles stay in definition order");
		assert.ok(text.indexOf("reviewer") < text.indexOf("+ Add agent"), "Add agent follows the roles");
		assert.ok(text.indexOf("+ Add agent") < text.indexOf("Runs"), "role controls precede the run heading");
		assert.ok(text.indexOf("Runs") < text.indexOf("live"), "the run list follows role configuration");
		assert.ok(text.indexOf("live") < text.indexOf("history"), "active runs lead historical runs");
		if (!enabled) assert.match(text, /Subagents.*Off/);
		f.view.dispose();
	}
});

test("role edit, save, and cancel stay reachable with runs in the same pane", () => {
	const f = fixture();
	const run = (id, status) => ({
		id,
		status,
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: "/workspace",
		task: id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	});
	f.service.runs = () => [run("live", "running"), run("history", "completed")];
	f.view.route({ view: "workflow", query: "runs" });
	assert.match(f.text(120), /→ live/);
	const original = f.config.roles.find((role) => role.id === "coder").description;
	select(f, "coder");
	enter(f.view);
	assert.match(f.text(), /Edit agent/);
	down(f.view);
	f.view.handleInput(" updated");
	enter(f.view);
	assert.equal(f.writes, 1);
	const saved = f.config.roles.find((role) => role.id === "coder").description;
	assert.notEqual(saved, original);
	assert.match(saved, /updated/);
	assert.match(f.text(120), /→ coder/);
	assert.match(f.text(120), /Saved coder/);
	assert.match(f.text(120), /live/);

	select(f, "coder");
	enter(f.view);
	down(f.view);
	f.view.handleInput(" discarded");
	cancel(f.view);
	assert.equal(f.writes, 1, "canceling the draft writes nothing");
	assert.equal(f.config.roles.find((role) => role.id === "coder").description, saved);
	assert.match(f.text(120), /→ coder/);
	assert.match(f.text(120), /history/);
	f.view.dispose();
});

test("the unified pane bounds scrolling and keeps roles reachable above runs", () => {
	const f = fixture();
	const config = structuredClone(f.config);
	config.roles = Array.from({ length: 40 }, (_, index) => ({ ...config.roles[0], id: `agent-${index}` }));
	f.service.roles = () => ({ config: structuredClone(config), revision: digest(config) });
	const run = (id, status) => ({
		id,
		status,
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: "/workspace",
		task: id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	});
	f.service.runs = () => [run("active-run", "running"), run("history-run", "completed")];
	f.view.route({ view: "workflow", query: "runs" });
	f.text();
	for (const rows of [80, 32, 16, 12, 8, 4, 1]) {
		f.context.tui.terminal.rows = rows;
		for (const width of [24, 48, 80, 120]) {
			const lines = f.view.render(width);
			assert.ok(lines.length <= paletteHeightBudget(rows));
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
		}
		if (rows >= 12) assert.ok(f.view.render(48).at(-1).startsWith("╰"));
	}
	f.context.tui.terminal.rows = 80;
	const large = f.view.render(120).join("\n");
	assert.match(large, /agent-0/);
	assert.match(large, /active-run/);
	assert.ok(large.indexOf("agent-0") < large.indexOf("active-run"), "roles render before runs on a tall terminal");
	f.context.tui.terminal.rows = 12;
	assert.match(f.view.render(48).join("\n"), /→ active-run/);
	f.view.handleInput("\x1b[H");
	down(f.view, 3);
	const roleText = f.view.render(48).join("\n");
	assert.match(roleText, /→ agent-0/);
	assert.ok(f.view.render(48).length <= paletteHeightBudget(12));
	f.view.dispose();
});

test("browse reaches the last role and run, then returns to the top", () => {
	const f = fixture();
	const config = structuredClone(f.config);
	config.roles = Array.from({ length: 30 }, (_, index) => ({ ...config.roles[0], id: `agent-${index}` }));
	f.service.roles = () => ({ config: structuredClone(config), revision: digest(config) });
	const run = (id, status) => ({
		id,
		status,
		role: { id },
		model: { provider: "test", id: "model" },
		cwd: "/workspace",
		task: id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	});
	f.service.runs = () => [run("active-run", "running"), run("history-run", "completed")];
	f.context.tui.terminal.rows = 12;
	f.view.route({ view: "workflow", query: "runs" });
	f.text();
	end(f.view);
	assert.match(f.text(48), /→ history-run/, "the last run is reachable");
	assert.match(indicator(f.text(48)), /\d+-\d+\/\d+/);
	select(f, "agent-29");
	assert.match(f.text(48), /→ agent-29/, "the last role is reachable");
	home(f.view);
	const top = f.text(48);
	assert.match(top, /→ Subagents/, "Home returns to the first browse row");
	assert.match(indicator(top), /1-\d+\/\d+/);
	assert.doesNotMatch(indicator(top), /↑/);
	f.view.dispose();
});

test("browse scrolls past the last row to trailing empty-run text and back", () => {
	const f = fixture();
	const config = structuredClone(f.config);
	config.roles = Array.from({ length: 30 }, (_, index) => ({ ...config.roles[0], id: `agent-${index}` }));
	f.service.roles = () => ({ config: structuredClone(config), revision: digest(config) });
	f.context.tui.terminal.rows = 12;
	f.text();
	end(f.view);
	let text = f.text(48);
	assert.match(text, /→ \+ /);
	assert.match(indicator(text), /↓/, "the indicator shows content below the viewport");
	pageDown(f.view);
	text = f.text(48);
	assert.match(text, /No child runs/, "Page Down reaches trailing nonselectable text");
	assert.match(indicator(text), /↑/);
	assert.doesNotMatch(indicator(text), /↓/);
	pageUp(f.view);
	text = f.text(48);
	assert.match(text, /→ \+ /, "Page Up returns to the last selectable row");
	home(f.view);
	text = f.text(48);
	assert.match(text, /→ Subagents/);
	assert.match(indicator(text), /1-\d+\/\d+/);
	f.view.dispose();
});

test("definition form pages to its last action and returns to the first field", () => {
	const f = fixture();
	f.context.tui.terminal.rows = 12;
	select(f, "coder");
	enter(f.view);
	let text = f.text(48);
	assert.match(text, /→ Role ID/);
	assert.match(indicator(text), /\d+-\d+\/\d+/);
	pageDown(f.view, 10);
	text = f.text(48);
	assert.match(text, /Cancel/, "paging reaches the end of the definition form");
	enter(f.view);
	assert.match(f.text(48), /→ Role ID/, "Enter reveals the offscreen selected field without saving it");
	pageDown(f.view, 10);
	f.text(48);
	f.view.handleInput("x");
	assert.match(f.text(48), /→ Role ID/, "typing reveals an offscreen field");
	assert.equal(f.view.draft.id, "coder", "revealing an offscreen field does not edit it");
	ctrlEnd(f.view);
	assert.match(f.text(48), /→ Cancel/);
	ctrlHome(f.view);
	text = f.text(48);
	assert.match(text, /→ Role ID/);
	assert.match(indicator(text), /1-\d+\/\d+/);
	f.view.dispose();
});

test("run detail pages through nonselectable details and back to the top", () => {
	const f = fixture();
	f.context.tui.terminal.rows = 12;
	const run = {
		id: "detail-run",
		status: "completed",
		role: f.config.roles[1],
		model: { provider: "test", id: "日本語-model" },
		cwd: "/workspace/detail",
		task: "Inspect the detailed result",
		context: { mode: "summary", parentLookup: true },
		result: "Long result evidence ".repeat(8),
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 },
	};
	f.service.runs = () => [run];
	f.view.route({ view: "workflow", query: "runs" });
	f.text();
	enter(f.view);
	let text = f.text(48);
	assert.match(text, /→ Read output/);
	assert.match(indicator(text), /\d+-\d+\/\d+/);
	pageUp(f.view, 20);
	text = f.text(48);
	assert.match(text, /Run\s+─/u, "the top of the detail document is reachable");
	assert.match(text, /Agent/);
	assert.match(indicator(text), /1-\d+\/\d+/);
	pageDown(f.view, 20);
	text = f.text(48);
	assert.match(text, /Back to runs/, "the bottom of the detail document is reachable");
	assert.doesNotMatch(indicator(text), /↓/);
	f.view.dispose();
});

test("subagents toggle supports Enter, arrows and Space without leaking into edits", async () => {
	const f = fixture();
	assert.match(f.text(), /Subagents.*On/);
	select(f, "Subagents");
	assert.match(f.text(80), /Space.*toggle/);
	enter(f.view);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.service.subagentsEnabled(), false);
	assert.match(f.text(), /Subagents.*Off/);
	f.view.handleInput("\x1b[C");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.service.subagentsEnabled(), true);
	f.view.handleInput(" ");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.service.subagentsEnabled(), false);
	for (const width of [24, 48, 80, 120])
		for (const line of f.view.render(width)) assert.ok(visibleWidth(line) <= width);
	select(f, "coder");
	enter(f.view);
	f.view.handleInput(" ");
	assert.equal(f.service.subagentsEnabled(), false);
	assert.doesNotMatch(f.text(80), /Space.*toggle/);
	cancel(f.view);
	assert.equal(f.writes, 0);
});

test("disabling active children requires confirmation and handles failure and busy state", async () => {
	const f = fixture();
	f.service.runs = () => [{ id: "active", status: "running", role: { id: "coder" }, task: "task" }];
	select(f, "Subagents");
	enter(f.view);
	assert.match(f.text(80), /stop all queued and running/);
	cancel(f.view);
	assert.equal(f.service.subagentsEnabled(), true);
	enter(f.view);
	let finish;
	f.service.setSubagentsEnabled = () =>
		new Promise((_resolve, reject) => {
			finish = reject;
		});
	enter(f.view);
	assert.match(f.text(80), /Busy/);
	cancel(f.view);
	assert.equal(f.closes, 0);
	finish(new Error("Could not stop child"));
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(f.text(80), /Could not stop child/);
	assert.equal(f.service.subagentsEnabled(), true);
	cancel(f.view);
});

test("Workflow keeps definitions above an empty run list without a View choice", () => {
	const f = fixture();
	const text = f.text(120);
	assert.match(text, /Workflow/);
	assert.match(text, /orchestrator/);
	assert.match(text, /\+ Add agent/);
	assert.match(text, /Runs/);
	assert.match(text, /No child runs/);
	assert.doesNotMatch(text, /View:/);
	assert.ok(text.indexOf("orchestrator") < text.indexOf("Runs"));
	cancel(f.view);
	assert.equal(f.closes, 1);
});
test("definition edits cancel without saving and text arrows belong to the input", () => {
	const f = fixture();
	select(f, "orchestrator");
	enter(f.view);
	assert.match(f.text(), /Edit agent/);
	f.view.handleInput("x");
	f.view.handleInput("\x1b[D");
	f.view.handleInput("y");
	assert.equal(f.view.allowsGlobalNavigation(), false);
	cancel(f.view);
	assert.equal(f.writes, 0);
	assert.equal(f.config.roles[0].id, "orchestrator");
});
test("model choice searches Japanese text and Escape preserves the definition draft", () => {
	const f = fixture();
	select(f, "orchestrator");
	enter(f.view);
	down(f.view, 2);
	enter(f.view);
	assert.match(f.text(), /Search/);
	f.view.handleInput("日本");
	assert.match(f.text(), /Test/);
	enter(f.view);
	assert.match(f.text(), /Edit agent/);
	assert.equal(f.writes, 0);
	down(f.view, 8);
	enter(f.view);
	assert.equal(f.writes, 1);
	assert.equal(f.config.roles[0].model, "test/日本語-model");
});
test("catalog model names lead selection while saved selectors remain exact", () => {
	const f = fixture();
	const provider = "catalog:office:local:8f5c5bb9e126e978";
	f.service.models = () => [{ provider, id: "deepseek-flash", name: "DeepSeek Flash 日本語" }];
	select(f, "orchestrator");
	enter(f.view);
	down(f.view, 2);
	enter(f.view);
	f.view.handleInput("DeepSeek");
	assert.match(f.text(80), /DeepSeek Flash 日本語/);
	assert.doesNotMatch(f.text(80), /catalog:|8f5c/);
	for (const width of [24, 48, 80, 120]) assert.ok(f.view.render(width).every((line) => visibleWidth(line) <= width));
	enter(f.view);
	assert.match(f.text(80), /DeepSeek Flash 日本語/);
	assert.equal(f.writes, 0);
	down(f.view, 8);
	enter(f.view);
	assert.equal(f.config.roles[0].model, `${provider}/deepseek-flash`);
	assert.match(f.text(80), /DeepSeek Flash 日本語/);
});

test("the model picker offers the same-as-session selector and saves its literal value", () => {
	const f = fixture();
	select(f, "orchestrator");
	enter(f.view);
	down(f.view, 2);
	enter(f.view);
	assert.match(f.text(), /Same as this session/u);
	assert.match(f.text(), /same/u);
	enter(f.view);
	assert.match(f.text(), /Edit agent/u);
	down(f.view, 8);
	enter(f.view);
	assert.equal(f.writes, 1);
	assert.equal(f.config.roles[0].model, "same");
});
test("all rendered rows fit narrow and wide terminals including model search and forms", () => {
	const f = fixture();
	for (const stage of [0, 1, 2]) {
		if (stage === 1) {
			select(f, "orchestrator");
			enter(f.view);
		}
		if (stage === 2) {
			down(f.view, 2);
			enter(f.view);
			f.view.handleInput("日本");
		}
		for (const width of [8, 24, 48, 80, 120])
			for (const line of f.view.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
	}
});
test("external routing and Tab cannot discard an active definition edit", () => {
	const f = fixture();
	const router = new JouzuPaletteRouter({
		context: f.context,
		initialRoute: { view: "workflow" },
		factories: {
			workflow: () => f.view,
			models: () => ({ render: () => ["model view"], invalidate() {}, route() {} }),
		},
	});
	select(f, "orchestrator");
	enter(f.view);
	router.handleInput("\t");
	assert.match(router.render(48).join("\n"), /Edit agent/);
	router.route({ view: "models" });
	assert.match(router.render(48).join("\n"), /Edit agent/);
	assert.equal(f.writes, 0);
	cancel(f.view);
	router.handleInput("\t");
	assert.equal(router.render(48)[0], "model view");
});
test("hints use rebound primary and cancel keys", () => {
	const f = fixture();
	f.context.keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
		"tui.select.confirm": ["ctrl+y"],
		"tui.select.cancel": ["ctrl+x"],
	});
	const text = f.text();
	assert.match(text, /Ctrl\+Y/);
	assert.match(text, /Ctrl\+X/);
});

test("unsaved definitions cannot launch or apply, and Save keeps its receipt", () => {
	const f = fixture();
	select(f, "orchestrator");
	enter(f.view);
	f.view.handleInput("x");
	down(f.view, 11);
	enter(f.view);
	assert.match(f.text(80), /Save or cancel your edits/);
	assert.equal(f.writes, 0);
	f.view.handleInput("\x1b[A");
	enter(f.view);
	assert.equal(f.writes, 1);
	assert.match(f.text(80), /Saved/);
});
test("multiline instructions stay in the enclosing draft and fit a short terminal", () => {
	const f = fixture();
	f.context.tui.terminal.rows = 16;
	select(f, "reviewer");
	enter(f.view);
	down(f.view, 9);
	enter(f.view);
	assert.match(f.text(80), /Edit instructions/);
	f.view.handleInput("\r");
	f.view.handleInput("Additional instruction");
	assert.ok(f.view.render(48).length <= 16);
	cancel(f.view);
	assert.match(f.text(), /Edit agent/);
	assert.equal(f.writes, 0);
	cancel(f.view);
	assert.equal(f.writes, 0);
});

test("model search receives the hardware cursor marker while focused", () => {
	const f = fixture();
	select(f, "orchestrator");
	enter(f.view);
	down(f.view, 2);
	enter(f.view);
	assert.match(f.text(), /Search/);
	assert.ok(
		f.text().includes(CURSOR_MARKER),
		"the focused model search renders the hardware cursor marker for IME anchoring",
	);
	f.view.focused = false;
	assert.ok(!f.text().includes(CURSOR_MARKER), "an unfocused palette drops the cursor marker from the search field");
	f.view.focused = true;
	cancel(f.view);
	assert.match(f.text(), /Edit agent/);
	assert.ok(!f.text().includes(CURSOR_MARKER), "exiting the search to the Model row drops the cursor marker");
	enter(f.view);
	assert.match(f.text(), /Search/);
	assert.ok(f.text().includes(CURSOR_MARKER), "reopening the model search restores the cursor marker");
});

test("every run status stays fully visible beside unbounded metadata at 48 columns", () => {
	const f = fixture();
	const statuses = ["queued", "starting", "running", "completed", "failed", "cancelled", "interrupted"];
	const longIdentity = "とても長いエージェント識別子".repeat(3);
	const longTool = "非常に長いツール名".repeat(6);
	const longTask = "長い割り当て。".repeat(24);
	const runFor = (status, meta) => ({
		id: `fixture-${status}-${meta}`,
		role: { id: longIdentity },
		model: { provider: "fixture", id: "test" },
		status,
		...(meta === "currentTool" ? { currentTool: longTool, task: "Inspect" } : { task: longTask }),
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: null },
	});
	f.service.runs = () => [runFor("queued", "task")];
	f.view.route({ view: "workflow", query: "runs" });
	f.text();
	for (const status of statuses) {
		for (const meta of ["currentTool", "task"]) {
			f.service.runs = () => [runFor(status, meta)];
			const lines = f.view.render(48);
			const text = lines.join("\n");
			assert.ok(text.includes(status), `48: ${status} stays fully visible with a long ${meta} and CJK identity`);
			for (const line of lines) assert.ok(visibleWidth(line) <= 48, `48: ${line}`);
			if (status === "interrupted") {
				const metaText = meta === "currentTool" ? longTool : longTask;
				assert.ok(text.includes(metaText.slice(0, 4)), "metadata still renders when spare space allows");
				for (const width of [24, 80, 120]) {
					for (const line of f.view.render(width)) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
				}
			}
		}
	}
});

test("Runs opens output, requires Stop confirmation, and exposes Resume after cancellation", async () => {
	const f = fixture();
	let stops = 0;
	const run = {
		id: "fixture-run",
		role: f.config.roles[1],
		model: { provider: "fixture", id: "test" },
		status: "running",
		task: "Inspect fixture",
		cwd: "/workspace/fixture",
		usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: null },
	};
	f.service.runs = () => [run];
	f.service.read = () => ({
		text: JSON.stringify({ type: "message", role: "assistant", text: "Output evidence" }),
		nextOffset: null,
		totalBytes: 80,
	});
	f.service.stop = async () => {
		stops++;
		run.status = "cancelled";
	};
	f.view.route({ view: "workflow", query: "runs" });
	enter(f.view);
	assert.match(f.text(80), /Read output/);
	enter(f.view);
	assert.match(f.text(80), /Output evidence/);
	cancel(f.view);
	down(f.view, 2);
	enter(f.view);
	assert.match(f.text(80), /Changes already made remain/);
	assert.equal(stops, 0);
	cancel(f.view);
	down(f.view, 2);
	enter(f.view);
	enter(f.view);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(stops, 1);
	assert.match(f.text(80), /Resume with a task/);
});

test("concurrency and child-writer settings save from the unified browse pane", () => {
	const f = fixture();
	select(f, "Concurrency");
	assert.match(f.text(80), /Concurrency.*4/);
	assert.match(f.text(80), /1–32/);
	enter(f.view);
	assert.match(f.text(80), /Concurrency/);
	f.view.handleInput("\x7f");
	f.view.handleInput("6");
	enter(f.view);
	assert.equal(f.writes, 1);
	assert.equal(f.config.maxConcurrent, 6);
	assert.match(f.text(80), /Concurrency set to 6/);
	select(f, "Concurrency");
	enter(f.view);
	f.view.handleInput("\x7f");
	f.view.handleInput("33");
	enter(f.view);
	assert.equal(f.writes, 1, "an out-of-range value is rejected before it reaches storage");
	assert.equal(f.config.maxConcurrent, 6);
	assert.match(f.text(80), /Concurrent agents must be 1–32/);
	cancel(f.view);
	select(f, "Child writers");
	assert.match(f.text(80), /In parallel/);
	enter(f.view);
	assert.equal(f.config.workspaceWriters, "serialize");
	assert.match(f.text(80), /One at a time/);
	f.view.handleInput("\x1b[C");
	assert.equal(f.config.workspaceWriters, "parallel");
	f.view.dispose();
});

test("the assignment form defaults to the parent workspace and passes a chosen one", async () => {
	const f = fixture();
	f.service.launch = async (id, task, options) => {
		const run = {
			id: "fixture-run",
			role: f.config.roles.find((role) => role.id === id),
			model: { provider: "fixture", id: "test" },
			status: "queued",
			task,
			cwd: options?.workspace ?? "/workspace/parent",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null },
		};
		f.launches.push({ id, task, options });
		f.service.runs = () => [run];
		return run;
	};
	select(f, "coder");
	enter(f.view);
	down(f.view, 11);
	enter(f.view);
	assert.match(f.text(120), /Workspace.*\/workspace\/parent/);
	assert.match(f.text(120), /default/);
	enter(f.view);
	f.view.handleInput("Do the work");
	cancel(f.view);
	down(f.view);
	enter(f.view);
	assert.match(f.text(80), /Edit workspace/);
	f.view.handleInput("\x15");
	f.view.handleInput("../other-worktree");
	cancel(f.view);
	assert.match(f.text(120), /other-worktree/);
	down(f.view, 2);
	enter(f.view);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(f.launches, [{ id: "coder", task: "Do the work", options: { workspace: "../other-worktree" } }]);
	assert.match(f.text(120), /Run/);
	f.view.dispose();
});

for (const [locale, sameLabel, thinkingLabel] of [
	["en", "Same as main", "Thinking"],
	["ja", "メインと同じ", "思考"],
]) {
	test(`Thinking inheritance cycles, cancels, and saves in ${locale}`, () => {
		const f = fixture(resolveCatalog(locale).bundle);
		select(f, "coder");
		enter(f.view);
		down(f.view, 6);
		assert.ok(f.text().includes(sameLabel));
		f.view.handleInput("\x1b[C");
		assert.match(f.text(), new RegExp(`${thinkingLabel}.*off`, "u"));
		cancel(f.view);
		assert.equal(f.writes, 0);
		select(f, "coder");
		enter(f.view);
		down(f.view, 6);
		f.view.handleInput("\x1b[D");
		assert.match(f.text(), new RegExp(`${thinkingLabel}.*max`, "u"));
		f.view.handleInput("\x1b[C");
		assert.ok(f.text().includes(sameLabel));
		for (const width of [24, 48, 80]) assert.ok(f.view.render(width).every((line) => visibleWidth(line) <= width));
		down(f.view, 4);
		enter(f.view);
		assert.equal(f.writes, 1);
		assert.equal(f.config.roles.find((role) => role.id === "coder").thinking, "same");
		assert.equal(f.config.roles.find((role) => role.id === "coder").model, "same");
		f.view.dispose();
	});
}
