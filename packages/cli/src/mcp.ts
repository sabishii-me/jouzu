import type { InlineExtension, LoadedMcpConfig, McpServerConfig } from "@earendil-works/pi-coding-agent";

/** Keep script-oriented configurations discoverable through direct tool calls. */
export function deferredMcpConfig(config: McpServerConfig): McpServerConfig {
	return {
		...config,
		exposure: !config.exposure || config.exposure === "codemode" ? "deferred" : config.exposure,
		...(config.toolExposure
			? {
					toolExposure: Object.fromEntries(
						Object.entries(config.toolExposure).map(([name, exposure]) => [
							name,
							exposure === "codemode" ? "deferred" : exposure,
						]),
					),
				}
			: {}),
	};
}

/** Use Pi's MCP client and configuration loader without changing saved server settings. */
export function createDeferredMcpExtension(): InlineExtension {
	return {
		name: "mcp",
		builtin: true,
		replaceable: true,
		async factory(pi) {
			const { createMcpExtension, getAgentDir } = await import("@earendil-works/pi-coding-agent");
			// The exact Pi pin exports the extension factory, but not its configuration loader.
			const { loadMcpConfig } = (await import(
				new URL("./extensions/mcp/config.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
			)) as {
				loadMcpConfig(options: { agentDir: string; cwd: string; projectTrusted: boolean }): LoadedMcpConfig;
			};
			return createMcpExtension({
				loadConfig: (ctx) => {
					const loaded = loadMcpConfig({
						agentDir: getAgentDir(),
						cwd: ctx.cwd,
						projectTrusted: ctx.isProjectTrusted(),
					});
					return {
						...loaded,
						autoEnableCodemode: false,
						servers: loaded.servers.map((entry) => ({ ...entry, config: deferredMcpConfig(entry.config) })),
					};
				},
			})({
				...pi,
				getMcpServers: () => pi.getMcpServers().map((entry) => ({ ...entry, config: deferredMcpConfig(entry.config) })),
			});
		},
	};
}
