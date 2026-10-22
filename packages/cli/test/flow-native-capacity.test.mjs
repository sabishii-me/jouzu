import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { captureNativeProjections, convertNativeProjections } from "../dist/flow-control/native-context-projections.js";
import { retirableNativeRequests } from "../dist/flow-control/native-request-retention.js";
import { BACKGROUND_CONTEXT, setValue, value } from "../dist/flow-control/scalar-storage.js";
import { assembledSession, capturedNotices, replacedSession } from "./fixtures/flow-assembly.mjs";

const limit = 1024 * 1024;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytes = (records) => Buffer.byteLength(JSON.stringify(records));
const payload = { hash: "a".repeat(64), bytes: 100, api: "fixture", provider: "fixture", model: "fixture" };

function record(id, size = 0) {
	const message = {
		role: "toolResult",
		toolCallId: id,
		toolName: "fixture",
		content: [{ type: "text", text: "x".repeat(size) }],
		isError: false,
		timestamp: 1,
	};
	const messages = [message];
	const hash = digest(messages);
	const projectionCapture = captureNativeProjections(messages, messages);
	convertNativeProjections(projectionCapture, messages, {
		outputs: messages,
		hashes: [digest(message)],
		sourceIndices: [0],
		imageReplaced: [false],
	});
	return {
		id,
		ownerId: "previous-owner",
		sourceHash: hash,
		transformedHash: hash,
		modelHash: hash,
		systemHash: hash,
		sourceCapture: {
			hash,
			count: 1,
			members: [],
			context: { hash, count: 1, members: [] },
			model: { hash, count: 1, members: [] },
		},
		projectionCapture,
		payload,
		outcome: "success",
	};
}

async function seed(attachment, records) {
	await attachment.session.mutate(
		(writer, context) =>
			writer.commit(
				[
					setValue(value("jouzu.flow.native-requests", "v1"), {
						version: 1,
						cancellationIndexVersion: 1,
						scope: attachment.nativeRequests.scope,
						ids: records.map((r) => r.id),
					}),
					...records.map((r) => setValue(value("jouzu.flow.native-request", r.id), r)),
				],
				context,
			),
		BACKGROUND_CONTEXT,
	);
}

async function fullStore(t) {
	const f = await assembledSession(t, { persist: true });
	await f.session.prompt("/flow");
	const attachment = f.ingress.branch().attachment;
	const store = attachment.nativeRequests;
	const pending = record("pending");
	await store.begin(pending);
	const [owned] = await store.snapshot();
	const records = [...Array.from({ length: 12 }, (_, i) => record(`old-${i}`, 80000)), owned];
	records[0] = record("old-0", 80000 + limit - 2 - bytes(records));
	assert.equal(bytes(records), limit - 2);
	await seed(attachment, records);
	return { ...f, store, attachment, records };
}

test("a request admitted by an older build can settle at the byte limit and reopen", async (t) => {
	const f = await fullStore(t);
	assert.equal(await f.store.handoff("pending", payload), true);
	await f.store.finish("pending", "success");
	assert.ok(bytes(await f.store.snapshot()) > limit);
	const next = await replacedSession(t, f, { reason: "resume", persist: true, sessionManager: f.sessionManager });
	await next.session.prompt("/flow");
	const store = next.ingress.branch().attachment.nativeRequests;
	await store.retireHistory();
	assert.ok(bytes(await store.snapshot()) <= limit / 2);
	await next.session.prompt("Continue after settlement.");
	assert.equal(next.bodies.length, 1, next.session.agent.state.errorMessage);
});

test("/flow clear recovers a full legacy store without inventing an outcome or losing history", async (t) => {
	const f = await fullStore(t);
	const notices = capturedNotices(f.session);
	await f.session.prompt("/flow clear");
	assert.equal(f.store.recoveryBlocked, false, JSON.stringify(notices));
	assert.equal(f.bodies.length, 0);
	await f.session.prompt("Continue after clearing the hold.");
	assert.equal(f.bodies.length, 1, f.session.agent.state.errorMessage);
	const requests = await f.store.snapshot();
	const pending =
		requests.find((r) => r.id === "pending") ??
		(await f.attachment.session.getValue(value("jouzu.flow.native-request-history", "pending"), BACKGROUND_CONTEXT))
			?.value;
	assert.equal(pending.reset, true);
	assert.equal(pending.outcome, undefined);
	assert.equal(pending.payload, undefined);
	for (const old of f.records.slice(0, -1)) {
		const kept =
			requests.find((r) => r.id === old.id) ??
			(await f.attachment.session.getValue(value("jouzu.flow.native-request-history", old.id), BACKGROUND_CONTEXT))
				?.value;
		assert.deepEqual(kept, old);
	}
	await assert.rejects(f.store.begin(record("old-0")), { code: "stale" });
});

test("new request admission reserves space and leaves a full store unchanged on refusal", async (t) => {
	const f = await fullStore(t);
	await f.store.reset();
	const before = await f.store.snapshot();
	await assert.rejects(f.store.begin(record("too-full")), { code: "capacity" });
	assert.deepEqual(await f.store.snapshot(), before);
});

test("continuous tools retire large settled snapshots before the next request without an idle boundary", async (t) => {
	let steps = 0;
	let endings = 0;
	const f = await assembledSession(t, {
		producerExtensions: [
			{
				name: "capacity-history",
				factory(pi) {
					pi.registerTool({
						name: "step",
						label: "Step",
						description: "Advance the fixture.",
						parameters: { type: "object", properties: {} },
						async execute() {
							const attachment = f.ingress.branch().attachment;
							const records = await attachment.nativeRequests.snapshot();
							await seed(attachment, [...records, record(`history-${steps++}`, 80000)]);
							return { content: [{ type: "text", text: "done" }], details: {} };
						},
					});
					pi.on("agent_end", () => {
						endings++;
					});
				},
			},
		],
		script: (_body, index) =>
			index < 20 ? { toolCalls: [{ id: `step-${index}`, name: "step", arguments: {} }] } : { text: "Finished." },
	});
	await f.session.prompt("Run the tool sequence.");
	assert.equal(f.bodies.length, 21, f.session.agent.state.errorMessage);
	assert.equal(steps, 20);
	assert.equal(endings, 1);
	assert.equal(f.ingress.automatedPause(), undefined);
	assert.ok(bytes(await f.ingress.branch().attachment.nativeRequests.snapshot()) < limit);
});

test("byte retirement preserves live evidence and retires retry chains together", () => {
	const records = Array.from({ length: 8 }, (_, i) => record(`record-${i}`, 80000));
	const parent = {
		...records[0],
		outcome: "withheld",
		retryAuthorization: { ownerId: "owner", requestId: records[2].id },
	};
	const child = { ...records[2], retryOf: parent.id };
	records[0] = parent;
	records[2] = child;
	const selected = retirableNativeRequests(records, 64, new Set(), new Set([records[1].id]), new Set(), 300000);
	assert.ok(selected.includes(parent.id));
	assert.ok(selected.includes(child.id));
	assert.ok(!selected.includes(records[1].id));
	assert.ok(bytes(records.filter((r) => !selected.includes(r.id))) <= 300000);
	for (const protectedId of [parent.id, child.id]) {
		const protectedSelection = retirableNativeRequests(records, 64, new Set(), new Set([protectedId]), new Set(), 0);
		assert.ok(!protectedSelection.includes(parent.id));
		assert.ok(!protectedSelection.includes(child.id));
	}
});
