import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertPortableBundledPackages } from "./portable-package-boundary.mjs";

function fixture(t, metadata) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-portable-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = "node_modules/extension/node_modules/@native/binding/package.json";
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), JSON.stringify(metadata));
	return { root, files: [{ path }] };
}

test("rejects nested build-host native packages on any host", (t) => {
	const { root, files } = fixture(t, {
		name: "@napi-rs/canvas-linux-x64-gnu",
		os: ["linux"],
		cpu: ["x64"],
		libc: ["glibc"],
	});
	assert.throws(() => assertPortableBundledPackages(root, files), /canvas-linux-x64-gnu.*os, cpu, libc/);
});

test("does not mistake multi-platform assets for host-selected packages", (t) => {
	const { root, files } = fixture(t, { name: "portable-native-wrapper", files: ["native"] });
	assert.doesNotThrow(() => assertPortableBundledPackages(root, files));
});

test("rejects CPU-only restrictions", (t) => {
	const { root, files } = fixture(t, { name: "native-x64", cpu: ["x64"] });
	assert.throws(() => assertPortableBundledPackages(root, files), /native-x64.*cpu/);
});

test("ignores metadata not shipped in the bundle", (t) => {
	const { root } = fixture(t, { name: "unpacked", os: ["linux"] });
	assert.doesNotThrow(() => assertPortableBundledPackages(root, [{ path: "dist/cli.js" }]));
});
