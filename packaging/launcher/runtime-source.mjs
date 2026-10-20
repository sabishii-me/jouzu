import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function validateRuntimeSource(run, jobs, artifacts, runId) {
	const sources = [
		".github/workflows/launcher-recipe.yml",
		".github/workflows/launcher-runtime.yml",
		".github/workflows/publish-npm.yml",
	];
	if (String(run.id) !== String(runId) || run.status !== "completed" || !sources.includes(run.path))
		throw new Error("Runtime source must be a completed recipe, runtime, or npm publish workflow.");
	if (run.path === ".github/workflows/publish-npm.yml") {
		const producers = jobs.filter((job) => job.name === "windows-update / recipe");
		if (
			producers.length !== 1 ||
			producers[0].status !== "completed" ||
			producers[0].conclusion !== "success" ||
			String(producers[0].run_id) !== String(runId)
		)
			throw new Error("Runtime source must have a successful Windows recipe job.");
	} else if (run.conclusion !== "success") {
		throw new Error("Runtime source recipe or runtime workflow must have succeeded.");
	}
	const matches = artifacts.filter((artifact) => artifact.name === "windows-published-runtime");
	if (
		matches.length !== 1 ||
		matches[0].expired ||
		String(matches[0].workflow_run?.id) !== String(runId) ||
		matches[0].workflow_run?.head_sha !== run.head_sha
	)
		throw new Error(
			"Runtime source must contain one unexpired windows-published-runtime artifact from the selected run and commit.",
		);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const runId = process.env.RUNTIME_RUN_ID;
	const repository = process.env.GITHUB_REPOSITORY;
	if (!/^\d+$/.test(runId ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
		throw new Error("Invalid runtime run or repository.");
	const api = (path, paginate = false) =>
		JSON.parse(
			execFileSync(
				"gh",
				["api", ...(paginate ? ["--paginate", "--slurp"] : []), `repos/${repository}/actions/runs/${runId}${path}`],
				{ encoding: "utf8" },
			),
		);
	const run = api("");
	const jobs = api(`/attempts/${run.run_attempt}/jobs?per_page=100`, true).flatMap((page) => page.jobs);
	const artifacts = api("/artifacts?per_page=100", true).flatMap((page) => page.artifacts);
	validateRuntimeSource(run, jobs, artifacts, runId);
}
