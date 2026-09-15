import type { CompactionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

/** Exclusive end of summarized history; an empty boundary explicitly keeps no tail. */
export function compactionHistoryEnd(branch: readonly SessionEntry[], compaction: CompactionEntry): number {
	const index = branch.findIndex((entry) => entry.id === compaction.id);
	if (index < 0) return -1;
	if (compaction.firstKeptEntryId === "") return index;
	const kept = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	return kept >= 0 && kept < index ? kept : -1;
}
