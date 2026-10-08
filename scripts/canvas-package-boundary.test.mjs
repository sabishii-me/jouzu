import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertExternalCanvas, canvasVersion, externalizeBundledCanvas } from "./canvas-package-boundary.mjs";

function manifest(root, path, value) {
	const file = join(root, path, "package.json");
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(value));
}

test("externalizes nested canvas without removing unrelated native packages or the direct copy", () => {
	const root = mkdtempSync(join(tmpdir(), "canvas-boundary-"));
	try {
		manifest(root, "", { dependencies: { "@napi-rs/canvas": canvasVersion } });
		manifest(root, "node_modules/@napi-rs/canvas", { name: "@napi-rs/canvas", version: canvasVersion });
		manifest(root, "node_modules/pdf-parse", { name: "pdf-parse", dependencies: { "@napi-rs/canvas": canvasVersion } });
		const nested = "node_modules/pdf-parse/node_modules/@napi-rs/canvas";
		manifest(root, nested, { name: "@napi-rs/canvas", version: canvasVersion });
		manifest(root, `${nested}-linux-x64-gnu`, { name: "@napi-rs/canvas-linux-x64-gnu", version: canvasVersion });
		manifest(root, "node_modules/pdf-parse/node_modules/unrelated", { name: "unrelated" });
		manifest(root, "node_modules/pdf-parse/node_modules/pdfjs-dist", {
			name: "pdfjs-dist",
			optionalDependencies: { "@napi-rs/canvas": `^${canvasVersion}` },
		});
		externalizeBundledCanvas(root);
		const pdfjs = JSON.parse(
			readFileSync(join(root, "node_modules/pdf-parse/node_modules/pdfjs-dist/package.json"), "utf8"),
		);
		assert.equal(pdfjs.optionalDependencies["@napi-rs/canvas"], undefined);
		assert.equal(existsSync(join(root, nested)), false);
		assert.equal(existsSync(join(root, `${nested}-linux-x64-gnu`)), false);
		assert.ok(existsSync(join(root, "node_modules/@napi-rs/canvas")));
		assert.ok(existsSync(join(root, "node_modules/pdf-parse/node_modules/unrelated")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rejects bundled canvas and platform bindings for every packing host", () => {
	const pkg = { dependencies: { "@napi-rs/canvas": canvasVersion } };
	assert.doesNotThrow(() => assertExternalCanvas([], pkg));
	for (const name of [
		"canvas",
		"canvas-win32-x64-msvc",
		"canvas-darwin-arm64",
		"canvas-linux-x64-gnu",
		"canvas-linux-x64-musl",
	]) {
		assert.throws(
			() => assertExternalCanvas([{ path: `node_modules/pdf-parse/node_modules/@napi-rs/${name}/package.json` }], pkg),
			/bundled canvas/,
		);
	}
	assert.throws(() => assertExternalCanvas([], {}), /external/);
	assert.throws(() => assertExternalCanvas([], { ...pkg, bundleDependencies: ["@napi-rs/canvas"] }), /external/);
});
