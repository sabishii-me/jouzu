import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPromptHook } from "../../../scripts/fixtures/prompt-hook.mjs";
import { buildModelGuidance } from "../dist/model-guidance.js";
import { createJouzuPresentationExtension } from "../dist/presentation.js";
import { childResourceLoader } from "../dist/subagents/worker.js";

const base =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
function hook() {
	const handlers = new Map();
	createJouzuPresentationExtension({}, {}).factory({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand() {},
		registerTool() {},
	});
	return handlers.get("before_agent_start");
}

function assertRecoveryGuidance(prompt) {
	for (const clause of [
		"diagnosis and failure reports are intermediate results, not completion",
		"Do not weaken checks, bypass failures, or silently reduce the requested scope",
		"If the user explicitly requests diagnosis only, review only, or otherwise limits changes, respect that boundary",
		"Keep the original deliverables active while resolving prerequisites",
		"apply that instruction in the same turn",
		"Preserve running jobs and pending work across follow-up messages",
		"compare the requested deliverables with the overall completion checklist, completed work, and verification evidence",
		"A failed check or unsuccessful first attempt is not by itself a reason to stop",
		"use the supported wait mechanism and resume on its result",
		"overall completion checklist",
		"use them selectively for bounded, coherent work packages",
		"In cascade mode, an in_progress task is prompted before pending tasks",
		"A task list is an execution aid, not proof of completion",
	]) {
		assert.ok(prompt.includes(clause), `Missing recovery instruction: ${clause}`);
	}
}

test("Astra guidance follows the selected model on every turn without accumulating", async () => {
	const before = hook();
	const turn = (ctx) => runPromptHook(before, { systemPrompt: base, options: { selectedTools: ["read"] }, ctx });
	const astra = { model: { id: "gpt-6-astra", provider: "configured-provider" } };
	const first = turn(astra);
	assert.match(first.systemPrompt, /carry authorized work through implementation/);
	assert.match(
		first.systemPrompt,
		/Do not stop at acknowledging capability, proposing a plan, or offering to continue/,
	);
	assert.match(first.systemPrompt, /continue without ending the turn to clarify/);
	assert.match(
		first.systemPrompt,
		/diagnose and fix the issues you identify within the requested scope, then verify the fixes/,
	);
	assert.match(first.systemPrompt, /Do not stop at findings or ask whether to implement an authorized fix/);
	assert.match(
		first.systemPrompt,
		/If the user explicitly requests diagnosis only, review only, or otherwise limits changes, respect that boundary/,
	);
	assert.match(first.systemPrompt, /Authorization persists across turns/);
	assertRecoveryGuidance(first.systemPrompt);
	assert.match(first.systemPrompt, /repeat or broaden testing only/);
	assert.match(first.systemPrompt, /overall completion checklist/);
	assert.match(first.systemPrompt, /use them selectively for bounded, coherent work packages/);
	assert.match(first.systemPrompt, /A task list is an execution aid, not proof of completion/);
	assert.doesNotMatch(first.systemPrompt, /Use `subagent`/);
	const other = turn({ model: { id: "gpt-5.6-sol" } });
	assert.doesNotMatch(other.systemPrompt, /carry authorized work through implementation/);
	// Each run starts from fresh options, so guidance is set once per turn and never accumulates.
	assert.deepEqual(turn(astra).sections, first.sections);
	assert.equal(first.systemPrompt.split("carry authorized work through implementation").length, 2);
});

test("delegation guidance describes only the active Jouzu tool", () => {
	assert.match(buildModelGuidance("gpt-6-astra", ["subagent"]), /Follow its role-discovery and assignment contract/);
	assert.doesNotMatch(buildModelGuidance("gpt-6-astra", ["read"]), /subagent|configured roles/);
	for (const id of [undefined, "gpt-6-astra-preview", "custom-gpt-6-astra", "gpt-5.6-sol"])
		assert.equal(buildModelGuidance(id, ["subagent"]), "");
});

test("Astra guidance keeps one scope boundary and evidence rule after deduplication", () => {
	const guidance = buildModelGuidance("gpt-6-astra", ["subagent"]);
	assert.equal(guidance.match(/respect that boundary/g)?.length, 1);
	assert.equal(guidance.match(/do not mark work complete or report success without the required evidence/g)?.length, 1);
	assert.match(guidance, /Use task dependencies, user-input holds, pauses, or agent_wait for blocked work/);
	assert.match(guidance, /verify child evidence and the integrated result before reporting completion/);
	assert.ok(guidance.length < 5650, "keep this wording-only pass below the prior 5981-character guidance");
});

test("child sessions receive the same model guidance as main sessions", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-child-model-guidance-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const launch = (id) => ({
		cwd: root,
		directory: root,
		task: "task",
		role: { id: "reviewer", instructions: "Review the change.", tools: ["read"], judging: true },
		model: { id, provider: "configured-provider" },
		auth: {},
	});
	const astraPrompt = (await childResourceLoader(launch("gpt-6-astra"))).getAppendSystemPrompt();
	assert.ok(astraPrompt.includes("Review the change."));
	assert.ok(astraPrompt.includes(buildModelGuidance("gpt-6-astra", ["read"])));
	assert.match(astraPrompt.join("\n"), /offering to continue/);
	assertRecoveryGuidance(astraPrompt.join("\n"));
	const other = (await childResourceLoader(launch("gpt-5.6-sol"))).getAppendSystemPrompt();
	assert.ok(other.includes("Review the change."));
	assert.doesNotMatch(other.join("\n"), /carry authorized work through implementation/);
});

test("explicit custom system prompts remain user-owned", () => {
	const run = runPromptHook(hook(), {
		systemPrompt: "Review only.",
		options: { customPrompt: "Review only.", selectedTools: ["subagent"] },
		ctx: { model: { id: "gpt-6-astra" } },
	});
	assert.equal(run.result, undefined);
	assert.deepEqual(run.sections, {});
	assert.equal(run.systemPrompt, "Review only.");
});
