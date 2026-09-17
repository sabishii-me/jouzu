import { BACKGROUND_CONTEXT, type SessionReader, setValue, value, type Write } from "@earendil-works/pi-agent-core";
import { FlowLedgerError } from "./receipt-ledger.js";
import { validRetiredIdentityHash } from "./retired-identities.js";

export type WaitHistoryKind = "work" | "executions" | "waits";
export interface WaitHistoryEntry {
	kind: WaitHistoryKind;
	key: string;
	record?: unknown;
	toolReceipts?: unknown[];
}
const address = (kind: WaitHistoryKind, epoch: number, key: string) =>
	value<WaitHistoryEntry>(`jouzu.flow.wait-history-${kind}`, JSON.stringify([epoch, key]));

export async function hasRetiredWaitIdentity(
	reader: SessionReader,
	kind: WaitHistoryKind,
	epoch: number,
	key: string,
): Promise<boolean> {
	const stored = await reader.getValue(address(kind, epoch, key), BACKGROUND_CONTEXT);
	if (!stored) return false;
	if (stored.value?.kind !== kind || stored.value.key !== key || !validRetiredIdentityHash(key))
		throw new FlowLedgerError("schema", "Invalid retired wait identity.");
	return true;
}

/** Loaded once on attachment for synchronous admission; ordinary updates use exact keys. */
export async function readRetiredWaitWork(reader: SessionReader, epoch: number): Promise<Set<string>> {
	const result = new Set<string>();
	for (const stored of await reader.scanValues(
		value<WaitHistoryEntry>("jouzu.flow.wait-history-work"),
		BACKGROUND_CONTEXT,
	)) {
		let key: unknown;
		try {
			key = JSON.parse(stored.address.key);
		} catch {
			throw new FlowLedgerError("schema", "Invalid retired wait identity.");
		}
		if (
			!Array.isArray(key) ||
			key.length !== 2 ||
			!Number.isSafeInteger(key[0]) ||
			key[0] < 0 ||
			!validRetiredIdentityHash(key[1]) ||
			stored.value?.kind !== "work" ||
			stored.value.key !== key[1]
		)
			throw new FlowLedgerError("schema", "Invalid retired wait identity.");
		if (key[0] === epoch) result.add(key[1]);
	}
	return result;
}

/** Archive writes join the active-state replacement in the caller's transaction. */
export async function indexWaitHistory(
	reader: SessionReader,
	epoch: number,
	entries: WaitHistoryEntry[],
): Promise<Write[]> {
	const unique = new Map<string, WaitHistoryEntry>();
	for (const entry of entries) {
		const key = JSON.stringify([entry.kind, entry.key]);
		if (!unique.has(key) || entry.record !== undefined) unique.set(key, entry);
	}
	const writes: Write[] = [];
	for (const entry of unique.values()) {
		if (await hasRetiredWaitIdentity(reader, entry.kind, epoch, entry.key)) {
			if (entry.record !== undefined)
				throw new FlowLedgerError("identity", "Retired wait history cannot be overwritten.");
			continue;
		}
		writes.push(setValue(address(entry.kind, epoch, entry.key), entry));
	}
	return writes;
}
