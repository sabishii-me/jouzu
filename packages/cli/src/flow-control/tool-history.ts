import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { validateFlowToolOrder } from "./model-input.js";
import { FlowLedgerError } from "./receipt-ledger.js";

/**
 * Close tool exchanges cut short by a branch, rewind, or interrupted session.
 * This is a model-context projection, never a transcript edit or tool execution.
 * Keep replayable messages (including signed assistant content) unchanged.
 * Failed assistant turns and their results are omitted from model replay, as
 * providers discard those assistants and would otherwise receive orphan results.
 */
export function prepareToolHistory(messages: Message[]): Message[] {
	const prepared: Message[] = [];
	const pending = new Map<string, ToolResultMessage>();
	const flush = () => {
		prepared.push(...pending.values());
		pending.clear();
	};
	let failedTurn = false;
	const failedCalls = new Map<string, string | undefined>();
	let omitted = false;
	for (const message of messages) {
		if (message.role !== "toolResult") {
			flush();
			failedTurn = message.role === "assistant" && ["error", "aborted"].includes(message.stopReason);
		}
		// Failed responses can contain partially streamed, invalid call IDs. They
		// are not replayable calls; do not synthesize results for them.
		if (failedTurn) {
			if (message.role === "assistant") {
				failedCalls.clear();
				for (const part of message.content) {
					if (part.type !== "toolCall") continue;
					failedCalls.set(part.id, failedCalls.has(part.id) ? undefined : part.name);
				}
			} else if (message.role === "toolResult") {
				if (
					typeof message.toolCallId !== "string" ||
					typeof message.toolName !== "string" ||
					!message.toolName ||
					failedCalls.get(message.toolCallId) !== message.toolName ||
					!failedCalls.delete(message.toolCallId)
				)
					throw new FlowLedgerError(
						"schema",
						"Failed assistant history contains an unmatched or repeated tool result.",
					);
			}
			omitted = true;
			continue;
		}
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type !== "toolCall") continue;
				// Leave invalid/repeated identities to the strict validator below.
				pending.set(part.id, {
					role: "toolResult",
					toolCallId: part.id,
					toolName: part.name,
					content: [
						{
							type: "text",
							text: "This tool result is unavailable in the selected conversation history. Its execution outcome is unknown; it may have completed outside this branch. This placeholder does not execute the tool. Check the relevant state before deciding whether to repeat the action.",
						},
					],
					isError: true,
					// Stable across retries/reopening; no fabricated execution time.
					timestamp: message.timestamp,
				});
			}
		} else if (message.role === "toolResult") {
			pending.delete(message.toolCallId);
		}
		prepared.push(message);
	}
	flush();
	// Missing results have one safe representation. Orphaned, duplicate, or
	// mismatched results do not: refuse them rather than inventing ancestry.
	validateFlowToolOrder(prepared);
	return !omitted && prepared.length === messages.length ? messages : prepared;
}

/** Summary excerpts may start inside a tool batch; they are serialized as text. */
export function prepareSummaryToolHistory(messages: Message[]): Message[] {
	let start = 0;
	const prefix: Message[] = [];
	const notice = "The tool call is not included in this summary excerpt.";
	while (messages[start]?.role === "toolResult") {
		const result = messages[start++] as ToolResultMessage;
		prefix.push(
			result.content[0]?.type === "text" && result.content[0].text === notice
				? result
				: { ...result, content: [{ type: "text", text: notice }, ...result.content] },
		);
	}
	return start ? [...prefix, ...prepareToolHistory(messages.slice(start))] : prepareToolHistory(messages);
}
