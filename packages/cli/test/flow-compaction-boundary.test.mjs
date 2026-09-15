import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { compactionHistoryEnd } from "../dist/flow-control/compaction-boundary.js";
import { reconcileNativeSources } from "../dist/flow-control/native-source-reconciliation.js";

for (const boundary of ["", "missing", undefined, null, "self", "later"])
	test(`native compaction accepts only an explicit empty boundary: ${String(boundary)}`, async () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({ role: "user", content: "Before", timestamp: 1 });
		const id = manager.appendCompaction("Summary", "", 100);
		const later = manager.appendMessage({ role: "user", content: "After", timestamp: 2 });
		const compaction = manager.getEntry(id);
		compaction.firstKeptEntryId = boundary === "self" ? id : boundary === "later" ? later : boundary;
		assert.equal(compactionHistoryEnd(manager.getBranch(), compaction), boundary === "" ? 1 : -1);
		let reconciled = false;
		const session = { sessionManager: manager, sessionId: manager.getSessionId(), agent: { state: { messages: [] } } };
		const attachment = {
			ledger: { scope: { sessionId: session.sessionId } },
			submissions: { snapshot: async () => [] },
			nativeRequests: {
				reconcileSources: async () => {
					reconciled = true;
					return 0;
				},
			},
		};
		const native = { recoverSources: async () => {}, sources: async () => [], consumedSources: async () => [] };
		if (boundary === "") {
			assert.equal(await reconcileNativeSources(session, attachment, native), 0);
			assert.equal(reconciled, true);
		} else {
			await assert.rejects(reconcileNativeSources(session, attachment, native), /no retained history boundary/);
			assert.equal(reconciled, false);
		}
	});
