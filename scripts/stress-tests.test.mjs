import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { flaky, parseStressArguments } from "./stress-tests.mjs";

const stress = fileURLToPath(new URL("./stress-tests.mjs", import.meta.url));

test("stress arguments set repeats and load and pass runner options through", () => {
	assert.deepEqual(parseStressArguments(["--repeat", "3", "--load", "0", "--test-name-pattern=x", "a.test.mjs"], 8), {
		repeat: 3,
		load: 0,
		runner: ["--test-name-pattern=x", "a.test.mjs"],
	});
	assert.equal(parseStressArguments(["a.test.mjs"], 8).load, 32);
	assert.throws(() => parseStressArguments(["--repeat", "0", "a.test.mjs"]), /--repeat/);
	assert.throws(() => parseStressArguments(["--load", "x", "a.test.mjs"]), /--load/);
	assert.throws(() => parseStressArguments(["--repeat", "2"]), /Usage/);
});

test("flaky counts failures per top-level test across runs", () => {
	const run = (status) => ({
		tests: [
			{ file: "f", test: "t", nesting: 0, status },
			{ file: "f", test: "s", nesting: 0, status: "skip" },
		],
	});
	assert.deepEqual(flaky([run("pass"), run("fail"), run("pass")]), [{ file: "f", test: "t", runs: 3, failures: 1 }]);
	assert.deepEqual(flaky([run("pass")]), []);
});

test("a test that fails only on some runs is reported with its failure count", (t) => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-stress-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const counter = join(root, "count");
	writeFileSync(counter, "0");
	writeFileSync(
		join(root, "alternating.test.mjs"),
		`import { test } from "node:test";
		import { readFileSync, writeFileSync } from "node:fs";
		test("alternates", () => {
			const count = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
			writeFileSync(${JSON.stringify(counter)}, String(count));
			if (count % 2 === 0) throw new Error("even run");
		});`,
	);
	const result = spawnSync(process.execPath, [stress, "--repeat", "4", "--load", "1", "alternating.test.mjs"], {
		cwd: root,
		encoding: "utf8",
		timeout: 60_000,
		env: { ...process.env, JOUZU_TEST_TIMEOUT_MS: "5000", JOUZU_TEST_SUITE_TIMEOUT_MS: "20000" },
	});
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stdout, /2\/4 failed: .*alternating\.test\.mjs :: alternates/);
	assert.match(result.stdout, /4 runs under 1 load workers: 2 failed runs, 1 failing tests/);
});
