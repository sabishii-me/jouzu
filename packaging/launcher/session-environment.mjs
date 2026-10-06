import { delimiter, dirname, join } from "node:path";

/**
 * The environment a managed session runs with: the runtime this installation carries, the Git Bash it
 * prepared, the npm it carries, and Jouzu's own directories. The window, a terminal entry, and a
 * terminal the Launcher opens all run with this, so a setting that reaches one reaches all of them.
 *
 * The command entries come first, so a shell started here answers with this installation's own `jz`
 * whatever else the machine has on its PATH.
 */
export function sessionEnvironment({ app, shell, home, cacheDir, configDir, entries = null, node = process.execPath, base = process.env }) {
	const nodeDirectory = dirname(node);
	const npm = join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js");
	const git = shell ? [dirname(shell), join(dirname(shell), "..", "cmd"), join(dirname(shell), "..", "usr", "bin")] : [];
	const inherited = base.PATH ?? base.Path ?? "";
	const path = [...(entries ? [entries] : []), nodeDirectory, join(app, "..", "tools"), ...git, inherited].join(delimiter);
	return {
		PATH: path,
		JOUZU_HOME: home,
		...(shell ? { JOUZU_LAUNCHER_BASH: shell } : {}),
		// The launcher updates Jouzu itself, and the marker names this installation's own entry points.
		JOUZU_NO_UPDATE: "1",
		PI_SKIP_VERSION_CHECK: "1",
		NODE_USE_SYSTEM_CA: "1",
		NODE_USE_ENV_PROXY: "1",
		npm_execpath: npm,
		npm_node_execpath: node,
		npm_config_cache: join(cacheDir, "npm"),
		npm_config_prefix: join(configDir, "npm"),
	};
}
