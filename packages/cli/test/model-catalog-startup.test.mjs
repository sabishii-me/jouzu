import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { catalogRuntimeProvider } from "../dist/model-catalog-projection.js";

const fixture = fileURLToPath(new URL("./fixtures/model-catalog-startup.mjs", import.meta.url));
const catalogProvider = catalogRuntimeProvider(
	"ai.example.test",
	"ai.example.gateway",
	"https://api.shisa.ai/v1/jouzu/model-catalog",
);

// Only the variables the launcher needs are passed through. Provider credentials are
// deliberately absent: an ambient key would register another provider and change which
// model Pi resolves first, which is the behavior under test.
const ALLOWED_ENV = ["PATH", "SystemRoot", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"];

/** Runs one startup scenario in a fresh home and returns what the first runtime observed. */
function startup(scenario) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-catalog-startup-"));
	try {
		const home = join(root, "jouzu");
		const env = { HOME: root, USERPROFILE: root, TERM: "xterm-256color" };
		for (const key of ALLOWED_ENV) {
			if (process.env[key] !== undefined) env[key] = process.env[key];
		}
		const result = spawnSync(process.execPath, [fixture, JSON.stringify(scenario)], {
			cwd: root,
			encoding: "utf8",
			// Budget covers the 8-second startup abort plus runtime startup overhead.
			timeout: 40_000,
			env: {
				...env,
				JOUZU_HOME: home,
				JOUZU_PROFILE: "core",
				JOUZU_NO_UPDATE: "1",
				JOUZU_NO_PI_IMPORT: "1",
				JOUZU_FLOW_CONTROL: "0",
				PI_OFFLINE: "1",
			},
		});
		assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}\n${result.stdout}`);
		return JSON.parse(readFileSync(join(home, "observed.json"), "utf8"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("a source with no activated revision is refreshed before the first runtime", () => {
	const observed = startup({ credential: true, delayMs: 1_500 });
	assert.equal(observed.startupTimeoutMs, 8_000);
	assert.equal(observed.requests[0].authorization, "Bearer fixture-key");
	assert.ok(
		observed.requests[0].settledAt !== null && observed.requests[0].settledAt < observed.observedAt,
		"the catalog refresh settled before Pi resolved the initial model",
	);
	assert.deepEqual(observed.activeRevisions, ["fixture-2"]);
	assert.equal(observed.model?.provider, catalogProvider);
	assert.equal(observed.model?.id, "example-model");
	assert.equal(observed.model?.name, "Refreshed Model", "the initial model comes from the activated catalog");
	assert.equal(observed.noticeShown, true, "the startup wait is explained");
	// The awaited refresh is the first request. The regular background refresh still runs
	// afterwards, so a second request is expected; the first one is never aborted.
	assert.equal(observed.requests[0].abortedAt, null);
});

test("an activated revision keeps startup on the background refresh", () => {
	const observed = startup({ credential: true, cache: true, delayMs: 15_000 });
	assert.equal(observed.model?.name, "Example Model", "the cached catalog serves the initial model");
	assert.equal(observed.noticeShown, false, "a cached catalog adds no startup wait");
	assert.equal(
		observed.requests[0].settledAt,
		null,
		"the first runtime was reached while the background refresh was still in flight",
	);
});

test("a refresh that exceeds the startup budget is treated as unreachable", () => {
	const observed = startup({ credential: true, delayMs: 60_000 });
	const abortedAt = observed.requests[0].abortedAt;
	assert.ok(
		abortedAt !== null && abortedAt >= 7_900 && abortedAt < 12_000,
		`the startup refresh aborts after 8 seconds (observed ${abortedAt} ms)`,
	);
	assert.deepEqual(observed.activeRevisions, [], "a failed startup refresh leaves no revision");
	assert.equal(observed.noticeShown, true);
	assert.notEqual(observed.model?.provider, catalogProvider, "no catalog model is available to select");
});

test("a source without an available credential adds no request and no notice", () => {
	const observed = startup({});
	assert.deepEqual(observed.requests, []);
	assert.equal(observed.noticeShown, false);
});
