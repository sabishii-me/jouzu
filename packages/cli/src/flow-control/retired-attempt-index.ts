import { BACKGROUND_CONTEXT, type SessionReader, setValue, value, type Write } from "@earendil-works/pi-agent-core";
import { emptyRetiredAttempts, type FlowRetiredAttempts, type FlowRetirementQuery } from "./attempt-retention.js";
import { FlowLedgerError } from "./receipt-ledger.js";

const address = (kind: "members" | "work" | "settled" | "triggers", epoch: number, key: string) =>
	value<number>(`jouzu.flow.retired-${kind}`, JSON.stringify([epoch, key]));

async function readCount(
	reader: SessionReader,
	kind: "members" | "work" | "settled" | "triggers",
	epoch: number,
	key: string,
): Promise<number> {
	const record = await reader.getValue(address(kind, epoch, key), BACKGROUND_CONTEXT);
	if (!record) return 0;
	if (!Number.isSafeInteger(record.value) || record.value < 1 || (kind !== "settled" && record.value !== 1))
		throw new FlowLedgerError("schema", "Invalid archived flow identity.");
	return record.value;
}

/** Query only current candidates; archived identities do not enter the operational ledger. */
export async function projectRetiredAttempts(
	reader: SessionReader,
	epoch: number,
	query: FlowRetirementQuery,
	summary = emptyRetiredAttempts(),
): Promise<FlowRetiredAttempts> {
	const result: FlowRetiredAttempts = { ...emptyRetiredAttempts(), round: [...summary.round] };
	if (query.triggers) {
		result.triggers = [];
		for (const key of new Set(query.triggers))
			if (summary.triggers?.includes(key) || (await readCount(reader, "triggers", epoch, key)))
				result.triggers.push(key);
	}
	for (const kind of ["members", "work"] as const)
		for (const key of new Set(query[kind] ?? []))
			if (summary[kind].includes(key) || (await readCount(reader, kind, epoch, key))) result[kind].push(key);
	for (const id of new Set(query.settled ?? [])) {
		const count =
			(summary.settled.find((entry) => entry.id === id)?.count ?? 0) + (await readCount(reader, "settled", epoch, id));
		if (count) result.settled.push({ id, count });
	}
	return result;
}

/** The caller commits these identity facts with retirement of their source attempts. */
export async function indexRetiredAttempts(
	reader: SessionReader,
	epoch: number,
	summary: FlowRetiredAttempts,
): Promise<Write[]> {
	const writes: Write[] = [];
	for (const key of summary.triggers ?? []) writes.push(setValue(address("triggers", epoch, key), 1));
	for (const kind of ["members", "work"] as const)
		for (const key of summary[kind]) writes.push(setValue(address(kind, epoch, key), 1));
	for (const entry of summary.settled) {
		const count = entry.count + (await readCount(reader, "settled", epoch, entry.id));
		if (!Number.isSafeInteger(count))
			throw new FlowLedgerError("capacity", "Flow iteration count exceeds safe integer range.");
		writes.push(setValue(address("settled", epoch, entry.id), count));
	}
	return writes;
}
