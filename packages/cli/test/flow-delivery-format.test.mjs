import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT, setValue, value } from "@earendil-works/pi-agent-core";
import { createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { renderFlowMessage } from "../dist/flow-control/flow-message-renderer.js";
import { createFlowStatusExtension } from "../dist/flow-control/flow-status-extension.js";
import { openLocalFlowSession } from "../dist/flow-control/local-storage.js";
import { FlowModelInput, inspectPersistedFlowInput } from "../dist/flow-control/model-input.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { buildFlowResultEnvelope } from "../dist/flow-control/result-envelope.js";
import { createFlowWaitDecisionProducer, observedFlowWaits } from "../dist/flow-control/wait-decisions.js";
import { createFlowWait } from "../dist/flow-control/wait-state.js";
import { observedWaitToolReceipt, waitToolResponse } from "../dist/flow-control/wait-tool-response.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = { sessionId: "session", branchId: "branch" };
const handle = {
	producer: "bg",
	handle: "job",
	execution: "exec",
	until: "exit",
};
const declaration = {
	scope,
	workId: "work",
	token: "wait",
	reason: "exit",
	mode: "all",
	on: [handle],
	expiresAt: 100,
};
const terminal = () => createFlowWait(declaration, [{ ...handle, scope, workId: "work", state: "satisfied" }], 3, 100);
const theme = { fg: (_role, text) => text };
const render = (content, expanded = false, width = 120) =>
	renderFlowMessage({ content }, { expanded, outputPad: 1 }, theme).render(width);
const frame = (kind, content) => ({
	type: "text",
	text: JSON.stringify({
		flowInput: ["jouzu-flow", "a", "i", "1"],
		kind,
		content,
	}),
});

for (const kind of ["work", "user", "alert", "wait", "result"])
	test(`composition preserves source data for ${kind}`, () => {
		const source = ' { "number": 9007199254740993, "duplicate": 1, "duplicate": 2, "huge": 1e400 } ';
		const input = FlowModelInput.compose("a", [{ id: "i", revision: "1", kind, text: source }], 4096);
		const text = input.content[0].text;
		if (["wait", "result"].includes(kind)) assert.ok(text.includes(`"content":${source}`));
		else assert.equal(JSON.parse(text).content, source);
		assert.equal(input.bytes, Buffer.byteLength(JSON.stringify(input.content)));
		assert.deepEqual(
			inspectPersistedFlowInput("a", input.members, input.content).map((r) => r.disposition),
			["included"],
		);
		const changed = input.content;
		changed[0].text = text.replace("9007199254740993", "9007199254740992");
		assert.equal(input.inspect([{ role: "user", content: changed }])[0].disposition, "replaced");
	});

for (const source of ["[1,2]", "null", "42", '"text"', "not JSON", "{bad"])
	test(`non-object result remains text: ${source}`, () => {
		const input = FlowModelInput.compose("a", [{ id: "i", revision: "1", kind: "result", text: source }], 4096);
		assert.equal(JSON.parse(input.content[0].text).content, source);
	});

test("registered custom delivery persists and converts identical text and image parts", async (t) => {
	const extension = createFlowStatusExtension({
		ingress: () => {
			throw new Error("unused");
		},
	});
	const { session, requests } = await createFlowSession(t, {
		persist: true,
		extensions: [extension],
	});
	await session.bindExtensions({
		onError: (error) => {
			throw error;
		},
	});
	const input = FlowModelInput.compose(
		"a",
		[
			{
				id: "i",
				revision: "1",
				kind: "work",
				text: "Inspect this image",
				images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
			},
		],
		4096,
	);
	session.agent.followUp({
		role: "custom",
		customType: "jouzu-flow",
		content: input.content,
		details: { attemptId: "a" },
		display: true,
		timestamp: 1,
	});
	await session.continueQueued();
	const saved = session.sessionManager.getBranch().find((entry) => entry.type === "custom_message");
	assert.equal(saved.customType, "jouzu-flow");
	assert.equal(saved.display, true);
	assert.deepEqual(saved.content, input.content);
	assert.deepEqual(requests[0][0].content, input.content);
	assert.equal(requests[0][0].role, "user");
	assert.equal(input.inspect(requests[0])[0].disposition, "included");
});

test("result rendering counts hidden samples and preserves warnings and cancelled status", async () => {
	const members = Array.from({ length: 7 }, (_, i) => ({
		id: `r${i}`,
		producer: "bg",
		execution: `e${i}`,
		revision: "1",
		status: i === 0 ? "cancelled" : "success",
		title: `日本語 👩🏽‍💻 ${i}`,
		reference: `ref${i}`,
		warnings: i === 1 ? ["Needs review"] : [],
	}));
	const { item } = await buildFlowResultEnvelope({
		attemptId: "a",
		runMembers: [],
		id: "i",
		revision: "1",
		members,
		producerOrder: ["bg"],
		maxBytes: 20000,
		retain: async () => `flow-results:${"a".repeat(64)}`,
	});
	const input = FlowModelInput.compose("a", [item], 20000);
	const before = structuredClone(input.content);
	const lines = render(input.content);
	assert.match(lines.join("\n"), /\+3 more results/);
	assert.match(lines.join("\n"), /1 result with warnings/);
	assert.match(lines.join("\n"), /Completion does not imply review approval/);
	assert.match(lines.join("\n"), /⊘ 日本語/);
	for (const width of [12, 48, 80])
		for (const line of render(input.content, true, width)) assert.ok(terminalTextWidth(line) <= width);
	assert.ok(render(input.content, true, 20000).join("\n").includes(input.content[0].text));
	assert.deepEqual(input.content, before);
});

for (const content of [
	{ wait: null },
	{ wait: { state: "resolved", observations: [null] } },
	{ sample: null },
	{ sample: "wrong" },
	{ sample: [null] },
	42,
])
	test(`malformed envelope falls back to source text: ${JSON.stringify(content)}`, () => {
		for (const kind of ["wait", "result"]) {
			const part = frame(kind, content);
			assert.ok(render([part], false, 1000).join("\n").includes(part.text));
		}
	});

test("rendering sanitizes external terminal controls while keeping source bytes", () => {
	const payload = "\u001b]52;c;clipboard\u0007text\u001b[2J";
	const part = frame("work", payload);
	const before = structuredClone(part);
	const lines = render([part, { type: "image", mimeType: "image/png" }]);
	assert.match(lines.join("\n"), /▶ work text/);
	assert.match(lines.join("\n"), /\[image: image\/png\]/);
	assert.ok(!lines.join("\n").includes("\u001b"));
	assert.deepEqual(part, before);
});

test("wait summary carries cancellation identity and supports all retained clock values", () => {
	const wait = terminal();
	const response = waitToolResponse(wait);
	assert.match(response.content[0].text, /agent_wait resolved \[wait\]/);
	assert.match(response.content[0].text, /job \(bg\/exit\)/);
	assert.equal(response.details.token, wait.token);
	assert.deepEqual(response.details.on, wait.on);
	assert.deepEqual(response.details.observations, wait.observations);
	assert.match(response.content[0].text, /job \(bg\/exit\): satisfied/);
	assert.match(response.content[0].text, /mode all/);
	response.details.on[0].handle = "changed";
	assert.equal(wait.on[0].handle, "job");
	const mixed = {
		...wait,
		state: "failed",
		observations: [...wait.observations, { ...wait.observations[0], handle: "failed-job", state: "failed" }],
	};
	assert.match(waitToolResponse(mixed).content[0].text, /failed-job \(bg\/exit\): failed/);
	assert.doesNotThrow(() =>
		waitToolResponse({
			...wait,
			checkAt: Number.MAX_SAFE_INTEGER - 1,
			expiresAt: Number.MAX_SAFE_INTEGER,
		}),
	);
});

for (const format of [1, 2, 3])
	for (const tamper of [false, true])
		test(`wait store reopens format ${format} receipts and rejects corruption: ${tamper}`, async (t) => {
			const root = await mkdtemp(join(tmpdir(), "jouzu-format-reopen-"));
			let storage;
			let attachment = await PiFlowAttachment.open(
				root,
				scope,
				async (directory) => (storage = await openLocalFlowSession(directory)),
			);
			t.after(async () => {
				await attachment.close();
				await rm(root, { recursive: true, force: true });
			});
			await attachment.waits.registerWork("work", "bg", 1);
			await attachment.waits.registerExecution(
				{
					...handle,
					workId: "work",
					revision: 1,
					predicates: [{ until: "exit", state: "satisfied" }],
				},
				1,
				2,
			);
			const wait = await attachment.waits.declareOwned("bg", 1, declaration, 3, 100, undefined, undefined, {
				toolCallId: "call",
				toolName: "agent_wait",
			});
			const details = {
				token: "wait",
				scope,
				work: "work",
				state: "resolved",
				reason: "exit",
				expiresAt: 100,
				health: "deadline-only",
				unmet: [],
			};
			const content =
				format === 1 ? [{ type: "text", text: JSON.stringify(details) }] : waitToolResponse(wait, format).content;
			await storage.mutate(async (writer, context) => {
				const address = value("jouzu.flow.waits", "v1");
				const state = (await writer.getValue(address, context)).value;
				state.toolReceipts[0].contentHash = tamper ? "0".repeat(64) : sha(content);
				await writer.commit([setValue(address, state)], context);
			}, BACKGROUND_CONTEXT);
			await attachment.close();
			if (tamper) {
				await assert.rejects(PiFlowAttachment.open(root, scope), /Invalid wait tool response receipt/);
				return;
			}
			attachment = await PiFlowAttachment.open(root, scope);
			const receipts = await attachment.waits.toolReceipts();
			assert.equal(
				observedWaitToolReceipt(
					{
						role: "toolResult",
						toolCallId: "call",
						toolName: "agent_wait",
						content,
					},
					receipts,
				)?.token,
				"wait",
			);
			assert.equal(
				observedWaitToolReceipt(
					{
						role: "toolResult",
						toolCallId: "call",
						toolName: "agent_wait",
						content: [{ type: "text", text: "changed" }],
					},
					receipts,
				),
				undefined,
			);
		});

for (const format of [1, 2])
	test(`historical format ${format} decisions remain delivered without replay`, async () => {
		const wait = terminal();
		const store = { snapshot: async () => [wait] };
		const producer = createFlowWaitDecisionProducer(store);
		const [intent] = await producer.snapshot(new AbortController().signal);
		const item = await producer.build(intent, new AbortController().signal);
		const input = FlowModelInput.compose("a", [item], 20000);
		const members = input.members;
		if (format === 1)
			members[0].contentHash = sha([
				{
					type: "text",
					text: JSON.stringify({
						flowInput: ["jouzu-flow", "a", item.id, item.revision],
						kind: "wait",
						content: item.text,
					}),
				},
			]);
		const ledger = {
			attempts: [
				{
					id: "a",
					phase: "settled",
					outcome: "success",
					members,
					requests: [
						{
							handedOff: true,
							outcome: "success",
							inclusion: members.map((m) => ({
								...m,
								disposition: "included",
							})),
						},
					],
				},
			],
		};
		const native = {
			ledger: { snapshot: async () => ledger },
			submissions: { snapshot: async () => [] },
			requests: { snapshot: async () => [] },
		};
		assert.deepEqual(await createFlowWaitDecisionProducer(store, native).snapshot(new AbortController().signal), []);
		assert.deepEqual(await observedFlowWaits([wait], native, [], ledger), [wait]);
		members[0].contentHash = "0".repeat(64);
		assert.equal(
			(await createFlowWaitDecisionProducer(store, native).snapshot(new AbortController().signal)).length,
			1,
		);
	});
