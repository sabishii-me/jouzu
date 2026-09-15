import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { assistant } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { FlowModelInput } from "../dist/flow-control/model-input.js";
import { compactedFlowMembers } from "../dist/flow-control/pi-compaction-receipts.js";

function fixture() {
	const manager = SessionManager.inMemory();
	const composition = FlowModelInput.compose(
		"attempt",
		[{ id: "work", revision: "1", kind: "work", text: "Do work" }],
		4096,
	);
	const entryId = manager.appendCustomMessageEntry("jouzu-flow", composition.content, true, { attemptId: "attempt" });
	const kept = manager.appendMessage(assistant());
	manager.appendCompaction("Continue the remaining work.", kept, 5000);
	const sourceMessages = manager.buildSessionContext().messages;
	const input = {
		sourceMessages,
		transformedMessages: structuredClone(sourceMessages),
		modelMessages: convertToLlm(sourceMessages),
		requestId: "request",
		systemPrompt: "",
	};
	const attempt = {
		id: "attempt",
		members: composition.members,
		history: [
			{
				id: "work",
				revision: "1",
				entryId,
				entryHash: createHash("sha256")
					.update(JSON.stringify(manager.getEntry(entryId)))
					.digest("hex"),
			},
		],
	};
	return { manager, composition, input, attempt, entryId };
}

test("compaction evidence identifies the exact omitted frame and survives repeated compaction", () => {
	const f = fixture();
	assert.deepEqual(compactedFlowMembers(f.manager, f.attempt, f.input), [{ id: "work", revision: "1" }]);
	const kept = f.manager.appendMessage(assistant());
	f.manager.appendCompaction("Continue after a second compaction.", kept, 6000);
	f.input.sourceMessages = f.manager.buildSessionContext().messages;
	f.input.modelMessages = convertToLlm(f.input.sourceMessages);
	assert.deepEqual(compactedFlowMembers(f.manager, f.attempt, f.input), [{ id: "work", revision: "1" }]);
});

for (const fault of [
	"retained-frame",
	"missing-history",
	"changed-history",
	"changed-frame",
	"wrong-branch",
	"missing-summary",
	"filtered-summary",
	"reinserted-source",
])
	test(`compaction cannot excuse unverified omission: ${fault}`, () => {
		const f = fixture();
		switch (fault) {
			case "retained-frame":
				f.manager.appendCompaction("Keep work.", f.entryId, 5000);
				break;
			case "missing-history":
				f.attempt.history = [];
				break;
			case "changed-history":
				f.attempt.history[0].entryHash = "bad";
				break;
			case "changed-frame":
				f.attempt.members[0].contentHash = "bad";
				break;
			case "wrong-branch":
				f.manager.branch(f.entryId);
				break;
			case "missing-summary":
				f.input.sourceMessages = [];
				break;
			case "filtered-summary":
				f.input.modelMessages = [];
				break;
			case "reinserted-source":
				f.input.sourceMessages.push({ role: "user", content: f.composition.content, timestamp: 1 });
				break;
		}
		assert.deepEqual(compactedFlowMembers(f.manager, f.attempt, f.input), []);
	});
