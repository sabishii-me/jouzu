import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CatalogMessageId, catalogText, defaultCatalog } from "../dist/cli-messages.js";
import { UNAVAILABLE_INPUT_REASON } from "../dist/flow-control/submission-view.js";
import { UserInputAdapters } from "../dist/flow-control/user-input-adapters.js";
import {
	checkUserInputAdapterGrant,
	USER_INPUT_ADAPTERS_MAX_BYTES,
	userInputAdapterGrantsPath,
} from "../dist/flow-control/user-input-grants.js";
import { projectUserInputReceipt } from "../dist/flow-control/user-input-receipts.js";
import { loadCatalog } from "../dist/locale-catalog.js";

/**
 * The external user-input receipt and grants reasons resolve from the session catalog
 * bundle. These tests pin three things about that migration:
 *
 * 1. the English source text is byte-identical to the sentences the module used before
 *    it read a catalog, for a caller that supplies no bundle;
 * 2. a supplied bundle reaches every display path, including the shared callback-ended
 *    sentence, while the machine codes and the receipt schema stay unchanged;
 * 3. the runtime adapter resolves the bundle lazily at each projection, never while the
 *    registry is constructed.
 *
 * The supplied bundle is a controlled test double. It proves which bundle a path read,
 * and it makes no claim about the quality of any translation: the non-English catalogs
 * carry the English source text as documented fallback text.
 */

const MAX_BYTES = String(USER_INPUT_ADAPTERS_MAX_BYTES);

/** The English sentence each migrated ID must keep, and the arguments it takes. */
const ENGLISH = {
	[CatalogMessageId.userInputReceiptAdmissionHold]: "Input is waiting for admission.",
	[CatalogMessageId.userInputReceiptHandledWithoutInput]:
		"The input handler completed without passing this input to the model.",
	[CatalogMessageId.userInputReceiptSubmissionCancelled]: "The retained input was cancelled before delivery.",
	[CatalogMessageId.userInputReceiptQueueCancelled]: "The queued input was removed before it ran.",
	[CatalogMessageId.userInputReceiptContextCancelled]: "The deferred context was removed before it ran.",
	[CatalogMessageId.userInputReceiptDispatchFailed]:
		"Native dispatch failed before it produced input, so delivery is unconfirmed.",
	[CatalogMessageId.userInputReceiptDispatchUnconfirmed]:
		"Input was dispatched without a receipt that confirms or rules out delivery.",
	[CatalogMessageId.userInputReceiptQueueEvidenceMissing]:
		"The queued input is not in the live host queue, so delivery is unconfirmed.",
	[CatalogMessageId.userInputReceiptCancellationUnconfirmed]:
		"A cancellation was requested but the native removal is not confirmed.",
	[CatalogMessageId.userInputReceiptFlowSuspended]: "Flow control was suspended before this input was delivered.",
	[CatalogMessageId.userInputReceiptUnauthorized]:
		"The adapter's authorization was revoked before this input was delivered.",
	[CatalogMessageId.userInputGrantsAgentDirectoryNotDirectory]:
		"the agent configuration directory must be a real directory",
	[CatalogMessageId.userInputGrantsAgentDirectoryUninspectable]:
		"the agent configuration directory could not be inspected",
	[CatalogMessageId.userInputGrantsUninspectable]: "user-input adapter grants could not be inspected",
	[CatalogMessageId.userInputGrantsNotRegularFile]: "user-input adapter grants must be a real regular file",
	[CatalogMessageId.userInputGrantsTooLarge]: `user-input adapter grants must be no larger than ${MAX_BYTES} bytes`,
	[CatalogMessageId.userInputGrantsNotUtf8]: "user-input adapter grants must be readable UTF-8",
};

/** The arguments each ID needs, so the English comparison formats the same message the runtime does. */
const ARGS = {
	[CatalogMessageId.userInputGrantsTooLarge]: { bytes: MAX_BYTES },
};

/**
 * A controlled bundle. Every resolution carries the marker and the arguments it received,
 * so a test can see which bundle a display path read and which arguments reached it.
 */
function controlledBundle(marker) {
	const text = (id, args) => `${marker}:${id}${args === undefined ? "" : `:${JSON.stringify(args)}`}`;
	return {
		locale: "en",
		version: "2",
		digest: marker,
		messages: {},
		format: (id, args) => text(id, args),
		render: (id, args) => [text(id, args)],
	};
}

const controlled = controlledBundle("controlled");

const provenance = { adapterId: "test-input", messageId: "message-1", version: 1 };
const target = "target-branch-1";
const journal = { generation: 3, revision: 11 };
const submission = {
	version: 1,
	id: "submission-1",
	api: "prompt",
	origin: { kind: "extension", id: "test-input" },
	scope: { sessionId: "parent", attachmentId: "attachment-1", leafId: null },
	args: ["external message at /private/adapter.ts"],
};
const hold = { phase: "submission", reason: "Secret message at /private/adapter.ts" };

const retained = (overrides = {}) => ({
	id: "submission-1",
	revision: 1,
	status: "retained",
	acceptedAt: 1,
	submission,
	...overrides,
});
const dispatched = (dispatch, overrides = {}) =>
	retained({ dispatch: { operationId: "operation-1", ownerId: "owner-1", ...dispatch }, ...overrides });
const receipt = (record, catalog, extra = {}) =>
	projectUserInputReceipt({ record, provenance, target, journal, ...extra }, catalog);
const queueInput = (id, revision = 1) => ({ kind: "steer", args: ["queued work"], queue: { id, revision } });

/** One record per reachable receipt reason, in the order the projection checks them. */
const RECEIPTS = [
	["admission-hold", CatalogMessageId.userInputReceiptAdmissionHold, retained({ holds: [hold] })],
	[
		"handled-without-input",
		CatalogMessageId.userInputReceiptHandledWithoutInput,
		dispatched({ phase: "returned", noInput: true }),
	],
	["submission-cancelled", CatalogMessageId.userInputReceiptSubmissionCancelled, retained({ status: "cancelled" })],
	[
		"flow-suspended",
		CatalogMessageId.userInputReceiptFlowSuspended,
		retained({ status: "cancelled", cancellationReason: "flow-suspended" }),
	],
	[
		"unauthorized",
		CatalogMessageId.userInputReceiptUnauthorized,
		retained({ status: "cancelled", cancellationReason: "unauthorized" }),
	],
	[
		"queue-cancelled",
		CatalogMessageId.userInputReceiptQueueCancelled,
		dispatched({
			phase: "returned",
			inputs: [queueInput("queue-1")],
			queueClaims: [{ id: "queue-1", revision: 1, consumed: false }],
			queueCancellations: [{ id: "queue-1", revision: 1 }],
		}),
	],
	[
		"context-cancelled",
		CatalogMessageId.userInputReceiptContextCancelled,
		dispatched({
			phase: "returned",
			inputs: [{ kind: "context", args: [{ role: "custom", customType: "note", display: false }] }],
			contextCancellations: [{ inputIndex: 0, removed: true }],
		}),
	],
	["dispatch-failed", CatalogMessageId.userInputReceiptDispatchFailed, dispatched({ phase: "failed" })],
	["dispatch-unconfirmed", CatalogMessageId.userInputReceiptDispatchUnconfirmed, dispatched({ phase: "started" })],
	[
		"queue-evidence-missing",
		CatalogMessageId.userInputReceiptQueueEvidenceMissing,
		dispatched({ phase: "returned", inputs: [queueInput("queue-1")] }),
	],
	[
		"cancellation-unconfirmed",
		CatalogMessageId.userInputReceiptCancellationUnconfirmed,
		dispatched({
			phase: "returned",
			inputs: [queueInput("queue-1")],
			queueCancellations: [{ id: "queue-1", revision: 1 }],
		}),
	],
];

test("every migrated reason keeps its English bytes in the source and default catalogs", () => {
	const en = loadCatalog("en");
	for (const [id, expected] of Object.entries(ENGLISH)) {
		assert.equal(catalogText(en, id, ARGS[id]), expected, id);
		assert.equal(catalogText(defaultCatalog(), id, ARGS[id]), expected, id);
	}
});

test("a receipt without a bundle keeps its English sentence, code, and schema", () => {
	for (const [code, id, record] of RECEIPTS) {
		const projected = receipt(record);
		assert.deepEqual(projected.reason, { code, text: ENGLISH[id] }, code);
		assert.deepEqual(Object.keys(projected), [
			"version",
			"adapterId",
			"messageId",
			"target",
			"generation",
			"revision",
			"state",
			"reason",
		]);
		// Ordering stays the committed journal position, never the record's own revision.
		assert.equal(projected.generation, journal.generation, code);
		assert.equal(projected.revision, journal.revision, code);
		// A display sentence never repeats message text, a path, or a stored hold reason.
		assert.equal(projected.reason.text.includes("external message"), false, code);
		assert.equal(projected.reason.text.includes("/private/adapter.ts"), false, code);
	}
});

test("a supplied bundle supplies every receipt sentence and changes no code", () => {
	for (const [code, id, record] of RECEIPTS) {
		const projected = receipt(record, controlled);
		assert.deepEqual(projected.reason, { code, text: `controlled:${id}` }, code);
	}
});

test("callback-ended reports the shared unavailable sentence from the same bundle", () => {
	const ended = retained({ unavailable: "callback-ended" });
	const english = receipt(ended);
	assert.equal(english.state, "unknown");
	assert.deepEqual(english.reason, { code: "callback-ended", text: UNAVAILABLE_INPUT_REASON });
	assert.deepEqual(receipt(ended, controlled).reason, {
		code: "callback-ended",
		text: `controlled:${CatalogMessageId.flowSubmissionUnavailable}`,
	});
});

function grantsFixture(t) {
	const root = mkdtempSync(join(tmpdir(), "user-input-catalog-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	const extension = join(root, "extension.ts");
	writeFileSync(extension, "export default () => {};\n");
	return {
		root,
		agentDir,
		extension,
		path: userInputAdapterGrantsPath(agentDir),
		check: (overrides = {}) =>
			checkUserInputAdapterGrant({ agentDir, loaderExtensionPath: extension, adapterId: "test-input", ...overrides }),
	};
}

test("a grants denial without a bundle keeps its English reason and code", async (t) => {
	const setup = grantsFixture(t);
	const cases = [
		[
			"agent directory is a file",
			CatalogMessageId.userInputGrantsAgentDirectoryNotDirectory,
			() => setup.check({ agentDir: setup.extension }),
		],
		[
			"grants file is a symlink",
			CatalogMessageId.userInputGrantsNotRegularFile,
			() => {
				writeFileSync(join(setup.root, "real.json"), JSON.stringify({ schemaVersion: 1, grants: [] }));
				symlinkSync(join(setup.root, "real.json"), setup.path);
				return setup.check();
			},
		],
		[
			"grants file is too large",
			CatalogMessageId.userInputGrantsTooLarge,
			() => {
				rmSync(setup.path, { force: true });
				writeFileSync(setup.path, " ".repeat(USER_INPUT_ADAPTERS_MAX_BYTES + 1));
				return setup.check();
			},
		],
		[
			"grants file is not UTF-8",
			CatalogMessageId.userInputGrantsNotUtf8,
			() => {
				rmSync(setup.path, { force: true });
				writeFileSync(setup.path, Buffer.from([0xc3, 0x28, 0x0a]));
				return setup.check();
			},
		],
	];
	for (const [name, id, run] of cases) {
		const decision = await run();
		assert.equal(decision.authorized, false, name);
		assert.equal(decision.code, "invalid-config", name);
		assert.equal(decision.reason, ENGLISH[id], name);
	}
});

test("a supplied bundle supplies the grants reason and its argument", async (t) => {
	const setup = grantsFixture(t);
	const directory = await setup.check({ agentDir: setup.extension, catalog: controlled });
	assert.deepEqual(directory, {
		authorized: false,
		code: "invalid-config",
		reason: `controlled:${CatalogMessageId.userInputGrantsAgentDirectoryNotDirectory}`,
	});
	writeFileSync(setup.path, " ".repeat(USER_INPUT_ADAPTERS_MAX_BYTES + 1));
	const tooLarge = await setup.check({ catalog: controlled });
	assert.equal(tooLarge.code, "invalid-config");
	assert.equal(
		tooLarge.reason,
		`controlled:${CatalogMessageId.userInputGrantsTooLarge}:${JSON.stringify({ bytes: MAX_BYTES })}`,
	);
});

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("the runtime registry resolves the bundle lazily, at each receipt projection", async (t) => {
	const setup = grantsFixture(t);
	const extensionPath = realpathSync(setup.extension);
	writeFileSync(setup.path, JSON.stringify({ schemaVersion: 1, grants: [{ extensionPath, adapterId: "test-input" }] }));
	const scope = { sessionId: "session-1", branchId: "branch-1" };
	const epoch = "epoch-1";
	const target = hash([scope.sessionId, scope.branchId, epoch]);
	const messageId = "message-1";
	const id = hash([target, extensionPath, "test-input", messageId]);
	const record = {
		...retained({ holds: [hold] }),
		id,
		submission: {
			...submission,
			id,
			origin: { kind: "extension", id: extensionPath },
			externalUser: { version: 1, adapterId: "test-input", messageId },
		},
	};
	const branch = {
		scope,
		attachment: {
			attachmentId: "attachment-1",
			submissions: {
				externalTargetEpoch: async () => epoch,
				snapshotVersioned: async () => ({ records: [record], journal }),
			},
		},
	};
	let resolved = 0;
	const adapters = new UserInputAdapters({
		agentDir: setup.agentDir,
		branch: () => branch,
		enabled: () => true,
		liveQueue: () => new Map(),
		catalog: () => {
			resolved++;
			return controlled;
		},
		pending: () => false,
		retain: async () => {},
		onError: (error) => assert.fail(`unexpected runtime error: ${error}`),
	});
	t.after(() => adapters.close());
	// Construction stores the callback; it must not resolve a catalog.
	assert.equal(resolved, 0);
	const adapter = await adapters.register(
		{ extensionId: extensionPath, scope: () => ({ sessionId: scope.sessionId, attachmentId: "attachment-1" }) },
		{ id: "test-input", label: "Test Input" },
	);
	const projected = await adapter.lookup({ target, messageId });
	assert.deepEqual(projected.reason, {
		code: "admission-hold",
		text: `controlled:${CatalogMessageId.userInputReceiptAdmissionHold}`,
	});
	assert.ok(resolved > 0, "the projection resolved the session bundle");
});
