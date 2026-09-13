import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FlowWaitState } from "./wait-state.js";

export interface FlowWaitToolReceipt {
	token: string;
	toolCallId: string;
	toolName: "agent_wait" | "agent_wait_cancel";
	contentHash: string;
}
export function waitToolResponse(wait: FlowWaitState) {
	const details = {
		token: wait.token,
		scope: wait.scope,
		work: wait.workId,
		state: wait.state,
		reason: wait.reason,
		expiresAt: wait.expiresAt,
		...(wait.checkAt === undefined ? {} : { checkAt: wait.checkAt }),
		// Named per dependency so a reader can tell which handles are monitored and which are not.
		health: wait.on.some((handle) => handle.health)
			? wait.on.map((handle) => ({ handle: handle.handle, policy: handle.health ?? "deadline-only" }))
			: "deadline-only",
		unmet: wait.unmet,
	};
	// The token stays in the text because cancelling the wait needs it and details do not reach
	// the model. Everything else here is scannable context; the exact payload stays in details.
	const handles = wait.on
		.map(
			(handle) => `${handle.handle} (${handle.producer}/${handle.until}${handle.health ? ` · ${handle.health}` : ""})`,
		)
		.join(", ");
	const check = wait.checkAt === undefined ? "" : ` · check ${new Date(wait.checkAt).toISOString()}`;
	const text = [
		`agent_wait ${wait.state} [${wait.token}] — ${handles}${check} · deadline ${new Date(wait.expiresAt).toISOString()}`,
		wait.unmet.length ? `${wait.unmet.length} unmet` : undefined,
		wait.reason || undefined,
	]
		.filter(Boolean)
		.join(" — ");
	return { content: [{ type: "text" as const, text }], details };
}
export const waitToolContentHash = (content: unknown) =>
	createHash("sha256").update(JSON.stringify(content)).digest("hex");
export function observedWaitToolReceipt(
	message: AgentMessage,
	receipts: FlowWaitToolReceipt[],
): FlowWaitToolReceipt | undefined {
	if (message.role !== "toolResult" || message.isError || !Array.isArray(message.content)) return undefined;
	return receipts.find(
		(receipt) =>
			receipt.toolCallId === message.toolCallId &&
			receipt.toolName === message.toolName &&
			receipt.contentHash === waitToolContentHash(message.content),
	);
}
