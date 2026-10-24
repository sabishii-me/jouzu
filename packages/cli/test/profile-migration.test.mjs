/**
 * The reversible Japanese-profile migration.
 *
 * These tests drive the compiled `dist/profile-migration.js` and pin the
 * issue #75 acceptance items: the plan types are exported and the plan
 * explains the effective profile from the applied state and the saved choice;
 * the mapping is `ja` to `responseLanguage: "ja"` and `core` to `"auto"`; a
 * temporary CLI or environment choice is never auto-saved to the user-wide
 * settings; an edited `APPEND_SYSTEM.md` is preserved and a re-run does not
 * duplicate instructions; cancel and rollback restore the previous state; and
 * the response behavior is unchanged until the migration is accepted.
 *
 * `npm run build` must run first: the tests import `dist`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../dist/locale-catalog.js";
import {
	applyProfileMigration,
	cancelProfileMigration,
	formatProfileMigrationPlan,
	PROFILE_CHOICE_FILE_NAME,
	PROFILE_MIGRATION_ASSET_TARGET,
	PROFILE_MIGRATION_BACKUP_DIRECTORY,
	ProfileMigrationConflictError,
	planProfileMigration,
	profileMigrationPersists,
	rollbackProfileMigration,
} from "../dist/profile-migration.js";
import { loadBundledProfile } from "../dist/profiles.js";
import { LOCALIZATION_FILE_NAME } from "../dist/ui-locale.js";

const MANAGED = "# Jouzu Japanese-First Policy\n\n- Reply in Japanese.\n- Keep protected values exact.\n";

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-profile-migration-"));
	const configDir = join(root, "config");
	const stateDir = join(root, "state");
	const agentDir = join(configDir, "agent");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	const paths = {
		configDir,
		agentDir,
		stateDir,
		cacheDir: join(root, "cache"),
		sessionDir: join(stateDir, "sessions"),
		profileStatePath: join(stateDir, "profile-state.json"),
		backupDir: join(stateDir, "backups"),
	};
	return { root, paths };
}

function cleanup(workspace) {
	rmSync(workspace.root, { recursive: true, force: true });
}

function writeChoice(workspace, profile) {
	writeFileSync(
		join(workspace.paths.stateDir, PROFILE_CHOICE_FILE_NAME),
		`${JSON.stringify({ schemaVersion: 1, profile, chosenAt: "2026-08-20T12:00:00.000Z" }, null, 2)}\n`,
	);
}

function writeState(workspace, profile) {
	const sha = createHash("sha256").update("manifest").digest("hex");
	writeFileSync(
		workspace.paths.profileStatePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				activeProfile: profile,
				profileVersion: 1,
				manifestSha256: sha,
				jouzuVersion: "0.1.19",
				transactionId: "t-1",
				appliedAt: "2026-08-20T12:00:00.000Z",
				managedTargets: [{ target: PROFILE_MIGRATION_ASSET_TARGET, sha256: sha }],
			},
			null,
			2,
		)}\n`,
	);
}

function writeSettings(workspace, localization, schemaVersion = 2) {
	writeFileSync(
		join(workspace.paths.configDir, LOCALIZATION_FILE_NAME),
		`${JSON.stringify({ schemaVersion, localization }, null, 2)}\n`,
	);
}

function settingsFile(workspace) {
	return join(workspace.paths.configDir, LOCALIZATION_FILE_NAME);
}

function appendFile(workspace) {
	return join(workspace.paths.agentDir, PROFILE_MIGRATION_ASSET_TARGET);
}

function options(extra = {}) {
	return { managedAppendSystem: MANAGED, env: {}, ...extra };
}

test("the migration operations and the plan constants are exported", () => {
	for (const value of [planProfileMigration, applyProfileMigration, cancelProfileMigration, rollbackProfileMigration]) {
		assert.equal(typeof value, "function");
	}
	assert.equal(PROFILE_MIGRATION_ASSET_TARGET, "APPEND_SYSTEM.md");
	assert.equal(PROFILE_MIGRATION_BACKUP_DIRECTORY, "profile-migration");
});

test("the plan explains the effective profile from the applied state and the saved choice", () => {
	const workspace = makeWorkspace();
	try {
		const empty = planProfileMigration(workspace.paths, options());
		assert.deepEqual(empty.from, { profile: "core", source: "default" });

		writeState(workspace, "ja");
		const fromState = planProfileMigration(workspace.paths, options());
		assert.deepEqual(fromState.from, { profile: "ja", source: "saved" });

		rmSync(workspace.paths.profileStatePath);
		writeChoice(workspace, "ja");
		const fromChoice = planProfileMigration(workspace.paths, options());
		assert.deepEqual(fromChoice.from, { profile: "ja", source: "saved" });

		const explicit = planProfileMigration(workspace.paths, options({ explicitProfile: "core" }));
		assert.deepEqual(explicit.from, { profile: "core", source: "cli" });

		const fromEnv = planProfileMigration(workspace.paths, options({ env: { JOUZU_PROFILE: "ja" } }));
		assert.deepEqual(fromEnv.from, { profile: "ja", source: "env" });
	} finally {
		cleanup(workspace);
	}
});

test("the mapping is ja to responseLanguage ja and core to auto, with the display language left alone", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const ja = planProfileMigration(workspace.paths, options());
		assert.deepEqual(ja.to, { responseLanguage: "ja", uiLocale: "auto" });

		writeChoice(workspace, "core");
		const core = planProfileMigration(workspace.paths, options());
		assert.deepEqual(core.to, { responseLanguage: "auto", uiLocale: "auto" });
	} finally {
		cleanup(workspace);
	}
});

test("a temporary CLI choice is never auto-saved to the user-wide settings", () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const before = readFileSync(settingsFile(workspace), "utf8");
		const receipt = applyProfileMigration(workspace.paths, options({ explicitProfile: "ja" }));
		assert.equal(receipt.changed, false);
		assert.equal(receipt.persisted, false);
		assert.equal(profileMigrationPersists(receipt.plan), false);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), before);
	} finally {
		cleanup(workspace);
	}
});

test("a temporary environment choice is never auto-saved to the user-wide settings", () => {
	const workspace = makeWorkspace();
	try {
		const receipt = applyProfileMigration(workspace.paths, options({ env: { JOUZU_PROFILE: "ja" } }));
		assert.equal(receipt.changed, false);
		assert.equal(receipt.persisted, false);
		assert.equal(existsSync(settingsFile(workspace)), false, "no settings file is created for a temporary choice");
	} finally {
		cleanup(workspace);
	}
});

test("a saved ja choice persists responseLanguage ja through the shared writer", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(receipt.changed, true);
		assert.equal(receipt.persisted, true);
		const saved = JSON.parse(readFileSync(settingsFile(workspace), "utf8"));
		assert.equal(saved.localization.responseLanguage, "ja");
		assert.equal(saved.localization.uiLocale, "en", "the display language is unchanged");
	} finally {
		cleanup(workspace);
	}
});

test("a schemaVersion 1 settings file is read, migrated in memory, and preserved", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "ja" }, 1);
		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(receipt.changed, true);
		const saved = JSON.parse(readFileSync(settingsFile(workspace), "utf8"));
		assert.equal(saved.schemaVersion, 2);
		assert.equal(saved.localization.uiLocale, "ja", "the version 1 uiLocale survives");
		assert.equal(saved.localization.responseLanguage, "ja");
	} finally {
		cleanup(workspace);
	}
});

test("the apply is idempotent: a second run changes nothing", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const first = applyProfileMigration(workspace.paths, options());
		assert.equal(first.changed, true);
		const settingsAfterFirst = readFileSync(settingsFile(workspace), "utf8");
		const second = applyProfileMigration(workspace.paths, options());
		assert.equal(second.changed, false);
		assert.equal(second.targets.length, 0);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsAfterFirst);
	} finally {
		cleanup(workspace);
	}
});

test("a distribution-managed APPEND_SYSTEM.md is deduplicated once and a re-run does not duplicate", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeFileSync(appendFile(workspace), MANAGED);
		const plan = planProfileMigration(workspace.paths, options());
		const asset = plan.assets.find((entry) => entry.target === PROFILE_MIGRATION_ASSET_TARGET);
		assert.equal(asset?.action, "deduplicate");
		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(receipt.changed, true);
		assert.equal(existsSync(appendFile(workspace)), false, "the managed duplicate is removed");
		const again = applyProfileMigration(workspace.paths, options());
		assert.equal(again.changed, false);
		assert.equal(existsSync(appendFile(workspace)), false);
	} finally {
		cleanup(workspace);
	}
});

test("an edited APPEND_SYSTEM.md is preserved and its duplicate is shown as a diff with a resolution", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const edited = `${MANAGED}- My own instruction.\n`;
		writeFileSync(appendFile(workspace), edited);
		const plan = planProfileMigration(workspace.paths, options());
		const asset = plan.assets.find((entry) => entry.target === PROFILE_MIGRATION_ASSET_TARGET);
		assert.equal(asset?.action, "preserve");
		assert.equal(asset?.resolution, "keep-edits");
		assert.ok(asset?.diff.some((line) => line.kind === "remove" && line.text.includes("Reply in Japanese")));
		assert.ok(asset?.diff.some((line) => line.kind === "keep" && line.text.includes("My own instruction")));

		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(receipt.changed, true, "the response language is persisted");
		assert.equal(readFileSync(appendFile(workspace), "utf8"), edited, "the edited file is not rewritten");

		const again = applyProfileMigration(workspace.paths, options());
		assert.equal(again.changed, false);
		assert.equal(readFileSync(appendFile(workspace), "utf8"), edited);
	} finally {
		cleanup(workspace);
	}
});

test("the default managed asset is the bundled ja APPEND_SYSTEM.md", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const bundled = loadBundledProfile("ja").assets.find((asset) => asset.target === PROFILE_MIGRATION_ASSET_TARGET);
		writeFileSync(appendFile(workspace), bundled.bytes);
		const plan = planProfileMigration(workspace.paths, { env: {} });
		const asset = plan.assets.find((entry) => entry.target === PROFILE_MIGRATION_ASSET_TARGET);
		assert.equal(asset?.action, "deduplicate");
	} finally {
		cleanup(workspace);
	}
});

test("a cancel writes nothing and restores no state", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const before = readFileSync(settingsFile(workspace), "utf8");
		const result = cancelProfileMigration(workspace.paths, options());
		assert.equal(result.applied, false);
		assert.equal(result.plan.from.profile, "ja");
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), before);
		assert.equal(existsSync(workspace.paths.backupDir), false);
	} finally {
		cleanup(workspace);
	}
});

test("a rollback restores the previous settings and the removed asset", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(receipt.changed, true);
		assert.ok(receipt.backupDir?.includes(PROFILE_MIGRATION_BACKUP_DIRECTORY));
		assert.deepEqual([...receipt.targets].sort(), [LOCALIZATION_FILE_NAME, PROFILE_MIGRATION_ASSET_TARGET].sort());
		assert.equal(existsSync(appendFile(workspace)), false);

		const rollback = rollbackProfileMigration(workspace.paths, receipt);
		assert.equal(rollback.restored, true);
		const restored = JSON.parse(readFileSync(settingsFile(workspace), "utf8"));
		assert.equal(restored.localization.responseLanguage, "en");
		assert.equal(readFileSync(appendFile(workspace), "utf8"), MANAGED, "the managed asset is restored");
	} finally {
		cleanup(workspace);
	}
});

test("a rollback removes a settings file the migration created", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const receipt = applyProfileMigration(workspace.paths, options());
		assert.equal(existsSync(settingsFile(workspace)), true);
		rollbackProfileMigration(workspace.paths, receipt);
		assert.equal(existsSync(settingsFile(workspace)), false, "the created settings file is removed");
	} finally {
		cleanup(workspace);
	}
});

test("response behavior is unchanged until the migration is accepted", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		const appendBefore = readFileSync(appendFile(workspace), "utf8");

		// A preview and a cancel are read-only: the settings, the prompt asset,
		// and the state directory are unchanged.
		planProfileMigration(workspace.paths, options());
		cancelProfileMigration(workspace.paths, options());
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore);
		assert.equal(readFileSync(appendFile(workspace), "utf8"), appendBefore);
		assert.equal(existsSync(workspace.paths.backupDir), false);
	} finally {
		cleanup(workspace);
	}
});

test("an unusable settings file is a conflict and the apply refuses to write", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeFileSync(settingsFile(workspace), "{ not json\n");
		const plan = planProfileMigration(workspace.paths, options());
		assert.ok(plan.conflicts.includes("environment-settings-unusable"));
		assert.throws(() => applyProfileMigration(workspace.paths, options()), ProfileMigrationConflictError);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), "{ not json\n");
	} finally {
		cleanup(workspace);
	}
});

test("a damaged profile choice is a conflict and the apply refuses to write", () => {
	const workspace = makeWorkspace();
	try {
		writeFileSync(join(workspace.paths.stateDir, PROFILE_CHOICE_FILE_NAME), "{ not json\n");
		const plan = planProfileMigration(workspace.paths, options());
		assert.ok(plan.conflicts.includes("profile-choice-unreadable"));
		assert.throws(() => applyProfileMigration(workspace.paths, options()), ProfileMigrationConflictError);
	} finally {
		cleanup(workspace);
	}
});

test("a symlinked APPEND_SYSTEM.md is a conflict and is never rewritten", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const target = join(workspace.root, "elsewhere.md");
		writeFileSync(target, MANAGED);
		symlinkSync(target, appendFile(workspace));
		const plan = planProfileMigration(workspace.paths, options());
		assert.ok(plan.conflicts.includes("asset-unsafe"));
		assert.throws(() => applyProfileMigration(workspace.paths, options()), ProfileMigrationConflictError);
		assert.equal(readFileSync(target, "utf8"), MANAGED);
	} finally {
		cleanup(workspace);
	}
});

test("the human renderer explains the plan in the resolved locale", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeFileSync(appendFile(workspace), MANAGED);
		const plan = planProfileMigration(workspace.paths, options());
		const english = formatProfileMigrationPlan(plan);
		assert.match(english, /Jouzu profile migration plan/u);
		assert.match(english, /ja \(saved\)/u);
		assert.match(english, /response language ja/u);
		const japanese = formatProfileMigrationPlan(plan, { catalog: loadCatalog("ja") });
		assert.match(japanese, /プロファイル移行プラン/u);
	} finally {
		cleanup(workspace);
	}
});

test("a temporary plan renders the not-saved notice", () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const plan = planProfileMigration(workspace.paths, options({ explicitProfile: "ja" }));
		assert.match(formatProfileMigrationPlan(plan), /not changed/u);
	} finally {
		cleanup(workspace);
	}
});
