import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context, MemorySessionRepo, setValue, value } from "@earendil-works/pi-agent-core";
import { initialFlowAdmission } from "../dist/flow-control/admission.js";
import { emptyRetiredAttempts, retiredMemberHash, retiredWorkHash } from "../dist/flow-control/attempt-retention.js";
import { retainedByReceipt } from "../dist/flow-control/controller.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { createPiLedgerStore } from "../dist/flow-control/pi-ledger-store.js";
import { FlowReceiptLedger } from "../dist/flow-control/receipt-ledger.js";
import { orderFlowResultProducers } from "../dist/flow-control/result-order.js";
import { MAX_RETIRED_FLOW_IDENTITIES } from "../dist/flow-control/retired-identities.js";

const scope = { sessionId: "parent", branchId: "branch-a" };
const hash = (id) => createHash("sha256").update(`content:${id}`).digest("hex");
const member = (id, kind = "work") => ({
	id,
	revision: "r1",
	kind,
	required: kind === "work" || kind === "wait",
	contentHash: hash(id),
});
const included = (item) => ({
	id: item.id,
	revision: item.revision,
	disposition: "included",
	contentHash: item.contentHash,
});

async function fixture(t) {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	t.after(() => repo.close(context));
	return FlowReceiptLedger.attach(createPiLedgerStore(session), scope);
}

/** A legacy ledger at the retired-identity budget must migrate under ordinary limits. */
async function fencedFixture(t, spent) {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	t.after(() => repo.close(context));
	await session.mutate(
		(mutation, ctx) =>
			mutation.commit(
				[
					setValue(value("jouzu.flow.receipts", "v1"), {
						schemaVersion: 1,
						scope,
						generation: 0,
						revision: 0,
						attemptIds: [],
						retiredAttempts: { ...emptyRetiredAttempts(), members: spent },
					}),
				],
				ctx,
			),
		context,
	);
	return FlowReceiptLedger.attach(createPiLedgerStore(session), scope);
}

const intent = (id, overrides = {}) => ({
	id,
	revision: "r1",
	producer: "multiloop",
	sequence: 0,
	rank: 4,
	workId: "campaign",
	workRevision: "1:1",
	independent: false,
	runnable: true,
	...overrides,
});

/** Drive one attempt from selection to a settled successful outcome. */
async function settledAttempt(ledger, attemptId, intentId, resultProducer) {
	// One member must carry the selected intent's identity for the ledger to accept the choice.
	const work = { ...member(intentId), id: intentId, revision: "r1" };
	const items = [work];
	if (resultProducer) items.push(member(`result-${attemptId}`, "result"));
	// Each selection must quote the current admission revision and advance it.
	const revision = (await ledger.snapshot()).admission?.revision ?? 0;
	const choice = {
		revision,
		intent: intent(intentId),
		coalescedIds: [],
		next: { ...initialFlowAdmission(), revision: revision + 1 },
		...(resultProducer
			? {
					resultSnapshot: [
						{ id: items[1].id, revision: "r1", producer: resultProducer },
						{ id: "pending-beta", revision: "r1", producer: "beta" },
					],
				}
			: {}),
	};
	await ledger.select(attemptId, items, choice);
	const queue = { id: `queue-${attemptId}`, revision: 1 };
	await ledger.queued(attemptId, queue);
	await ledger.claim(attemptId, queue);
	await ledger.prepare(attemptId, `request-${attemptId}`, items.map(included), false);
	await ledger.handoff(attemptId, `request-${attemptId}`);
	await ledger.requestOutcome(attemptId, `request-${attemptId}`, "success");
	await ledger.settle(attemptId, "success");
	return items;
}

test("retirement removes settled attempts and keeps the newest addressable", async (t) => {
	const ledger = await fixture(t);
	for (let index = 0; index < 5; index++) await settledAttempt(ledger, `a${index}`, "loop");
	assert.equal((await ledger.snapshot()).attempts.length, 5);
	assert.equal(await ledger.retire(2), 3);
	const state = await ledger.snapshot();
	assert.equal(state.attempts.length, 2);
	assert.deepEqual(
		state.attempts.map((attempt) => attempt.id),
		["a3", "a4"],
	);
	assert.equal(await ledger.retire(2), 0, "a second pass retires nothing new");
});

test("a retired attempt still fences its members and its cadence work", async (t) => {
	const ledger = await fixture(t);
	const [work] = await settledAttempt(ledger, "a0", "loop");
	const before = await ledger.snapshot();
	const memberIntent = {
		...intent("loop"),
		id: work.id,
		revision: work.revision,
		rank: 6,
		workId: undefined,
		workRevision: undefined,
	};
	assert.equal(retainedByReceipt(memberIntent, before), true);
	assert.equal(retainedByReceipt(intent("loop"), before), true);
	await ledger.retire(0);
	const after = await ledger.snapshot();
	after.retiredAttempts = await ledger.retired({
		members: [retiredMemberHash(work.id, work.revision)],
		work: [retiredWorkHash("campaign", "1:1")],
	});
	assert.equal(after.attempts.length, 0);
	assert.equal(retainedByReceipt(memberIntent, after), true, "member replay stays fenced after retirement");
	assert.equal(retainedByReceipt(intent("loop"), after), true, "cadence replay stays fenced after retirement");
	// A later iteration carries a new descriptor revision and a new work revision; neither is fenced.
	assert.equal(
		retainedByReceipt(intent("loop", { revision: "r2", workRevision: "1:2" }), after),
		false,
		"a new iteration is admissible",
	);
	assert.equal(
		retainedByReceipt(intent("loop", { revision: "r2" }), after),
		true,
		"the same work revision stays fenced under a new descriptor revision",
	);
});

test("iteration numbering continues across retirement", async (t) => {
	const ledger = await fixture(t);
	for (let index = 0; index < 3; index++) await settledAttempt(ledger, `a${index}`, "loop");
	const before = await ledger.snapshot();
	const counted = (state) =>
		state.attempts.filter(
			(attempt) =>
				attempt.admission?.choice.intent.id === "loop" && attempt.phase === "settled" && attempt.outcome === "success",
		).length + (state.retiredAttempts?.settled.find((entry) => entry.id === "loop")?.count ?? 0);
	assert.equal(counted(before), 3);
	await ledger.retire(0);
	const after = await ledger.snapshot();
	after.retiredAttempts = await ledger.retired({ settled: ["loop"] });
	assert.equal(after.attempts.length, 0);
	assert.equal(counted(after), 3, "the settled count survives pruning");
	assert.deepEqual(after.retiredAttempts.settled, [{ id: "loop", count: 3 }]);
});

test("the producer round carries past retirement so fairness does not restart", async (t) => {
	const ledger = await fixture(t);
	await settledAttempt(ledger, "a0", "loop", "alpha");
	const before = await ledger.snapshot();
	const eligible = [
		intent("next-alpha", { rank: 6, producer: "alpha", sequence: 0 }),
		intent("pending-beta", { rank: 6, producer: "beta", sequence: 1 }),
	];
	const served = orderFlowResultProducers(eligible, before);
	assert.deepEqual(served, ["beta", "alpha"]);
	await ledger.retire(0);
	const after = await ledger.snapshot();
	assert.deepEqual(after.retiredAttempts.round, ["beta"]);
	assert.deepEqual(orderFlowResultProducers(eligible, after), served, "ordering is unchanged by retirement");
});

test("an active attempt is never retired", async (t) => {
	const ledger = await fixture(t);
	await settledAttempt(ledger, "a0", "loop");
	await ledger.select("live", [member("live-member")]);
	assert.equal((await ledger.snapshot()).activeAttemptId, "live");
	assert.equal(await ledger.retire(0), 1, "only the settled attempt retires");
	const state = await ledger.snapshot();
	assert.deepEqual(
		state.attempts.map((attempt) => attempt.id),
		["live"],
	);
});

test("a successful request with an omitted result retains its context exclusion evidence", async (t) => {
	const ledger = await fixture(t);
	const work = member("instruction"),
		result = member("filtered-result", "result");
	await ledger.select("filtered", [work, result], {
		revision: 0,
		intent: intent(work.id),
		coalescedIds: [],
		next: { ...initialFlowAdmission(), revision: 1 },
	});
	const queue = { id: "filtered-queue", revision: 1 };
	await ledger.queued("filtered", queue);
	await ledger.claim("filtered", queue);
	const inclusion = [included(work), { id: result.id, revision: result.revision, disposition: "omitted" }];
	await ledger.prepare("filtered", "filtered-request", inclusion, false);
	await ledger.handoff("filtered", "filtered-request");
	await ledger.requestOutcome("filtered", "filtered-request", "success");
	await ledger.settle("filtered", "success");
	assert.equal(await ledger.retire(0), 0, "success does not establish inclusion of every composed member");
	assert.equal((await ledger.snapshot()).attempts[0].members[1].id, result.id);
});

test("indexed retirement survives repeated attachments and reset starts a new replay epoch", async (t) => {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	t.after(() => repo.close(context));
	const store = createPiLedgerStore(session);
	let ledger = await FlowReceiptLedger.attach(store, scope);
	await settledAttempt(ledger, "first", "loop");
	await ledger.retire(0);
	await assert.rejects(ledger.select("first", [member("different")]), { code: "identity" });
	for (let i = 0; i < 3; i++) ledger = await FlowReceiptLedger.attach(store, scope);
	const query = {
		members: [retiredMemberHash("loop", "r1")],
		work: [retiredWorkHash("campaign", "1:1")],
		settled: ["loop"],
	};
	let facts = await ledger.retired(query);
	assert.equal(facts.members.length, 1);
	assert.equal(facts.work.length, 1);
	assert.deepEqual(facts.settled, [{ id: "loop", count: 1 }]);
	assert.ok(await session.getValue(value("jouzu.flow.attempt-history", JSON.stringify([0, "first"])), context));
	await ledger.reset();
	facts = await ledger.retired(query);
	assert.equal(facts.members.length, 0);
	assert.equal(facts.work.length, 0);
	assert.equal(facts.settled.length, 0);
	await settledAttempt(ledger, "second", "loop");
	await ledger.retire(0);
	facts = await ledger.retired(query);
	assert.deepEqual(facts.settled, [{ id: "loop", count: 1 }]);
});

test("production attachment queries indexed retirement after disk reopen and reset", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "flow-retired-index-"));
	let attachment;
	t.after(async () => {
		await attachment?.close();
		await rm(root, { recursive: true, force: true });
	});
	attachment = await PiFlowAttachment.open(root, scope);
	await settledAttempt(attachment.ledger, "first", "loop");
	await attachment.ledger.retire(0);
	await attachment.close();
	attachment = await PiFlowAttachment.open(root, scope);
	const query = {
		members: [retiredMemberHash("loop", "r1")],
		work: [retiredWorkHash("campaign", "1:1")],
		settled: ["loop"],
	};
	const facts = await attachment.ledger.retired(query);
	assert.deepEqual(facts.members, query.members);
	assert.deepEqual(facts.work, query.work);
	assert.deepEqual(facts.settled, [{ id: "loop", count: 1 }]);
	await attachment.ledger.reset();
	assert.deepEqual(await attachment.ledger.retired(query), emptyRetiredAttempts());
});

test("retirement rejects an invalid window", async (t) => {
	const ledger = await fixture(t);
	assert.throws(
		() => ledger.retire(-1),
		(error) => error.code === "capacity",
	);
	assert.throws(
		() => ledger.retire(1.5),
		(error) => error.code === "capacity",
	);
});

test("indexed retirement crosses the old lifetime budget without growing the operational snapshot", async (t) => {
	const spent = Array.from({ length: MAX_RETIRED_FLOW_IDENTITIES }, (_, index) =>
		retiredMemberHash(`spent-${index}`, "r1"),
	);
	const ledger = await fencedFixture(t, spent);
	for (let i = 0; i < 12; i++) {
		await settledAttempt(ledger, `a-${i}`, "loop");
		assert.equal(await ledger.retire(0), 1);
	}
	const state = await ledger.snapshot();
	assert.equal(state.attempts.length, 0);
	assert.equal(state.retiredAttempts.members.length, 0);
	assert.equal(state.retiredAttempts.settled.length, 0);
	assert.ok(Buffer.byteLength(JSON.stringify(state)) < 2000);
	const facts = await ledger.retired({
		members: [spent[0], spent.at(-1), retiredMemberHash("loop", "r1"), retiredMemberHash("fresh", "r1")],
		settled: ["loop"],
	});
	assert.deepEqual(facts.members, [spent[0], spent.at(-1), retiredMemberHash("loop", "r1")]);
	assert.deepEqual(facts.settled, [{ id: "loop", count: 12 }]);
});
