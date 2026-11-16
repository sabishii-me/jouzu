import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProtectedStateExtension } from "../dist/protected-state-policy.js";

function handlerFor(roots) {
	let handler;
	createProtectedStateExtension(roots).factory({
		on(name, fn) {
			if (name === "tool_call") handler = fn;
		},
	});
	return (toolName, input, cwd) => handler({ type: "tool_call", toolCallId: "t", toolName, input }, { cwd });
}

test("file tools cannot write Jouzu state or cache, by any spelling of the path", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-protected-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const state = join(root, "home", "state");
	const cache = join(root, "home", "cache");
	const workspace = join(root, "workspace");
	await mkdir(join(cache, "textguard"), { recursive: true });
	await mkdir(state, { recursive: true });
	await mkdir(workspace, { recursive: true });
	await symlink(cache, join(workspace, "linked-cache"));
	const call = handlerFor([state, cache]);
	for (const [tool, path] of [
		["write", join(cache, "textguard", "approvals.json")],
		["edit", join(state, "flow", "journal.jsonl")],
		["write", `@${join(cache, "textguard", "approvals.json")}`],
		["write", "../home/cache/textguard/approvals.json"],
		["write", "linked-cache/textguard/approvals.json"],
		["write", "linked-cache/new-folder/file.json"],
		["edit", cache],
	]) {
		const result = call(tool, { path, content: "{}" }, workspace);
		assert.equal(result?.block, true, `${tool} ${path}`);
		assert.match(result.reason, /read-only for tools/);
	}
});

test("other paths and tools that do not write files are unaffected", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-protected-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const cache = join(root, "home", "cache");
	const workspace = join(root, "workspace");
	await mkdir(cache, { recursive: true });
	await mkdir(workspace, { recursive: true });
	const call = handlerFor([cache]);
	assert.equal(call("write", { path: "notes.md", content: "x" }, workspace), undefined);
	assert.equal(call("write", { path: join(root, "home", "cache-sibling", "x") }, workspace), undefined);
	assert.equal(call("read", { path: join(cache, "textguard", "approvals.json") }, workspace), undefined);
	assert.equal(call("write", { content: "no path" }, workspace), undefined);
});
