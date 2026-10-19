import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "./ci-changes.mjs";

test("product-only pull requests get the required tier", () => {
	assert.deepEqual(classify(["packages/cli/src/model-picker.ts", "docs/models.md"]), { full: false, endurance: false });
});

test("flow-control changes add the endurance cases", () => {
	assert.deepEqual(classify(["packages/cli/src/flow-control/wait-store.ts"]), { full: false, endurance: true });
	assert.deepEqual(classify(["packages/cli/test/flow-submissions.test.mjs"]), { full: false, endurance: true });
});

test("packaging, update, dependency, and workflow changes need full qualification", () => {
	for (const file of [
		"package-lock.json",
		"packages/cli/package.json",
		"packages/cli/src/updater.ts",
		"packaging/launcher/runtime-source.mjs",
		"python/jouzu/pyproject.toml",
		"upstream/pi.lock.json",
		".github/workflows/ci.yml",
		"scripts/test-packed-cli.mjs",
		"scripts/prepare-ci-artifacts.mjs",
	])
		assert.deepEqual(classify([file]), { full: true, endurance: true }, file);
});

test("the full-ci label selects full qualification", () => {
	assert.deepEqual(classify(["docs/models.md"], ["full-ci"]), { full: true, endurance: true });
});
