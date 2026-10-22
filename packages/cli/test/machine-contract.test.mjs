import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { UsageError } from "../dist/args.js";
import { catalogStatus } from "../dist/catalog-command.js";
import { createDoctorReport } from "../dist/doctor.js";
import { KeybindingConfigError, KeybindingConflictError, planKeybindings } from "../dist/keybindings.js";
import { handleMainCliError } from "../dist/main-cli.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { PiImportError } from "../dist/pi-import.js";
import { ProfileConflictError, ProfileStateError } from "../dist/profile-manager.js";
import { UpdateError } from "../dist/updater.js";
import {
	CATALOG_SOURCE_KEYS,
	CATALOG_STATUS_KEYS,
	DOCTOR_DEFAULT_ISSUE_IDS,
	DOCTOR_FIELD_IDS,
	DOCTOR_FIELD_KEYS,
	DOCTOR_ISSUE_KEYS,
	DOCTOR_PROBLEM_ISSUE_IDS,
	DOCTOR_REPORT_KEYS,
	KEYBINDING_ACTION_KEYS,
	KEYBINDING_PLAN_KEYS,
} from "./fixtures/machine-contract.mjs";

/**
 * The machine contract is the `--json` shape, the process exit codes, and the
 * doctor identifiers. These tests are intentionally literal: a rename or a
 * dropped key must break the build, not silently ship to automation.
 */

function metadata(overrides = {}) {
	return {
		jouzuVersion: "0.1.0",
		displayVersion: "0.1.0",
		build: undefined,
		piVersion: "0.84.2",
		profileSchemaVersion: 1,
		lock: {
			schemaVersion: 2,
			repository: "https://github.com/earendil-works/pi-mono",
			tag: "v0.84.2",
			tagCommit: "914cf1472e715297caa30db4b9535d534a9eb718",
			commit: "914cf1472e715297caa30db4b9535d534a9eb718",
			packages: {},
			reviewedAt: "2026-08-20",
			compatibilityStatus: "qualified",
			deviations: [],
			...overrides,
		},
	};
}

function doctorContext(paths, overrides = {}) {
	return {
		metadata: metadata(),
		paths,
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "0.84.2",
		executable: "/opt/jouzu/dist/cli.js",
		env: { HOME: paths.stateDir },
		platform: "linux",
		architecture: "x64",
		nodeVersion: "v22.19.0",
		locale: "en-US",
		uiLocale: { requested: "auto", effective: "en", source: "os" },
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
		...overrides,
	};
}

const KEYBINDING_PLAN = {
	schemaVersion: 1,
	defaultsVersion: 2,
	configPath: "/tmp/machine-contract/keybindings.json",
	statePath: "/tmp/machine-contract/keybindings-state.json",
	configExists: true,
	policy: "applied",
	status: "customized",
	portabilityWarnings: [],
	actions: [
		{ type: "set", action: "app.message.followUp", binding: "ctrl+enter", reason: "default" },
		{
			type: "conflict",
			action: "app.message.dequeue",
			reason: "user binding",
			conflictingAction: "app.message.followUp",
			observed: "ctrl+enter",
		},
	],
};

const PROFILE_PLAN = {
	schemaVersion: 1,
	profile: "ja",
	profileVersion: 3,
	manifestSha256: "0".repeat(64),
	agentDir: "/tmp/machine-contract/agent",
	actions: [
		{ type: "create", target: "/tmp/machine-contract/agent/a.md", reason: "add", desiredSha256: "1".repeat(64) },
		{
			type: "conflict",
			target: "/tmp/machine-contract/agent/b.md",
			reason: "modified",
			desiredSha256: "2".repeat(64),
			observedSha256: "3".repeat(64),
		},
	],
};

function withTempRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-machine-contract-"));
	rmSync(root, { recursive: true, force: true });
	try {
		return run(resolveJouzuPaths({ homeOverride: root }));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function effectiveExitCode(error) {
	const originalError = console.error;
	const originalExitCode = process.exitCode;
	console.error = () => {};
	process.exitCode = undefined;
	try {
		handleMainCliError(error);
	} finally {
		console.error = originalError;
	}
	const code = process.exitCode;
	process.exitCode = originalExitCode;
	return code;
}

test("machine contract: --json keys are pinned", () => {
	withTempRoot((paths) => {
		const report = createDoctorReport(doctorContext(paths)).report;
		assert.deepEqual(Object.keys(report), DOCTOR_REPORT_KEYS);
		for (const field of report.fields) assert.deepEqual(Object.keys(field), DOCTOR_FIELD_KEYS);
		for (const issue of report.issues) {
			assert.deepEqual(
				Object.keys(issue),
				issue.subject === undefined ? DOCTOR_ISSUE_KEYS : [...DOCTOR_ISSUE_KEYS, "subject"],
			);
		}

		const plan = planKeybindings(paths, { platform: "linux", env: {} });
		assert.deepEqual(Object.keys(plan), KEYBINDING_PLAN_KEYS);
		for (const action of plan.actions) assert.deepEqual(Object.keys(action), KEYBINDING_ACTION_KEYS);

		const status = catalogStatus(paths, {});
		assert.deepEqual(Object.keys(status), CATALOG_STATUS_KEYS);
		for (const source of status.sources) assert.deepEqual(Object.keys(source), CATALOG_SOURCE_KEYS);
	});
});

test("machine contract: doctor field and issue IDs are pinned", () => {
	withTempRoot((paths) => {
		const report = createDoctorReport(doctorContext(paths)).report;
		assert.deepEqual(
			report.fields.map((field) => field.id),
			DOCTOR_FIELD_IDS,
		);
		assert.deepEqual(
			report.issues.map((issue) => issue.id),
			DOCTOR_DEFAULT_ISSUE_IDS,
		);

		const failing = createDoctorReport(
			doctorContext(paths, {
				metadata: metadata({ compatibilityStatus: "pending" }),
				profile: { id: "core", source: "default", appliedManifestSha256: "b".repeat(64) },
				piRuntimeVersion: "0.85.0",
				piRuntimeDiagnostic: "boom",
				desiredProfileManifestSha256: "c".repeat(64),
				nodeVersion: "v20.0.0",
				commandPaths: { git: null, bash: null, npm: null },
				updateStatus: {
					policy: "off",
					installChannel: "other",
					startupEligible: false,
					state: {
						schemaVersion: 1,
						policy: "off",
						channel: "latest",
						lastCheckedAt: null,
						nextCheckAt: null,
						lastResult: "failed",
						installedVersion: "0.1.0",
						latestVersion: null,
						latestIntegrity: null,
						previousVersion: null,
						lastUpdatedAt: null,
						lastErrorCode: "E_NET",
					},
				},
				updateDiagnostic: "status boom",
				keybindingPlan: KEYBINDING_PLAN,
				keybindingDiagnostic: "kb boom",
				releaseExtensionStatus: {
					manifest: { schemaVersion: 1, packages: [], compatibilityDependencies: [], runtimeDependencyRedirects: [] },
					extensionCount: 2,
					skillCount: 0,
					resolvedExtensions: [],
					resolvedExtensionPaths: [],
					resolvedSkillPaths: [],
					resolvedPackageRoots: {},
					degradedExtensions: [{ packageName: "p", packageVersion: "1", tools: [], error: "e" }],
					errors: ["required missing"],
				},
				releaseExtensionDiagnostic: "ext boom",
				catalogDiagnostic: "cat boom",
			}),
		).report;
		assert.deepEqual(
			failing.issues.map((issue) => issue.id),
			DOCTOR_PROBLEM_ISSUE_IDS,
		);
	});
});

test("machine contract: exit codes are pinned", () => {
	assert.equal(effectiveExitCode(new PiImportError("x")), 1);
	assert.equal(effectiveExitCode(new KeybindingConflictError(KEYBINDING_PLAN)), 5);
	assert.equal(effectiveExitCode(new KeybindingConfigError("x")), 5);
	assert.equal(effectiveExitCode(new ProfileStateError("x")), 1);
	assert.equal(effectiveExitCode(new ProfileConflictError(PROFILE_PLAN)), 3);
	assert.equal(effectiveExitCode(new UsageError("x")), 2);
	assert.equal(effectiveExitCode(new Error("x")), 1);
	assert.equal(effectiveExitCode("x"), 1);
	assert.equal(new UpdateError("x", "update-error").exitCode, 4);
});
