import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Publication-only files cannot alter the already built runtime package.
export const publicationOnlyPaths = [
	".github/workflows/publish-npm.yml",
	"scripts/publish-npm.mjs",
	"scripts/release-publication-source.mjs",
	"scripts/release-publication-source.test.mjs",
	"scripts/verify-published-release.mjs",
];

export function verifyPublicationDelta(paths) {
	assert.ok(paths.length > 0, "publication source delta is empty");
	for (const path of paths) assert.ok(publicationOnlyPaths.includes(path), `unqualified source change: ${path}`);
}

export function verifyPublicationSource(qualifiedCommit, releaseCommit) {
	for (const commit of [qualifiedCommit, releaseCommit]) assert.match(commit, /^[a-f0-9]{40}$/);
	if (qualifiedCommit === releaseCommit) return;
	execFileSync("git", ["merge-base", "--is-ancestor", qualifiedCommit, releaseCommit]);
	const paths = execFileSync("git", ["diff", "--name-only", `${qualifiedCommit}..${releaseCommit}`], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
	verifyPublicationDelta(paths);
}

export function qualificationManifest(manifest, run, jobs, artifactJobs = jobs) {
	assert.equal(String(run.id), manifest.qualification.runId);
	assert.equal(run.head_sha, manifest.sourceCommit);
	assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt >= manifest.qualification.runAttempt);
	const producer = artifactJobs.find((job) => job.name === "release-artifacts");
	assert.ok(producer, "artifact producer missing");
	assert.equal(producer.run_attempt, manifest.qualification.runAttempt, "artifact producer attempt mismatch");
	assert.equal(producer.status, "completed", "artifact producer incomplete");
	assert.equal(producer.conclusion, "success", "artifact producer failed");
	assert.equal(String(producer.run_id), manifest.qualification.runId, "artifact producer run mismatch");
	assert.equal(producer.head_sha, manifest.sourceCommit, "artifact producer source mismatch");
	for (const job of jobs) {
		assert.equal(job.head_sha, manifest.sourceCommit, job.name);
		assert.equal(String(job.run_id), manifest.qualification.runId, job.name);
		assert.ok(job.run_attempt >= manifest.qualification.runAttempt && job.run_attempt <= run.run_attempt, job.name);
	}
	// The original manifest keeps the artifact-producing attempt. Qualification
	// uses GitHub's successful attempt, which includes passed jobs it reused.
	return { ...manifest, qualification: { ...manifest.qualification, runAttempt: run.run_attempt } };
}
