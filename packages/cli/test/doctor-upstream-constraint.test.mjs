import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDoctorReport, formatDoctorReport } from "../dist/doctor.js";
import { loadCatalog } from "../dist/locale-catalog.js";
import { DOCTOR_FIELD_IDS } from "./fixtures/machine-contract.mjs";

/** Collapse the renderer's alignment and wrapping so message assertions stay readable. */
function flat(text) {
	return text.replace(/\s+/gu, " ");
}

function metadata() {
	return {
		jouzuVersion: "0.1.0",
		displayVersion: "0.1.0",
		build: undefined,
		piVersion: "1.0.0",
		profileSchemaVersion: 1,
		lock: {
			schemaVersion: 2,
			repository: "https://github.com/earendil-works/pi",
			tag: "v1.0.0",
			tagCommit: "a13d35a742c6ef8462812a28fbe1d8c8b7431c32",
			commit: "a13d35a742c6ef8462812a28fbe1d8c8b7431c32",
			packages: {},
			reviewedAt: "2026-10-02",
			compatibilityStatus: "qualified",
			deviations: [],
		},
	};
}

function context(root) {
	return {
		metadata: metadata(),
		paths: {
			agentDir: join(root, "agent"),
			stateDir: join(root, "state"),
			cacheDir: join(root, "cache"),
			sessionDir: join(root, "state", "sessions"),
			profileStatePath: join(root, "state", "profile-state.json"),
			backupDir: join(root, "state", "backups"),
		},
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "1.0.0",
		executable: "/opt/jouzu/dist/cli.js",
		env: { HOME: root },
		platform: "linux",
		architecture: "x64",
		nodeVersion: "v22.19.0",
		locale: "en-US",
		uiLocale: { requested: "auto", effective: "en", source: "builtin" },
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
	};
}

const RENDER = { colorEnabled: false, columns: 100 };

test("doctor names the residual upstream English and the Jouzu-owned adapter exception in the human text", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-upstream-"));
	try {
		const result = createDoctorReport(context(root));
		const english = flat(formatDoctorReport(result.report, RENDER));
		assert.match(english, /Upstream text constraint:/u);
		assert.match(
			english,
			/the pinned Pi and the third-party bundled extensions render their own English that Jouzu does not translate or replace/u,
		);
		assert.match(english, /the Jouzu-owned browser adapter renders its tool labels from the Jouzu catalog/u);
		assert.match(english, /A surface that could not be inspected stays unverified and is not counted as translated/u);
		assert.match(english, /Recheck when the Pi pin or an extension version changes/u);

		const japanese = flat(
			formatDoctorReport(result.report, { ...RENDER, locale: "ja", catalog: loadCatalog("ja") }),
		).replace(/\s+/gu, "");
		assert.match(japanese, /上流の表示に関する制約/u);
		assert.match(japanese, /固定版のPiと第三者の同梱拡張は独自の英語で表示し、Jouzuはこれを翻訳も置換もしません/u);
		assert.match(japanese, /Jouzu所有のブラウザーアダプターはツールのラベルをJouzuカタログから表示します/u);
		assert.match(japanese, /確認できなかった表示面は未確認のままとなり、翻訳済みには数えません/u);
		assert.match(japanese, /Piの固定版または拡張の版が変わったときに再確認します/u);
		assert.ok(!japanese.includes("Upstream text constraint"), "the ja render does not fall back to the English text");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the constraint stays out of the doctor report so the --json contract is unchanged", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-upstream-json-"));
	try {
		const result = createDoctorReport(context(root));
		// The machine keys are exactly the pinned contract: no constraint field, issue, or note.
		assert.deepEqual(
			result.report.fields.map((field) => field.id),
			DOCTOR_FIELD_IDS,
		);
		const serialized = JSON.stringify(result.report);
		assert.ok(!serialized.includes("upstream-owned"), "the constraint never enters the JSON report");
		assert.ok(!serialized.includes("Upstream text constraint"), "the constraint never enters the JSON report");
		// The renderer is still a pure rendering of the report plus the constraint text.
		assert.equal(formatDoctorReport(result.report), result.text);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a report without the pi.upstream field omits the constraint", () => {
	const minimal = {
		schemaVersion: 1,
		experimental: true,
		healthy: true,
		fields: [{ id: "a", section: "runtime", label: "A", value: "1" }],
		issues: [],
		notes: ["Note text."],
	};
	const text = formatDoctorReport(minimal, RENDER);
	assert.ok(!text.includes("Upstream text constraint"), "a report without pi.upstream has no constraint");
});
