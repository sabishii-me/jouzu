/**
 * The user-facing `profile-migration` entry.
 *
 * These tests drive the compiled `dist/profile-migration-command.js` and the
 * compiled CLI. They pin the issue #77 acceptance items: the plan shows the
 * effective profile, the mapping, the asset diff, and the not-saved notice for
 * a temporary choice; confirming applies through the module and reports the
 * receipt; cancelling writes nothing; rolling back restores the previous
 * settings and the removed asset; a second run changes nothing; and the
 * response behavior is unchanged until the migration is accepted.
 *
 * `npm run build` must run first: the tests import `dist`.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJouzuArgs, UsageError } from "../dist/args.js";
import { loadCatalog } from "../dist/locale-catalog.js";
import { PROFILE_CHOICE_FILE_NAME, PROFILE_MIGRATION_ASSET_TARGET } from "../dist/profile-migration.js";
import {
	PROFILE_MIGRATION_RECEIPT_FILE_NAME,
	readStoredProfileMigrationReceipt,
	runProfileMigrationCommand,
} from "../dist/profile-migration-command.js";
import { LOCALIZATION_FILE_NAME } from "../dist/ui-locale.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = join(packageRoot, "dist", "cli.js");

const MANAGED = "# Jouzu Japanese-First Policy\n\n- Reply in Japanese.\n- Keep protected values exact.\n";

function makeWorkspace() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-profile-migration-command-"));
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

function writeSettings(workspace, localization) {
	writeFileSync(
		join(workspace.paths.configDir, LOCALIZATION_FILE_NAME),
		`${JSON.stringify({ schemaVersion: 2, localization }, null, 2)}\n`,
	);
}

function settingsFile(workspace) {
	return join(workspace.paths.configDir, LOCALIZATION_FILE_NAME);
}

function appendFile(workspace) {
	return join(workspace.paths.agentDir, PROFILE_MIGRATION_ASSET_TARGET);
}

function receiptFile(workspace) {
	return join(workspace.paths.stateDir, PROFILE_MIGRATION_RECEIPT_FILE_NAME);
}

function managedOptions(extra = {}) {
	return { managedAppendSystem: MANAGED, env: {}, ...extra };
}

/** A writable that collects the rendered report. */
function collector() {
	let text = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			text += chunk.toString();
			callback();
		},
	});
	return { stream, text: () => text };
}

/** A byte input stream with the answer already buffered. */
function input(text) {
	const stream = new PassThrough();
	stream.end(text);
	return stream;
}

/** Collapse the renderer's alignment and wrapping so message assertions stay readable. */
function flat(text) {
	return text.replace(/\s+/gu, " ");
}

async function runCommand(paths, options) {
	const out = collector();
	const exitCode = await runProfileMigrationCommand(paths, {
		catalog: loadCatalog("en"),
		output: out.stream,
		...options,
	});
	return { exitCode, output: out.text() };
}

function scrubbedEnv() {
	const scrubbed = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key === "AI_AGENT" || /^JOUZU_/.test(key) || /^PI_CODING_AGENT(?:_|$)/.test(key)) continue;
		scrubbed[key] = value;
	}
	return scrubbed;
}

function runCli(args, options = {}) {
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		timeout: 30_000,
		env: { ...scrubbedEnv(), PI_OFFLINE: "1", ...options.env },
	});
}

test("the parser accepts plan, apply, and rollback and rejects unknown operations and options", () => {
	assert.deepEqual(parseJouzuArgs(["profile-migration"]), {
		kind: "profile-migration",
		options: {},
		operation: "plan",
		json: false,
		yes: false,
	});
	assert.deepEqual(parseJouzuArgs(["--jouzu-home=/tmp/上手", "profile-migration", "plan", "--json"]), {
		kind: "profile-migration",
		options: { home: "/tmp/上手" },
		operation: "plan",
		json: true,
		yes: false,
	});
	assert.deepEqual(parseJouzuArgs(["--jouzu-profile", "ja", "profile-migration", "apply", "--yes"]), {
		kind: "profile-migration",
		options: { profile: "ja" },
		operation: "apply",
		json: false,
		yes: true,
	});
	assert.deepEqual(parseJouzuArgs(["profile-migration", "rollback"]), {
		kind: "profile-migration",
		options: {},
		operation: "rollback",
		json: false,
		yes: false,
	});
	assert.throws(() => parseJouzuArgs(["profile-migration", "other"]), UsageError);
	assert.throws(() => parseJouzuArgs(["profile-migration", "apply", "--json"]), UsageError);
	assert.throws(() => parseJouzuArgs(["profile-migration", "plan", "--yes"]), UsageError);
	assert.throws(() => parseJouzuArgs(["profile-migration", "plan", "--json", "--json"]), UsageError);
});

test("the plan shows the effective profile, the mapping, and the asset diff", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeFileSync(appendFile(workspace), `${MANAGED}- My own instruction.\n`);
		const { exitCode, output } = await runCommand(workspace.paths, { operation: "plan", ...managedOptions() });
		assert.equal(exitCode, 0);
		const text = flat(output);
		assert.match(text, /Jouzu profile migration plan/u);
		assert.match(text, /From ja \(saved\)/u);
		assert.match(text, /To response language ja; display language auto/u);
		assert.match(text, /APPEND_SYSTEM\.md/u);
		assert.match(text, /keep the edited file and review the duplicated lines/u);
		assert.match(text, /remove - Reply in Japanese\./u);
		assert.match(text, /keep - My own instruction\./u);
		assert.match(text, /Confirming this plan saves it to the user-wide settings\./u);
	} finally {
		cleanup(workspace);
	}
});

test("the plan shows the not-saved notice for a temporary choice", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const { output } = await runCommand(workspace.paths, {
			operation: "plan",
			...managedOptions({ explicitProfile: "ja" }),
		});
		const text = flat(output);
		assert.match(text, /From ja \(cli\)/u);
		assert.match(text, /The profile choice is temporary; the user-wide settings are not changed\./u);
	} finally {
		cleanup(workspace);
	}
});

test("the plan is available as JSON without the human rendering path", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "plan",
			json: true,
			...managedOptions(),
		});
		assert.equal(exitCode, 0);
		const plan = JSON.parse(output);
		assert.deepEqual(plan.from, { profile: "ja", source: "saved" });
		assert.deepEqual(plan.to, { responseLanguage: "ja", uiLocale: "auto" });
		assert.deepEqual(plan.conflicts, []);
	} finally {
		cleanup(workspace);
	}
});

test("confirming applies the plan through the module and reports the receipt", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "apply",
			interactive: true,
			input: input("y\n"),
			...managedOptions(),
		});
		assert.equal(exitCode, 0);
		const text = flat(output);
		assert.match(text, /Apply this migration\? \[y\/N\]/u);
		assert.match(text, /Applied profile migration transaction: [0-9a-f-]{36}/u);
		assert.match(text, /Backup: /u);
		assert.match(text, /Changed files: localization\.json, APPEND_SYSTEM\.md/u);

		const saved = JSON.parse(readFileSync(settingsFile(workspace), "utf8"));
		assert.equal(saved.localization.responseLanguage, "ja");
		assert.equal(saved.localization.uiLocale, "en");
		assert.equal(existsSync(appendFile(workspace)), false, "the managed duplicate is removed");

		const stored = readStoredProfileMigrationReceipt(workspace.paths);
		assert.equal(stored.status, "ok");
		assert.deepEqual([...stored.receipt.targets].sort(), ["APPEND_SYSTEM.md", LOCALIZATION_FILE_NAME].sort());
		assert.ok(stored.receipt.backupDir?.includes("profile-migration"));
	} finally {
		cleanup(workspace);
	}
});

test("an apply with --yes is the non-interactive confirmation", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "apply",
			yes: true,
			...managedOptions(),
		});
		assert.equal(exitCode, 0);
		assert.match(output, /Applied profile migration transaction:/u);
		assert.equal(JSON.parse(readFileSync(settingsFile(workspace), "utf8")).localization.responseLanguage, "ja");
	} finally {
		cleanup(workspace);
	}
});

test("cancelling writes nothing", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		const appendBefore = readFileSync(appendFile(workspace), "utf8");
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "apply",
			interactive: true,
			input: input("n\n"),
			...managedOptions(),
		});
		assert.equal(exitCode, 0);
		assert.match(output, /Cancelled; nothing was written\./u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore);
		assert.equal(readFileSync(appendFile(workspace), "utf8"), appendBefore);
		assert.equal(existsSync(workspace.paths.backupDir), false);
		assert.equal(existsSync(receiptFile(workspace)), false);
	} finally {
		cleanup(workspace);
	}
});

test("a non-interactive apply without --yes writes nothing", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "apply",
			interactive: false,
			...managedOptions(),
		});
		assert.equal(exitCode, 0);
		assert.match(output, /This run is not interactive, so nothing was written\./u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore);
		assert.equal(existsSync(receiptFile(workspace)), false);
	} finally {
		cleanup(workspace);
	}
});

test("a temporary choice is never auto-saved", async () => {
	const workspace = makeWorkspace();
	try {
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		const { exitCode, output } = await runCommand(workspace.paths, {
			operation: "apply",
			yes: true,
			...managedOptions({ explicitProfile: "ja" }),
		});
		assert.equal(exitCode, 0);
		assert.match(flat(output), /The profile choice is temporary; the user-wide settings were not written\./u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore);
		assert.equal(existsSync(receiptFile(workspace)), false);
		assert.equal(existsSync(workspace.paths.backupDir), false);
	} finally {
		cleanup(workspace);
	}
});

test("rolling back restores the previous settings and the removed asset", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		await runCommand(workspace.paths, { operation: "apply", yes: true, ...managedOptions() });
		assert.equal(existsSync(appendFile(workspace)), false);

		const { exitCode, output } = await runCommand(workspace.paths, { operation: "rollback", ...managedOptions() });
		assert.equal(exitCode, 0);
		assert.match(output, /Rolled back profile migration transaction: [0-9a-f-]{36}/u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore, "the previous settings are restored");
		assert.equal(readFileSync(appendFile(workspace), "utf8"), MANAGED, "the removed asset is restored");
		assert.equal(existsSync(receiptFile(workspace)), false, "the record is cleared after a rollback");
	} finally {
		cleanup(workspace);
	}
});

test("a rollback with no record reports nothing to roll back", async () => {
	const workspace = makeWorkspace();
	try {
		const { exitCode, output } = await runCommand(workspace.paths, { operation: "rollback", ...managedOptions() });
		assert.equal(exitCode, 1);
		assert.match(output, /There is no recorded profile migration to roll back\./u);
	} finally {
		cleanup(workspace);
	}
});

test("a second apply changes nothing and keeps the first receipt", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const first = await runCommand(workspace.paths, { operation: "apply", yes: true, ...managedOptions() });
		assert.match(first.output, /Applied profile migration transaction:/u);
		const settingsAfterFirst = readFileSync(settingsFile(workspace), "utf8");
		const receiptAfterFirst = readFileSync(receiptFile(workspace), "utf8");

		const second = await runCommand(workspace.paths, { operation: "apply", yes: true, ...managedOptions() });
		assert.equal(second.exitCode, 0);
		assert.match(second.output, /No changes were needed; the migration is already applied\./u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsAfterFirst);
		assert.equal(readFileSync(receiptFile(workspace), "utf8"), receiptAfterFirst);
		assert.equal(existsSync(appendFile(workspace)), false);
	} finally {
		cleanup(workspace);
	}
});

test("the response behavior is unchanged until the migration is accepted", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeSettings(workspace, { uiLocale: "en", responseLanguage: "en" });
		writeFileSync(appendFile(workspace), MANAGED);
		const settingsBefore = readFileSync(settingsFile(workspace), "utf8");
		const appendBefore = readFileSync(appendFile(workspace), "utf8");

		// A preview and a cancel are read-only: the settings, the prompt asset, and
		// the state directory are unchanged.
		await runCommand(workspace.paths, { operation: "plan", ...managedOptions() });
		await runCommand(workspace.paths, { operation: "plan", json: true, ...managedOptions() });
		await runCommand(workspace.paths, {
			operation: "apply",
			interactive: true,
			input: input("n\n"),
			...managedOptions(),
		});
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), settingsBefore);
		assert.equal(readFileSync(appendFile(workspace), "utf8"), appendBefore);
		assert.equal(existsSync(workspace.paths.backupDir), false);
		assert.equal(existsSync(receiptFile(workspace)), false);
	} finally {
		cleanup(workspace);
	}
});

test("a conflict stops the plan and the apply with the reserved status", async () => {
	const workspace = makeWorkspace();
	try {
		writeChoice(workspace, "ja");
		writeFileSync(settingsFile(workspace), "{ not json\n");
		const plan = await runCommand(workspace.paths, { operation: "plan", ...managedOptions() });
		assert.equal(plan.exitCode, 3);
		assert.match(flat(plan.output), /environment-settings-unusable/u);
		const apply = await runCommand(workspace.paths, { operation: "apply", yes: true, ...managedOptions() });
		assert.equal(apply.exitCode, 3);
		assert.match(apply.output, /The plan contains conflicts, so nothing was written\./u);
		assert.equal(readFileSync(settingsFile(workspace), "utf8"), "{ not json\n");
	} finally {
		cleanup(workspace);
	}
});

test("the CLI entry plans without mutation, applies with --yes, and rolls back", () => {
	const temp = mkdtempSync(join(tmpdir(), "jouzu-profile-migration-cli-"));
	const home = join(temp, "home");
	try {
		const planned = runCli(["--jouzu-home", home, "profile-migration", "plan", "--json"]);
		assert.equal(planned.status, 0, planned.stderr);
		assert.deepEqual(JSON.parse(planned.stdout).from, { profile: "core", source: "default" });
		assert.equal(existsSync(home), false, "the plan mutated the Jouzu home");

		mkdirSync(join(home, "state"), { recursive: true });
		mkdirSync(join(home, "agent"), { recursive: true });
		writeChoice({ paths: { stateDir: join(home, "state") } }, "ja");
		writeSettings({ paths: { configDir: home } }, { uiLocale: "en", responseLanguage: "en" });

		const applied = runCli(["--jouzu-home", home, "profile-migration", "apply", "--yes"]);
		assert.equal(applied.status, 0, applied.stderr);
		assert.match(applied.stdout, /Applied profile migration transaction:/u);
		assert.equal(
			JSON.parse(readFileSync(join(home, LOCALIZATION_FILE_NAME), "utf8")).localization.responseLanguage,
			"ja",
		);
		assert.equal(existsSync(join(home, "state", PROFILE_MIGRATION_RECEIPT_FILE_NAME)), true);

		const second = runCli(["--jouzu-home", home, "profile-migration", "apply", "--yes"]);
		assert.equal(second.status, 0, second.stderr);
		assert.match(second.stdout, /No changes were needed/u);

		const rolledBack = runCli(["--jouzu-home", home, "profile-migration", "rollback"]);
		assert.equal(rolledBack.status, 0, rolledBack.stderr);
		assert.match(rolledBack.stdout, /Rolled back profile migration transaction:/u);
		assert.equal(
			JSON.parse(readFileSync(join(home, LOCALIZATION_FILE_NAME), "utf8")).localization.responseLanguage,
			"en",
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

test("the CLI entry rejects an unknown operation and option with the usage status", () => {
	const temp = mkdtempSync(join(tmpdir(), "jouzu-profile-migration-usage-"));
	const home = join(temp, "home");
	try {
		const operation = runCli(["--jouzu-home", home, "profile-migration", "other"]);
		assert.equal(operation.status, 2);
		assert.match(operation.stderr, /profile-migration requires "plan", "apply", or "rollback"/u);
		const option = runCli(["--jouzu-home", home, "profile-migration", "plan", "--yes"]);
		assert.equal(option.status, 2);
		assert.match(option.stderr, /unknown profile-migration plan option: --yes/u);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
