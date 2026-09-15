import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
test("Windows network acceptance fixture exercises the built CLI", { timeout: 240_000 }, async () => {
	const root = resolve(import.meta.dirname, "../../..");
	const { stdout } = await run(
		process.execPath,
		[resolve(root, "packaging/windows/network.test.mjs"), resolve(root, "packages/cli/dist/cli.js"), tmpdir()],
		{ timeout: 230_000, maxBuffer: 1024 * 1024 },
	);
	assert.match(stdout, /streamed inference and model rejection passed/u);
});
