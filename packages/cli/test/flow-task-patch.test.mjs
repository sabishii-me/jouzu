import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyInstalledTaskFlow, applyTaskFlow } from "../../../scripts/apply-task-flow.mjs";

const installed = new URL("../node_modules/@lhl/pi-tasks/", import.meta.url);

test("installed task adapter is pinned and idempotent", async () => {
	assert.equal(await applyInstalledTaskFlow(true), 0);
	assert.equal(await applyInstalledTaskFlow(), 0);
	const source = await readFile(new URL("src/index.ts", installed), "utf8");
	assert.ok(source.includes("taskFlow.send"));
	assert.ok(source.includes("taskFlow.connect"));
	assert.ok(source.includes("taskFlow.registerTool"));
});
for (const variant of ["source", "runtime", "package"])
	test(`task patch refuses unexpected ${variant} without rewriting it`, async (t) => {
		const root = await mkdtemp(join(tmpdir(), "jouzu-task-patch-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		await mkdir(join(root, "src"));
		for (const path of ["package.json", "src/index.ts", "src/jouzu-flow.ts"])
			await writeFile(join(root, path), await readFile(new URL(path, installed)));
		const target = variant === "source" ? "src/index.ts" : variant === "runtime" ? "src/jouzu-flow.ts" : "package.json";
		const original = await readFile(join(root, target), "utf8");
		const altered =
			variant === "package"
				? JSON.stringify({ ...JSON.parse(original), version: "99.0.0" })
				: `${original}\n// unrecognized change\n`;
		await writeFile(join(root, target), altered);
		await assert.rejects(applyTaskFlow(root), /differs/);
		assert.equal(await readFile(join(root, target), "utf8"), altered);
	});
