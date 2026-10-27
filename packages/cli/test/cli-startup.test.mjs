import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-startup-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !/^(?:JOUZU_|PI_|NODE_COMPILE_CACHE$|NODE_DISABLE_COMPILE_CACHE$|NODE_OPTIONS$)/.test(key),
		),
	);
	return { root, env: { ...env, JOUZU_HOME: join(root, "home"), JOUZU_UI_LOCALE: "en", PI_OFFLINE: "1" } };
}

function run(args, env, preload) {
	return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, cli, ...args], {
		encoding: "utf8",
		env,
		timeout: 30_000,
	});
}

test("help avoids the main runtime and preserves locale and argument validation", (t) => {
	const { root, env } = fixture(t);
	const preload = join(root, "no-runtime.mjs");
	writeFileSync(
		preload,
		`import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "./main-cli.js") throw new Error("Main runtime loaded");
  return nextResolve(specifier, context);
}});
`,
	);
	for (const args of [["--help"], ["-h"], ["acp", "--help"], ["acp", "-h"]]) {
		const result = run(args, env, preload);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /Jouzu agentic AI environment/);
		assert.equal(result.stderr, "");
	}
	const ja = run(["--jouzu-ui-locale", "ja", "--help"], env, preload);
	assert.equal(ja.status, 0, ja.stderr);
	assert.match(ja.stdout, /Jouzu エージェント型 AI 環境/u);
	const invalid = run(["--help", "unexpected"], env, preload);
	assert.equal(invalid.status, 2, invalid.stderr);
	assert.equal(invalid.stdout, "");
	assert.doesNotMatch(invalid.stderr, /Main runtime loaded/);
	const home = join(root, "saved locale 上手");
	mkdirSync(home);
	for (const [contents, expected] of [
		[JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" } }), /Jouzu エージェント型 AI 環境/u],
		["{broken", /Jouzu agentic AI environment/],
		[JSON.stringify({ schemaVersion: 999 }), /Jouzu agentic AI environment/],
	]) {
		writeFileSync(join(home, "localization.json"), contents);
		const saved = run(["--jouzu-home", home, "--help"], env, preload);
		assert.equal(saved.status, 0, saved.stderr);
		assert.match(saved.stdout, expected);
		assert.equal(saved.stderr, "");
	}
});

test("help validates locale inputs and version still validates the loaded runtime", (t) => {
	const { root, env } = fixture(t);
	const preload = join(root, "wrong-pi-version.mjs");
	writeFileSync(
		preload,
		`import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-coding-agent" && context.parentURL.endsWith("/main-cli.js")) {
    return { shortCircuit: true, url: "data:text/javascript,export const VERSION = '0.0.0';" };
  }
  return nextResolve(specifier, context);
}});
`,
	);
	const invalid = run(["--jouzu-ui-locale", "invalid", "--help"], env, preload);
	assert.equal(invalid.status, 2, invalid.stderr);
	assert.equal(invalid.stdout, "");
	assert.match(invalid.stderr, /--jouzu-ui-locale must be one of:/);
	const fallback = run(["--help"], { ...env, JOUZU_UI_LOCALE: "invalid" }, preload);
	assert.equal(fallback.status, 0, fallback.stderr);
	assert.match(fallback.stdout, /Jouzu agentic AI environment/);
	const version = run(["--version"], env, preload);
	assert.equal(version.status, 1, version.stderr);
	assert.equal(version.stdout, "");
	assert.match(version.stderr, /0\.0\.0/);
	assert.match(version.stderr, /pin/i);
});

test("the entry point enables Node's optional cache before loading application modules", (t) => {
	const { root, env } = fixture(t);
	const preload = join(root, "cache-probe.mjs");
	const resultPath = join(root, "cache-state.json");
	writeFileSync(
		preload,
		`import { getCompileCacheDir, registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "./cli-bootstrap.js") {
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ directory: getCompileCacheDir() ?? null }));
  }
  return nextResolve(specifier, context);
}});
`,
	);
	const blocked = join(root, "not-a-directory");
	writeFileSync(blocked, "blocked");
	const temporary = join(root, "temporary cache 上手");
	mkdirSync(temporary);
	for (const [label, extra, enabled, expectedRoot] of [
		["default", { TMPDIR: temporary, TMP: temporary, TEMP: temporary }, true, temporary],
		["override", { NODE_COMPILE_CACHE: join(root, "custom cache 上手") }, true, join(root, "custom cache 上手")],
		["disabled", { NODE_DISABLE_COMPILE_CACHE: "1" }, false],
		["unavailable", { TMPDIR: blocked, TMP: blocked, TEMP: blocked }, false],
	]) {
		const result = run(["--help"], { ...env, ...extra }, preload);
		assert.equal(result.status, 0, `${label}: ${result.stderr}`);
		assert.equal(result.stderr, "", label);
		assert.match(result.stdout, /Usage:/, label);
		const { directory } = JSON.parse(readFileSync(resultPath, "utf8"));
		assert.equal(directory !== null, enabled, label);
		if (enabled) assert.ok(directory.startsWith(expectedRoot), `${label}: ${directory}`);
	}
});
