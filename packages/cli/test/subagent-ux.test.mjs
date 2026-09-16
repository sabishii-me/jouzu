import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { catalogRuntimeProvider } from "../dist/model-catalog-projection.js";
import { agentModelDisplay, agentModelSelectorLabel } from "../dist/subagents/model-display.js";
import { parseSubagentResult, subagentComponent } from "../dist/subagents/render.js";

const plain = { fg: (_role, value) => value };
const provider = catalogRuntimeProvider("office", "local", "https://example.com");
const model = { provider, id: "deepseek-flash", name: "DeepSeek Flash 日本語" };

test("friendly labels retain exact selectors and readable catalog source", () => {
	assert.equal(agentModelDisplay(model).name, model.name);
	assert.equal(agentModelDisplay(model).source, "local · office");
	assert.equal(agentModelSelectorLabel(`${provider}/${model.id}`, [model]), model.name);
	assert.equal(agentModelSelectorLabel(model.id, [model]), model.name);
	assert.equal(agentModelSelectorLabel("same", [model]), "Same as this session");
	assert.equal(agentModelSelectorLabel(`${provider}/${model.id}`, []), "local/deepseek-flash");
	assert.equal(agentModelSelectorLabel("unknown", []), "unknown");
	assert.equal(agentModelDisplay({ ...model, name: [] }).name, model.id);
	assert.equal(agentModelDisplay({ provider: "", id: "" }).label, "");
	for (const value of [
		{ id: "run", role: "coder", model, status: "running" },
		{ roles: [{ id: "coder", model: `${provider}/${model.id}`, modelLabel: model.name }] },
	]) {
		const compact = subagentComponent(value, plain).render(120).join("\n");
		assert.match(compact, /DeepSeek Flash 日本語/);
		assert.doesNotMatch(compact, /catalog:/);
		assert.match(subagentComponent(value, plain, true).render(120).join("\n"), /catalog:office:local:/);
	}
});

const events = [
	{ type: "ready", sessionFile: "/private/session", sessionId: "hidden" },
	{ type: "message", role: "assistant", text: "" },
	{ type: "usage", input: 850, output: 2956, cacheRead: 123328 },
	{ type: "activity", tool: "read" },
	{ type: "activity", tool: "read" },
	{ type: "activity", tool: "bash" },
	{ type: "message", role: "tool:read", text: "giant blob".repeat(100) },
	{ type: "message", role: "assistant", text: "Checking 日本語 tests." },
];
const page = {
	text: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
	nextOffset: 324699,
	totalBytes: 400000,
};

test("read previews summarize activity and assistant messages instead of event JSON", () => {
	const content = [{ type: "text", text: JSON.stringify(page) }];
	const parsed = parseSubagentResult(content);
	assert.deepEqual(parsed, page, "JSON parsing preserves record boundaries and original content");
	const compact = subagentComponent(parsed, plain, false, "read").render(80).join("\n");
	assert.match(compact, /8 events/);
	assert.match(compact, /read × 2 · bash × 1/);
	assert.match(compact, /Assistant: Checking 日本語 tests/);
	assert.match(compact, /More output available/);
	assert.doesNotMatch(compact, /giant blob|cacheRead|324699|private|sessionId|\{"/);
	const expanded = subagentComponent(parsed, plain, true, "read").render(80).join("\n");
	assert.match(expanded, /Child session ready/);
	assert.match(expanded, /tool:read · output received/);
	assert.match(expanded, /Next byte offset: 324699/);
	assert.doesNotMatch(expanded, /giant blob|cacheRead|private|\{"/);
});

test("read previews retain terminal outcomes and separate multiline message words", () => {
	const value = {
		...page,
		text: "partial record",
		terminal: { status: "failed", summary: "Tests failed.\nFix the parser." },
	};
	const output = subagentComponent(value, plain, false, "read").render(80).join("\n");
	assert.match(output, /Failed/);
	assert.match(output, /Tests failed\. Fix the parser\./);
	const multiline = { ...page, text: JSON.stringify({ type: "message", role: "assistant", text: "One\nTwo\tThree" }) };
	assert.match(subagentComponent(multiline, plain, false, "read").render(80).join("\n"), /One Two Three/);
	const lifecycle = {
		...page,
		text: [
			{ type: "task", text: "Inspect changes" },
			{ type: "steer", status: "accepted" },
			{ type: "terminal", status: "failed" },
		]
			.map((event) => JSON.stringify(event))
			.join("\n"),
	};
	const expanded = subagentComponent(lifecycle, plain, true, "read").render(80).join("\n");
	assert.match(expanded, /Assignment: Inspect changes/);
	assert.match(expanded, /Message: accepted/);
	assert.match(expanded, /Failed/);
});

test("read previews tolerate partial records, empty output, results and hostile strings", () => {
	const partial = { ...page, text: `tail of a split record"}\n${page.text}{"type":"message","text":"partial` };
	assert.match(subagentComponent(partial, plain, false, "read").render(80).join("\n"), /Partial records omitted/);
	const noComplete = { text: "middle of a large tool record", nextOffset: 24000, totalBytes: 30000 };
	const empty = { text: "No output yet.", nextOffset: null, totalBytes: 0 };
	assert.match(subagentComponent(empty, plain, false, "read").render(80).join("\n"), /No output yet/);
	const result = {
		text: JSON.stringify({ type: "result", status: "failed", text: "Tests failed 日本語👩🏽‍💻\x1b]52;c;secret\x07" }),
		nextOffset: null,
		totalBytes: 100,
	};
	assert.match(subagentComponent(result, plain, false, "read").render(80).join("\n"), /Failed: Tests failed/);
	for (const value of [page, partial, noComplete, empty, result]) {
		for (const expanded of [false, true]) {
			for (const width of [1, 10, 24, 48, 80, 120]) {
				const lines = subagentComponent(value, plain, expanded, "read").render(width);
				assert.ok(lines.every((line) => visibleWidth(line) <= width));
				assert.ok(lines.every((line) => !line.includes("\x1b")));
			}
		}
	}
});
