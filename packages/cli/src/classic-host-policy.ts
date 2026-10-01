import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** These tools require their own transcript result to establish ownership or acknowledge delivery. */
export function requiresDirectToolCall(name: string): boolean {
	return (
		[
			"agent_wait",
			"agent_wait_cancel",
			"agent_no_reply",
			"agent_results",
			"subagent",
			"bg_task",
			"bg_status",
			"schedule_prompt",
			"compact_context",
			"get_goal",
			"update_goal",
		].includes(name) ||
		/^Task(?:CreateMany|Create|Get|List|Update|Reorder|Execute|Output|Stop)$/.test(name) ||
		name.startsWith("multiloop_")
	);
}

/** A nested call has no individual transcript result; do not allow it to create an unobservable obligation. */
export function createDirectToolPolicyExtension(): InlineExtension {
	return {
		name: "jouzu-direct-tool-policy",
		factory(pi) {
			pi.on("tool_call", (event) => {
				if (event.parentToolCallId && requiresDirectToolCall(event.toolName))
					return {
						block: true,
						reason: `Call ${event.toolName} directly, not from another tool, so its result can be acknowledged.`,
					};
			});
		},
	};
}

/** Load only built-ins whose model-request and instruction admission paths are qualified. */
export function classicHostBuiltinOverrides(): InlineExtension[] {
	return [
		{
			name: "codemode",
			builtin: true,
			replaceable: true,
			// Scripts can issue model requests outside the classic host's request checkpoint.
			factory() {},
		},
		{
			name: "mcp",
			builtin: true,
			replaceable: true,
			factory(pi) {
				pi.registerCommand("mcp", {
					description: "Show MCP session availability",
					handler: async (_args, ctx) => {
						ctx.ui.notify(
							"Built-in Model Context Protocol (MCP) connections are not enabled in this session. Use Jouzu's file and web tools instead.",
							"warning",
						);
					},
				});
			},
		},
	];
}
