import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context, MemorySessionRepo, setValue, value } from "@earendil-works/pi-agent-core";
import { checkpointFlowJournal } from "../dist/flow-control/journal-checkpoint.js";
import { openLocalFlowSession } from "../dist/flow-control/local-storage.js";
import { checkFlowNoReply, flowNoReplyToken } from "../dist/flow-control/no-reply.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { createPiLedgerStore } from "../dist/flow-control/pi-ledger-store.js";
import { FlowReceiptLedger } from "../dist/flow-control/receipt-ledger.js";
import {
	consolidateFlowRequests,
	flowMemberIncluded,
	hasFlowHandoff,
	hasFlowUserInput,
} from "../dist/flow-control/request-retention.js";

const scope = { sessionId: "retention", branchId: "main" };
const members = Array.from({ length: 15 }, (_, i) => ({
	id: `member-${i}`,
	revision: "1",
	kind: i ? "result" : "work",
	required: !i,
	contentHash: createHash("sha256").update(String(i)).digest("hex"),
}));
const included = members.map(({ id, revision, contentHash }) => ({
	id,
	revision,
	contentHash,
	disposition: "included",
}));
const omitted = members.map(({ id, revision }) => ({ id, revision, disposition: "omitted" }));
async function fixture(t) {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	t.after(() => repo.close(context));
	const store = createPiLedgerStore(session);
	return { session, store, ledger: await FlowReceiptLedger.attach(store, scope) };
}
async function start(ledger, id = "attempt") {
	await ledger.select(id, members);
	await ledger.queued(id, { id: "queue", revision: 1 });
	await ledger.claim(id, { id: "queue", revision: 1 });
}
async function request(ledger, id, inclusion, user = false) {
	assert.equal(await ledger.prepare("attempt", id, inclusion, user, members), true);
	await ledger.handoff("attempt", id);
	await ledger.requestOutcome("attempt", id, "success");
}

test("a long active attempt stays bounded across omitted compacted inputs without losing evidence", async (t) => {
	const { ledger, store, session } = await fixture(t);
	await start(ledger);
	await request(ledger, "first", included, true);
	for (let i = 0; i < 1200; i++) await request(ledger, `request-${i}`, omitted);
	const state = await ledger.snapshot();
	const attempt = state.attempts[0];
	assert.equal(attempt.requests.length, 4);
	assert.equal(attempt.requestSummary.count, 1197);
	assert.equal(hasFlowHandoff(attempt), true);
	assert.equal(hasFlowUserInput(attempt), true);
	assert.ok(members.every((member) => flowMemberIncluded(attempt, member)));
	assert.deepEqual(checkFlowNoReply(state, flowNoReplyToken(attempt.id)), {
		allowed: false,
		reason: "carries-user-input",
	});
	assert.ok(Buffer.byteLength(JSON.stringify(state)) < 20000);
	await assert.rejects(ledger.prepare("attempt", "first", omitted, false, members), { code: "identity" });
	assert.equal((await ledger.snapshot()).attempts[0].requests.at(-1).id, "request-1199");
	const archived = (await session.getValue(value("jouzu.flow.request-history", "first"), context))?.value;
	assert.equal(archived.request.outcome, "success");
	assert.equal(archived.attemptId, "attempt");
	assert.deepEqual(archived.request.inclusion, included);
	await ledger.settle("attempt", "success");
	const reopened = await FlowReceiptLedger.attach(store, scope);
	const reopenedAttempt = (await reopened.snapshot()).attempts[0];
	assert.ok(members.every((member) => flowMemberIncluded(reopenedAttempt, member)));
});

test("consolidation preserves inclusion predicates and unknown handoffs", () => {
	const requests = Array.from({ length: 30 }, (_, i) => ({
		id: `r-${i}`,
		handedOff: true,
		containsUserInput: i === 1,
		outcome: i === 2 ? undefined : i % 2 ? "failure" : "success",
		inclusion: included.map((item, index) =>
			index === i % 15 ? item : { id: item.id, revision: item.revision, disposition: "omitted" },
		),
	}));
	const attempt = { id: "a", members, requests };
	const before = members.map((member) => [
		flowMemberIncluded(attempt, member),
		flowMemberIncluded(attempt, member, false),
	]);
	consolidateFlowRequests(attempt);
	assert.deepEqual(
		members.map((member) => [flowMemberIncluded(attempt, member), flowMemberIncluded(attempt, member, false)]),
		before,
	);
	assert.ok(attempt.requests.some((request) => request.id === "r-2"));
	assert.equal(hasFlowUserInput(attempt), true);
	assert.equal(attempt.requests.length, 5);
});

test("attachment consolidates legacy receipts above the byte limit before enforcing capacity", async (t) => {
	const { session, store, ledger } = await fixture(t);
	await start(ledger);
	await request(ledger, "first", included);
	await ledger.settle("attempt", "success");
	const state = await ledger.snapshot();
	const attempt = state.attempts[0];
	attempt.requests = Array.from({ length: 1200 }, (_, i) => ({ ...attempt.requests[0], id: `legacy-${i}` }));
	assert.ok(Buffer.byteLength(JSON.stringify(attempt)) > 1024 * 1024);
	await session.mutate(
		(mutation, ctx) => mutation.commit([setValue(value("jouzu.flow.attempt", attempt.id), attempt)], ctx),
		context,
	);
	const reopened = await FlowReceiptLedger.attach(store, scope);
	const repaired = (await reopened.snapshot()).attempts[0];
	assert.equal(repaired.requests.length, 4);
	assert.equal(repaired.requestSummary.count, 1196);
	assert.equal(repaired.phase, "settled");
	assert.ok(members.every((member) => flowMemberIncluded(repaired, member)));
});

test("failed consolidation commit leaves original receipts and archive unchanged", async (t) => {
	const { session } = await fixture(t);
	let rejectCommit = false;
	const store = createPiLedgerStore({
		mutate: (update, ctx) =>
			session.mutate(
				(mutation, context) =>
					update(
						{
							getValue: mutation.getValue.bind(mutation),
							commit: (...args) => {
								if (rejectCommit) throw new Error("injected commit failure");
								return mutation.commit(...args);
							},
						},
						context,
					),
				ctx,
			),
	});
	const ledger = await FlowReceiptLedger.attach(store, scope);
	await start(ledger);
	for (let i = 0; i < 4; i++) await request(ledger, `atomic-${i}`, included);
	const before = await ledger.snapshot();
	rejectCommit = true;
	await assert.rejects(ledger.prepare("attempt", "atomic-4", included, false, members), /injected commit failure/);
	assert.deepEqual(await ledger.snapshot(), before);
	assert.equal(await session.getValue(value("jouzu.flow.request-history", "atomic-0"), context), undefined);
	rejectCommit = false;
	await request(ledger, "atomic-4", included);
	assert.equal((await ledger.snapshot()).attempts[0].requestSummary.count, 1);
	assert.ok(await session.getValue(value("jouzu.flow.request-history", "atomic-0"), context));
	await ledger.prepare("attempt", "atomic-5", included, false, members);
	await assert.rejects(ledger.handoff("attempt", "atomic-0"), { code: "identity" });
	await ledger.handoff("attempt", "atomic-5");
	await assert.rejects(ledger.requestOutcome("attempt", "atomic-0", "failure"), { code: "identity" });
	await ledger.requestOutcome("attempt", "atomic-5", "success");
	await assert.rejects(ledger.prepare("attempt", "atomic-0", included, false, members), { code: "identity" });
});

test("the production attachment forwards archival support through its ownership wrapper", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "flow-owned-request-history-"));
	let attachment;
	t.after(async () => {
		await attachment?.close();
		await rm(root, { recursive: true, force: true });
	});
	attachment = await PiFlowAttachment.open(root, scope);
	await start(attachment.ledger);
	for (let i = 0; i < 12; i++) await request(attachment.ledger, `owned-${i}`, included);
	assert.equal((await attachment.ledger.snapshot()).attempts[0].requests.length, 4);
	assert.equal((await attachment.ledger.snapshot()).attempts[0].requestSummary.count, 8);
	await attachment.ledger.settle("attempt", "success");
	await attachment.close();
	attachment = await PiFlowAttachment.open(root, scope);
	await start(attachment.ledger, "next");
	await assert.rejects(attachment.ledger.prepare("next", "owned-0", included, false, members), { code: "identity" });
});

test("a store without archival support retains request identities", async () => {
	let state;
	const store = {
		async read() {
			return structuredClone(state);
		},
		async transact(update) {
			const next = update(structuredClone(state));
			state = structuredClone(next.state);
			return next.result;
		},
	};
	const ledger = await FlowReceiptLedger.attach(store, scope);
	await start(ledger);
	for (let i = 0; i < 12; i++) await request(ledger, `plain-${i}`, included);
	assert.equal((await ledger.snapshot()).attempts[0].requests.length, 12);
	await assert.rejects(ledger.prepare("attempt", "plain-0", included, false, members), { code: "identity" });
});

for (const phase of ["prepared", "running", "handed-off"])
	test(`oversized active legacy ${phase} receipts reopen uncertain and fence old callbacks`, async (t) => {
		const { session, store, ledger } = await fixture(t);
		await start(ledger);
		await request(ledger, "first", included, true);
		const attempt = (await ledger.snapshot()).attempts[0];
		attempt.phase = phase;
		attempt.requests = Array.from({ length: 1200 }, (_, i) => ({ ...attempt.requests[0], id: `legacy-${i}` }));
		if (phase !== "running") {
			delete attempt.requests.at(-1).outcome;
			attempt.requests.at(-1).handedOff = phase === "handed-off";
		}
		await session.mutate(
			(mutation, ctx) => mutation.commit([setValue(value("jouzu.flow.attempt", attempt.id), attempt)], ctx),
			context,
		);
		const reopened = await FlowReceiptLedger.attach(store, scope);
		const state = await reopened.snapshot();
		assert.equal(state.attempts[0].phase, "uncertain");
		assert.equal(state.attempts[0].requests.length, 4);
		assert.ok(members.every((member) => flowMemberIncluded(state.attempts[0], member)));
		assert.equal(hasFlowUserInput(state.attempts[0]), true);
		await assert.rejects(ledger.requestOutcome("attempt", "legacy-1199", "success"), { code: "stale" });
	});

test("checkpoint and disk reopen preserve archived receipt evidence and replay protection", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "flow-request-history-"));
	let session;
	t.after(async () => {
		await session?.close(context);
		await rm(root, { recursive: true, force: true });
	});
	session = await openLocalFlowSession(root);
	let ledger = await FlowReceiptLedger.attach(createPiLedgerStore(session), scope);
	await start(ledger);
	for (let i = 0; i < 12; i++) await request(ledger, `disk-${i}`, included, i === 0);
	await ledger.settle("attempt", "success");
	await session.close(context);
	session = undefined;
	const files = await readdir(root, { recursive: true });
	const journal = files.find((path) => path.endsWith("_flow.jsonl"));
	assert.ok(journal);
	await checkpointFlowJournal(join(root, journal), 0);
	session = await openLocalFlowSession(root);
	ledger = await FlowReceiptLedger.attach(createPiLedgerStore(session), scope);
	const attempt = (await ledger.snapshot()).attempts[0];
	assert.equal(attempt.requestSummary.count, 8);
	assert.equal(hasFlowUserInput(attempt), true);
	assert.ok(members.every((member) => flowMemberIncluded(attempt, member)));
	const archived = (await session.getValue(value("jouzu.flow.request-history", "disk-0"), context)).value;
	assert.equal(archived.attemptId, "attempt");
	assert.deepEqual(archived.request.inclusion, included);
	await start(ledger, "next");
	await assert.rejects(ledger.prepare("next", "disk-0", included, false, members), { code: "identity" });
});
