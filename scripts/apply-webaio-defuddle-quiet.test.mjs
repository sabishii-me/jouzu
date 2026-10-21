import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { applyInstalledDefuddleDiagnostics, resolveDefuddleSource } from "./apply-webaio-defuddle-quiet.mjs";

const MARKER_START = "/* jouzu-defuddle-diagnostics:start */";
const MARKER_END = "/* jouzu-defuddle-diagnostics:end */";
const SIDECAR_NAME = "jouzu-diagnostics.cjs";
const requireHere = createRequire(import.meta.url);

const FIXTURE_FILES = {
	"package.json": `${JSON.stringify(
		{
			name: "defuddle",
			version: "0.0.0-fixture",
			main: "dist/index.js",
			exports: { ".": "./dist/index.js" },
		},
		null,
		2,
	)}\n`,
	"dist/index.js": `"use strict";\nconsole.log("index loaded");\nmodule.exports = { loaded: true };\n`,
	"dist/defuddle.js": `"use strict";\nfunction parse(debug) {\n\tif (debug) console.log("debug detail");\n\tconsole.warn("recoverable");\n\treturn { ok: true };\n}\nmodule.exports = { parse };\n`,
	"dist/metadata.js": `"use strict";\nfunction extract(href) {\n\ttry {\n\t\tnew URL(href);\n\t} catch (error) {\n\t\tconsole.warn("Failed to parse URL:", error);\n\t}\n\treturn { ok: true };\n}\nmodule.exports = { extract };\n`,
	"dist/extractor-registry.js": `"use strict";\nconsole.error("extractor failed");\nmodule.exports = {};\n`,
	"dist/markdown.js": `"use strict";\nfunction convert() {\n\tconsole.error("markdown failed");\n\tconsole.log("Problematic content:", "secret");\n\treturn "markdown";\n}\nmodule.exports = { convert };\n`,
	"dist/utils.js": `"use strict";\nfunction logDebug(enabled) {\n\tif (enabled) console.log("Defuddle:", "debug");\n\treturn enabled;\n}\nmodule.exports = { logDebug };\n`,
	"dist/elements/math.full.js": `"use strict";\nfunction convert() {\n\tconsole.warn("math failed");\n\treturn "math";\n}\nmodule.exports = { convert };\n`,
	"dist/extractors/youtube.js": `"use strict";\nfunction extract() {\n\tconsole.error("youtube failed");\n\treturn "youtube";\n}\nmodule.exports = { extract };\n`,
	"dist/nested/deep/module.js": `"use strict";\nfunction run() {\n\tconsole.info("nested info");\n\treturn "nested";\n}\nmodule.exports = { run };\n`,
	"dist/with-comment.js": `// leading comment\n"use strict";\nconsole.log("with comment");\nmodule.exports = {};\n`,
	"dist/with-trailing-comment.js": `"use strict"; // keep strict\nconsole?.warn("trailing comment");\nmodule.exports = {};\n`,
	"dist/cli.js": `#!/usr/bin/env node\n"use strict";\nconsole.log("cli output");\n`,
	"dist/no-console.js": `"use strict";\nmodule.exports = 42;\n`,
};

const PATCHED_RELATIVE_PATHS = [
	"dist/defuddle.js",
	"dist/elements/math.full.js",
	"dist/extractor-registry.js",
	"dist/extractors/youtube.js",
	"dist/index.js",
	"dist/markdown.js",
	"dist/metadata.js",
	"dist/nested/deep/module.js",
	"dist/utils.js",
	"dist/with-comment.js",
	"dist/with-trailing-comment.js",
];

function createFixture(t, layout) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jouzu-defuddle-")));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const webaio = join(root, "node_modules", "pi-webaio");
	const defuddle =
		layout === "nested" ? join(webaio, "node_modules", "defuddle") : join(root, "node_modules", "defuddle");
	mkdirSync(webaio, { recursive: true });
	writeFileSync(join(webaio, "package.json"), JSON.stringify({ name: "pi-webaio", version: "0.0.0" }));
	for (const [path, content] of Object.entries(FIXTURE_FILES)) {
		const target = join(defuddle, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	let anchor = webaio;
	if (layout === "junction") {
		anchor = join(root, "packages", "cli", "node_modules", "pi-webaio");
		mkdirSync(dirname(anchor), { recursive: true });
		symlinkSync(webaio, anchor, "junction");
	}
	return { root, webaio, defuddle, anchor, dist: join(defuddle, "dist") };
}

function countOccurrences(source, needle) {
	return source.split(needle).length - 1;
}

function requireFixture(path) {
	return requireHere(path);
}

function expectedPatchedFiles(defuddle) {
	return PATCHED_RELATIVE_PATHS.map((path) => join(defuddle, path)).sort();
}

for (const layout of ["nested", "hoisted", "junction"]) {
	test(`resolves and patches the ${layout} Defuddle layout`, (t) => {
		const fixture = createFixture(t, layout);
		const originalConsole = globalThis.console;
		const originalLog = console.log;
		const result = applyInstalledDefuddleDiagnostics(fixture.anchor);

		assert.equal(basename(result.helperPath), SIDECAR_NAME);
		assert.equal(result.helperPath, join(fixture.dist, SIDECAR_NAME));
		assert.equal(resolveDefuddleSource(fixture.anchor), join(fixture.dist, "defuddle.js"));
		assert.deepEqual(result.patchedFiles, expectedPatchedFiles(fixture.defuddle));
		assert.equal(globalThis.console, originalConsole);
		assert.equal(console.log, originalLog);

		for (const file of result.patchedFiles) {
			const source = readFileSync(file, "utf8");
			assert.equal(countOccurrences(source, MARKER_START), 1, file);
			assert.equal(countOccurrences(source, MARKER_END), 1, file);
			const relativeRequire = relative(dirname(file), result.helperPath).split(sep).join("/");
			const requirePath =
				relativeRequire.startsWith("./") || relativeRequire.startsWith("../")
					? relativeRequire
					: `./${relativeRequire}`;
			assert.ok(source.includes(`require(${JSON.stringify(requirePath)})`), file);
		}
		const withComment = readFileSync(join(fixture.dist, "with-comment.js"), "utf8");
		assert.ok(withComment.startsWith(`// leading comment\n"use strict";\n${MARKER_START}\n`));
		const withTrailingComment = readFileSync(join(fixture.dist, "with-trailing-comment.js"), "utf8");
		assert.ok(withTrailingComment.startsWith(`"use strict"; // keep strict\n${MARKER_START}\n`));
		assert.ok(withTrailingComment.includes("// keep strict"));
		assert.equal(readFileSync(join(fixture.dist, "cli.js"), "utf8"), FIXTURE_FILES["dist/cli.js"]);
		assert.equal(readFileSync(join(fixture.dist, "no-console.js"), "utf8"), FIXTURE_FILES["dist/no-console.js"]);

		const sidecar = readFileSync(result.helperPath, "utf8");
		assert.match(sidecar, /function capture\(callback, sanitize = \(value\) => value\)/);
		assert.match(sidecar, /module\.exports = \{/);
	});
}

test("repeated application is stable and repairs a stale binding", (t) => {
	const fixture = createFixture(t, "hoisted");
	const first = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const snapshots = new Map(first.patchedFiles.map((file) => [file, readFileSync(file, "utf8")]));
	const sidecar = readFileSync(first.helperPath, "utf8");

	const second = applyInstalledDefuddleDiagnostics(fixture.anchor);
	assert.deepEqual(second, first);
	for (const [file, source] of snapshots) assert.equal(readFileSync(file, "utf8"), source);
	assert.equal(readFileSync(first.helperPath, "utf8"), sidecar);

	const target = join(fixture.dist, "defuddle.js");
	writeFileSync(target, readFileSync(target, "utf8").replace("./jouzu-diagnostics.cjs", "./stale.cjs"));
	const repaired = applyInstalledDefuddleDiagnostics(fixture.anchor);
	assert.deepEqual(repaired, first);
	assert.ok(readFileSync(target, "utf8").includes(`require("./jouzu-diagnostics.cjs")`));
	assert.equal(countOccurrences(readFileSync(target, "utf8"), MARKER_START), 1);
});

test("patched Defuddle modules capture diagnostics and keep parser results", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const sidecar = requireFixture(helperPath);
	const defuddle = requireFixture(join(fixture.dist, "defuddle.js"));
	const metadata = requireFixture(join(fixture.dist, "metadata.js"));
	const youtube = requireFixture(join(fixture.dist, "extractors", "youtube.js"));
	const math = requireFixture(join(fixture.dist, "elements", "math.full.js"));
	const nested = requireFixture(join(fixture.dist, "nested", "deep", "module.js"));
	const markdown = requireFixture(join(fixture.dist, "markdown.js"));

	const result = await sidecar.capture(() => {
		assert.deepEqual(defuddle.parse(false), { ok: true });
		assert.deepEqual(defuddle.parse(true), { ok: true });
		assert.deepEqual(metadata.extract("/relative"), { ok: true });
		assert.equal(youtube.extract(), "youtube");
		assert.equal(math.convert(), "math");
		assert.equal(nested.run(), "nested");
		assert.equal(markdown.convert(), "markdown");
		return "value";
	});

	assert.equal(result.value, "value");
	assert.equal(result.omitted, 0);
	assert.deepEqual(
		result.diagnostics.map((diagnostic) => diagnostic.level),
		["warn", "log", "warn", "warn", "error", "warn", "info", "error", "log"],
	);
	assert.equal(result.diagnostics[0].message, "recoverable");
	assert.equal(result.diagnostics[1].message, "debug detail");
	assert.equal(result.diagnostics[2].message, "recoverable");
	assert.match(result.diagnostics[3].message, /Failed to parse URL: TypeError: Invalid URL/);
	assert.match(result.diagnostics[3].message, /ERR_INVALID_URL/);
	assert.match(result.diagnostics[3].message, /input: \/relative/);
	assert.equal(result.diagnostics[4].message, "youtube failed");
	assert.equal(result.diagnostics[5].message, "math failed");
	assert.equal(result.diagnostics[6].message, "nested info");
	assert.equal(result.diagnostics[7].message, "markdown failed");
	assert.equal(result.diagnostics[8].message, "Problematic content: secret");
});

test("capture records every console level and ignores logs outside a capture", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet } = requireFixture(helperPath);

	quiet.error("outside");
	const outside = await capture(() => "value");
	assert.equal(outside.value, "value");
	assert.deepEqual(outside.diagnostics, []);

	const result = await capture(() => {
		quiet.log("log");
		quiet.info("info");
		quiet.warn("warn");
		quiet.error("error");
		quiet.debug("debug");
		quiet.trace("trace");
		quiet.dir({ a: 1 });
		quiet.table([1, 2]);
		quiet.assert(false, "assert");
		return 7;
	});
	assert.equal(result.value, 7);
	assert.deepEqual(
		result.diagnostics.map((diagnostic) => diagnostic.level),
		["log", "info", "warn", "error", "debug", "trace", "log", "log", "error"],
	);
	assert.deepEqual(
		result.diagnostics.map((diagnostic) => diagnostic.message),
		["log", "info", "warn", "error", "debug", "trace", "{ a: 1 }", "[ 1, 2 ]", "Assertion failed: assert"],
	);
});

test("capture bounds diagnostics and escapes terminal controls", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet, MAX_DIAGNOSTICS, MAX_MESSAGE_LENGTH } = requireFixture(helperPath);
	const long = "x".repeat(MAX_MESSAGE_LENGTH * 3);

	const result = await capture(() => {
		quiet.error(long);
		for (let index = 0; index < MAX_DIAGNOSTICS + 7; index += 1) quiet.warn(`entry ${index}`);
	});
	assert.equal(result.diagnostics.length, MAX_DIAGNOSTICS);
	assert.equal(result.omitted, 8);
	assert.equal(result.diagnostics[0].message.length, MAX_MESSAGE_LENGTH);
	assert.ok(result.diagnostics[0].message.endsWith("..."));
	assert.equal(result.diagnostics[1].message, "entry 0");
	assert.equal(result.diagnostics.at(-1).message, `entry ${MAX_DIAGNOSTICS - 2}`);

	const escaped = await capture(() => {
		quiet.error("line\nbreak\u001b[31mred\u001b[0m\ttab\u0085\u2028end");
	});
	assert.equal(escaped.diagnostics[0].message, "line\\nbreak\\x1b[31mred\\x1b[0m\\ttab\\x85\\u2028end");
});

test("capture summarizes errors and objects without stacks, getters, or custom inspection", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet } = requireFixture(helperPath);

	const error = new Error("failed at /home/user/secret");
	error.code = "ERR_FIXTURE";
	error.input = "/relative";
	error.stack = "STACK_SENTINEL\n    at /home/user/private.js:1:1";
	const errorResult = await capture(() => quiet.error(error));
	assert.equal(
		errorResult.diagnostics[0].message,
		"Error: failed at /home/user/secret (code: ERR_FIXTURE) (input: /relative)",
	);
	assert.ok(!errorResult.diagnostics[0].message.includes("STACK_SENTINEL"));
	assert.ok(!errorResult.diagnostics[0].message.includes("private.js"));

	let chain = new Error("leaf");
	for (let depth = 0; depth < 100; depth++) {
		const parent = new Error("shared");
		parent.code = chain;
		parent.input = chain;
		chain = parent;
	}
	let rawLength = 0;
	const chainResult = await capture(
		() => quiet.error(chain),
		(raw) => {
			rawLength = raw.length;
			return raw;
		},
	);
	assert.ok(rawLength < 2000, `bounded formatting received ${rawLength} characters`);
	assert.match(chainResult.diagnostics[0].message, /shared/);

	const getterObject = {};
	Object.defineProperty(getterObject, "secret", {
		enumerable: true,
		get() {
			throw new Error("getter invoked");
		},
	});
	const getterResult = await capture(() => quiet.error(getterObject));
	assert.equal(getterResult.diagnostics[0].message, "{ secret: '[Getter]' }");

	const customInspect = {};
	Object.defineProperty(customInspect, Symbol.for("nodejs.util.inspect.custom"), {
		value() {
			throw new Error("custom inspect invoked");
		},
	});
	const inspectResult = await capture(() => quiet.error(customInspect));
	assert.equal(inspectResult.diagnostics[0].message, "{}");

	const circularError = new Error("circular");
	circularError.input = circularError;
	const circularResult = await capture(() => quiet.error(circularError));
	assert.equal(circularResult.diagnostics[0].message, "Error: circular (input: [Circular])");

	const circularObject = { name: "loop" };
	circularObject.self = circularObject;
	const objectResult = await capture(() => quiet.error(circularObject));
	assert.equal(objectResult.diagnostics[0].message, "{ name: 'loop', self: '[Circular]' }");
	const outer = new Error("outer");
	outer.input = { error };
	for (const value of [{ error }, [error], outer]) {
		const nested = await capture(() => quiet.error(value));
		assert.match(nested.diagnostics[0].message, /failed at/);
		assert.doesNotMatch(nested.diagnostics[0].message, /STACK_SENTINEL|private\.js/);
	}
});

test("capture applies a per-capture sanitizer before escaping and truncation", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet, MAX_MESSAGE_LENGTH } = requireFixture(helperPath);
	const secret = `sk-${"a".repeat(MAX_MESSAGE_LENGTH * 2)}`;
	const seen = [];

	const result = await capture(
		() => {
			quiet.error(`token=${secret}\nnext`);
			return 1;
		},
		(message) => {
			seen.push(message);
			return message.replace(secret, "[redacted]");
		},
	);
	assert.equal(result.value, 1);
	assert.equal(seen.length, 1);
	assert.ok(seen[0].includes(secret));
	assert.ok(seen[0].includes("\n"));
	assert.equal(result.diagnostics[0].message, "token=[redacted]\\nnext");

	const first = await capture(
		() => quiet.error("one"),
		(message) => `first:${message}`,
	);
	const second = await capture(() => quiet.error("two"));
	assert.equal(first.diagnostics[0].message, "first:one");
	assert.equal(second.diagnostics[0].message, "two");

	const failedSanitizer = await capture(
		() => quiet.error("secret"),
		() => {
			throw new Error("sanitizer failed");
		},
	);
	assert.equal(failedSanitizer.diagnostics[0].message, "[unredacted diagnostic omitted]");

	const invalidSanitizer = await capture(
		() => quiet.error("secret"),
		() => 42,
	);
	assert.equal(invalidSanitizer.diagnostics[0].message, "[invalid sanitized diagnostic]");
	await assert.rejects(
		capture(() => 1, "not a function"),
		/sanitize to be a function/,
	);
});

test("concurrent and nested captures keep diagnostics isolated", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet } = requireFixture(helperPath);
	const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

	const [first, second] = await Promise.all([
		capture(async () => {
			quiet.warn("first one");
			await delay(20);
			quiet.error("first two");
			return "first";
		}),
		capture(async () => {
			quiet.warn("second one");
			await delay(5);
			quiet.error("second two");
			await delay(20);
			return "second";
		}),
	]);
	assert.equal(first.value, "first");
	assert.equal(second.value, "second");
	assert.deepEqual(
		first.diagnostics.map((diagnostic) => diagnostic.message),
		["first one", "first two"],
	);
	assert.deepEqual(
		second.diagnostics.map((diagnostic) => diagnostic.message),
		["second one", "second two"],
	);

	const nested = await capture(async () => {
		quiet.log("outer before");
		const inner = await capture(() => {
			quiet.error("inner");
			return "inner value";
		});
		quiet.warn("outer after");
		return inner;
	});
	assert.equal(nested.value.value, "inner value");
	assert.deepEqual(
		nested.value.diagnostics.map((diagnostic) => diagnostic.message),
		["inner"],
	);
	assert.deepEqual(
		nested.diagnostics.map((diagnostic) => diagnostic.message),
		["outer before", "outer after"],
	);
});

test("capture preserves callback rejections and ignores late logs", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const { capture, console: quiet } = requireFixture(helperPath);

	const syncError = new Error("sync failure");
	await assert.rejects(
		capture(() => {
			quiet.error("before sync throw");
			throw syncError;
		}),
		(error) => error === syncError,
	);
	const asyncError = new Error("async failure");
	await assert.rejects(
		capture(async () => {
			quiet.error("before async throw");
			throw asyncError;
		}),
		(error) => error === asyncError,
	);

	const recovered = await capture(() => {
		quiet.log("after rejection");
		return "ok";
	});
	assert.equal(recovered.value, "ok");
	assert.deepEqual(
		recovered.diagnostics.map((diagnostic) => diagnostic.message),
		["after rejection"],
	);

	let releaseLate;
	const late = new Promise((resolve) => {
		releaseLate = resolve;
	});
	const lateResult = await capture(() => {
		setTimeout(() => {
			quiet.error("late");
			releaseLate();
		}, 10);
		quiet.log("during");
		return "value";
	});
	await late;
	assert.deepEqual(
		lateResult.diagnostics.map((diagnostic) => diagnostic.message),
		["during"],
	);
});

test("applying the helper leaves the process console intact", (t) => {
	const fixture = createFixture(t, "hoisted");
	const originalConsole = globalThis.console;
	const originalLog = console.log;
	const originalWrite = process.stdout.write;
	applyInstalledDefuddleDiagnostics(fixture.anchor);
	assert.equal(globalThis.console, originalConsole);
	assert.equal(console.log, originalLog);

	let output = "";
	process.stdout.write = (chunk) => {
		output += String(chunk);
		return true;
	};
	try {
		console.log("normal console");
	} finally {
		process.stdout.write = originalWrite;
	}
	assert.equal(output, "normal console\n");
});

test("the generated sidecar never writes to stdout or stderr", (t) => {
	const fixture = createFixture(t, "hoisted");
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const root = mkdtempSync(join(tmpdir(), "jouzu-defuddle-child-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const scriptPath = join(root, "child.cjs");
	const resultPath = join(root, "result.json");
	writeFileSync(
		scriptPath,
		`"use strict";
const fs = require("node:fs");
const { capture, console: quiet } = require(${JSON.stringify(helperPath)});
const resultPath = ${JSON.stringify(resultPath)};
function writeResult(value) {
	fs.writeFileSync(resultPath, JSON.stringify(value));
}
quiet.log("outside");
quiet.error("outside error");
(async () => {
	const result = await capture(async () => {
		quiet.log("inside log");
		quiet.info("inside info");
		quiet.warn("inside warn");
		quiet.error("inside error");
		quiet.debug("inside debug");
		quiet.trace("inside trace");
		quiet.dir({ nested: true });
		quiet.table([1, 2]);
		quiet.assert(false, "inside assert");
		setTimeout(() => quiet.error("late"), 10);
		return 1;
	});
	await new Promise((resolve) => setTimeout(resolve, 25));
	writeResult({ ok: true, value: result.value, count: result.diagnostics.length });
})().catch((error) => {
	writeResult({ ok: false, error: error && error.stack ? error.stack : String(error) });
	process.exitCode = 1;
});
`,
	);
	const child = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", timeout: 30_000 });
	assert.equal(child.status, 0, child.stderr);
	assert.equal(child.stdout, "");
	assert.equal(child.stderr, "");
	assert.deepEqual(JSON.parse(readFileSync(resultPath, "utf8")), { ok: true, value: 1, count: 9 });
});

test("patched real Defuddle metadata captures relative canonical URL warnings", async (t) => {
	const fixture = createFixture(t, "hoisted");
	const realDist = dirname(requireHere.resolve("defuddle"));
	writeFileSync(join(fixture.dist, "metadata.js"), readFileSync(join(realDist, "metadata.js")));
	writeFileSync(join(fixture.dist, "utils.js"), readFileSync(join(realDist, "utils.js")));
	const { helperPath } = applyInstalledDefuddleDiagnostics(fixture.anchor);
	const sidecar = requireFixture(helperPath);
	const metadata = requireFixture(join(fixture.dist, "metadata.js"));
	const { document } = parseHTML(
		'<html><head><link rel="canonical" href="/relative"><title>Fixture title</title></head><body><h1>Fixture title</h1></body></html>',
	);

	const result = await sidecar.capture(() => metadata.MetadataExtractor.extract(document, {}, []));
	assert.equal(result.value.title, "Fixture title");
	assert.equal(result.value.domain, "");
	assert.equal(result.diagnostics.length, 1);
	assert.equal(result.diagnostics[0].level, "warn");
	assert.match(result.diagnostics[0].message, /Failed to parse URL: TypeError: Invalid URL/);
	assert.match(result.diagnostics[0].message, /ERR_INVALID_URL/);
	assert.match(result.diagnostics[0].message, /input: \/relative/);
	assert.ok(!result.diagnostics[0].message.includes("\n"));
});

test("fails clearly when the known Defuddle layout changes", (t) => {
	const missing = createFixture(t, "hoisted");
	rmSync(join(missing.dist, "metadata.js"));
	assert.throws(
		() => applyInstalledDefuddleDiagnostics(missing.anchor),
		/Defuddle package layout changed: missing .*metadata\.js/,
	);

	const noConsole = createFixture(t, "hoisted");
	for (const [path] of Object.entries(FIXTURE_FILES)) {
		if (!path.endsWith(".js")) continue;
		writeFileSync(join(noConsole.defuddle, path), '"use strict";\nmodule.exports = {};\n');
	}
	assert.throws(
		() => applyInstalledDefuddleDiagnostics(noConsole.anchor),
		/Defuddle package layout changed: no console usage found/,
	);

	const movedEntry = createFixture(t, "hoisted");
	const manifestPath = join(movedEntry.defuddle, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	delete manifest.exports;
	manifest.main = "lib/index.js";
	writeFileSync(manifestPath, JSON.stringify(manifest));
	mkdirSync(join(movedEntry.defuddle, "lib"), { recursive: true });
	writeFileSync(join(movedEntry.defuddle, "lib", "index.js"), "");
	assert.throws(
		() => applyInstalledDefuddleDiagnostics(movedEntry.anchor),
		/Defuddle package layout changed: expected the package entry under dist/,
	);

	const localConsole = createFixture(t, "hoisted");
	writeFileSync(join(localConsole.dist, "defuddle.js"), '"use strict";\nconst console = {};\nconsole.log("local");\n');
	assert.throws(() => applyInstalledDefuddleDiagnostics(localConsole.anchor), /already declares a console binding/);

	const malformed = createFixture(t, "hoisted");
	writeFileSync(join(malformed.dist, "defuddle.js"), `"use strict";\n${MARKER_START}\nconsole.warn("unterminated");\n`);
	assert.throws(() => applyInstalledDefuddleDiagnostics(malformed.anchor), /1 start and 0 end markers/);

	const missingPackage = createFixture(t, "hoisted");
	rmSync(join(missingPackage.anchor, "package.json"));
	assert.throws(
		() => applyInstalledDefuddleDiagnostics(missingPackage.anchor),
		/pi-webaio root is missing package\.json/,
	);
});
