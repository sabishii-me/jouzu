import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { testInvocation } from "./run-tests.mjs";

const runner = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));
function fixture(t, source) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-test-runner-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "fixture.test.mjs");
	writeFileSync(path, source);
	return { root, path };
}
function run(path, env = {}, options = [], cwd) {
	return spawnSync(process.execPath, [runner, ...options, path], {
		cwd,
		encoding: "utf8",
		timeout: 15_000,
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "5000", JOUZU_TEST_SUITE_TIMEOUT_MS: "10000", ...env },
	});
}

test("runner expands quoted globs, deduplicates files, and retains name filters", (t) => {
	const { root, path } = fixture(t, "import { test } from 'node:test'; test('pass', () => {});");
	const invocation = testInvocation(["--test-name-pattern", "pass=one", "*.test.mjs", path], {}, root);
	assert.deepEqual(invocation.files, [path]);
	assert.equal(invocation.cwd, root);
	assert.deepEqual(invocation.options, ["--test-name-pattern=pass=one"]);
	assert.equal(invocation.testTimeout, 120_000);
	assert.equal(invocation.suiteTimeout, 600_000);
	const result = run(path);
	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.match(result.stdout, /TAP version 13/);
	assert.match(result.stdout, /# pass 1/);
});

test("runner keeps the caller cwd and treats spaces and leading hyphens as file names", (t) => {
	const { root } = fixture(t, "");
	const cwd = join(root, "caller with spaces");
	mkdirSync(cwd);
	for (const name of ["--test-force-exit.test.mjs", "-leading space.test.mjs", "ordinary space.test.mjs"]) {
		writeFileSync(
			join(cwd, name),
			`import assert from "node:assert/strict";
			import { realpathSync } from "node:fs";
			import { test } from "node:test";
			test("literal file", () => assert.equal(realpathSync(process.cwd()), realpathSync(${JSON.stringify(cwd)})));`,
		);
	}
	const result = run("*.test.mjs", {}, ["./--test-force-exit.test.mjs"], cwd);
	assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
	assert.match(result.stderr, /\[tests\] 3 test files/);
	assert.match(result.stdout, /# pass 3/);
});

for (const absolute of [false, true])
	test(`runner retains ${absolute ? "an absolute" : "a relative"} custom cwd after the caller moves`, (t) => {
		const { root } = fixture(t, "");
		const cwd = join(root, "custom cwd");
		mkdirSync(cwd);
		mkdirSync(join(root, "other cwd"));
		for (const path of [join(cwd, "-inside.test.mjs"), join(root, "outside.test.mjs")]) {
			writeFileSync(
				path,
				`import assert from "node:assert/strict";
				import { realpathSync } from "node:fs";
				import { test } from "node:test";
				test("custom cwd", () => assert.equal(realpathSync(process.cwd()), realpathSync(${JSON.stringify(cwd)})));`,
			);
		}
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { runTests, testInvocation } from ${JSON.stringify(pathToFileURL(runner).href)};
				const invocation = testInvocation(["./-inside.test.mjs", "../outside.test.mjs"], process.env,
					${JSON.stringify(absolute ? cwd : "custom cwd")});
				process.chdir("other cwd");
				process.exitCode = await runTests(invocation);`,
			],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 15_000,
				env: {
					...process.env,
					JOUZU_TEST_TIMEOUT_MS: "5000",
					JOUZU_TEST_SUITE_TIMEOUT_MS: "10000",
					JOUZU_TEST_TIMINGS_DIR: "timing records",
					JOUZU_TEST_TIMINGS_LABEL: "custom",
				},
			},
		);
		assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
		assert.match(result.stdout, /# pass 2/);
		const timingDirectory = join(cwd, "timing records");
		const [file] = readdirSync(timingDirectory);
		const records = readFileSync(join(timingDirectory, file), "utf8").trim().split("\n").map(JSON.parse);
		assert.equal(records[0].files, 2);
		assert.equal(records.at(-1).exitCode, 0);
		assert.equal(records.filter((record) => record.type === "test" && record.status === "pass").length, 2);
	});

test("runner launches a long-checkout selection larger than the Windows absolute argument limit", (t) => {
	const { root } = fixture(t, "");
	const cwd = join(root, "long checkout ".repeat(10).trim());
	mkdirSync(cwd);
	const name = "case-000.test.mjs";
	const count = Math.ceil(33_000 / (join(cwd, name).length + 1));
	for (let index = 0; index < count; index++) {
		writeFileSync(
			join(cwd, `case-${String(index).padStart(3, "0")}.test.mjs`),
			'import { test } from "node:test"; test("selected file", () => {});',
		);
	}
	const invocation = testInvocation(["*.test.mjs"], {}, cwd);
	assert.equal(invocation.files.length, count);
	assert.ok(invocation.files.join(" ").length > 32_767);
	// This regression runs many real child processes, with a finite one-minute suite budget.
	const result = spawnSync(process.execPath, [runner, "--test-concurrency=4", "*.test.mjs"], {
		cwd,
		encoding: "utf8",
		timeout: 75_000,
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "5000", JOUZU_TEST_SUITE_TIMEOUT_MS: "60000" },
	});
	assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
	assert.match(result.stdout, new RegExp(`# pass ${count}\\b`));
	assert.match(result.stdout, /# fail 0/);
});

test("JOUZU_TEST_CONCURRENCY sets test concurrency unless an argument does", (t) => {
	const { root, path } = fixture(t, "import { test } from 'node:test'; test('pass', () => {});");
	assert.deepEqual(testInvocation([path], { JOUZU_TEST_CONCURRENCY: "4" }, root).options, ["--test-concurrency=4"]);
	assert.deepEqual(testInvocation(["--test-concurrency=2", path], { JOUZU_TEST_CONCURRENCY: "4" }, root).options, [
		"--test-concurrency=2",
	]);
	for (const value of ["0", "65", "-1", "1.5", "", "four"])
		assert.throws(() => testInvocation([path], { JOUZU_TEST_CONCURRENCY: value }, root), /JOUZU_TEST_CONCURRENCY/);
	const result = run(path, { JOUZU_TEST_CONCURRENCY: "2" });
	assert.equal(result.status, 0, result.stderr + result.stdout);
});

test("runner rejects missing selections, unmatched globs, directories, and unsafe overrides", (t) => {
	const { root, path } = fixture(t, "throw new Error('must not run');");
	for (const args of [
		[],
		["missing-*.test.mjs"],
		[root],
		["--test-reporter=spec", path],
		["--test-timeout=0", path],
		["--watch", path],
		["--test-force-exit", path],
		["--test-concurrency=0", path],
		["--test-name-pattern"],
	])
		assert.throws(() => testInvocation(args, {}, root));
	for (const name of ["JOUZU_TEST_TIMEOUT_MS", "JOUZU_TEST_SUITE_TIMEOUT_MS"])
		for (const value of ["0", "-1", "Infinity", "NaN", "1.5", "", "3600001"])
			assert.throws(() => testInvocation([path], { [name]: value }, root));
	const result = run(path, {}, ["--test-reporter=spec"]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /Unsupported option/);
	assert.doesNotMatch(result.stderr + result.stdout, /must not run/);
});

test("failed assertions keep their diagnostics and nonzero status", (t) => {
	const { path } = fixture(
		t,
		"import { test } from 'node:test'; test('failure', () => { throw new Error('visible failure'); });",
	);
	const result = run(path);
	assert.equal(result.status, 1);
	assert.match(result.stdout, /not ok/);
	assert.match(result.stdout, /visible failure/);
});

test("per-test deadlines report an asynchronous hang", (t) => {
	const { path } = fixture(
		t,
		`
		import { test } from 'node:test';
		test('hang', async (t) => {
			const timer = setInterval(() => {}, 1000);
			t.after(() => clearInterval(timer));
			await new Promise(() => {});
		});
	`,
	);
	const result = run(path, { JOUZU_TEST_TIMEOUT_MS: "100" });
	assert.equal(result.status, 1, result.stderr + result.stdout);
	assert.match(result.stdout, /testTimeoutFailure|timed out/);
});

for (const source of ["while (true) {}", "setInterval(() => {}, 1000);"])
	test(`suite watchdog stops ${source.startsWith("while") ? "a blocked event loop" : "leaked handles"}`, (t) => {
		const { path } = fixture(t, source);
		const result = run(path, { JOUZU_TEST_SUITE_TIMEOUT_MS: "700" });
		assert.equal(result.status, 124, result.error?.message ?? result.stderr);
		assert.match(result.stderr, /suite deadline exceeded/);
	});

test("failure diagnostics arrive before a later hung test exits", { timeout: 15_000 }, async (t) => {
	const { path } = fixture(
		t,
		`
		import { test } from 'node:test';
		test('failure first', () => { throw new Error('early diagnostic'); });
		test('hang later', async () => { setInterval(() => {}, 1000); await new Promise(() => {}); });
	`,
	);
	const child = spawn(process.execPath, [runner, path], {
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "10000", JOUZU_TEST_SUITE_TIMEOUT_MS: "3000" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	t.after(() => {
		child.kill("SIGTERM");
	});
	let stdout = "",
		stderr = "",
		early = false;
	child.stdout.on("data", (data) => {
		stdout += data;
		if (stdout.includes("early diagnostic") && child.exitCode === null) early = true;
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const [code] = await once(child, "exit");
	assert.equal(code, 124, stderr);
	assert.equal(early, true, stdout);
});

test("interrupts stop the supervised run with a failing signal status", {
	timeout: 15_000,
	skip: process.platform === "win32",
}, async (t) => {
	const { path } = fixture(
		t,
		`
		import { test } from 'node:test';
		test('pending', async () => {
			console.log('signal fixture ready');
			setInterval(() => {}, 1000);
			await new Promise(() => {});
		});
	`,
	);
	const child = spawn(process.execPath, [runner, path], {
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "10000", JOUZU_TEST_SUITE_TIMEOUT_MS: "10000" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	t.after(() => {
		child.kill("SIGTERM");
	});
	let stdout = "",
		stderr = "",
		interrupted = false;
	child.stdout.on("data", (data) => {
		stdout += data;
		if (!interrupted && stdout.includes("signal fixture ready")) {
			interrupted = true;
			child.kill("SIGTERM");
		}
	});
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const [code] = await once(child, "exit");
	assert.equal(code, 143, stdout + stderr);
	assert.match(stderr, /terminated; terminating test processes/);
});

test("package and CI Node test entry points use the bounded runner", () => {
	const rawTest = /\bnode\b[^&|;\n]*\s--test(?:\s|$)/;
	for (const path of ["../package.json", "../packages/cli/package.json", "../packages/session-ui/package.json"]) {
		const pkg = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
		for (const [name, command] of Object.entries(pkg.scripts))
			assert.doesNotMatch(command, rawTest, `${path} ${name} bypasses the bounded runner`);
	}
	const workflows = new URL("../.github/workflows/", import.meta.url);
	for (const file of readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file)))
		assert.doesNotMatch(readFileSync(new URL(file, workflows), "utf8"), rawTest, `${file} bypasses the bounded runner`);
});
