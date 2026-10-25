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
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ARTIFACT_POLICY_FIELDS,
	DEFAULT_ARTIFACT_POLICY,
	resolveArtifactPolicy,
	resolveResponseLanguage,
} from "../dist/language-settings.js";
import {
	applyLocalization,
	LOCALIZATION_SESSION_FILE_NAME,
	LocalizationConflictError,
	LocalizationRecoveryError,
	planLocalization,
	readLocalizationSessionOverride,
	readLocalizationSessionOverrides,
	resetLocalization,
} from "../dist/localization-ops.js";
import {
	LOCALIZATION_FILE_NAME,
	LOCALIZATION_LOCK_FILE_NAME,
	readLocalizationConfigSnapshot,
	readLocalizationSettings,
	saveLocalizationConfig,
	UiLocaleConflictError,
} from "../dist/ui-locale.js";

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

test("Saved setting persists all requested fields for a fresh session and clears matching overrides", (t) => {
	const workspace = makeWorkspace();
	t.after(() => cleanup(workspace));
	const artifactPolicy = { comments: "preserve", documentation: "zh-Hant", commits: "en", reviews: "project" };
	const old = { uiLocale: "en", responseLanguage: "en", artifactPolicy: { commits: "ja" } };
	writeSettings(workspace.configDir, { schemaVersion: 2, localization: old });
	applyLocalization(workspace.paths, {
		sessionId: "s1",
		scope: "session",
		request: { uiLocale: "en", responseLanguage: "zh-Hans", artifactPolicy: { commits: "zh-Hans" } },
	});
	applyLocalization(workspace.paths, { sessionId: "other", scope: "session", request: old });
	const other = readLocalizationSessionOverride(workspace.stateDir, "other");
	const request = { uiLocale: "ja", responseLanguage: "ja", artifactPolicy };
	const result = applyLocalization(workspace.paths, { sessionId: "s1", scope: "environment", request });
	assert.equal(result.changed, true);
	assert.deepEqual(JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8")).localization, request);
	assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "s1"), {});
	assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "other"), other);
	assert.deepEqual(
		result.notices.map((notice) => notice.sessionId),
		["other"],
	);
	assert.deepEqual(JSON.parse(readFileSync(join(result.backupDir, LOCALIZATION_FILE_NAME), "utf8")).localization, old);
	for (const field of ["uiLocale", "responseLanguage", "artifactPolicy"]) {
		assert.ok(result.plan.actions.some((action) => action.scope === "environment" && action.field === field));
		assert.ok(
			result.plan.actions.some(
				(action) => action.scope === "session" && action.field === field && action.type === "clear",
			),
		);
	}
	for (const sessionId of ["s1", "fresh"]) {
		const { effective } = planLocalization(workspace.paths, { sessionId, scope: "session" });
		assert.equal(effective.responseLanguage.source, "config");
		assert.equal(effective.responseLanguage.effective, "ja");
		assert.deepEqual(effective.artifactPolicy.effective, artifactPolicy);
		assert.ok(Object.values(effective.artifactPolicy.fieldSources).every((source) => source === "config"));
	}
	// Startup resolves only the saved fields, with no current-session override.
	const saved = readLocalizationSettings(workspace.configDir).settings;
	assert.equal(resolveResponseLanguage({ config: saved.responseLanguage }).effective, "ja");
	assert.deepEqual(resolveArtifactPolicy({ config: saved.artifactPolicy }).effective, artifactPolicy);
});

for (const field of ARTIFACT_POLICY_FIELDS) {
	test(`Saved setting merges ${field} without clearing omitted preferences or overrides`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		const artifactPolicy = { comments: "en", documentation: "ja", commits: "zh-Hans", reviews: "zh-Hant" };
		const saved = { uiLocale: "ja", responseLanguage: "zh-Hant", artifactPolicy };
		writeSettings(workspace.configDir, { schemaVersion: 2, localization: saved });
		const override = { uiLocale: "en", responseLanguage: "en", artifactPolicy: { ...artifactPolicy } };
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: override });
		const result = applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "environment",
			request: { artifactPolicy: { [field]: "preserve" } },
		});
		assert.equal(result.changed, true);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8")).localization, {
			...saved,
			artifactPolicy: { ...artifactPolicy, [field]: "preserve" },
		});
		delete override.artifactPolicy[field];
		assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "s1"), override);
		const { effective } = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
		assert.equal(effective.artifactPolicy.effective[field], "preserve");
		assert.equal(effective.artifactPolicy.fieldSources[field], "config");
		for (const omitted of ARTIFACT_POLICY_FIELDS.filter((candidate) => candidate !== field)) {
			assert.equal(effective.artifactPolicy.fieldSources[omitted], "session");
		}
	});
}

for (const request of [
	{ responseLanguage: "auto" },
	{ artifactPolicy: { comments: "preserve" } },
	{ uiLocale: "auto", responseLanguage: "auto", artifactPolicy: DEFAULT_ARTIFACT_POLICY },
]) {
	test(`Saved setting records explicit defaults on first save: ${JSON.stringify(request)}`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		const options = { sessionId: "s1", scope: "environment", request };
		const result = applyLocalization(workspace.paths, options);
		assert.equal(result.changed, true);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8")).localization, {
			uiLocale: "auto",
			...request,
		});
		assert.equal(existsSync(sessionStorePath(workspace.stateDir)), false);
		const again = applyLocalization(workspace.paths, options);
		assert.equal(again.changed, false);
		assert.deepEqual(again.plan.actions, []);
		assert.deepEqual(again.notices, []);
		assert.equal(again.backupDir, undefined);
	});
}

for (const request of [{}, { artifactPolicy: {} }]) {
	test(`an empty Saved request preserves every session override: ${JSON.stringify(request)}`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		const override = { uiLocale: "ja", responseLanguage: "ja", artifactPolicy: { commits: "ja" } };
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: override });
		applyLocalization(workspace.paths, { sessionId: "other", scope: "session", request: override });
		const before = readFileSync(sessionStorePath(workspace.stateDir), "utf8");
		const result = applyLocalization(workspace.paths, { sessionId: "s1", scope: "environment", request });
		assert.equal(result.changed, false);
		assert.deepEqual(result.plan.actions, []);
		assert.deepEqual(result.notices, []);
		assert.equal(readFileSync(sessionStorePath(workspace.stateDir), "utf8"), before);
		assert.equal(existsSync(settingsPath(workspace.configDir)), false);
	});
}

test("saving an existing response default clears only its stale session override without a settings notice", (t) => {
	const workspace = makeWorkspace();
	t.after(() => cleanup(workspace));
	writeSettings(workspace.configDir, { schemaVersion: 2, localization: { uiLocale: "ja", responseLanguage: "auto" } });
	const request = { uiLocale: "en", responseLanguage: "ja", artifactPolicy: { reviews: "ja" } };
	applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request });
	applyLocalization(workspace.paths, { sessionId: "other", scope: "session", request });
	const before = readFileSync(settingsPath(workspace.configDir), "utf8");
	const result = applyLocalization(workspace.paths, {
		sessionId: "s1",
		scope: "environment",
		request: { responseLanguage: "auto" },
	});
	assert.equal(result.changed, true);
	assert.deepEqual(result.notices, []);
	assert.equal(readFileSync(settingsPath(workspace.configDir), "utf8"), before);
	assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "s1"), {
		uiLocale: "en",
		artifactPolicy: { reviews: "ja" },
	});
	assert.equal(
		planLocalization(workspace.paths, { sessionId: "s1", scope: "session" }).effective.responseLanguage.effective,
		"auto",
	);
});

test("reset preserves saved response and artifact defaults and other sessions after a Saved change", (t) => {
	const workspace = makeWorkspace();
	t.after(() => cleanup(workspace));
	const request = {
		uiLocale: "ja",
		responseLanguage: "zh-Hant",
		artifactPolicy: { comments: "preserve", commits: "en" },
	};
	applyLocalization(workspace.paths, { sessionId: "s1", scope: "environment", request });
	const override = { uiLocale: "en", responseLanguage: "auto", artifactPolicy: { comments: "ja" } };
	applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: override });
	applyLocalization(workspace.paths, { sessionId: "other", scope: "session", request: override });
	const result = resetLocalization(workspace.paths, { sessionId: "s1" });
	assert.equal(result.changed, true);
	assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "s1"), {});
	assert.deepEqual(readLocalizationSessionOverride(workspace.stateDir, "other"), override);
	assert.deepEqual(JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8")).localization, {
		...request,
		uiLocale: "auto",
	});
	const { effective } = planLocalization(workspace.paths, { sessionId: "s1", scope: "session" });
	assert.equal(effective.responseLanguage.effective, "zh-Hant");
	assert.equal(effective.responseLanguage.source, "config");
	assert.equal(effective.artifactPolicy.effective.commits, "en");
	assert.ok(result.plan.actions.some((action) => action.field === "responseLanguage" && action.type === "clear"));
});

for (const localization of [{ responseLanguage: "ja", unknown: true }, { artifactPolicy: { unknown: "en" } }]) {
	test(`Saved setting refuses unknown schema fields: ${JSON.stringify(localization)}`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		writeSettings(workspace.configDir, { schemaVersion: 2, localization });
		const before = readFileSync(settingsPath(workspace.configDir), "utf8");
		assert.throws(
			() =>
				applyLocalization(workspace.paths, {
					sessionId: "s1",
					scope: "environment",
					request: { responseLanguage: "en", artifactPolicy: { reviews: "en" } },
				}),
			LocalizationConflictError,
		);
		assert.equal(readFileSync(settingsPath(workspace.configDir), "utf8"), before);
		assert.equal(existsSync(sessionStorePath(workspace.stateDir)), false);
	});
}

for (const failure of ["revision conflict", "atomic rename failure"]) {
	test(`a response/artifact Saved ${failure} leaves the session override intact`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		const saved = { uiLocale: "en", responseLanguage: "en", artifactPolicy: { commits: "en" } };
		writeSettings(workspace.configDir, { schemaVersion: 2, localization: saved });
		applyLocalization(workspace.paths, {
			sessionId: "s1",
			scope: "session",
			request: { responseLanguage: "zh-Hans", artifactPolicy: { commits: "zh-Hans" } },
		});
		const sessionBefore = readFileSync(sessionStorePath(workspace.stateDir), "utf8");
		const originalCopy = fs.copyFileSync;
		if (failure === "revision conflict") {
			t.mock.method(fs, "copyFileSync", (...args) => {
				originalCopy(...args);
				writeSettings(workspace.configDir, {
					schemaVersion: 2,
					localization: { ...saved, responseLanguage: "zh-Hant" },
				});
			});
		} else {
			t.mock.method(fs, "renameSync", () => {
				throw new Error("simulated rename failure");
			});
		}
		syncBuiltinESMExports();
		try {
			assert.throws(
				() =>
					applyLocalization(workspace.paths, {
						sessionId: "s1",
						scope: "environment",
						request: { responseLanguage: "ja", artifactPolicy: { commits: "ja" } },
					}),
				failure === "revision conflict" ? UiLocaleConflictError : /simulated rename failure/u,
			);
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
		assert.equal(readFileSync(sessionStorePath(workspace.stateDir), "utf8"), sessionBefore);
		assert.deepEqual(JSON.parse(readFileSync(settingsPath(workspace.configDir), "utf8")).localization, {
			...saved,
			responseLanguage: failure === "revision conflict" ? "zh-Hant" : "en",
		});
	});
}

for (const operation of ["save-existing", "save-absent", "reset"]) {
	test(`${operation} restores the prior settings after the session-store rename fails`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		if (operation !== "save-absent") {
			// Restore the exact source bytes, including the legacy schema and spacing.
			writeFileSync(
				settingsPath(workspace.configDir),
				'{ "schemaVersion": 1, "localization": { "uiLocale": "ja" } }\n',
			);
		}
		const before = operation === "save-absent" ? undefined : readFileSync(settingsPath(workspace.configDir), "utf8");
		const override = { uiLocale: "en", responseLanguage: "zh-Hant", artifactPolicy: { commits: "en" } };
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: override });
		applyLocalization(workspace.paths, { sessionId: "other", scope: "session", request: { responseLanguage: "en" } });
		const sessionBefore = readFileSync(sessionStorePath(workspace.stateDir), "utf8");
		const rename = fs.renameSync;
		const targets = [];
		t.mock.method(fs, "renameSync", (source, target) => {
			targets.push(target);
			if (target === sessionStorePath(workspace.stateDir)) throw new Error("session-store rename failed");
			return rename(source, target);
		});
		syncBuiltinESMExports();
		const apply = () =>
			operation === "reset"
				? resetLocalization(workspace.paths, { sessionId: "s1" })
				: applyLocalization(workspace.paths, {
						sessionId: "s1",
						scope: "environment",
						request: { responseLanguage: "ja", artifactPolicy: { commits: "ja" } },
					});
		try {
			assert.throws(apply, /session-store rename failed/u);
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
		assert.deepEqual(targets.slice(0, 2), [settingsPath(workspace.configDir), sessionStorePath(workspace.stateDir)]);
		if (before === undefined) assert.equal(existsSync(settingsPath(workspace.configDir)), false);
		else assert.equal(readFileSync(settingsPath(workspace.configDir), "utf8"), before);
		assert.equal(readFileSync(sessionStorePath(workspace.stateDir), "utf8"), sessionBefore);
		assert.equal(existsSync(join(workspace.stateDir, LOCALIZATION_LOCK_FILE_NAME)), false);
		const retried = apply();
		assert.equal(retried.changed, true, "the restored operation is retryable");
	});
}

for (const failure of ["concurrent save", "restore write", "recovery lock", "settings directory replaced"]) {
	test(`failed session-store save reports incomplete recovery after ${failure}`, (t) => {
		const workspace = makeWorkspace();
		t.after(() => cleanup(workspace));
		if (failure !== "settings directory replaced") {
			writeSettings(workspace.configDir, {
				schemaVersion: 2,
				localization: { uiLocale: "en", responseLanguage: "en" },
			});
		}
		applyLocalization(workspace.paths, { sessionId: "s1", scope: "session", request: { responseLanguage: "zh-Hant" } });
		const sessionBefore = readFileSync(sessionStorePath(workspace.stateDir), "utf8");
		const rename = fs.renameSync;
		let sessionWriteFailed = false;
		t.mock.method(fs, "renameSync", (source, target) => {
			if (target === sessionStorePath(workspace.stateDir)) {
				sessionWriteFailed = true;
				if (failure === "concurrent save") {
					saveLocalizationConfig(
						workspace.paths,
						"en",
						readLocalizationConfigSnapshot(workspace.configDir),
						undefined,
						{ responseLanguage: "zh-Hans" },
					);
				} else if (failure === "settings directory replaced") {
					const moved = `${workspace.configDir}-moved`;
					rename(workspace.configDir, moved);
					fs.symlinkSync(moved, workspace.configDir, "junction");
				} else if (failure === "recovery lock") {
					writeFileSync(
						join(workspace.stateDir, LOCALIZATION_LOCK_FILE_NAME),
						JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: "other-owner" }),
					);
				}
				throw new Error("session-store rename failed");
			}
			if (failure === "restore write" && sessionWriteFailed && target === settingsPath(workspace.configDir)) {
				throw new Error("restore rename failed");
			}
			return rename(source, target);
		});
		syncBuiltinESMExports();
		try {
			assert.throws(
				() =>
					applyLocalization(workspace.paths, {
						sessionId: "s1",
						scope: "environment",
						request: { responseLanguage: "ja" },
					}),
				(error) => {
					assert.ok(error instanceof LocalizationRecoveryError);
					assert.match(error.message, /could not be restored/u);
					assert.match(error.message, /Reopen Language settings/u);
					assert.match(error.cause.message, /session-store rename failed/u);
					if (failure === "concurrent save") assert.ok(error.recoveryError instanceof UiLocaleConflictError);
					return true;
				},
			);
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
		assert.equal(readFileSync(sessionStorePath(workspace.stateDir), "utf8"), sessionBefore);
		assert.equal(
			readLocalizationSettings(workspace.configDir).settings.responseLanguage,
			failure === "concurrent save" ? "zh-Hans" : "ja",
		);
		if (failure === "recovery lock") {
			assert.equal(
				JSON.parse(readFileSync(join(workspace.stateDir, LOCALIZATION_LOCK_FILE_NAME), "utf8")).token,
				"other-owner",
			);
		}
	});
}

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
