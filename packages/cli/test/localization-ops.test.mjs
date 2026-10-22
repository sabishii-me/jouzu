/**
 * The language-settings operations.
 *
 * These tests drive the compiled `dist/localization-ops.js`. They pin the
 * issue #73 acceptance items: the session override and the environment save
 * are separate and resolve in the documented order; an environment save
 * reaches the current session; another session's input is unchanged and it is
 * told about the change; reset returns to the defaults; a corrupt file keeps
 * the previous values; and the receipt names the backup and the transaction.
 *
 * `npm run build` must run first: the tests import `dist`.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	applyLocalization,
	LOCALIZATION_SESSION_FILE_NAME,
	LocalizationConflictError,
	planLocalization,
	readLocalizationSessionOverride,
	readLocalizationSessionOverrides,
	resetLocalization,
} from "../dist/localization-ops.js";
import { LOCALIZATION_FILE_NAME } from "../dist/ui-locale.js";

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-localization-ops-"));
	const configDir = join(root, "config");
	const stateDir = join(root, "state");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });
	const paths = {
		configDir,
		agentDir: join(configDir, "agent"),
		stateDir,
		cacheDir: join(root, "cache"),
		sessionDir: join(stateDir, "sessions"),
		profileStatePath: join(stateDir, "profile-state.json"),
		backupDir: join(stateDir, "backups"),
	};
	return { root, configDir, stateDir, paths };
}

function settingsPath(configDir) {
	return join(configDir, LOCALIZATION_FILE_NAME);
}

function sessionStorePath(stateDir) {
	return join(stateDir, LOCALIZATION_SESSION_FILE_NAME);
}

function writeSettings(configDir, value) {
	writeFileSync(settingsPath(configDir), `${JSON.stringify(value, null, 2)}\n`);
}

function cleanup(workspace) {
	rmSync(workspace.root, { recursive: true, force: true });
}

test("the plan, apply, and reset operations are exported with a receipt shape", () => {
	assert.equal(typeof planLocalization, "function");
	assert.equal(typeof applyLocalization, "function");
	assert.equal(typeof resetLocalization, "function");
	assert.equal(LOCALIZATION_SESSION_FILE_NAME, "localization-session.json");
});

test("a session override and an environment save are stored separately", () => {
	const workspace = makeWorkspace();
	try {
		const session = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { uiLocale: "ja", responseLanguage: "ja" },
		});
		assert.equal(session.changed, true);
		assert.equal(existsSync(sessionStorePath(workspace.stateDir)), true);
		assert.equal(existsSync(settingsPath(workspace.configDir)), false, "a session override writes no settings file");

		const environment = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "environment",
			request: { uiLocale: "en" },
		});
		assert.equal(environment.changed, true);
		assert.equal(existsSync(settingsPath(workspace.configDir)), true, "the environment save writes the settings file");
		const saved = JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8"));
		assert.equal(saved.localization.uiLocale, "en");

		const override = readLocalizationSessionOverride(workspace.stateDir, "s1");
		assert.equal(override.uiLocale, undefined, "the environment save drops the display-language override");
		assert.equal(override.responseLanguage, "ja", "the response language stays in the session store");

		const plan = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(plan.effective.uiLocale.source, "config");
		assert.equal(plan.effective.uiLocale.effective, "en");
		assert.equal(plan.effective.responseLanguage.source, "session");
		assert.equal(plan.effective.responseLanguage.effective, "ja");
	} finally {
		cleanup(workspace);
	}
});

test("the response language resolves session before the saved setting", () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace.configDir, {
			schemaVersion: 2,
			localization: { uiLocale: "en", responseLanguage: "en" },
		});
		applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { responseLanguage: "ja" },
		});
		const withOverride = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(withOverride.effective.responseLanguage.source, "session");
		assert.equal(withOverride.effective.responseLanguage.effective, "ja");

		const withoutOverride = planLocalization(workspace.paths, { sessionId: "s2", scope: "session" });
		assert.equal(withoutOverride.effective.responseLanguage.source, "config");
		assert.equal(withoutOverride.effective.responseLanguage.effective, "en");
	} finally {
		cleanup(workspace);
	}
});

test("an environment save reaches the current session", () => {
	const workspace = makeWorkspace();
	try {
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: { uiLocale: "ja" } });
		const before = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(before.effective.uiLocale.source, "session");
		assert.equal(before.effective.uiLocale.effective, "ja");

		applyLocalization(workspace.paths, { sessionId: "s1", scope: "environment", request: { uiLocale: "en" } });
		const after = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(after.effective.uiLocale.source, "config");
		assert.equal(after.effective.uiLocale.effective, "en");
	} finally {
		cleanup(workspace);
	}
});

test("another session's input is unchanged and it is told about the change", () => {
	const workspace = makeWorkspace();
	try {
		applyLocalization(workspace.paths, { sessionId: "s2", scope: "session", request: { responseLanguage: "ja" } });
		const before = readLocalizationSessionOverride(workspace.stateDir, "s2");

		const result = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "environment",
			request: { uiLocale: "en" },
		});

		assert.deepEqual(
			result.notices.map((notice) => notice.sessionId),
			["s2"],
		);
		assert.equal(result.notices[0].change, "environment-settings");
		const after = readLocalizationSessionOverride(workspace.stateDir, "s2");
		assert.deepEqual(after, before, "another session's override is not edited");
	} finally {
		cleanup(workspace);
	}
});

test("reset returns every language setting to its default", () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace.configDir, { schemaVersion: 2, localization: { uiLocale: "en" } });
		applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { uiLocale: "ja", responseLanguage: "ja", artifactPolicy: { commits: "ja" } },
		});
		const before = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(before.effective.responseLanguage.source, "session");
		assert.equal(before.effective.artifactPolicy.effective.commits, "ja");

		const result = resetLocalization(workspace.paths, { sessionId: "s1" });
		assert.equal(result.changed, true);
		assert.equal(typeof result.transactionId, "string");
		assert.ok(result.transactionId.length > 0);

		const override = readLocalizationSessionOverride(workspace.stateDir, "s1");
		assert.deepEqual(override, {}, "the session override is cleared");
		const saved = JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8"));
		assert.equal(saved.localization.uiLocale, "auto", "the saved display language returns to auto");

		const after = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.notEqual(after.effective.uiLocale.source, "session");
		assert.equal(after.effective.responseLanguage.source, "builtin");
		assert.equal(after.effective.responseLanguage.effective, "auto");
		assert.equal(after.effective.artifactPolicy.source, "builtin");
		assert.equal(after.effective.artifactPolicy.effective.commits, "project");
	} finally {
		cleanup(workspace);
	}
});

test("a corrupt settings file keeps the previous values", () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace.configDir, { schemaVersion: 2, localization: { uiLocale: "ja" } });
		const corrupt = "{ not json";
		writeFileSync(settingsPath(workspace.configDir), corrupt);

		assert.throws(
			() =>
				applyLocalization(workspace.paths, {
					sessionId: "s1",
					scope: "environment",
					request: { uiLocale: "en" },
				}),
			LocalizationConflictError,
		);
		assert.equal(
			readFileSync(settingsPath(workspace.configDir), "utf8"),
			corrupt,
			"the corrupt file is not overwritten",
		);

		assert.throws(() => resetLocalization(workspace.paths, { sessionId: "s1" }), LocalizationConflictError);
		assert.equal(readFileSync(settingsPath(workspace.configDir), "utf8"), corrupt);
		assert.equal(existsSync(sessionStorePath(workspace.stateDir)), false, "no session write happened");
	} finally {
		cleanup(workspace);
	}
});

test("the receipt names the backup and the transaction", () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace.configDir, { schemaVersion: 2, localization: { uiLocale: "ja" } });
		const result = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "environment",
			request: { uiLocale: "en" },
		});
		assert.equal(typeof result.transactionId, "string");
		assert.ok(result.transactionId.length > 0);
		assert.equal(typeof result.backupDir, "string");
		assert.ok(result.backupDir.startsWith(join(workspace.paths.backupDir, "localization")));
		const backedUp = JSON.parse(readFileSync(join(result.backupDir, "localization.json"), "utf8"));
		assert.equal(backedUp.localization.uiLocale, "ja", "the backup holds the previous value");
	} finally {
		cleanup(workspace);
	}
});

test("a session apply receipts the previous session store as a backup", () => {
	const workspace = makeWorkspace();
	try {
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: { uiLocale: "ja" } });
		const result = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { uiLocale: "en" },
		});
		assert.equal(typeof result.backupDir, "string");
		const backedUp = JSON.parse(readFileSync(join(result.backupDir, LOCALIZATION_SESSION_FILE_NAME), "utf8"));
		assert.equal(backedUp.sessions.s1.uiLocale, "ja");
	} finally {
		cleanup(workspace);
	}
});

test("an unsupported requested value is a plan conflict and writes nothing", () => {
	const workspace = makeWorkspace();
	try {
		const plan = planLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { uiLocale: "fr" },
		});
		assert.equal(plan.conflicts.length, 1);
		assert.equal(plan.conflicts[0].reason, "unsupported-value");
		assert.throws(
			() => applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: { uiLocale: "fr" } }),
			LocalizationConflictError,
		);
		assert.equal(existsSync(sessionStorePath(workspace.stateDir)), false);
	} finally {
		cleanup(workspace);
	}
});

test("the session store keeps every session's override", () => {
	const workspace = makeWorkspace();
	try {
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: { uiLocale: "ja" } });
		applyLocalization(workspace.paths, { sessionId: "s2", scope: "session", request: { uiLocale: "en" } });
		const overrides = readLocalizationSessionOverrides(workspace.stateDir);
		assert.equal(overrides.s1.uiLocale, "ja");
		assert.equal(overrides.s2.uiLocale, "en");
	} finally {
		cleanup(workspace);
	}
});
