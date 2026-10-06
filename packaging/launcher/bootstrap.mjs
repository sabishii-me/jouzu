import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { sessionEnvironment } from "./session-environment.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const app = join(root, "node_modules", "jouzu");
const cli = join(app, "dist", "cli.js");
const args = process.argv.slice(2);
const { parseJouzuArgs } = await import(pathToFileURL(join(app, "dist", "args.js")));
const { resolveJouzuPaths } = await import(pathToFileURL(join(app, "dist", "paths.js")));
const parsed = parseJouzuArgs(args);
process.env.JOUZU_HOME ||= join(process.env.LOCALAPPDATA, "Shisa.ai", "Jouzu", "data");
const paths = resolveJouzuPaths({ homeOverride: parsed.options.home });
const shell = process.env.JOUZU_LAUNCHER_BASH;
Object.assign(process.env, sessionEnvironment({
  app: root,
  shell,
  home: process.env.JOUZU_HOME,
  cacheDir: paths.cacheDir,
  configDir: paths.configDir,
}));
mkdirSync(paths.agentDir, { recursive: true });
const settingsPath = join(paths.agentDir, "settings.json");
const markerPath = join(paths.agentDir, "launcher-runtime.json");
const require = createRequire(join(app, "package.json"));
const lock = require("proper-lockfile");
const release = await lock.lock(settingsPath, { realpath: false, retries: { retries: 20, minTimeout: 50, maxTimeout: 200 } });
try {
  const read = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) : {};
  const settings = read(settingsPath);
  const previous = read(markerPath);
  if (shell && (!settings.shellPath || settings.shellPath === previous.shellPath)) settings.shellPath = shell;
  const npmCommand = [process.execPath, npm];
  if (!settings.npmCommand || JSON.stringify(settings.npmCommand) === JSON.stringify(previous.npmCommand)) settings.npmCommand = npmCommand;
  for (const [path, data] of [[settingsPath, settings], [markerPath, { shellPath: shell, npmCommand }]]) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(temporary, path);
  }
} finally { await release(); }
process.argv = [process.execPath, cli, ...args];
await import(pathToFileURL(cli));
