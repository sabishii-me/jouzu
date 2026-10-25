import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotificationInbox } from "../dist/notifications/inbox.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * A minimal inbox whose `build` is the external producer: the body it returns
 * is the finished string the inbox must display as-is.
 */
function fixture(body) {
	const records = [{ id: "run", revision: "terminal-1", handled: false }];
	const branch = [];
	const sent = [];
	const handlers = new Map();
	const ctx = {
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getSessionId: () => "parent", getBranch: () => branch },
	};
	const inbox = createNotificationInbox({
		pi: {
			on: (name, handler) => handlers.set(name, handler),
			sendMessage: (message) => sent.push(message),
		},
		customType: "fixture-results",
		records: () => records,
		save: (id, change) =>
			Object.assign(
				records.find((record) => record.id === id),
				change,
			),
		observed: () => new Set(),
		build: () => ({ content: body, display: true, details: { runs: [] } }),
		reportError: () => {},
	});
	inbox.start(ctx);
	return { inbox, records, branch, sent, ctx, handlers };
}

test("the model-facing acknowledge reply and the inbox protocol fields are unchanged", async () => {
	const f = fixture("Externally produced body.");
	try {
		f.inbox.request();
		await tick();
		assert.equal(f.sent.length, 1);
		const message = f.sent[0];
		const batchId = message.details.inbox.batchId;
		assert.equal(message.customType, "fixture-results");
		assert.equal(message.details.inbox.version, 1);
		assert.equal(message.details.inbox.sessionId, "parent");

		f.handlers.get("agent_start")();
		f.handlers.get("message_start")({ message: { role: "custom", ...message } }, f.ctx);
		f.branch.push({ type: "custom_message", ...message });
		const reply = f.inbox.acknowledge(batchId);
		assert.deepEqual(reply, {
			content: [{ type: "text", text: "No reply needed." }],
			details: { batchId },
			terminate: true,
		});
	} finally {
		f.inbox.shutdown();
	}
});

test("an externally produced notification body is displayed unchanged", async () => {
	const external = "外部で生成された本文: /var/tmp/keep.json — keep { $placeholder } verbatim.";
	const f = fixture(external);
	try {
		f.inbox.request();
		await tick();
		assert.equal(f.sent.length, 1);
		assert.equal(f.sent[0].content, external);
		assert.equal(f.sent[0].details.inbox.batchId, f.records[0].batchId);
	} finally {
		f.inbox.shutdown();
	}
});
