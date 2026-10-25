/**
 * The user-facing entry for the Japanese profile migration.
 *
 * This module is the command layer over `profile-migration.ts`. It reuses the
 * plan, the apply, the cancel, and the rollback from that module and adds only
 * what a terminal needs: a preview, a confirmation step, a persisted receipt,
 * and a rollback that can run in a later process.
 *
 * ## The operations
 *
 * `plan` renders the migration plan in the resolved locale and writes nothing.
 * `apply` renders the same plan, asks for confirmation, and only then calls the
 * backup-backed `applyProfileMigration`. `rollback` restores the files named by
 * the receipt the last apply persisted.
 *
 * ## Confirmation
 *
 * Nothing applies without a confirmation. An interactive run prompts with a
 * default of "no"; a non-interactive run needs the explicit `--yes` flag and
 * otherwise prints the confirmation notice and writes nothing. A temporary
 * profile choice (an explicit `--profile` or `JOUZU_PROFILE`) is never
 * auto-saved: the plan carries the not-saved notice, and the apply reports that
 * nothing was written.
 *
 * ## The receipt
 *
 * `applyProfileMigration` already returns the `transactionId`, the `backupDir`,
 * and the changed file names. A rollback in a later process cannot see that
 * in-memory value, so a changed apply persists those fields in
 * `<stateDir>/profile-migration-receipt.json` through the private atomic write
 * helper. The file is written only when something changed, so a second run
 * leaves the first receipt in place and can still be rolled back. A successful
 * rollback removes the record.
 */

import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ProfileId } from "./args.js";
import { CatalogMessageId, type CatalogRenderOptions, catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import type { JouzuPaths } from "./paths.js";
import { validatePrivateDirectory, writeFilePrivateAtomic } from "./private-fs.js";
import {
	applyProfileMigration,
	cancelProfileMigration,
	formatProfileMigrationPlan,
	ProfileMigrationConflictError,
	type ProfileMigrationOptions,
	type ProfileMigrationPlan,
	planProfileMigration,
	profileMigrationPersists,
	rollbackProfileMigration,
} from "./profile-migration.js";

/** The persisted receipt file name inside `stateDir`. */
export const PROFILE_MIGRATION_RECEIPT_FILE_NAME = "profile-migration-receipt.json";
/** The schema version this build writes and understands for the receipt. */
export const PROFILE_MIGRATION_RECEIPT_SCHEMA_VERSION = 1;

/** The largest receipt this build will read, so a damaged file cannot exhaust memory. */
const PROFILE_MIGRATION_RECEIPT_MAX_BYTES = 64 * 1024;

/** The catalog IDs this command renders. */
export const PROFILE_MIGRATION_COMMAND_MESSAGE_IDS = {
	applied: "jouzu.cli.profileMigrationCommand.applied",
	alreadyApplied: "jouzu.cli.profileMigrationCommand.alreadyApplied",
	willSave: "jouzu.cli.profileMigrationCommand.willSave",
	changedTargets: "jouzu.cli.profileMigrationCommand.changedTargets",
	temporaryNotSaved: "jouzu.cli.profileMigrationCommand.temporaryNotSaved",
	confirm: "jouzu.cli.profileMigrationCommand.confirm",
	confirmationRequired: "jouzu.cli.profileMigrationCommand.confirmationRequired",
	cancelled: "jouzu.cli.profileMigrationCommand.cancelled",
	conflict: "jouzu.cli.profileMigrationCommand.conflict",
	rolledBack: "jouzu.cli.profileMigrationCommand.rolledBack",
	rollbackUnchanged: "jouzu.cli.profileMigrationCommand.rollbackUnchanged",
	nothingToRollback: "jouzu.cli.profileMigrationCommand.nothingToRollback",
	receiptUnreadable: "jouzu.cli.profileMigrationCommand.receiptUnreadable",
} as const;

/** One command operation. */
export type ProfileMigrationOperation = "plan" | "apply" | "rollback";

/** The inputs to `runProfileMigrationCommand`. */
export interface ProfileMigrationCommandOptions {
	readonly operation: ProfileMigrationOperation;
	/** Emit the machine plan for `plan` instead of the human report. */
	readonly json?: boolean;
	/** Confirm the apply without a prompt. It is the non-interactive confirmation. */
	readonly yes?: boolean;
	/** Whether the confirmation prompt may run. A non-interactive run needs `yes`. */
	readonly interactive?: boolean;
	/** The explicit `--profile` value. It is a temporary choice (`cli`). */
	readonly explicitProfile?: ProfileId;
	/** The environment `JOUZU_PROFILE` is read from; `process.env` when omitted. */
	readonly env?: NodeJS.ProcessEnv;
	/** The bundled managed asset text. The bundled `ja` asset when omitted. */
	readonly managedAppendSystem?: string;
	/** The resolved catalog the report renders from; English when omitted. */
	readonly catalog?: CatalogBundle;
	/** The display options (columns, color) the human report uses. */
	readonly render?: CatalogRenderOptions;
	/** The confirmation input; `process.stdin` when omitted. */
	readonly input?: NodeJS.ReadableStream;
	/** The report output; `process.stdout` when omitted. */
	readonly output?: NodeJS.WritableStream;
}

/** The receipt fields a rollback needs, as persisted. */
export interface StoredProfileMigrationReceipt {
	readonly transactionId: string;
	readonly backupDir?: string;
	readonly targets: readonly string[];
}

/** The outcome of reading the persisted receipt. */
export type StoredProfileMigrationReceiptState =
	| { readonly status: "absent" }
	| { readonly status: "ok"; readonly receipt: StoredProfileMigrationReceipt }
	| { readonly status: "invalid" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receiptPath(paths: JouzuPaths): string {
	return join(paths.stateDir, PROFILE_MIGRATION_RECEIPT_FILE_NAME);
}

/**
 * Read the persisted receipt.
 *
 * An absent file is `absent`; a file that cannot be trusted (a symlink, a
 * non-regular file, an oversized file, malformed content, or an unknown schema)
 * is `invalid`, so a rollback never acts on a damaged record.
 */
export function readStoredProfileMigrationReceipt(paths: JouzuPaths): StoredProfileMigrationReceiptState {
	try {
		validatePrivateDirectory(paths.stateDir);
	} catch {
		return { status: "invalid" };
	}
	const path = receiptPath(paths);
	if (!existsSync(path)) return { status: "absent" };
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(path);
	} catch {
		return { status: "invalid" };
	}
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > PROFILE_MIGRATION_RECEIPT_MAX_BYTES) {
		return { status: "invalid" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return { status: "invalid" };
	}
	if (!isPlainObject(parsed)) return { status: "invalid" };
	if (parsed.schemaVersion !== PROFILE_MIGRATION_RECEIPT_SCHEMA_VERSION) return { status: "invalid" };
	if (typeof parsed.transactionId !== "string" || parsed.transactionId.length === 0) return { status: "invalid" };
	if (!Array.isArray(parsed.targets) || !parsed.targets.every((target) => typeof target === "string")) {
		return { status: "invalid" };
	}
	if (parsed.backupDir !== undefined && typeof parsed.backupDir !== "string") return { status: "invalid" };
	return {
		status: "ok",
		receipt: {
			transactionId: parsed.transactionId,
			...(typeof parsed.backupDir === "string" ? { backupDir: parsed.backupDir } : {}),
			targets: parsed.targets as string[],
		},
	};
}

function writeStoredProfileMigrationReceipt(
	paths: JouzuPaths,
	receipt: StoredProfileMigrationReceipt,
	appliedAt: string,
): void {
	const payload = `${JSON.stringify(
		{
			schemaVersion: PROFILE_MIGRATION_RECEIPT_SCHEMA_VERSION,
			transactionId: receipt.transactionId,
			...(receipt.backupDir ? { backupDir: receipt.backupDir } : {}),
			targets: receipt.targets,
			appliedAt,
		},
		null,
		2,
	)}\n`;
	writeFilePrivateAtomic(receiptPath(paths), payload, paths.stateDir);
}

function clearStoredProfileMigrationReceipt(paths: JouzuPaths): void {
	rmSync(receiptPath(paths), { force: true });
}

function writeLine(output: NodeJS.WritableStream, text: string): void {
	output.write(`${text}\n`);
}

/** Ask the confirmation question. A closed stream, an error, or anything but yes is "no". */
async function confirmApply(
	input: NodeJS.ReadableStream,
	output: NodeJS.WritableStream,
	catalog: CatalogBundle,
): Promise<boolean> {
	const readline = createInterface({ input, output });
	try {
		const answer = await readline.question(`${catalogText(catalog, PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.confirm)} `);
		return /^(?:y|yes)$/iu.test(answer.trim());
	} catch {
		return false;
	} finally {
		readline.close();
	}
}

function runRollback(paths: JouzuPaths, catalog: CatalogBundle, output: NodeJS.WritableStream): number {
	const text = (id: string, args?: Readonly<Record<string, string>>): string => catalogText(catalog, id, args);
	const stored = readStoredProfileMigrationReceipt(paths);
	if (stored.status === "absent") {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.nothingToRollback));
		return 1;
	}
	if (stored.status === "invalid") {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.receiptUnreadable));
		return 1;
	}
	const result = rollbackProfileMigration(paths, stored.receipt);
	clearStoredProfileMigrationReceipt(paths);
	if (!result.restored) {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.rollbackUnchanged));
		return 0;
	}
	writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.rolledBack, { id: result.transactionId }));
	return 0;
}

async function runApply(
	paths: JouzuPaths,
	plan: ProfileMigrationPlan,
	migrationOptions: ProfileMigrationOptions,
	options: ProfileMigrationCommandOptions,
	catalog: CatalogBundle,
	render: CatalogRenderOptions,
	output: NodeJS.WritableStream,
): Promise<number> {
	const text = (id: string, args?: Readonly<Record<string, string>>): string => catalogText(catalog, id, args);
	// Show the plan first, so the confirmation answers a visible proposal. The
	// plan carries the effective profile, the mapping, the asset diff, and the
	// temporary not-saved notice. A persisting plan gets the matching will-save
	// notice, so both outcomes state whether the plan would be saved.
	writeLine(output, formatProfileMigrationPlan(plan, render));
	if (plan.conflicts.length > 0) {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.conflict));
		return 3;
	}
	if (profileMigrationPersists(plan)) {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.willSave));
	}
	let confirmed: boolean;
	if (options.yes === true) {
		confirmed = true;
	} else if (options.interactive === true) {
		confirmed = await confirmApply(options.input ?? process.stdin, output, catalog);
	} else {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.confirmationRequired));
		return 0;
	}
	if (!confirmed) {
		cancelProfileMigration(paths, migrationOptions);
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.cancelled));
		return 0;
	}
	let receipt: ReturnType<typeof applyProfileMigration>;
	try {
		receipt = applyProfileMigration(paths, migrationOptions);
	} catch (error) {
		if (error instanceof ProfileMigrationConflictError) {
			writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.conflict));
			return 3;
		}
		throw error;
	}
	if (!receipt.persisted) {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.temporaryNotSaved));
		return 0;
	}
	if (!receipt.changed) {
		writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.alreadyApplied));
		return 0;
	}
	writeStoredProfileMigrationReceipt(
		paths,
		{
			transactionId: receipt.transactionId,
			...(receipt.backupDir ? { backupDir: receipt.backupDir } : {}),
			targets: receipt.targets,
		},
		new Date().toISOString(),
	);
	writeLine(output, text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.applied, { id: receipt.transactionId }));
	if (receipt.backupDir) {
		writeLine(output, catalogText(catalog, CatalogMessageId.backupPath, { path: receipt.backupDir }));
	}
	writeLine(
		output,
		text(PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.changedTargets, { targets: receipt.targets.join(", ") }),
	);
	return 0;
}

/**
 * Run one profile-migration command and return its exit code.
 *
 * `plan` is read-only. `apply` shows the plan, confirms, and applies through the
 * backup-backed `applyProfileMigration`. `rollback` restores the recorded
 * migration. A plan conflict is exit code 3; a rollback with no record or an
 * unreadable record is exit code 1; everything else is 0.
 */
export async function runProfileMigrationCommand(
	paths: JouzuPaths,
	options: ProfileMigrationCommandOptions,
): Promise<number> {
	const catalog = options.catalog ?? defaultCatalog();
	const output = options.output ?? process.stdout;
	const render: CatalogRenderOptions = { ...(options.render ?? {}), catalog };
	const migrationOptions: ProfileMigrationOptions = {
		...(options.explicitProfile ? { explicitProfile: options.explicitProfile } : {}),
		...(options.env ? { env: options.env } : {}),
		...(options.managedAppendSystem !== undefined ? { managedAppendSystem: options.managedAppendSystem } : {}),
		catalog,
	};
	const plan = planProfileMigration(paths, migrationOptions);
	if (options.operation === "plan") {
		if (options.json === true) writeLine(output, JSON.stringify(plan, null, 2));
		else {
			writeLine(output, formatProfileMigrationPlan(plan, render));
			if (plan.conflicts.length === 0 && profileMigrationPersists(plan)) {
				writeLine(output, catalogText(catalog, PROFILE_MIGRATION_COMMAND_MESSAGE_IDS.willSave));
			}
		}
		return plan.conflicts.length > 0 ? 3 : 0;
	}
	if (options.operation === "rollback") return runRollback(paths, catalog, output);
	return runApply(paths, plan, migrationOptions, options, catalog, render, output);
}
