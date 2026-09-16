import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyInstalledTaskFlow, applyTaskFlow } from "../../../scripts/apply-task-flow.mjs";

const installed = new URL("../node_modules/@lhl/pi-tasks/", import.meta.url);

test("task metadata upgrade replaces only the pinned preceding runtime", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-task-upgrade-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "src"));
	for (const path of ["package.json", "src/index.ts"])
		await writeFile(join(root, path), await readFile(new URL(path, installed)));
	const runtime = await readFile(new URL("src/jouzu-flow.ts", installed), "utf8");
	const previous = runtime
		.replace("; subject: string; status: string; reason?: string; blockedBy: string[]; }", "; }")
		.split("\n")
		.filter((line) => !line.startsWith("\t\tconst blockedBy =") && !line.startsWith("\t\tconst reason ="))
		.join("\n")
		.replace("state, subject: task.subject, status: task.status, reason, blockedBy, revision:", "state, revision:");
	const lock = JSON.parse(
		await readFile(new URL("../../../upstream/task-flow/patch.lock.json", import.meta.url), "utf8"),
	);
	assert.equal(createHash("sha256").update(previous).digest("hex"), lock.previousRuntime);
	await writeFile(join(root, "src/jouzu-flow.ts"), previous);
	await assert.rejects(applyTaskFlow(root, true), /differs/);
	assert.equal(await readFile(join(root, "src/jouzu-flow.ts"), "utf8"), previous);
	assert.equal(await applyTaskFlow(root), 1);
	assert.equal(await readFile(join(root, "src/jouzu-flow.ts"), "utf8"), runtime);
	assert.equal(await applyTaskFlow(root, true), 0);
});

test("task navigation upgrade replaces only the pinned preceding source", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-task-navigation-upgrade-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "src"));
	for (const path of ["package.json", "src/jouzu-flow.ts"])
		await writeFile(join(root, path), await readFile(new URL(path, installed)));
	const source = await readFile(new URL("src/index.ts", installed), "utf8");
	const start = source.indexOf("  // Tree navigation replaces the flow branch");
	const end = source.indexOf("  // message_start is the delivery-time signal", start);
	assert.ok(start >= 0 && end > start);
	const previous = source.slice(0, start) + source.slice(end);
	const lock = JSON.parse(
		await readFile(new URL("../../../upstream/task-flow/patch.lock.json", import.meta.url), "utf8"),
	);
	assert.equal(createHash("sha256").update(previous).digest("hex"), lock.previousAfter);
	await writeFile(join(root, "src/index.ts"), previous);
	await assert.rejects(applyTaskFlow(root, true), /differs/);
	assert.equal(await readFile(join(root, "src/index.ts"), "utf8"), previous);
	assert.equal(await applyTaskFlow(root), 1);
	assert.equal(await readFile(join(root, "src/index.ts"), "utf8"), source);
	assert.equal(await applyTaskFlow(root, true), 0);
});

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
