import { createHash } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type NativeSourceClaim, nativeSourceKey } from "./native-request-store.js";
import type { PiFlowAttachment } from "./pi-attachment.js";
import type { PiNativeDispatch } from "./pi-native-dispatch.js";
import { memorySourceReceipts } from "./pi-native-source-recovery.js";
import { FlowLedgerError } from "./receipt-ledger.js";

const recoveredCompaction = new WeakMap<PiNativeDispatch, string>();

/** Reconcile absence from model history; this never creates a delivery receipt. */
export async function reconcileNativeSources(
	session: AgentSession,
	attachment: PiFlowAttachment,
	native: PiNativeDispatch,
	reason: "compacted" | "reset" = "compacted",
): Promise<number> {
	const manager = session.sessionManager;
	const branch = manager.getBranch();
	const compaction = [...branch].reverse().find((entry) => entry.type === "compaction");
	if (reason === "compacted" && !compaction) return 0;
	if (reason === "compacted" && recoveredCompaction.get(native) === compaction?.id) return 0;
	// Pi rebuilds message objects during compaction. Rebind retained sources at the
	// serialized request checkpoint before reconciling the excluded history.
	await native.recoverSources(true);
	const projected = new Set(manager.buildContextEntries().map((entry) => entry.id));
	const cutoff =
		compaction?.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	if (reason === "compacted" && cutoff < 0)
		throw new FlowLedgerError("identity", "Compaction has no retained history boundary.");
	const eligible = new Map((reason === "reset" ? branch : branch.slice(0, cutoff)).map((entry) => [entry.id, entry]));
	const live = new Set((await native.sources(session.agent.state.messages)).map(nativeSourceKey));
	const consumed = new Set((await native.consumedSources()).map(nativeSourceKey));
	const selected: NativeSourceClaim[] = [];
	const memory = memorySourceReceipts(manager);
	for (const { dispatch } of await attachment.submissions.snapshot()) {
		if (!dispatch) continue;
		const candidates = [
			...memory
				.filter((receipt) => receipt.operationId === dispatch.operationId)
				.map((receipt) => ({
					receipt,
					source: {
						operationId: receipt.operationId,
						...(receipt.prompt ? { prompt: receipt.prompt } : { queue: receipt.queue }),
					},
				})),
			...(dispatch.promptHistory ?? []).map((receipt) => ({
				receipt,
				source: {
					operationId: dispatch.operationId,
					prompt: { inputIndex: receipt.inputIndex, messageIndex: receipt.messageIndex },
				},
			})),
			...(dispatch.queueHistory ?? []).map((receipt) => ({
				receipt,
				source: { operationId: dispatch.operationId, queue: { id: receipt.id, revision: receipt.revision } },
			})),
		];
		for (const { receipt, source } of candidates) {
			if (live.has(nativeSourceKey(source)) || !consumed.has(nativeSourceKey(source))) continue;
			const entry = eligible.get(receipt.entryId);
			if (!entry || projected.has(receipt.entryId)) continue;
			if (createHash("sha256").update(JSON.stringify(entry)).digest("hex") !== receipt.entryHash)
				throw new FlowLedgerError("identity", "Source recovery history differs from its receipt.");
			selected.push(source);
		}
	}
	if (manager.getLeafId() !== branch.at(-1)?.id || session.sessionId !== attachment.ledger.scope.sessionId)
		throw new FlowLedgerError("stale", "Source recovery branch changed.");
	const count = await attachment.nativeRequests.reconcileSources(selected, reason);
	if (compaction) recoveredCompaction.set(native, compaction.id);
	return count;
}
