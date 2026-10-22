import assert from "node:assert/strict";
import { test } from "node:test";
import { createFastModeExtension, FAST_MODE_STATUS } from "../dist/fast-mode.js";
import { loadCatalog } from "../dist/locale-catalog.js";
import { renderScrollbackTranscript } from "../dist/scrollback.js";
import {
	createSessionUiStyles,
	renderSessionLine,
	sessionUiText,
	terminalTextWidth,
} from "../dist/session-ui/index.js";
import { assembledSession, capturedNotices } from "./fixtures/flow-assembly.mjs";

const catalog = loadCatalog("ja");

test("Japanese Fast mode notices preserve persisted state and priority request payloads", async () => {
	const handlers = new Map();
	const commands = new Map();
	const entries = [];
	const statuses = new Map();
	const notices = [];
	const model = { id: "gpt-example", api: "openai-responses" };
	const ctx = {
		model,
		mode: "tui",
		isIdle: () => true,
		sessionManager: { getBranch: () => entries },
		ui: { setStatus: (key, value) => statuses.set(key, value), notify: (value) => notices.push(value) },
	};
	createFastModeExtension(catalog).factory({
		on: (key, value) => handlers.set(key, value),
		registerCommand: (key, value) => commands.set(key, value),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	});
	await commands.get("fast").handler("on", ctx);
	assert.match(notices.at(-1), /利用料金が高く/u);
	assert.equal(statuses.get(FAST_MODE_STATUS), "on");
	const payload = { model: model.id, input: [] };
	assert.deepEqual(handlers.get("before_provider_request")({ request: { model }, payload }, ctx), {
		...payload,
		service_tier: "priority",
	});
	assert.equal(payload.service_tier, undefined);
	await commands.get("fast").handler("off", ctx);
	assert.match(notices.at(-1), /無効/u);
	assert.deepEqual(
		entries.map((entry) => entry.data.enabled),
		[true, false],
	);
});

test("Japanese flow reset still requires explicit confirmation and leaves later prompts usable", async (t) => {
	const f = await assembledSession(t, { catalog });
	const notices = capturedNotices(f.session);
	await f.session.prompt("First request");
	await f.session.prompt("/flow reset");
	assert.match(notices.at(-1).text, /まず \/flow clear/u);
	assert.match(notices.at(-1).text, /\/flow reset confirm/u);
	await f.session.prompt("/flow reset confirm");
	assert.match(notices.at(-1).text, /フローをリセットしました/u);
	await f.session.prompt("After reset");
	assert.equal(f.bodies.length, 2);
	assert.equal(f.session.agent.state.errorMessage, undefined);
});

test("Japanese Fast mode stays visible in narrow session lines", () => {
	const theme = { fg: (_role, value) => value, bg: (_role, value) => value, bold: (value) => value };
	const styles = createSessionUiStyles(theme, { colorEnabled: false });
	const snapshot = { model: { providerId: "openai", modelId: "a-long-model-name", thinkingLevel: "high" } };
	for (const width of [12, 24, 48, 80]) {
		const line = renderSessionLine(snapshot, [], width, styles, sessionUiText(catalog), undefined, undefined, true);
		assert.equal(terminalTextWidth(line), width);
		assert.match(line, /高速/u);
	}
});

test("Japanese transcript export localizes labels without translating stored tool content", () => {
	const entries = [
		{
			type: "message",
			message: { role: "toolResult", toolName: "read", isError: true, content: "Exact stored output 日本語" },
		},
	];
	for (const width of [24, 48, 80]) {
		const output = renderScrollbackTranscript(entries, {
			width,
			catalog,
			sessionId: "session-id",
			exportedAt: new Date(0),
		});
		assert.ok(output.lines.every((line) => terminalTextWidth(line) <= width));
		const text = output.lines.join("\n");
		assert.match(text.replace(/\n/gu, ""), /ツール結果: read（エラー）/u);
		assert.match(text, /Exact stored output/u);
		assert.match(text, /session-id/u);
		assert.doesNotMatch(text, /Tool result:/u);
	}
});
