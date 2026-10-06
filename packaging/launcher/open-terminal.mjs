import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sessionEnvironment } from "./session-environment.mjs";

// The Launcher's own button: a terminal in a folder, with the environment this installation manages,
// that does not start Jouzu. The shell is the Git Bash the installation prepared, so the user gets a
// shell they can work in and can start Jouzu from it with jz or jouzu when they want to.
const [app, managed, host, shell, home, folder] = process.argv.slice(2);
if (!app || !managed || !host || !shell || !home || !folder) {
	console.error("usage: open-terminal.mjs <app> <managed> <host> <shell> <home> <folder>");
	process.exit(2);
}
const { resolveJouzuPaths } = await import(pathToFileURL(join(app, "node_modules", "jouzu", "dist", "paths.js")));
const paths = resolveJouzuPaths({ homeOverride: home });
// The command entries come first in this shell: jz and jouzu answer from this installation even when
// the user never authorized a PATH entry.
const entries = join(managed, "bin");
const environment = sessionEnvironment({
	app,
	shell,
	home,
	cacheDir: paths.cacheDir,
	configDir: paths.configDir,
	entries: existsSync(entries) ? entries : null,
});
// A tab in the window that is already open when there is one; Windows Terminal creates a window only
// when there is none.
spawn(host, ["-w", "0", "new-tab", "--title", "Jouzu", "--startingDirectory", folder, "--", shell, "--login", "-i"], {
	env: { ...process.env, ...environment },
	detached: true,
	stdio: "ignore",
}).unref();
