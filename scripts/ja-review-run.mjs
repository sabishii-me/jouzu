#!/usr/bin/env node
/**
 * Launch this checkout's built CLI for a Japanese review, with the isolation of
 * `scripts/ja_review.py run`: a dedicated home and settings directory, Japanese
 * saved as the initial interface language, the Core profile, no updates or Pi
 * import, and no inherited provider keys, Node options, or Git overrides.
 *
 * Unlike ja_review.py it runs on native Windows and uses the working tree as
 * built, so it suits unpushed changes. It records no source pin or receipt.
 *
 * Usage: node scripts/ja-review-run.mjs [--directory <dir>] [-- <jouzu args>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { devNull, homedir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(import.meta.dirname, "..");
const entrypoint = join(source, "packages", "cli", "dist", "cli.js");
const SAFE_ENV = new Set([
	"PATH",
	"PATHEXT",
	"COMSPEC",
	"LANG",
	"LANGUAGE",
	"TERM",
	"COLORTERM",
	"TERM_PROGRAM",
	"TERM_PROGRAM_VERSION",
	"TZ",
	"SHELL",
	"SYSTEMROOT",
	"WINDIR",
	"NO_COLOR",
	"FORCE_COLOR",
]);
const ISOLATION_FLAGS = new Set([
	"--jouzu-home",
	"--agent-dir",
	"--session-dir",
	"--jouzu-profile",
	"--session",
	"--fork",
]);

function fail(message, code = 2) {
	console.error(`ja-review-run: ${message}`);
	process.exit(code);
}

let args = process.argv.slice(2);
let root = join(homedir(), "jouzu-ja-review-local");
if (args[0] === "--directory") {
	if (!args[1]) fail("--directory needs a path");
	root = resolve(args[1]);
	args = args.slice(2);
}
if (args[0] === "--") args = args.slice(1);
for (const arg of args) {
	const flag = arg.split("=", 1)[0];
	if (ISOLATION_FLAGS.has(flag)) fail(`${flag} would change review isolation; omit it`);
	if (arg === "update" || arg === "self-update") fail("updates are disabled for the review build");
}
if (resolve(root).startsWith(source)) fail("use a review directory outside this checkout");
if (!existsSync(entrypoint)) fail(`${entrypoint} is missing; run "npm run build" in ${source} first`, 1);

const dir = (...parts) => {
	const path = join(root, ...parts);
	mkdirSync(path, { recursive: true });
	return path;
};
const home = dir("home");
const settings = join(home, "localization.json");
// Japanese is the initial choice only; later changes made in Settings are kept.
if (!existsSync(settings)) {
	const localization = { uiLocale: "ja", responseLanguage: "auto" };
	writeFileSync(settings, `${JSON.stringify({ schemaVersion: 2, localization }, null, 2)}\n`);
}
const sample = dir("sample-project");
const readme = join(sample, "README.md");
if (!existsSync(readme)) {
	writeFileSync(
		readme,
		"# Japanese review sample project\n\n" +
			"Use this directory to check display languages and Settings.\n" +
			"Sending prompts or authenticating may contact a provider and spend credit.\n\n" +
			"Japanese sample text: 日本語の表示と折り返しを確認します。\n",
	);
}

const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => SAFE_ENV.has(key.toUpperCase()) || key.startsWith("LC_")),
);
const user = dir("home", "user");
const temporary = dir("home", "tmp");
Object.assign(env, {
	HOME: user,
	USERPROFILE: user,
	XDG_CONFIG_HOME: dir("home", "user", "config"),
	XDG_STATE_HOME: dir("home", "user", "state"),
	XDG_CACHE_HOME: dir("home", "user", "cache"),
	XDG_DATA_HOME: dir("home", "user", "data"),
	APPDATA: dir("home", "user", "config"),
	LOCALAPPDATA: dir("home", "user", "state"),
	JOUZU_HOME: home,
	JOUZU_NO_UPDATE: "1",
	JOUZU_NO_PI_IMPORT: "1",
	PI_SKIP_VERSION_CHECK: "1",
	PI_TELEMETRY: "0",
	TMPDIR: temporary,
	TMP: temporary,
	TEMP: temporary,
	GIT_TERMINAL_PROMPT: "0",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: devNull,
});

const result = spawnSync(process.execPath, [entrypoint, "--jouzu-profile", "core", ...args], {
	cwd: sample,
	env,
	stdio: "inherit",
});
if (result.error) fail(result.error.message, 1);
process.exit(result.status ?? 1);
