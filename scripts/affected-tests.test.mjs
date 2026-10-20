import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedTests, dependencyGraph } from "./affected-tests.mjs";

const graph = new Map([
	["packages/cli/src/a.ts", new Set()],
	["packages/cli/src/b.ts", new Set(["packages/cli/src/a.ts"])],
	["packages/cli/test/fixtures/helper.mjs", new Set(["packages/cli/src/b.ts"])],
	["packages/cli/test/b.test.mjs", new Set(["packages/cli/test/fixtures/helper.mjs"])],
	["packages/cli/test/other.test.mjs", new Set(["packages/cli/src/c.ts"])],
	["packages/cli/src/c.ts", new Set()],
]);

test("changed sources select tests that import them directly or through sources and fixtures", () => {
	assert.deepEqual(affectedTests(["packages/cli/src/a.ts"], graph), {
		all: false,
		tests: ["packages/cli/test/b.test.mjs"],
	});
	assert.deepEqual(affectedTests(["packages/cli/test/other.test.mjs"], graph).tests, [
		"packages/cli/test/other.test.mjs",
	]);
	const sources = {
		"packages/cli/test/b.test.mjs": 'readFileSync("README.md")',
		"packages/cli/test/other.test.mjs": "",
	};
	assert.deepEqual(affectedTests(["README.md"], graph, (file) => sources[file]).tests, [
		"packages/cli/test/b.test.mjs",
	]);
});

test("dependency, build, and shared fixture changes select every test", () => {
	for (const file of [
		"package-lock.json",
		"packages/cli/package.json",
		"scripts/build-textguard.mjs",
		"upstream/pi.lock.json",
	])
		assert.deepEqual(affectedTests([file], graph), {
			all: true,
			tests: ["packages/cli/test/b.test.mjs", "packages/cli/test/other.test.mjs"],
		});
});

test("native Windows launcher tests are selected only on Windows, while static checks remain portable", () => {
	const native = ["command-entries", "command-path", "git-environment", "terminal-environment"].map(
		(name) => `packaging/launcher/${name}.test.mjs`,
	);
	const portable = "packaging/launcher/runtime-source.test.mjs";
	const imports = new Map([...native, portable].map((file) => [file, new Set()]));
	for (const platform of ["linux", "darwin", "win32"]) {
		assert.deepEqual(
			affectedTests(["upstream/pi.lock.json"], imports, undefined, platform).tests,
			platform === "win32" ? [...native, portable].sort() : [portable],
		);
		assert.deepEqual(
			affectedTests([native[0]], imports, undefined, platform).tests,
			platform === "win32" ? [native[0]] : [],
		);
	}
});

test("the repository graph maps compiled imports and launched CLI paths to their sources", () => {
	const imports = dependencyGraph();
	assert.ok(imports.get("packages/cli/test/model-picker.test.mjs").has("packages/cli/src/model-picker.ts"));
	const workflowTests = affectedTests([".github/workflows/ci.yml"], imports).tests;
	assert.ok(workflowTests.includes("scripts/check-release-metadata.test.mjs"));
	const launched = [...imports].filter(([, targets]) => targets.has("packages/cli/src/cli.ts"));
	assert.ok(
		launched.some(([file]) => file.endsWith(".test.mjs")),
		"a test launches the built CLI",
	);
});
