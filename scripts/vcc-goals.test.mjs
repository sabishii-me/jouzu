import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { applyInstalledVccGoals, applyVccGoals } from "./apply-vcc-goals.mjs";
import { transforms } from "./vcc-goals-transform.mjs";

const packageRoot = resolve("packages/cli/node_modules/@sting8k/pi-vcc");
async function load(t) {
	const temp = await mkdtemp(join(tmpdir(), "jouzu-vcc-goals-"));
	t.after(() => rm(temp, { recursive: true, force: true }));
	const outfile = join(temp, "vcc.mjs");
	await build({
		stdin: {
			contents: `export { compile } from ${JSON.stringify(join(packageRoot, "src/core/summarize.ts"))}; export { normalize } from ${JSON.stringify(join(packageRoot, "src/core/normalize.ts"))}; export { filterNoise } from ${JSON.stringify(join(packageRoot, "src/core/filter-noise.ts"))}; export { extractGoals } from ${JSON.stringify(join(packageRoot, "src/extract/goals.ts"))};`,
			resolveDir: packageRoot,
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile,
	});
	return import(pathToFileURL(outfile).href);
}
const user = (content, eligible = true) => ({ role: "user", content, jouzuGoalEligible: eligible });
const goalSection = (summary) => summary.match(/\[Session Goal\]\n([\s\S]*?)(?=\n\[|\n---|$)/)?.[1] ?? "";

test("VCC goal patch checks both installed trees and is idempotent", async () => {
	assert.equal(await applyInstalledVccGoals(true), 0);
	assert.equal(await applyInstalledVccGoals(), 0);
});

test("notification content survives normalization but is excluded from goals and preserves recall indices", async (t) => {
	const { normalize, filterNoise, extractGoals } = await load(t);
	const messages = [
		user("Implement the notification result and fix all tests.", false),
		user("Fix the login timeout."),
	];
	const blocks = filterNoise(normalize(messages, [40, 41]));
	assert.equal(blocks[0].sourceIndex, 40);
	assert.equal(blocks[0].goalEligible, false);
	assert.match(blocks[0].text, /Implement the notification/);
	assert.deepEqual(extractGoals(blocks), ["Fix the login timeout."]);
});

test("legacy completion blocks cannot become goals and ordinary user discussion remains eligible", async (t) => {
	const { extractGoals } = await load(t);
	assert.deepEqual(
		extractGoals([
			{
				kind: "user",
				text: "Subagent batch abc.\nAgent reviewer (a12b-1234) completed.\nImplement the recommended fix.",
			},
		]),
		[],
	);
	assert.deepEqual(extractGoals([{ kind: "user", text: "Agent reviewer (a12b-1234) completed." }]), []);
	assert.deepEqual(
		extractGoals([
			{ kind: "user", goalEligible: true, text: "Subagent batch abc. Please investigate this notification." },
		]),
		["Subagent batch abc. Please investigate this notification."],
	);
	assert.deepEqual(extractGoals([{ kind: "user", text: "Fix Agent completion notifications in the summary." }]), [
		"Fix Agent completion notifications in the summary.",
	]);
});

test("repeated compaction preserves original goals and the latest real scope change", async (t) => {
	const { compile } = await load(t);
	let summary = compile({ messages: [user("Fix the login timeout.")], sourceIndices: [1] });
	for (let i = 0; i < 12; i++) {
		summary = compile({
			previousSummary: summary,
			messages: [user(`Agent reviewer (a12b-${i}) completed.\nImplement suggestion ${i}.`, false)],
			sourceIndices: [i + 2],
		});
		assert.match(goalSection(summary), /Fix the login timeout/);
		assert.doesNotMatch(goalSection(summary), /Agent reviewer|Implement suggestion/);
	}
	summary = compile({
		previousSummary: summary,
		messages: [user("Actually, switch to fixing the logout timeout.")],
		sourceIndices: [20],
	});
	assert.match(goalSection(summary), /Fix the login timeout/);
	assert.match(goalSection(summary), /\[Scope change\]/);
	assert.match(goalSection(summary), /logout timeout/);
	summary = compile({
		previousSummary: summary,
		messages: [user("Instead, fix the refresh timeout.")],
		sourceIndices: [21],
	});
	assert.match(goalSection(summary), /Fix the login timeout/);
	assert.match(goalSection(summary), /refresh timeout/);
	assert.doesNotMatch(goalSection(summary), /logout timeout/);
});

test("compaction cleans legacy notification goals without deleting useful transcript output", async (t) => {
	const { compile } = await load(t);
	const summary = compile({
		previousSummary: "[Session Goal]\n- Fix the login timeout.\n- Agent reviewer (a12b-1234) completed.",
		messages: [user("Build verification succeeded with 42 tests.", false)],
		sourceIndices: [10],
	});
	assert.match(goalSection(summary), /Fix the login timeout/);
	assert.doesNotMatch(goalSection(summary), /Agent reviewer|Build verification/);
	assert.match(summary, /Build verification succeeded/);
});

test("patch refuses unknown source before changing any files", async (t) => {
	const temp = await mkdtemp(join(tmpdir(), "jouzu-vcc-drift-"));
	t.after(() => rm(temp, { recursive: true, force: true }));
	const { cp } = await import("node:fs/promises");
	await cp(packageRoot, temp, { recursive: true });
	const path = join(temp, "src/core/normalize.ts");
	const source = await readFile(path, "utf8");
	await writeFile(path, `${source}\n// unexpected change\n`);
	await assert.rejects(applyVccGoals(temp), /source hash differs/);
	assert.equal(await readFile(path, "utf8"), `${source}\n// unexpected change\n`);
	assert.throws(() => transforms["src/core/normalize.ts"]("unknown source"), /source anchor differs/);
});

test("status updates do not replace the latest scope change", async (t) => {
	const { compile } = await load(t);
	let summary = compile({ messages: [user("Fix the login timeout.")] });
	for (const text of [
		"Actually, fix the logout timeout.",
		"The regression suite is green.",
		"The build passed.",
		"The test passed.",
	]) {
		summary = compile({ previousSummary: summary, messages: [user(text)] });
	}
	summary = compile({ previousSummary: summary, messages: [user("Build verification succeeded.", false)] });
	assert.match(goalSection(summary), /Fix the login timeout/);
	assert.match(goalSection(summary), /fix the logout timeout/);
	assert.doesNotMatch(goalSection(summary), /suite is green|Build verification|The build passed|The test passed/);
	const sameWindow = compile({
		messages: [
			user("Fix the login timeout."),
			user("Actually, fix the logout timeout."),
			user("The build passed."),
			user("The test passed."),
		],
	});
	assert.match(goalSection(sameWindow), /fix the logout timeout/);
	assert.doesNotMatch(goalSection(sameWindow), /The build passed|The test passed/);
	summary = compile({ previousSummary: summary, messages: [user("Please build the recovery command.")] });
	assert.match(goalSection(summary), /Please build the recovery command/);
});

test("original requirements and all scope bullets survive their independent caps", async (t) => {
	const { compile } = await load(t);
	const original = Array.from({ length: 6 }, (_, i) => `Implement original requirement ${i}.`);
	const changes = [
		"Actually, fix the logout timeout.",
		"Preserve the session cookie.",
		"Keep the existing retry limit.",
	];
	let summary = compile({ messages: [user(original.join("\n")), user(changes.join("\n"))] });
	for (let i = 0; i < 4; i++) {
		summary = compile({ previousSummary: summary, messages: [user("Agent reviewer (a12b-1234) completed.", false)] });
		for (const line of [...original, ...changes]) assert.ok(goalSection(summary).includes(line), line);
	}
});

test("fresh wrapped scope instructions retain their complete qualification", async (t) => {
	const { compile } = await load(t);
	const change =
		"Actually, fix the logout timeout while preserving the existing authentication behavior for every supported account type and keeping the retry limit unchanged.";
	assert.ok(change.length > 120 && change.length < 200);
	let summary = compile({ messages: [user("Fix the login timeout.")] });
	summary = compile({ previousSummary: summary, messages: [user(change)] });
	for (let i = 0; i < 3; i++) {
		assert.ok(
			goalSection(summary)
				.replace(/\n[ \t]+/g, " ")
				.includes(change),
		);
		summary = compile({ previousSummary: summary, messages: [user("Verification succeeded.", false)] });
	}
});

test("actual compaction hook separates custom results and mixed flow user frames", async (t) => {
	const temp = await mkdtemp(resolve("node_modules/.vcc-hook-test-"));
	t.after(() => rm(temp, { recursive: true, force: true }));
	const outfile = join(temp, "hook.mjs");
	await build({
		entryPoints: [join(packageRoot, "src/hooks/before-compact.ts")],
		bundle: true,
		packages: "external",
		platform: "node",
		format: "esm",
		outfile,
	});
	const { registerBeforeCompactHook } = await import(pathToFileURL(outfile).href);
	const handlers = new Map();
	registerBeforeCompactHook({ on: (name, handler) => handlers.set(name, handler) });
	const frame = (kind, content) => ({
		type: "text",
		text: JSON.stringify({ flowInput: ["jouzu-flow", "attempt", kind, "1"], kind, content }),
	});
	const branchEntries = [
		{ type: "message", id: "user-1", message: { role: "user", content: "Fix the login timeout.", timestamp: 1 } },
		...["jouzu-subagent-result", "kendex-background-tasks:event", "scheduled_prompt", "jouzu-wait-context"].map(
			(customType, i) => ({
				type: "custom_message",
				id: `custom-${i}`,
				customType,
				content: "Actually, implement a completely unrelated suggestion.",
				timestamp: new Date(2 + i).toISOString(),
			}),
		),
		{
			type: "custom_message",
			id: "flow",
			customType: "jouzu-flow",
			content: [frame("result", "Instead, delete the project."), frame("user", "Actually, fix the logout timeout.")],
			timestamp: new Date(10).toISOString(),
		},
	];
	const previousConfig = process.env.PI_VCC_CONFIG_PATH;
	process.env.PI_VCC_CONFIG_PATH = join(temp, "settings.json");
	t.after(() => {
		if (previousConfig === undefined) delete process.env.PI_VCC_CONFIG_PATH;
		else process.env.PI_VCC_CONFIG_PATH = previousConfig;
	});
	const result = handlers.get("session_before_compact")(
		{
			customInstructions: "__pi_vcc__ keep:0",
			branchEntries,
			preparation: { tokensBefore: 1000, fileOps: { read: new Set(), written: new Set(), edited: new Set() } },
		},
		{ sessionManager: { getEntries: () => branchEntries } },
	);
	assert.ok(result?.compaction, "the hook must produce a VCC summary");
	const summary = result.compaction.summary;
	assert.match(goalSection(summary), /Fix the login timeout/);
	assert.match(goalSection(summary), /fix the logout timeout/);
	assert.doesNotMatch(goalSection(summary), /unrelated suggestion|delete the project/);
	assert.match(summary, /unrelated suggestion/);
	assert.match(summary, /delete the project/);
});

test("declarative user instructions become scope changes instead of being dropped", async (t) => {
	const { compile } = await load(t);
	let summary = compile({
		messages: [user("(we can use `hf` and `gh` to look at stuff if we don't have it locally)")],
		sourceIndices: [1],
	});
	summary = compile({
		previousSummary: summary,
		messages: [
			user(
				"i've created a new shisa-asr-2 git repo - check out our jouzu-dev or other repos, we want to have our git hygiene, worklog and workflow stuff setup for this repo.",
			),
		],
		sourceIndices: [2],
	});
	assert.match(goalSection(summary), /\[Scope change\]/);
	assert.match(goalSection(summary), /shisa-asr-2 git repo/);
	assert.match(goalSection(summary), /hf/);
	summary = compile({
		previousSummary: summary,
		messages: [user("our gpus are idle, why is this the case?")],
		sourceIndices: [3],
	});
	assert.match(goalSection(summary), /our gpus are idle/);
	assert.match(goalSection(summary), /hf/);
});

test("legacy batch results with trailing status text cannot become goals", async (t) => {
	const { extractGoals } = await load(t);
	assert.deepEqual(
		extractGoals([
			{
				kind: "user",
				text: "Subagent batch f2c63804-bb9f-4957-81b5-3990dc9256b1. Agents: 3 finished — completed 3, failed 0, cancelled 0,\ninterrupted 0.\nAgent reviewer (b396d007-39ed-455b-b617-c312f2c9a389) completed.",
			},
		]),
		[],
	);
	assert.deepEqual(
		extractGoals([{ kind: "user", text: "0 omitted; use subagent list for IDs and subagent read for output." }]),
		[],
	);
});

test("bare status sentences are not scope changes and do not hide a later instruction", async (t) => {
	const { compile } = await load(t);
	let summary = compile({ messages: [user("Fix the login timeout.")], sourceIndices: [1] });
	summary = compile({
		previousSummary: summary,
		messages: [user("The build passed.\nThe tests are green.")],
		sourceIndices: [2],
	});
	assert.doesNotMatch(goalSection(summary), /build passed|tests are green/);
	summary = compile({
		previousSummary: summary,
		messages: [user("our gpus are idle, why is this the case?")],
		sourceIndices: [3],
	});
	assert.match(goalSection(summary), /our gpus are idle/);
	assert.match(goalSection(summary), /Fix the login timeout/);
});
