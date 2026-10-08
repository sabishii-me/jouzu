import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertDefaultInstallation(report, status, lock) {
	assert.equal(
		report.fields.find((field) => field.id === "camoufox.runtime")?.value,
		"not installed; installs on first browser tool use",
	);
	const problems = report.issues.filter((issue) => issue.severity === "problem");
	// A candidate is not qualified until CI finishes. This check verifies the
	// default runtime, not release authorization; no other doctor problem is allowed.
	const expected = lock.compatibilityStatus === "pending-qualification" ? ["pi.lockUnqualified"] : [];
	assert.deepEqual(problems.map((issue) => issue.id).sort(), expected, JSON.stringify(problems, null, 2));
	assert.equal(status, problems.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = resolve(import.meta.dirname, "..");
	const result = spawnSync(process.execPath, [resolve(root, "packages/cli/dist/cli.js"), "doctor", "--json"], {
		encoding: "utf8",
		env: process.env,
		timeout: 60000,
	});
	process.stdout.write(result.stdout || "");
	process.stderr.write(result.stderr || "");
	if (result.error) throw result.error;
	assert.equal(result.signal, null);
	assertDefaultInstallation(
		JSON.parse(result.stdout),
		result.status,
		JSON.parse(readFileSync(resolve(root, "upstream/pi.lock.json"), "utf8")),
	);
}
