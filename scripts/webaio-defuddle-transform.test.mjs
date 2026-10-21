import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { applyInstalledDefuddleDiagnostics, resolveDefuddleSource } from "./apply-webaio-defuddle-quiet.mjs";
import {
	applyInstalledWebaioDiagnosticBridge,
	transformWebaioDiagnosticCapture,
	transformWebaioDiagnosticHistory,
} from "./webaio-defuddle-transform.mjs";

const root = resolve(import.meta.dirname, "..");
const cliModules = join(root, "packages/cli/node_modules");
const installedWebaio = join(cliModules, "pi-webaio");
const relativeRelease = "/ME3Tweaks/LegendaryExplorer/releases/tag/6.5.0.6522";
const html = (canonical, body = "Fixture release notes. ".repeat(100)) =>
	`<html><head><title>Release notes</title><link rel="canonical" href="${canonical}"></head><body><main><h1>Release notes</h1><p>${body}</p></main></body></html>`;

function linkChildren(source, target, exclude = []) {
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSync(source, { withFileTypes: true })) {
		if (exclude.includes(entry.name) || entry.name.startsWith(".")) continue;
		const destination = join(target, entry.name);
		symlinkSync(join(source, entry.name), destination, entry.isDirectory() ? "junction" : "file");
	}
}

async function fixture(t) {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-defuddle-history-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const webaio = join(temporary, "node_modules/pi-webaio");
	mkdirSync(webaio, { recursive: true });
	linkChildren(cliModules, join(temporary, "node_modules"), ["pi-webaio"]);
	cpSync(join(installedWebaio, "package.json"), join(webaio, "package.json"));
	cpSync(join(installedWebaio, "dist"), join(webaio, "dist"), { recursive: true });
	// Rebuild only the two patched modules in this isolated fixture. The live install may already
	// carry a different revision of our bridge, which must not be mistaken for pristine input.
	const ts = createRequire(import.meta.url)("typescript");
	for (const name of ["webfetch-api", "jouzu-extension"]) {
		const source = readFileSync(join(installedWebaio, "src", `${name}.ts`), "utf8");
		const { outputText } = ts.transpileModule(source, {
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.ESNext,
				rewriteRelativeImportExtensions: true,
			},
			fileName: `${name}.ts`,
		});
		writeFileSync(join(webaio, "dist/src", `${name}.js`), outputText);
	}
	linkChildren(join(installedWebaio, "node_modules"), join(webaio, "node_modules"), ["defuddle"]);
	const originalDefuddle = dirname(dirname(resolveDefuddleSource(installedWebaio)));
	const defuddle = join(webaio, "node_modules/defuddle");
	cpSync(originalDefuddle, defuddle, { recursive: true });
	// Older development trees have the preceding suppression patch. Restore those calls in this
	// isolated fixture so the capture test also covers main-parser errors rather than only warnings.
	const main = join(defuddle, "dist/defuddle.js");
	writeFileSync(main, readFileSync(main, "utf8").replaceAll("if (false) console.error(", "console.error("));
	applyInstalledDefuddleDiagnostics(webaio);
	applyInstalledWebaioDiagnosticBridge(webaio);
	const apiPath = join(webaio, "dist/src/webfetch-api.js");
	const key = "jouzu-defuddle-test-dependencies";
	writeFileSync(
		apiPath,
		readFileSync(apiPath, "utf8").replace(
			"const defaultFetcher = createStaticWebFetcher();",
			`const defaultFetcher = createStaticWebFetcher(globalThis[Symbol.for("${key}")]);`,
		),
	);
	const pages = new Map();
	const dependencies = {
		validateUrl: async () => ({ dangerous: false, pinnedIps: ["93.184.216.34"] }),
		createTransport: async () => ({ close: async () => {} }),
		request: async (url) =>
			new Response(pages.get(url) ?? html("https://example.com/"), {
				status: 200,
				headers: { "Content-Type": "text/html" },
			}),
	};
	globalThis[Symbol.for(key)] = dependencies;
	let api;
	let tools;
	try {
		api = await import(pathToFileURL(apiPath));
		tools = (await import(pathToFileURL(join(webaio, "dist/src/jouzu-extension.js")))).__test__;
	} finally {
		delete globalThis[Symbol.for(key)];
	}
	const require = createRequire(join(webaio, "package.json"));
	const capture = require(join(defuddle, "dist/jouzu-diagnostics.cjs"));
	return {
		api,
		tools,
		pages,
		capture,
		webaio,
		registry: require(join(defuddle, "dist/extractor-registry.js")).ExtractorRegistry,
	};
}

test("WebAIO diagnostic transforms are stable and reject changed anchors", () => {
	for (const [name, transform] of [
		["webfetch-api.js", transformWebaioDiagnosticCapture],
		["jouzu-extension.js", transformWebaioDiagnosticHistory],
	]) {
		const source = readFileSync(join(installedWebaio, "dist/src", name), "utf8");
		const result = transform(source);
		assert.equal(transform(result), result);
		assert.throws(() => transform("export const changed = true;"), /anchor changed/);
	}
});

test("Defuddle diagnostics survive single and concurrent batch tool results without raw console writes", async (t) => {
	const f = await fixture(t);
	const originalWarn = console.warn;
	const originalError = console.error;
	const leaked = [];
	console.warn = (...args) => leaked.push(args);
	console.error = (...args) => leaked.push(args);
	t.after(() => {
		console.warn = originalWarn;
		console.error = originalError;
	});
	const url = "https://github.com/ME3Tweaks/LegendaryExplorer/releases/tag/6.5.0.6522";
	f.pages.set(url, html(relativeRelease));
	const result = await f.tools.createWebFetchTool().execute("single", { url }, undefined);
	assert.equal(result.details.ok, true);
	assert.match(result.content[0].text, /Extraction diagnostics \(Defuddle\):/);
	assert.match(result.content[0].text, /ERR_INVALID_URL/);
	assert.match(result.content[0].text, /Fixture release notes/);
	assert.equal(result.details.extractionDiagnostics.length, 1);
	assert.match(result.details.extractionDiagnostics[0].message, /\.5\.0\.6522/);
	assert.doesNotMatch(result.content[0].text, /at MetadataExtractor|\/home\//);
	// Tool content and details are the session's saved tool-result fields, not a console side effect.
	const saved = JSON.parse(JSON.stringify(result));
	assert.deepEqual(saved.details.extractionDiagnostics, result.details.extractionDiagnostics);
	const requests = [{ url }, { url: "https://example.com/second" }, { url: "https://example.com/clean" }];
	f.pages.set(requests[1].url, html("/second-canonical"));
	f.pages.set(requests[2].url, html("https://example.com/clean"));
	const batch = await f.tools.createBatchWebFetchTool().execute("batch", { requests }, undefined);
	assert.equal(batch.details.succeeded, 3);
	assert.equal(batch.details.items[0].extractionDiagnostics.length, 1);
	assert.match(batch.details.items[0].extractionDiagnostics[0].message, /\.5\.0\.6522/);
	assert.doesNotMatch(batch.details.items[0].extractionDiagnostics[0].message, /second-canonical/);
	assert.match(batch.details.items[1].extractionDiagnostics[0].message, /second-canonical/);
	assert.equal(batch.details.items[2].extractionDiagnostics, undefined);
	assert.deepEqual(leaked, []);
	const theme = { fg: (_color, text) => text, bold: (text) => text };
	for (const [tool, response] of [
		[f.tools.createWebFetchTool(), result],
		[f.tools.createBatchWebFetchTool(), batch],
	]) {
		const compact = tool.renderResult(response, { isPartial: false, expanded: false }, theme, {});
		assert.match(compact.render(120).join("\n"), /extraction diagnostic/);
		const expanded = tool.renderResult(response, { isPartial: false, expanded: true }, theme, {});
		assert.match(expanded.render(120).join("\n"), /ERR_INVALID_URL/);
	}
});

test("later batch diagnostics survive article byte and line truncation", async (t) => {
	const f = await fixture(t);
	for (const content of ["x".repeat(100000), "article line\n".repeat(3000)]) {
		const requests = [{ url: "https://example.com/large" }, { url: "https://example.com/later" }];
		const results = requests.map(({ url }, index) => ({
			ok: true,
			url,
			finalUrl: url,
			statusCode: 200,
			content: index ? "Later article" : content,
			...(index ? { extractionDiagnostics: [{ level: "warn", message: "Later request metadata warning" }] } : {}),
		}));
		const output = f.tools.truncateToolOutput(f.tools.batchResponseText(requests, results));
		assert.equal(output.truncated, true);
		assert.match(output.text, /Request 2: https:\/\/example.com\/later/);
		assert.match(output.text, /Later request metadata warning/);
	}
	const requests = Array.from({ length: 20 }, (_, index) => ({ url: `https://example.com/request-${index}` }));
	const results = requests.map(({ url }) => ({
		ok: true,
		url,
		finalUrl: url,
		statusCode: 200,
		content: "article".repeat(10000),
		extractionDiagnostics: Array.from({ length: 50 }, () => ({ level: "warn", message: "日本語".repeat(160) })),
	}));
	const single = f.tools.truncateToolOutput(f.tools.responseText(results[0]));
	assert.match(single.text, /article/);
	assert.match(single.text, /shortened; expand this tool/);
	const output = f.tools.truncateToolOutput(f.tools.batchResponseText(requests, results));
	assert.equal(output.truncated, true);
	assert.ok(Buffer.byteLength(output.text) <= 50000);
	for (let index = 1; index <= 20; index++) assert.match(output.text, new RegExp(`Request ${index}:`));
	assert.match(output.text, /shortened; expand this tool/);
});

test("fetch diagnostics reach the model and persisted session history", async (t) => {
	const f = await fixture(t);
	const { assembledSession } = await import("../packages/cli/test/fixtures/flow-assembly.mjs");
	const url = "https://example.com/history";
	f.pages.set(url, html("/history-canonical"));
	const assembled = await assembledSession(t, {
		persist: true,
		producerExtensions: [
			{
				name: "diagnostic-fetch-fixture",
				factory(pi) {
					pi.registerTool(f.tools.createWebFetchTool());
				},
			},
		],
		script: (_body, index) =>
			index === 0
				? { toolCalls: [{ name: "web_fetch", arguments: { url } }] }
				: { text: "Reviewed the fetched result." },
	});
	await assembled.session.prompt("Read the fixture page");
	await assembled.session.waitForIdle();
	assert.equal(assembled.bodies.length, 2);
	assert.match(JSON.stringify(assembled.bodies[1]), /ERR_INVALID_URL/);
	const history = readFileSync(assembled.sessionManager.getSessionFile(), "utf8");
	const toolResult = history
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
	assert.match(toolResult.message.content[0].text, /Extraction diagnostics/);
	assert.match(toolResult.message.details.extractionDiagnostics[0].message, /history-canonical/);
});

test("diagnostics are redacted before bounding and retained on fallback or failed fetch results", async (t) => {
	const f = await fixture(t);
	const originalFindExtractor = f.registry.findExtractor;
	f.registry.findExtractor = () => {
		throw new Error("Fixture extractor failure");
	};
	let fallback;
	try {
		fallback = await f.tools
			.createWebFetchTool()
			.execute("fallback", { url: "https://example.com/fallback" }, undefined);
	} finally {
		f.registry.findExtractor = originalFindExtractor;
	}
	assert.equal(fallback.details.ok, true, "Defuddle's fallback still returns the article");
	assert.match(fallback.content[0].text, /Fixture release notes/);
	assert.match(fallback.content[0].text, /Fixture extractor failure/);
	assert.ok(fallback.details.extractionDiagnostics.some((entry) => entry.level === "error"));
	const createFetcher = f.api.createStaticWebFetcher;
	const secret = "sensitiveCredential123";
	const fetcher = createFetcher({
		validateUrl: async () => ({ dangerous: false, pinnedIps: ["93.184.216.34"] }),
		createTransport: async () => ({ close: async () => {} }),
		request: async () => {
			f.capture.console.error(`api_key=${secret} ${"x".repeat(10000)}`);
			throw new Error("Fixture transport failure");
		},
	});
	const failed = await fetcher("https://example.com/failure", { maxRetries: 0 });
	assert.equal(failed.ok, false);
	assert.ok(failed.extractionDiagnostics.length);
	assert.doesNotMatch(JSON.stringify(failed.extractionDiagnostics), new RegExp(secret));
	assert.match(f.tools.responseText(failed), /Extraction diagnostics/);
	assert.ok(f.tools.detailsFrom(failed).extractionDiagnostics.length);
	const bounded = f.tools.truncateToolOutput(
		f.tools.responseText({
			...failed,
			ok: true,
			statusCode: 200,
			content: "a".repeat(100000),
		}),
	);
	assert.equal(bounded.truncated, true);
	assert.match(bounded.text, /^Extraction diagnostics/);
});
