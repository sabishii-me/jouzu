import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = (directory) => JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"));
const workspaces = readdirSync(join(root, "packages"), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => `packages/${entry.name}`);

// Expand npm script references into the leaf commands a gate executes, keyed by package directory.
export function expand(command, directory = ".") {
	const leaves = [];
	for (const part of command.split(" && ").map((text) => text.trim())) {
		const run = part.match(/^npm (?:run (\S+)|(test))(?: (--workspaces --if-present|--workspace (\S+)))?$/);
		if (!run) {
			// Emit and no-emit TypeScript runs type-check the same project.
			leaves.push(`${directory}: ${part.replace(/ --noEmit$/, "")}`);
			continue;
		}
		const name = run[1] ?? run[2];
		const targets = run[3] === "--workspaces --if-present" ? workspaces : [run[4] ?? directory];
		for (const target of targets) {
			const script = manifest(target).scripts?.[name];
			if (script === undefined && run[3] === "--workspaces --if-present") continue;
			assert.ok(script, `${target} has no ${name} script`);
			leaves.push(...expand(script, target));
		}
	}
	return leaves;
}

function duplicates(leaves) {
	return leaves.filter((leaf, index) => leaves.indexOf(leaf) !== index);
}

function workflowJobs(file) {
	const workflow = readFileSync(join(root, ".github/workflows", file), "utf8");
	const body = workflow.slice(workflow.indexOf("\njobs:\n"));
	return body
		.split(/^ {2}(?=[a-z][a-z0-9-]*:\s*$)/m)
		.slice(1)
		.map((job) => ({
			name: job.slice(0, job.indexOf(":")),
			commands: [...job.matchAll(/^ {6}- run: (npm .+)$/gm)].map((match) => match[1].trim()),
		}));
}

test("release and contributor gates run each command once", () => {
	const scripts = manifest(".").scripts;
	for (const gate of ["release:check:candidate", "check", "test"]) {
		const leaves = expand(scripts[gate]);
		assert.ok(leaves.length > 3, gate);
		assert.deepEqual(duplicates(leaves), [], `${gate} repeats a command`);
	}
});

test("each CI job runs each command once", () => {
	const jobs = workflowJobs("ci.yml");
	assert.ok(jobs.some((job) => job.name === "node"));
	for (const job of jobs) {
		const leaves = job.commands.flatMap((command) => expand(command));
		assert.deepEqual(duplicates(leaves), [], `${job.name} repeats a command`);
	}
});

test("command expansion follows root, workspace, and all-workspace scripts", () => {
	const leaves = expand("npm run check:types && npm test --workspaces --if-present");
	assert.ok(leaves.includes("packages/cli: tsc -p tsconfig.json"));
	assert.ok(leaves.includes("packages/session-ui: tsc -p tsconfig.json"));
	assert.ok(leaves.includes("packages/cli: node ../../scripts/run-tests.mjs test/*.test.mjs"));
	assert.deepEqual(duplicates(["a", "b", "a"]), ["a"]);
});
