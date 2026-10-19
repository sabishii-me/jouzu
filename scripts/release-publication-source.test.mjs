import assert from "node:assert/strict";
import { test } from "node:test";
import {
	qualificationManifest,
	verifyPublicationDelta,
	verifyPublicationSource,
} from "./release-publication-source.mjs";

const commit = "a".repeat(40);
const manifest = { sourceCommit: commit, qualification: { runId: "10", runAttempt: 1 } };
const run = { id: 10, head_sha: commit, run_attempt: 2 };
const job = (name, attempt) => ({
	name,
	head_sha: commit,
	run_id: 10,
	run_attempt: attempt,
	status: "completed",
	conclusion: "success",
});

test("qualification reuses passed jobs and preserves artifact origin", () => {
	const jobs = [job("release-artifacts", 1), job("published-upgrade (macos-latest)", 2)];
	assert.equal(qualificationManifest(manifest, run, jobs).qualification.runAttempt, 2);
	assert.equal(manifest.qualification.runAttempt, 1);
	const stampedJobs = jobs.map((entry) => ({ ...entry, run_attempt: 2 }));
	assert.equal(qualificationManifest(manifest, run, stampedJobs, [jobs[0]]).qualification.runAttempt, 2);
	assert.throws(() => qualificationManifest(manifest, run, stampedJobs));
	for (const bad of [
		{ ...jobs[0], run_attempt: 2 },
		{ ...jobs[0], head_sha: "b".repeat(40) },
		{ ...jobs[0], run_id: 11 },
	])
		assert.throws(() => qualificationManifest(manifest, run, [bad, jobs[1]]));
	assert.throws(() => qualificationManifest(manifest, run, [jobs[0], job("consumer", 3)]));
	assert.throws(() => qualificationManifest(manifest, { ...run, id: 11 }, jobs));
});

test("publication delta rejects product, build, dependency, and test changes", () => {
	verifyPublicationDelta([".github/workflows/publish-npm.yml", "scripts/publish-npm.mjs"]);
	verifyPublicationSource(commit, commit);
	for (const path of [
		"package.json",
		"package-lock.json",
		"scripts/build-textguard.mjs",
		"packages/cli/src/cli.ts",
		"packages/cli/test/flow.test.mjs",
		"scripts/release-artifact.mjs",
	]) {
		assert.throws(() => verifyPublicationDelta([path]), /unqualified source change/);
	}
	assert.throws(() => verifyPublicationDelta([]));
	assert.throws(() => verifyPublicationSource("main", commit));
});
