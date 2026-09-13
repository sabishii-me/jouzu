import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { catalogStatus, formatCatalogStatus, validateCatalogFile } from "../dist/catalog-command.js";

const ESCAPE = String.fromCharCode(27);

/** Render every assertion at a fixed width without color, so layout is deterministic. */
const RENDER = { colorEnabled: false, columns: 100 };

/** Collapse the renderer's alignment and wrapping so message assertions stay readable. */
function flat(text) {
	return text.replace(/\s+/gu, " ");
}

const paths = {
	agentDir: "/unused/agent",
	stateDir: "/unused/state",
	cacheDir: "/unused/cache",
	sessionDir: "/unused/sessions",
	profileStatePath: "/unused/state/profile-state.json",
	backupDir: "/unused/state/backups",
};

test("built-in source without a key is visible and idle with no network work", () => {
	let fetchCount = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		fetchCount += 1;
		throw new Error("network must not be reached");
	};
	try {
		const status = catalogStatus(paths, {});
		assert.deepEqual(status, {
			schemaVersion: 1,
			status: "empty",
			configured: 1,
			active: 0,
			sources: [
				{
					schemaVersion: 1,
					status: "empty",
					configured: true,
					sourceId: "shisa-api",
					label: "Shisa API",
					enabled: true,
					endpoint: "https://api.shisa.ai/v1/jouzu/model-catalog",
					credentialName: "SHISA_API_KEY",
					credentialAvailable: false,
					credentialEnv: false,
					credentialStored: false,
					quarantined: 0,
				},
			],
		});
		assert.equal(fetchCount, 0);
		const text = formatCatalogStatus(status, RENDER);
		assert.match(text, /^○ Shisa API \[shisa-api\] · empty$/mu);
		assert.match(text, /^ +Credential {2,}environment variable SHISA_API_KEY \(not set\)$/mu);
		assert.match(flat(text), /⚠ shisa-api token variable SHISA_API_KEY is not set/u);
		assert.ok(!text.includes(ESCAPE), "piped output carries no escape sequences");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("catalog status lists offerings that declare no thinking levels", () => {
	const status = {
		schemaVersion: 1,
		status: "active",
		configured: true,
		sourceId: "codex-pool",
		label: "codex-pool",
		enabled: true,
		endpoint: "http://localhost:8989/v1/jouzu/model-catalog",
		catalogId: "ai.shisa.codex-pool",
		revision: "sha256:fixture",
		sequence: "7",
		offeringCount: 36,
		thinkingLevelGaps: [{ providerId: "aiand", modelId: "deepseek-ai/deepseek-v4-flash" }],
		quarantined: 0,
	};
	const text = formatCatalogStatus(status, RENDER);
	assert.match(text, /^✓ codex-pool active$/mu);
	assert.match(text, /^ +Thinking levels {2,}1 of 36 offerings have no declared levels$/mu);
	assert.match(text, /^ +aiand\/deepseek-ai\/deepseek-v4-flash$/mu);
	assert.match(flat(text), /⚠ codex-pool 1 of 36 offerings have no declared levels/u);
	assert.doesNotMatch(formatCatalogStatus({ ...status, thinkingLevelGaps: [] }, RENDER), /Thinking levels/u);
});

test("catalog file validation fails gracefully", () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-catalog-command-"));
	try {
		const invalidPath = join(temporary, "invalid.json");
		writeFileSync(invalidPath, "[]\n");
		const invalid = validateCatalogFile(invalidPath, false);
		assert.equal(invalid.valid, false);
		assert.equal(invalid.error?.code, "invalid_record");

		const missing = validateCatalogFile(join(temporary, "missing.json"), true);
		assert.equal(missing.valid, false);
		assert.match(missing.error?.message ?? "", /does not exist/);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
