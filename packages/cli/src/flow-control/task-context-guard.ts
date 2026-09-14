import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FlowAttempt } from "./receipt-ledger.js";

type Message = ContextEvent["messages"][number];
const skippedType = "jouzu-task-skipped";
function attemptId(message: Message): string | undefined {
	if (message.role !== "custom" || message.customType !== "jouzu-flow") return undefined;
	const id = (message.details as { attemptId?: unknown } | undefined)?.attemptId;
	return typeof id === "string" ? id : undefined;
}

/** Recheck consumed task instructions before conversion without changing their source bytes. */
export function installTaskContextGuard(
	pi: ExtensionAPI,
	options: {
		activeAttempt(): Promise<FlowAttempt | undefined>;
		valid(attempt: FlowAttempt): Promise<boolean>;
		onError(error: unknown): void;
	},
) {
	let incoming: Message[] = [];
	const skipped = new Set<string>();
	pi.on("session_start", async (_event, ctx) => {
		incoming = [];
		skipped.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== skippedType) continue;
			const id = (entry.data as { attemptId?: unknown } | undefined)?.attemptId;
			if (typeof id === "string") skipped.add(id);
		}
	});
	pi.on("agent_start", async () => {
		incoming = [];
	});
	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") incoming.push(event.message);
	});
	pi.on("context", async (event, ctx) => {
		const inputs = incoming;
		incoming = [];
		const attempt = inputs.some((message) => attemptId(message)) ? await options.activeAttempt() : undefined;
		if (
			attempt?.admission?.choice.intent.producer === "tasks" &&
			inputs.some((message) => attemptId(message) === attempt.id) &&
			!(await options.valid(attempt))
		) {
			if (!skipped.has(attempt.id)) {
				skipped.add(attempt.id);
				pi.appendEntry(skippedType, { attemptId: attempt.id });
				ctx.ui.notify("Skipped a task continuation because its task changed.", "info");
			}
			if (
				inputs.every((message) => attemptId(message) === attempt.id) &&
				attempt.members.every((member) => member.kind === "work")
			) {
				try {
					ctx.abort();
				} catch (error) {
					options.onError(error);
				}
			}
		}
		return {
			messages: event.messages.flatMap((message): Message[] => {
				const id = attemptId(message);
				if (!id || !skipped.has(id)) return [message];
				return [
					message,
					{
						role: "custom",
						customType: skippedType,
						display: false,
						timestamp: message.timestamp,
						content:
							"The task instruction in the preceding flow message is cancelled because the task changed. Do not execute that instruction. Respond to any other input, wait decisions, or results in this turn.",
					},
				];
			}),
		};
	});
}
