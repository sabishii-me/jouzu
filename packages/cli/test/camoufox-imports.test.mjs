import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { importJouzuCamoufoxModules, resolveCamoufoxRuntimePaths } from "../dist/camoufox-adapter.js";

function fixture(
	t,
	{ native = 'exports.Impit = class {}; throw new Error("native binding unavailable");', client } = {},
) {
	const state = mkdtempSync(join(tmpdir(), "jouzu browser 日本語 "));
	t.after(() => rmSync(state, { recursive: true, force: true }));
	const paths = resolveCamoufoxRuntimePaths(state);
	function file(name, contents) {
		const path = join(paths.installRoot, "node_modules", name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, contents);
		return path;
	}
	for (const name of ["camoufox-js", "@the-forge-flow/camoufox-pi"]) {
		file(`${name}/package.json`, JSON.stringify({ name, type: "module", exports: "./index.js" }));
	}
	file("impit/package.json", JSON.stringify({ name: "impit", main: "index.cjs" }));
	file("impit/index.cjs", native);
	const original = 'import { Impit } from "impit";\nexport { Impit };\n';
	const ipPath = file("camoufox-js/dist/ip.js", original);
	file("camoufox-js/index.js", 'export { Impit } from "./dist/ip.js";\nexport const launchOptions = () => ({});\n');
	file(
		"@the-forge-flow/camoufox-pi/index.js",
		client ?? 'export { Impit } from "camoufox-js";\nexport class CamoufoxClient {}\n',
	);
	return { paths, ipPath, original, file };
}

test("browser modules import without loading unused native IP discovery", async (t) => {
	const f = fixture(t);
	const { camoufoxPi, camoufoxJs } = await importJouzuCamoufoxModules(f.paths);
	assert.equal(typeof camoufoxPi.CamoufoxClient, "function");
	assert.equal(typeof camoufoxJs.launchOptions, "function");
	assert.equal(readFileSync(f.ipPath, "utf8"), f.original, "upstream source remains byte-identical");
	assert.throws(
		() => new camoufoxJs.Impit(),
		/native binding unavailable/u,
		"explicit use still loads the native client",
	);
});

test("deferred construction preserves native arguments and methods after hooks are removed", async (t) => {
	const f = fixture(t, {
		native: "exports.Impit = class { constructor(options) { this.options = options; } fetch(url) { return url; } };",
	});
	const { camoufoxJs } = await importJouzuCamoufoxModules(f.paths);
	const options = { proxyUrl: "http://proxy.example:8080", timeout: 5000 };
	const client = new camoufoxJs.Impit(options);
	assert.equal(client.options, options);
	assert.equal(client.fetch("https://example.com"), "https://example.com");
});

test("native construction during module evaluation does not recurse through the import hook", async (t) => {
	const f = fixture(t, {
		native: 'exports.Impit = class { identity = "native"; };',
		client: 'import { Impit } from "camoufox-js";\nexport const client = new Impit();\n',
	});
	const { camoufoxPi } = await importJouzuCamoufoxModules(f.paths);
	assert.equal(camoufoxPi.client.identity, "native");
});

test("a runtime path alias still scopes the hook to the canonical IP module", async (t) => {
	const f = fixture(t);
	const alias = join(f.paths.root, "runtime-alias");
	symlinkSync(f.paths.installRoot, alias, "junction");
	const { camoufoxJs } = await importJouzuCamoufoxModules({ ...f.paths, installRoot: alias });
	assert.equal(typeof camoufoxJs.launchOptions, "function");
	assert.throws(() => new camoufoxJs.Impit(), /native binding unavailable/u);
});

test("imports outside Camoufox IP discovery keep their native binding failures", async (t) => {
	const f = fixture(t, { client: 'import { Impit } from "impit";\nexport { Impit };\n' });
	await assert.rejects(importJouzuCamoufoxModules(f.paths), /native binding unavailable/u);
	const other = fixture(t);
	const { camoufoxJs } = await importJouzuCamoufoxModules(other.paths);
	assert.equal(typeof camoufoxJs.launchOptions, "function");
	const direct = other.file("direct-probe.mjs", 'export { Impit } from "impit";\n');
	await assert.rejects(import(pathToFileURL(direct).href), /native binding unavailable/u);
});

test("a failed client import removes the hook before a direct IP-module import", async (t) => {
	const f = fixture(t, { client: 'throw new Error("client import failed");\n' });
	await assert.rejects(importJouzuCamoufoxModules(f.paths), /client import failed/u);
	await assert.rejects(import(pathToFileURL(f.ipPath).href), /native binding unavailable/u);
});

test("concurrent runtime imports keep native constructors isolated", async (t) => {
	const first = fixture(t, { native: 'exports.Impit = class { identity = "first"; };' });
	const second = fixture(t, { native: 'exports.Impit = class { identity = "second"; };' });
	const [a, b, repeated] = await Promise.all([
		importJouzuCamoufoxModules(first.paths),
		importJouzuCamoufoxModules(second.paths),
		importJouzuCamoufoxModules(first.paths),
	]);
	assert.equal(new a.camoufoxJs.Impit().identity, "first");
	assert.equal(new b.camoufoxJs.Impit().identity, "second");
	assert.equal(repeated.camoufoxJs, a.camoufoxJs);
});
