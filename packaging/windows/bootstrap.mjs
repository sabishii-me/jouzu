import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const payload = dirname(fileURLToPath(import.meta.url));
const app = join(payload, "app", "node_modules", "jouzu", "dist");
const args = process.argv.slice(2);
const { parseJouzuArgs } = await import(pathToFileURL(join(app, "args.js")));
const { resolveJouzuPaths } = await import(pathToFileURL(join(app, "paths.js")));
const parsed = parseJouzuArgs(args);
process.env.JOUZU_HOME ||= join(process.env.LOCALAPPDATA, "JouzuDesktop", "data");
const paths = resolveJouzuPaths({ homeOverride: parsed.options.home });
const runtime = join(payload, "node");
const npm = join(runtime, "node_modules", "npm", "bin", "npm-cli.js");
const shell = join(payload, "git", "bin", "bash.exe");
process.env.PATH = [runtime, join(payload, "tools"), join(payload, "git", "cmd"), join(payload, "git", "bin"), join(payload, "git", "usr", "bin"), process.env.PATH || ""].join(delimiter);
process.env.JOUZU_NO_UPDATE = "1";
process.env.PI_SKIP_VERSION_CHECK = "1";
process.env.NODE_USE_SYSTEM_CA = "1";
process.env.NODE_USE_ENV_PROXY = "1";
process.env.npm_execpath = npm;
process.env.npm_node_execpath = process.execPath;
process.env.npm_config_cache = join(paths.cacheDir, "npm");
process.env.npm_config_prefix = join(paths.configDir, "npm");

// Configure only the desktop's Jouzu agent root, preserving user overrides.
mkdirSync(paths.agentDir, { recursive: true });
const settingsFile = join(paths.agentDir, "settings.json");
const markerFile = join(paths.agentDir, "desktop-runtime.json");
const read = (path) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) : {};
const piRequire = createRequire(join(app, "..", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"));
const lockfile = piRequire("proper-lockfile");
const release = await lockfile.lock(settingsFile, { realpath: false, retries: { retries: 20, minTimeout: 50, maxTimeout: 200 } });
try {
    const settings = read(settingsFile);
    const previous = read(markerFile);
    const command = [process.execPath, npm];
    if (!settings.shellPath || settings.shellPath === previous.shellPath) settings.shellPath = shell;
    if (!settings.npmCommand || JSON.stringify(settings.npmCommand) === JSON.stringify(previous.npmCommand)) settings.npmCommand = command;
    for (const [path, value] of [[settingsFile, settings], [markerFile, { shellPath: shell, npmCommand: command }]]) {
        const content = `${JSON.stringify(value, null, 2)}\n`;
        if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
        const temporary = `${path}.${randomUUID()}.tmp`;
        writeFileSync(temporary, content);
        renameSync(temporary, path);
    }
} finally {
    await release();
}
const cli = resolve(app, "cli.js");
process.argv = [process.execPath, cli, ...args];
await import(pathToFileURL(cli));
