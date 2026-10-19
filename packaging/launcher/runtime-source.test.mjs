import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRuntimeSource } from "./runtime-source.mjs";

function fixture() {
	return {
		run: {
			id: 42,
			status: "completed",
			conclusion: "failure",
			path: ".github/workflows/publish-npm.yml",
			head_sha: "commit",
		},
		jobs: [{ name: "windows-update / recipe", status: "completed", conclusion: "success", run_id: 42 }],
		artifacts: [{ name: "windows-published-runtime", expired: false, workflow_run: { id: 42, head_sha: "commit" } }],
	};
}
const check = ({ run, jobs, artifacts }) => validateRuntimeSource(run, jobs, artifacts, "42");
test("a successful recipe remains usable after a later publish job fails", () => {
	assert.doesNotThrow(() => check(fixture()));
});
for (const [name, change] of [
	[
		"failed recipe",
		(f) => {
			f.jobs[0].conclusion = "failure";
		},
	],
	[
		"missing recipe",
		(f) => {
			f.jobs = [];
		},
	],
	[
		"unrelated job",
		(f) => {
			f.jobs[0].name = "other / recipe";
		},
	],
	[
		"wrong job run",
		(f) => {
			f.jobs[0].run_id = 41;
		},
	],
	[
		"unfinished run",
		(f) => {
			f.run.status = "in_progress";
		},
	],
	[
		"wrong workflow",
		(f) => {
			f.run.path = ".github/workflows/ci.yml";
		},
	],
	[
		"wrong run",
		(f) => {
			f.run.id = 41;
		},
	],
	[
		"missing artifact",
		(f) => {
			f.artifacts = [];
		},
	],
	[
		"duplicate artifact",
		(f) => {
			f.artifacts.push(f.artifacts[0]);
		},
	],
	[
		"expired artifact",
		(f) => {
			f.artifacts[0].expired = true;
		},
	],
	[
		"wrong artifact run",
		(f) => {
			f.artifacts[0].workflow_run.id = 41;
		},
	],
	[
		"wrong artifact commit",
		(f) => {
			f.artifacts[0].workflow_run.head_sha = "other";
		},
	],
]) {
	test(`runtime repair rejects ${name}`, () => {
		const f = fixture();
		change(f);
		assert.throws(() => check(f));
	});
}
for (const workflow of ["launcher-recipe", "launcher-runtime"]) {
	test(`${workflow} requires a successful source run`, () => {
		const f = fixture();
		f.run.path = `.github/workflows/${workflow}.yml`;
		assert.throws(() => check(f));
		f.run.conclusion = "success";
		assert.doesNotThrow(() => check(f));
	});
}
