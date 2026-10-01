import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** Apply child permissions and the tool budget to direct and nested calls through the same hook. */
export function createChildToolPolicy(options: { maxCalls: number; onExhausted(): void }): InlineExtension {
	let calls = 0;
	return {
		name: "jouzu-child-tool-policy",
		factory(pi) {
			pi.on("tool_call", (event) => {
				// Roles control tools; the working directory is not a filesystem sandbox.
				if (!pi.getActiveTools().includes(event.toolName))
					return { block: true, reason: "Access denied: tool is not enabled for this child session." };
				if (++calls > options.maxCalls) {
					options.onExhausted();
					return { block: true, reason: "Tool limit reached. Report remaining work." };
				}
			});
		},
	};
}
