import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createSessionUiStyles,
	renderSessionLine,
	SessionLineComponent,
	SessionStatusController,
	selectSessionUiHint,
	sessionActivityGlyph,
	terminalTextWidth,
} from "../dist/index.js";

const styles = createSessionUiStyles({ fg: (_role, value) => value }, { colorEnabled: false });

function snapshot(overrides = {}) {
	return {
		schemaVersion: 1,
		observedAt: 1,
		workspace: { label: "work" },
		activity: { idle: true, idleSince: 1 },
		model: {
			providerId: "codex",
			modelId: "gpt-5.6-sol",
			displayName: "GPT-5.6 Sol",
			thinkingLevel: "xhigh",
			scopedModelCount: 0,
		},
		context: { status: "unknown", observedAt: 1 },
		usage: {
			status: "known",
			observedAt: 1,
			value: { scope: "active_branch", inputTokens: 0, outputTokens: 0, unknownMessageCount: 0 },
		},
		git: { status: "unknown", observedAt: 1 },
		runtime: { status: "unknown", observedAt: 1 },
		...overrides,
	};
}

const hints = [
	{ id: "default", text: "Ctrl+L models", priority: 10, role: "muted" },
	{ id: "warning", text: "! recovery needed", priority: 100, role: "warning" },
];

test("selects one deterministic priority hint", () => {
	assert.equal(selectSessionUiHint(hints).id, "warning");
	assert.equal(
		selectSessionUiHint([
			{ ...hints[0], id: "z" },
			{ ...hints[0], id: "a" },
		]).id,
		"a",
	);
});

test("applies separate semantic styles to the hint, provider, and model identity", () => {
	const applied = [];
	const tracingStyles = {
		scheme: styles.scheme,
		apply(role, value) {
			applied.push({ role, value });
			return value;
		},
	};
	renderSessionLine(snapshot(), hints, 64, tracingStyles);
	assert.deepEqual(
		applied.map(({ role }) => role),
		["session.provider", "session.model", "session.hint.warning"],
	);
});

test("protects model identity and drops the left hint before overlap", () => {
	const wide = renderSessionLine(snapshot(), hints, 64, styles);
	assert.equal(terminalTextWidth(wide), 64);
	assert.match(wide, /^! recovery needed/);
	assert.match(wide, /Codex gpt-5\.6-sol \(xhigh\)$/);
	const narrow = renderSessionLine(snapshot(), hints, 27, styles);
	assert.equal(terminalTextWidth(narrow), 27);
	assert.doesNotMatch(narrow, /recovery/);
	assert.match(narrow, /Codex gpt-5\.6-sol/);
});

test("keeps CJK labels width-safe and strips terminal controls", () => {
	const rendered = renderSessionLine(
		snapshot({
			model: {
				providerId: "危険\u001b[31m",
				modelId: "提供者/日本語モデル\n",
				thinkingLevel: "high\t",
				scopedModelCount: 0,
			},
		}),
		[{ id: "hint", text: "モデルを選択", priority: 1, role: "accent" }],
		48,
		styles,
	);
	assert.equal(terminalTextWidth(rendered), 48);
	assert.match(rendered, /モデルを選択/);
	assert.match(rendered, /日本語モデル/);
	assert.equal(rendered.includes("\u001b"), false);
	assert.equal(rendered.includes("\n"), false);
	assert.equal(rendered.includes("\t"), false);
});

test("catalog provider connections retain the readable provider and model in the session line", () => {
	const value = snapshot({
		model: { providerId: "catalog:ai.example.pool:lunaroute:0123456789abcdef", modelId: "glm-5.3" },
	});
	for (const width of [48, 80, 120]) {
		const line = renderSessionLine(value, [], width, styles);
		assert.match(line, /Lunaroute glm-5\.3/);
		assert.doesNotMatch(line, /catalog:|0123456789abcdef/);
		assert.equal(terminalTextWidth(line), width);
	}
});

const runningActivity = { text: "multiloop: 1 running", active: true };

test("activity replaces the hint and styles work by whether it is moving", () => {
	const applied = [];
	const tracingStyles = {
		scheme: styles.scheme,
		apply(role, value) {
			applied.push({ role, value });
			return value;
		},
	};
	const rendered = renderSessionLine(snapshot(), hints, 64, tracingStyles, runningActivity);
	assert.equal(terminalTextWidth(rendered), 64);
	assert.match(rendered, /^⠋ multiloop: 1 running/);
	assert.doesNotMatch(rendered, /recovery/);
	assert.match(rendered, /Codex gpt-5\.6-sol \(xhigh\)$/);
	assert.deepEqual(
		applied.map(({ role }) => role),
		["session.provider", "session.model", "session.activity"],
	);
	const paused = renderSessionLine(snapshot(), hints, 64, tracingStyles, {
		text: "multiloop: 1 paused",
		active: false,
	});
	assert.match(paused, /^○ multiloop: 1 paused/);
	assert.equal(applied.at(-1).role, "session.activity.idle");
});

test("uses the supplied animation frame and wraps frames deterministically", () => {
	assert.equal(sessionActivityGlyph(runningActivity, 2), "⠹");
	assert.equal(sessionActivityGlyph(runningActivity, 12), "⠹");
	assert.equal(sessionActivityGlyph({ text: "multiloop: 1 paused", active: false }, 7), "○");
	assert.match(renderSessionLine(snapshot(), [], 60, styles, runningActivity, "⠹"), /^⠹ multiloop: 1 running/);
});

test("keeps activity readable at narrow widths and sanitizes extension status text", () => {
	const truncated = renderSessionLine(snapshot(), hints, 48, styles, runningActivity);
	assert.equal(terminalTextWidth(truncated), 48);
	assert.match(truncated, /^⠋ multiloop: 1 runni…/);
	const dropped = renderSessionLine(snapshot(), hints, 40, styles, runningActivity);
	assert.doesNotMatch(dropped, /multiloop/);
	assert.match(dropped, /Codex gpt-5\.6-sol \(xhigh\)$/);
	for (const width of [24, 48, 80, 120]) {
		const line = renderSessionLine(snapshot(), [], width, styles, {
			text: "multiloop: 1 running 日本語\n\u001b[31m",
			active: true,
		});
		assert.equal(terminalTextWidth(line), width);
		assert.equal(line.includes("\n"), false);
		assert.equal(line.includes("\u001b"), false);
	}
});

function componentContext(idle) {
	return {
		cwd: "/tmp/work",
		model: { provider: "codex", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 200_000 },
		thinkingLevel: "xhigh",
		scopedModels: [],
		isIdle: () => idle,
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200_000, percent: 1 }),
		sessionManager: { getBranch: () => [] },
	};
}

test("animates only while work moves and the session is idle", async () => {
	let renders = 0;
	let activity = { ...runningActivity };
	const controller = new SessionStatusController({
		run: async () => ({ stdout: "", stderr: "", code: 1, killed: false }),
	});
	controller.sync(componentContext(true));
	const component = new SessionLineComponent(
		controller,
		styles,
		() => hints,
		() => {
			renders += 1;
		},
		() => activity,
		5,
	);
	const first = component.render(60)[0];
	assert.match(first, /^⠋ multiloop: 1 running/);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.notEqual(component.render(60)[0], first, "the frame advances while work moves");

	controller.sync(componentContext(false));
	component.render(60);
	const frozen = component.render(60)[0];
	const settled = renders;
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(renders, settled, "a streaming session leaves the marker to Pi's working indicator");
	assert.equal(component.render(60)[0], frozen);

	controller.sync(componentContext(true));
	activity = { text: "multiloop: 1 paused", active: false };
	assert.match(component.render(60)[0], /^○ multiloop: 1 paused/);
	const paused = renders;
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(renders, paused, "paused work does not animate");

	activity = { ...runningActivity };
	component.render(60);
	component.dispose();
	const disposed = renders;
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(renders, disposed, "dispose stops the timer");
	controller.dispose();
});
