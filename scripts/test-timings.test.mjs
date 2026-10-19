import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { testInvocation, timingContext } from "./run-tests.mjs";
import { compare, diffMarkdown, parseArguments, parseRecord, summarize, summaryMarkdown } from "./test-timings.mjs";

const runner = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));

function workspace(t) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-test-timings-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function run(root, files, env = {}) {
	return spawnSync(process.execPath, [runner, ...files], {
		cwd: root,
		encoding: "utf8",
		timeout: 15_000,
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "5000", JOUZU_TEST_SUITE_TIMEOUT_MS: "10000", ...env },
	});
}

function record(label, tests, wallMs = 1_000) {
	return parseRecord(
		[
			{ type: "run", schemaVersion: 1, label, node: "v22.19.0", platform: "linux" },
			...tests.map(([test, duration_ms, extra = {}]) => ({
				type: "test",
				file: "packages/cli/test/example.test.mjs",
				test,
				nesting: 0,
				duration_ms,
				status: "pass",
				...extra,
			})),
			{ type: "end", wallMs, exitCode: 0 },
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
	);
}

test("timing records name each test with its file, parents, duration, and status", (t) => {
	const root = workspace(t);
	writeFileSync(
		join(root, "sample.test.mjs"),
		`import { test } from "node:test";
		test("parent", async (t) => { await t.test("child", () => {}); });
		test("skipped", { skip: true }, () => {});
		test("broken", () => { throw new Error("visible failure"); });`,
	);
	const timings = join(root, "timings");
	const result = run(root, ["sample.test.mjs"], {
		JOUZU_TEST_TIMINGS_DIR: timings,
		JOUZU_TEST_TIMINGS_LABEL: "sample",
		JOUZU_TEST_TIMINGS_JOB: "unit",
	});
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /TAP version 13/);
	assert.match(result.stdout, /visible failure/);
	const [file] = readdirSync(timings);
	assert.match(file, /^sample-\d+-\d+\.jsonl$/);
	const parsed = parseRecord(readFileSync(join(timings, file), "utf8"));
	assert.equal(parsed.context.label, "sample");
	assert.equal(parsed.context.job, "unit");
	assert.equal(parsed.context.files, 1);
	assert.equal(parsed.context.node, process.version);
	assert.equal(parsed.end.exitCode, 1);
	assert.equal(parsed.end.truncated, false);
	assert.ok(parsed.end.wallMs >= 0);
	const byName = Object.fromEntries(parsed.tests.map((entry) => [entry.test, entry]));
	assert.equal(byName["parent > child"].nesting, 1);
	assert.equal(byName.parent.status, "pass");
	assert.equal(byName.skipped.status, "skip");
	assert.equal(byName.broken.status, "fail");
	assert.ok(parsed.tests.every((entry) => entry.file.endsWith("sample.test.mjs") && entry.duration_ms >= 0));
});

test("timing records are opt-in and nested runner invocations do not inherit them", (t) => {
	const root = workspace(t);
	writeFileSync(join(root, "plain.test.mjs"), `import { test } from "node:test"; test("plain", () => {});`);
	assert.equal(run(root, ["plain.test.mjs"]).status, 0);
	assert.deepEqual(readdirSync(root), ["plain.test.mjs"]);
	writeFileSync(
		join(root, "nested.test.mjs"),
		`import { test } from "node:test";
		import { spawnSync } from "node:child_process";
		test("nested", () => {
			const result = spawnSync(process.execPath, [${JSON.stringify(runner)}, "plain.test.mjs"], { encoding: "utf8" });
			if (result.status !== 0) throw new Error(result.stderr);
		});`,
	);
	const timings = join(root, "timings");
	assert.equal(run(root, ["nested.test.mjs"], { JOUZU_TEST_TIMINGS_DIR: timings }).status, 0);
	const files = readdirSync(timings);
	assert.equal(files.length, 1);
	const parsed = parseRecord(readFileSync(join(timings, files[0]), "utf8"));
	assert.deepEqual(
		parsed.tests.map((entry) => entry.test),
		["nested"],
	);
});

test("timing labels are validated and the run context records concurrency and CI identity", () => {
	assert.throws(
		() => testInvocation([runner], { JOUZU_TEST_TIMINGS_DIR: "out", JOUZU_TEST_TIMINGS_LABEL: "../escape" }),
		/JOUZU_TEST_TIMINGS_LABEL/,
	);
	assert.equal(
		testInvocation([runner], {
			JOUZU_TEST_TIMINGS_DIR: "out",
			npm_package_name: "@jouzu/cli",
			npm_lifecycle_event: "test:flow",
		}).timings.label,
		"jouzu_cli.test_flow",
	);
	const context = timingContext(
		{
			files: ["a", "b"],
			options: ["--test-concurrency=4"],
			testTimeout: 1,
			suiteTimeout: 2,
			timings: { label: "cli" },
		},
		{ GITHUB_ACTIONS: "true", GITHUB_SHA: "abc", GITHUB_JOB: "node", ImageOS: "ubuntu24", ImageVersion: "1.0" },
		new Date("2026-01-01T00:00:00Z"),
	);
	assert.equal(context.concurrency, 4);
	assert.equal(context.commit, "abc");
	assert.equal(context.hosted, true);
	assert.equal(context.job, "node");
	assert.equal(context.image, "ubuntu24 1.0");
	assert.equal(context.startedAt, "2026-01-01T00:00:00.000Z");
});

test("summaries rank top-level tests by median and report concentration", () => {
	const summary = summarize(
		[
			record("cli", [
				["slow", 12_000],
				["medium", 2_000],
				["fast", 10],
				["fast > nested", 9_000, { nesting: 1 }],
			]),
			record("cli", [
				["slow", 14_000],
				["medium", 4_000],
				["fast", 30],
			]),
		],
		{ top: 2 },
	);
	assert.equal(summary.runs, 2);
	assert.equal(summary.tests, 3);
	assert.deepEqual(
		summary.slowest.map((row) => [row.test, row.n, row.median]),
		[
			["slow", 2, 13_000],
			["medium", 2, 3_000],
		],
	);
	assert.equal(summary.over1s, 2);
	assert.equal(summary.over10s, 1);
	assert.equal(summary.totalMedianMs, 16_020);
	assert.deepEqual(summary.suites, [{ label: "cli", n: 2, median: 1_000, p90: 1_000, max: 1_000 }]);
	assert.match(summaryMarkdown(summary), /\| slow \| packages\/cli\/test\/example.test.mjs \| 2 \| 13.0 s \|/);
});

test("comparisons list added, removed, slower, and faster tests past both thresholds", () => {
	const base = summarize([
		record(
			"cli",
			[
				["kept", 10_000],
				["slower", 2_000],
				["noise", 2_000],
				["gone", 500],
			],
			400_000,
		),
	]);
	const head = summarize([
		record(
			"cli",
			[
				["kept", 4_000],
				["slower", 4_000],
				["noise", 2_300],
				["new", 700],
			],
			300_000,
		),
	]);
	const diff = compare(base, head);
	assert.deepEqual(
		diff.slower.map((row) => row.test),
		["slower"],
	);
	assert.deepEqual(
		diff.faster.map((row) => row.test),
		["kept"],
	);
	assert.deepEqual(
		diff.added.map((row) => row.test),
		["new"],
	);
	assert.deepEqual(
		diff.removed.map((row) => row.test),
		["gone"],
	);
	assert.deepEqual(diff.suites, [{ label: "cli", before: 400_000, after: 300_000 }]);
	assert.match(diffMarkdown(diff), /Suite cli median wall: 400.0 s -> 300.0 s/);
});

test("the timing command rejects incomplete arguments", () => {
	assert.throws(() => parseArguments(["summary"]), /record files/);
	assert.throws(() => parseArguments(["diff", "--base", "a"]), /--base and --head/);
	assert.throws(() => parseArguments(["summary", "--where", "node", "x"]), /key=value/);
	assert.throws(() => parseArguments(["summary", "--top", "0", "x"]), /--top/);
	assert.throws(() => parseArguments(["report", "x"]), /Usage/);
	assert.deepEqual(parseArguments(["summary", "--where", "node=22", "x"]).where, { node: "22" });
});
