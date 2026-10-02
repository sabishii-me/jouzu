import assert from "node:assert/strict";
import { test } from "node:test";
import { createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { createPiLedgerStore } from "../dist/flow-control/pi-ledger-store.js";
import { FlowReceiptLedger } from "../dist/flow-control/receipt-ledger.js";
import { BACKGROUND_CONTEXT as context, MemorySessionRepo } from "./fixtures/flow-storage.mjs";

test("classic Pi queue preserves duplicate prompts and images alongside flow receipts", async (t) => {
	t.mock.method(globalThis, "fetch", async () => {
		throw new Error("Network disabled in host reuse fixture.");
	});
	const { session: host } = await createFlowSession(t);
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	t.after(async () => {
		await session.close(context);
		await repo.close(context);
	});
	const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
	await host.followUp("same", [image]);
	await host.followUp("same", [image]);
	const [first, second] = host.agent.inspectQueuedMessages();
	assert.ok(first);
	assert.ok(second);
	assert.notEqual(first.id, second.id);
	for (const item of [first, second]) {
		assert.deepEqual(item.message.content, [{ type: "text", text: "same" }, image]);
		assert.equal(item.lane, "followUp");
	}
	assert.equal(host.agent.cancelQueuedMessage(first.id, first.revision).kind, "cancelled");
	assert.equal(host.agent.cancelQueuedMessage(first.id, first.revision).kind, "not-queued");
	const ledger = await FlowReceiptLedger.attach(createPiLedgerStore(session), {
		sessionId: host.sessionId,
		branchId: "main",
	});
	assert.equal((await ledger.snapshot()).attempts.length, 0);
	await ledger.select("attempt", [
		{ id: "result", revision: "1", kind: "result", required: false, contentHash: "a".repeat(64) },
	]);
	await ledger.cancel("attempt", "Cancelled before queue admission.");
	assert.deepEqual(host.agent.inspectQueuedMessages(), [second]);
	assert.equal(host.agent.cancelQueuedMessage(second.id, second.revision).kind, "cancelled");
	assert.deepEqual(host.agent.inspectQueuedMessages(), []);
});
