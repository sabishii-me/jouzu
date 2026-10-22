#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ensureJouzuCamoufoxRuntimeInstalled,
	importJouzuCamoufoxModules,
	resolveCamoufoxRuntimePaths,
} from "../packages/cli/dist/camoufox-adapter.js";

// Check the production client-import path without Firefox's system libraries.
// A child process releases native modules before temporary files are removed.
if (process.argv[2] === "--probe") {
	assert.ok(process.argv[3], "the probe requires an isolated state directory");
	const { camoufoxPi, camoufoxJs } = await importJouzuCamoufoxModules(resolveCamoufoxRuntimePaths(process.argv[3]));
	assert.equal(typeof camoufoxPi.CamoufoxClient, "function");
	assert.equal(typeof camoufoxPi.RealLauncher, "function");
	assert.equal(typeof camoufoxJs.launchOptions, "function");
	const nativeImports = Object.keys(createRequire(import.meta.url).cache).filter((path) =>
		/[\\/]node_modules[\\/]impit(?:[\\/]|-)/u.test(path),
	);
	assert.deepEqual(nativeImports, [], "default browsing must not load the unused Impit transport");
	console.log("Camoufox client imports passed without loading Impit; no browser was launched.");
} else {
	const state = mkdtempSync(join(tmpdir(), "jouzu-camoufox-client-"));
	try {
		await ensureJouzuCamoufoxRuntimeInstalled(state, AbortSignal.timeout(5 * 60 * 1000));
		const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--probe", state], {
			stdio: "inherit",
			timeout: 30_000,
		});
		if (child.error) throw child.error;
		assert.equal(child.status, 0, `Camoufox import probe failed (${child.signal ?? child.status})`);
	} finally {
		rmSync(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
	}
}
