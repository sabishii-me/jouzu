import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** Compare a value as it survives Pi's JSON-backed transcript. */
export function persistedValue(value: unknown): unknown {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) return undefined;
	return JSON.parse(serialized);
}

/** Compare an agent message as it survives Pi's JSON-backed transcript. */
export function persistedAgentMessage(message: AgentMessage, ignoreTimestamp = false): unknown {
	const persisted = persistedValue(ignoreTimestamp ? { ...message, timestamp: 0 } : message);
	if (persisted === undefined) throw new Error("Agent message cannot be persisted.");
	return persisted;
}
