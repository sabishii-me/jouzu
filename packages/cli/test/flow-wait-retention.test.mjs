import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT, setValue, value } from "@earendil-works/pi-agent-core";
import { chooseFlowIntent, initialFlowAdmission } from "../dist/flow-control/admission.js";
import { openLocalFlowSession } from "../dist/flow-control/local-storage.js";
import { multiloopWorkBinding } from "../dist/flow-control/multiloop-producer.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { MAX_RETIRED_FLOW_IDENTITIES, retiredIdentityHash } from "../dist/flow-control/retired-identities.js";

const scope = { sessionId: "session", branchId: "branch" };
const empty = () => ({ work: [], executions: [], waits: [] });
async function fixture(t, retiredCount = 0) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-wait-retention-"));
	let session;
	let attachment = await PiFlowAttachment.open(root, scope, async (directory) => {
		session = await openLocalFlowSession(directory);
		if (retiredCount)
			await session.mutate(
				async (writer, context) =>
					writer.commit(
						[
							setValue(value("jouzu.flow.waits", "v1"), {
								version: 1,
								scope,
								waits: [],
								retired: {
									work: Array.from({ length: retiredCount }, (_, i) => retiredIdentityHash(`retired-${i}`)),
									executions: [],
									waits: [],
								},
							}),
						],
						context,
					),
				BACKGROUND_CONTEXT,
			);
		return session;
	});
	t.after(async () => {
		await attachment.close();
		await rm(root, { recursive: true, force: true });
	});
	return {
		get store() {
			return attachment.waits;
		},
		get session() {
			return session;
		},
		async reopen(configure) {
			await attachment.close();
			attachment = await PiFlowAttachment.open(root, scope, async (directory) => {
				session = await openLocalFlowSession(directory);
				await configure?.(session);
				return session;
			});
		},
	};
}
async function completed(store, id = "work") {
	const work = await store.registerWork(id, "bg", 1);
	return store.changeWork(id, "bg", work.revision, "completed", "Finished", 2);
}

test("multiloop campaign activation persists one live generation and never revives stopped work", async (t) => {
	const f = await fixture(t),
		lane = { lane: "lane", runTag: "run" };
	const first = await f.store.activateWorkBinding(multiloopWorkBinding(lane), 1, ["bg"]);
	assert.deepEqual(await f.store.activateWorkBinding(multiloopWorkBinding(lane), 2, ["bg"]), first);
	assert.deepEqual(first.participants, ["multiloop", "bg"]);
	await f.store.changeWork(first.id, first.owner, first.revision, "paused", "pause", 3);
	await f.reopen();
	assert.equal(f.store.boundWork(multiloopWorkBinding(lane)).lifecycle.state, "paused");
	const resumed = await f.store.activateWorkBinding(multiloopWorkBinding(lane), 4);
	assert.equal(resumed.id, first.id);
	const stopped = await f.store.changeWork(resumed.id, resumed.owner, resumed.revision, "stopped", "stop", 5);
	assert.equal(f.store.boundWork(multiloopWorkBinding(lane)), undefined);
	await f.reopen();
	const next = await f.store.activateWorkBinding(multiloopWorkBinding(lane), 6, ["bg"]);
	assert.notEqual(next.id, first.id);
	assert.deepEqual(
		(await f.store.authoritySnapshot()).work.find((work) => work.id === first.id),
		stopped,
	);
	await f.store.retire({ ...empty(), work: [stopped] });
	await assert.rejects(f.store.registerWork(first.id, "multiloop", 7), { code: "stale" });
	assert.equal(f.store.boundWork(multiloopWorkBinding(lane)).id, next.id);
});

test("finished user retirement validates membership, lifecycle, and exact snapshots atomically", async (t) => {
	const f = await fixture(t);
	const inputs = [{ id: "input", revision: 1 }];
	const work = await f.store.registerWork("user", "host-user", 1, inputs);
	inputs[0].revision = 2;
	assert.equal(work.userInputs[0].revision, 1);
	await assert.rejects(f.store.registerWork("user", "host-user", 1, inputs), { code: "identity" });
	await assert.rejects(f.store.retire({ ...empty(), finishedUserWork: [null] }), { code: "identity" });
	await assert.rejects(f.store.retire({ ...empty(), finishedUserWork: [work, work] }), { code: "identity" });
	const paused = await f.store.changeWork(work.id, work.owner, 1, "paused", "pause", 2);
	await assert.rejects(f.store.retire({ ...empty(), finishedUserWork: [work] }), { code: "stale" });
	await assert.rejects(f.store.retire({ ...empty(), finishedUserWork: [paused] }), { code: "identity" });
	await f.reopen();
	assert.deepEqual((await f.store.authoritySnapshot()).work, [paused]);
});
async function dependency(store, { id = "work", token = "wait", state = "pending" } = {}) {
	const work = await store.registerWork(id, "bg", 1);
	const execution = await store.registerExecution(
		{
			producer: "bg",
			handle: "display",
			execution: `exec-${id}`,
			workId: id,
			revision: 1,
			predicates: [{ until: "exit", state }],
		},
		work.revision,
		2,
	);
	const wait = await store.declareOwned(
		"bg",
		work.revision,
		{
			scope,
			workId: id,
			token,
			reason: "exit",
			mode: "all",
			on: [{ producer: "bg", handle: "display", execution: execution.execution, until: "exit" }],
			expiresAt: 100,
		},
		3,
		100,
		undefined,
		undefined,
		{ toolCallId: "tool", toolName: "agent_wait" },
	);
	return { work, execution, wait };
}

test("retiring completed work frees the 257th slot and fences replay after restart", async (t) => {
	const f = await fixture(t),
		work = [];
	for (let i = 0; i < 256; i++) work.push(await completed(f.store, `work-${i}`));
	await assert.rejects(f.store.registerWork("new", "bg", 3));
	assert.deepEqual(await f.store.retire({ ...empty(), work }), { work: 256, executions: 0, waits: 0 });
	assert.equal((await f.store.registerWork("new", "bg", 3)).id, "new");
	await f.reopen();
	await assert.rejects(f.store.registerWork("work-0", "bg", 4), { code: "stale" });
	assert.deepEqual(await f.store.retire({ ...empty(), work }), { work: 0, executions: 0, waits: 0 });
	assert.equal((await f.store.authoritySnapshot()).work.length, 1);
	assert.ok(work.every((item) => f.store.gate().isWorkRetired(item.id)));
	assert.equal(f.store.gate().isWorkRetired("new"), false);
	const intent = {
		id: "again",
		revision: "2",
		producer: "bg",
		sequence: 0,
		rank: 4,
		workId: "work-0",
		workRevision: "2",
		runnable: true,
		independent: true,
	};
	assert.equal(
		chooseFlowIntent(initialFlowAdmission(), [intent], {
			hostReady: true,
			userPending: false,
			recoveryBlocked: false,
			...f.store.gate(),
		}),
		undefined,
	);
});

test("retirement gates keep their committed membership across later retirement and reset", async (t) => {
	const f = await fixture(t);
	const work = await completed(f.store);
	const before = f.store.gate();
	await f.store.retire({ ...empty(), work: [work] });
	const retired = f.store.gate();
	assert.equal(before.isWorkRetired(work.id), false);
	assert.equal(retired.isWorkRetired(work.id), true);
	assert.equal(Object.hasOwn(retired, "retiredWorkHashes"), false);
	await f.store.reset();
	assert.equal(retired.isWorkRetired(work.id), true);
	assert.equal(f.store.gate().isWorkRetired(work.id), false);
});

test("retirement atomically frees waits, execution evidence, tool receipts, and stopped work", async (t) => {
	const f = await fixture(t),
		d = await dependency(f.store, { state: "satisfied" });
	assert.equal((await f.store.toolReceipts()).length, 1);
	const work = await f.store.changeWork("work", "bg", d.work.revision, "stopped", "Stop", 4);
	await assert.rejects(f.store.retire({ ...empty(), work: [work] }), { code: "busy" });
	await assert.rejects(f.store.retire({ ...empty(), executions: [d.execution] }), { code: "busy" });
	const receipts = await f.store.toolReceipts();
	assert.deepEqual(await f.store.retire({ work: [work], executions: [d.execution], waits: [d.wait] }), {
		work: 1,
		executions: 1,
		waits: 1,
	});
	await f.reopen();
	for (const [kind, key, record] of [
		["work", retiredIdentityHash(work.id), work],
		["executions", retiredIdentityHash(d.execution.producer, d.execution.execution), d.execution],
		["waits", retiredIdentityHash(d.wait.token), d.wait],
	]) {
		const archived = (
			await f.session.getValue(value(`jouzu.flow.wait-history-${kind}`, JSON.stringify([0, key])), BACKGROUND_CONTEXT)
		).value;
		assert.deepEqual(archived.record, record);
		if (kind === "waits") assert.deepEqual(archived.toolReceipts, receipts);
	}
	assert.deepEqual(await f.store.snapshot(), []);
	assert.deepEqual(await f.store.toolReceipts(), []);
	assert.deepEqual(await f.store.authoritySnapshot(), { version: 1, work: [], executions: [], waitTokens: [] });
	await assert.rejects(f.store.registerWork("work", "bg", 5), { code: "stale" });
	const other = await f.store.registerWork("other", "bg", 5);
	const input = { ...d.execution, workId: "other" };
	delete input.observedAt;
	await assert.rejects(f.store.registerExecution(input, other.revision, 6), { code: "stale" });
	await assert.rejects(f.store.synchronizeExecution(input, other.revision, 6), { code: "stale" });
	await assert.rejects(
		f.store.declare(
			{ ...d.wait, workId: "raw" },
			d.wait.observations.map((o) => ({ ...o, workId: "raw" })),
			6,
			100,
		),
		{ code: "stale" },
	);
});

test("live waits, active work, and pending execution evidence cannot be retired", async (t) => {
	const f = await fixture(t),
		d = await dependency(f.store);
	for (const request of [
		{ ...empty(), waits: [d.wait] },
		{ ...empty(), work: [d.work] },
		{ ...empty(), executions: [d.execution] },
	])
		await assert.rejects(f.store.retire(request), { code: "busy" });
	assert.deepEqual(await f.store.snapshot(), [d.wait]);
	assert.equal(f.store.gate().isWorkRetired(d.work.id), false);
	const cancelled = await f.store.cancelOwned("bg", d.work.revision, d.wait.token, "Cancel gate", 4);
	await f.store.retire({ ...empty(), waits: [cancelled] });
	await assert.rejects(f.store.retire({ ...empty(), executions: [d.execution] }), { code: "busy" });
	assert.equal((await f.store.authoritySnapshot()).executions.length, 1);
});

test("stale or duplicate retirement selections commit nothing", async (t) => {
	const f = await fixture(t),
		work = await completed(f.store);
	await assert.rejects(f.store.retire({ ...empty(), work: [{ ...work, revision: work.revision + 1 }] }), {
		code: "stale",
	});
	await assert.rejects(f.store.retire({ ...empty(), work: [work, work] }), { code: "identity" });
	assert.deepEqual((await f.store.authoritySnapshot()).work, [work]);
	assert.equal(f.store.gate().isWorkRetired(work.id), false);
});

test("wait and execution slots can be reused past both live-record limits", async (t) => {
	const f = await fixture(t);
	const work = await f.store.registerWork("work", "bg", 1);
	let retiredExecution;
	for (let batch = 0; batch < 9; batch++) {
		const executions = [],
			waits = [];
		for (let index = 0; index < 128; index++) {
			const sequence = batch * 128 + index;
			const execution = await f.store.registerExecution(
				{
					producer: "bg",
					handle: "display",
					execution: `exec-${sequence}`,
					workId: "work",
					revision: 1,
					predicates: [{ until: "exit", state: "satisfied" }],
				},
				work.revision,
				2,
			);
			executions.push(execution);
			waits.push(
				await f.store.declareOwned(
					"bg",
					work.revision,
					{
						scope,
						workId: "work",
						token: `wait-${sequence}`,
						reason: "exit",
						mode: "all",
						on: [{ producer: "bg", handle: "display", execution: execution.execution, until: "exit" }],
						expiresAt: 100,
					},
					3,
					100,
				),
			);
		}
		retiredExecution ??= executions[0];
		assert.equal((await f.store.authoritySnapshot()).waitTokens.length, 128);
		assert.deepEqual(await f.store.retire({ work: [], executions, waits }), { work: 0, executions: 128, waits: 128 });
	}
	await f.reopen();
	assert.equal((await f.store.authoritySnapshot()).executions.length, 0);
	assert.equal((await f.store.authoritySnapshot()).waitTokens.length, 0);
	await assert.rejects(f.store.synchronizeExecution(retiredExecution, work.revision, 4), { code: "stale" });
});

test("an execution change races retirement without losing the newer evidence", async (t) => {
	const f = await fixture(t),
		d = await dependency(f.store, { state: "satisfied" });
	await f.store.retire({ ...empty(), waits: [d.wait] });
	await f.store.observeExecution(
		{ producer: "bg", handle: "display", execution: d.execution.execution },
		2,
		[{ until: "exit", state: "satisfied" }],
		4,
	);
	await assert.rejects(f.store.retire({ ...empty(), executions: [d.execution] }), { code: "stale" });
	assert.equal((await f.store.authoritySnapshot()).executions[0].revision, 2);
});

function failWaitCommits(session) {
	const mutate = session.mutate.bind(session);
	session.mutate = (update, context) =>
		mutate(
			(writer, ctx) =>
				update(
					new Proxy(writer, {
						get(target, key) {
							if (key === "commit")
								return (writes, context) => {
									if (writes.some((write) => write.namespace === "jouzu.flow.waits"))
										throw new Error("injected wait commit failure");
									return target.commit(writes, context);
								};
							const field = Reflect.get(target, key);
							return typeof field === "function" ? field.bind(target) : field;
						},
					}),
					ctx,
				),
			context,
		);
	return () => {
		session.mutate = mutate;
	};
}

test("wait retirement failure preserves active records and committed admission membership", async (t) => {
	const f = await fixture(t);
	const work = await completed(f.store);
	const restore = failWaitCommits(f.session);
	await assert.rejects(f.store.retire({ ...empty(), work: [work] }), /injected wait commit failure/);
	restore();
	assert.deepEqual((await f.store.authoritySnapshot()).work, [work]);
	assert.equal(f.store.gate().isWorkRetired(work.id), false);
	assert.equal(
		await f.session.getValue(
			value("jouzu.flow.wait-history-work", JSON.stringify([0, retiredIdentityHash(work.id)])),
			BACKGROUND_CONTEXT,
		),
		undefined,
	);
	await f.reopen();
	assert.deepEqual((await f.store.authoritySnapshot()).work, [work]);
	await f.store.retire({ ...empty(), work: [work] });
	assert.equal(f.store.gate().isWorkRetired(work.id), true);
});

test("retirement rechecks eligibility after asynchronous archive lookups", async (t) => {
	const f = await fixture(t);
	const work = await completed(f.store);
	let current = true;
	const mutate = f.session.mutate.bind(f.session);
	f.session.mutate = (update, context) =>
		mutate(
			(writer, ctx) =>
				update(
					new Proxy(writer, {
						get(target, key) {
							if (key === "getValue")
								return (address, context) => {
									if (address.namespace.startsWith("jouzu.flow.wait-history-")) current = false;
									return target.getValue(address, context);
								};
							const field = Reflect.get(target, key);
							return typeof field === "function" ? field.bind(target) : field;
						},
					}),
					ctx,
				),
			context,
		);
	await assert.rejects(
		f.store.retire({ ...empty(), work: [work] }, () => {
			if (!current) throw new Error("eligibility changed");
		}),
		/eligibility changed/,
	);
	f.session.mutate = mutate;
	assert.deepEqual((await f.store.authoritySnapshot()).work, [work]);
	assert.equal(f.store.gate().isWorkRetired(work.id), false);
	assert.equal(
		await f.session.getValue(
			value("jouzu.flow.wait-history-work", JSON.stringify([0, retiredIdentityHash(work.id)])),
			BACKGROUND_CONTEXT,
		),
		undefined,
	);
});

for (const state of ["pending", "satisfied"])
	test(`reset archives active wait evidence and permits token and execution reuse: ${state}`, async (t) => {
		const f = await fixture(t);
		const retired = await completed(f.store, "retired");
		await f.store.retire({ ...empty(), work: [retired] });
		const first = await dependency(f.store, { state });
		const receipts = await f.store.toolReceipts();
		const restore = failWaitCommits(f.session);
		await assert.rejects(f.store.reset(), /injected wait commit failure/);
		restore();
		assert.deepEqual(await f.store.snapshot(), [first.wait]);
		assert.deepEqual(await f.store.toolReceipts(), receipts);
		assert.equal(f.store.gate().isWorkRetired(retired.id), true);
		await f.store.reset();
		await f.reopen();
		assert.equal(f.store.gate().isWorkRetired(retired.id), false);
		assert.deepEqual(await f.store.snapshot(), []);
		const second = await dependency(f.store, { state });
		assert.equal(second.execution.execution, first.execution.execution);
		assert.equal(second.wait.token, first.wait.token);
		await f.store.reset();
		for (const epoch of [0, 1]) {
			const wait = (
				await f.session.getValue(
					value("jouzu.flow.wait-history-waits", JSON.stringify([epoch, retiredIdentityHash(first.wait.token)])),
					BACKGROUND_CONTEXT,
				)
			).value;
			assert.deepEqual(wait.record, first.wait);
			assert.deepEqual(wait.toolReceipts, receipts);
			assert.deepEqual(
				(
					await f.session.getValue(
						value(
							"jouzu.flow.wait-history-executions",
							JSON.stringify([epoch, retiredIdentityHash(first.execution.producer, first.execution.execution)]),
						),
						BACKGROUND_CONTEXT,
					)
				).value.record,
				first.execution,
			);
		}
	});

for (const replacement of [false, true])
	test(`owned declaration rechecks authorization after history reads: replacement=${replacement}`, async (t) => {
		const f = await fixture(t);
		const d = await dependency(f.store);
		if (!replacement) await f.store.cancelOwned("bg", d.work.revision, d.wait.token, "Finish prior wait", 4);
		const before = await f.store.snapshot();
		const receipts = await f.store.toolReceipts();
		const gate = f.store.gate().waitingWorkIds;
		let active = true;
		const mutate = f.session.mutate.bind(f.session);
		f.session.mutate = (update, context) =>
			mutate(
				(writer, ctx) =>
					update(
						new Proxy(writer, {
							get(target, key) {
								if (key === "getValue")
									return (address, context) => {
										if (address.namespace === "jouzu.flow.wait-history-waits") active = false;
										return target.getValue(address, context);
									};
								const field = Reflect.get(target, key);
								return typeof field === "function" ? field.bind(target) : field;
							},
						}),
						ctx,
					),
				context,
			);
		await assert.rejects(
			f.store.declareOwned(
				"bg",
				d.work.revision,
				{ ...d.wait, token: "new-wait" },
				5,
				100,
				replacement ? d.wait.token : undefined,
				() => {
					if (!active) throw new Error("authorization revoked");
				},
				{ toolCallId: "replacement", toolName: "agent_wait" },
			),
			/authorization revoked/,
		);
		f.session.mutate = mutate;
		assert.deepEqual(await f.store.snapshot(), before);
		assert.deepEqual(await f.store.toolReceipts(), receipts);
		assert.deepEqual(f.store.gate().waitingWorkIds, gate);
	});

test("owned cancellation rechecks authorization after its change callback yields", async (t) => {
	const f = await fixture(t);
	const d = await dependency(f.store);
	let active = true;
	await assert.rejects(
		f.store.cancelOwned("bg", d.work.revision, d.wait.token, "Cancel", 4, () => {
			if (!active) throw new Error("authorization revoked");
			queueMicrotask(() => {
				active = false;
			});
		}),
		/authorization revoked/,
	);
	assert.deepEqual(await f.store.snapshot(), [d.wait]);
	assert.deepEqual(f.store.gate().waitingWorkIds, [d.work.id]);
});

test("failed legacy wait migration retries atomically after reopen", async (t) => {
	const f = await fixture(t);
	const legacy = {
		version: 1,
		scope,
		waits: [],
		retired: {
			work: [retiredIdentityHash("old")],
			executions: [retiredIdentityHash("bg", "old-exec")],
			waits: [retiredIdentityHash("old-wait")],
		},
	};
	await f.session.mutate(
		(writer, context) => writer.commit([setValue(value("jouzu.flow.waits", "v1"), legacy)], context),
		BACKGROUND_CONTEXT,
	);
	await assert.rejects(
		f.reopen((session) => {
			failWaitCommits(session);
		}),
		/injected wait commit failure/,
	);
	await f.reopen(async (session) => {
		assert.deepEqual((await session.getValue(value("jouzu.flow.waits", "v1"), BACKGROUND_CONTEXT)).value, legacy);
		for (const kind of ["work", "executions", "waits"])
			assert.equal(
				await session.getValue(
					value(`jouzu.flow.wait-history-${kind}`, JSON.stringify([0, legacy.retired[kind][0]])),
					BACKGROUND_CONTEXT,
				),
				undefined,
			);
	});
	assert.equal(f.store.gate().isWorkRetired("old"), true);
	assert.equal(
		(await f.session.getValue(value("jouzu.flow.waits", "v1"), BACKGROUND_CONTEXT)).value.retired,
		undefined,
	);
	for (const kind of ["work", "executions", "waits"])
		assert.ok(
			await f.session.getValue(
				value(`jouzu.flow.wait-history-${kind}`, JSON.stringify([0, legacy.retired[kind][0]])),
				BACKGROUND_CONTEXT,
			),
		);
});

test("reset isolates reused identities and preserves each generation's archived records", async (t) => {
	const f = await fixture(t);
	const first = await completed(f.store);
	await f.store.retire({ ...empty(), work: [first] });
	await f.store.reset();
	await f.reopen();
	assert.equal(f.store.gate().isWorkRetired(first.id), false);
	const active = await f.store.registerWork(first.id, "other-owner", 4);
	const second = await f.store.changeWork(
		active.id,
		active.owner,
		active.revision,
		"completed",
		"Second generation",
		5,
	);
	await f.store.retire({ ...empty(), work: [second] });
	await f.reopen();
	assert.equal(f.store.gate().isWorkRetired(first.id), true);
	for (const [epoch, record] of [
		[0, first],
		[1, second],
	]) {
		assert.deepEqual(
			(
				await f.session.getValue(
					value("jouzu.flow.wait-history-work", JSON.stringify([epoch, retiredIdentityHash(record.id)])),
					BACKGROUND_CONTEXT,
				)
			).value.record,
			record,
		);
	}
});

test("ordinary wait updates query exact history without rescanning or rewriting retirement records", async (t) => {
	const f = await fixture(t, 20);
	const mutate = f.session.mutate.bind(f.session);
	f.session.mutate = (update, context) =>
		mutate(
			(writer, ctx) =>
				update(
					new Proxy(writer, {
						get(target, key) {
							if (key === "scanValues")
								return () => {
									throw new Error("unexpected retirement scan");
								};
							if (key === "commit")
								return (writes, context) => {
									assert.ok(writes.every((write) => !write.namespace.startsWith("jouzu.flow.wait-history-")));
									return target.commit(writes, context);
								};
							const field = Reflect.get(target, key);
							return typeof field === "function" ? field.bind(target) : field;
						},
					}),
					ctx,
				),
			context,
		);
	await completed(f.store, "fresh");
	await assert.rejects(f.store.registerWork("retired-0", "bg", 4), { code: "stale" });
	assert.equal(f.store.gate().isWorkRetired("retired-19"), true);
});

test("legacy wait replay fences migrate at the quota and permit further retirement", async (t) => {
	const f = await fixture(t, MAX_RETIRED_FLOW_IDENTITIES);
	const first = await completed(f.store, "first"),
		second = await completed(f.store, "second");
	await f.store.retire({ ...empty(), work: [first, second] });
	const header = (await f.session.getValue(value("jouzu.flow.waits", "v1"), BACKGROUND_CONTEXT)).value;
	assert.equal(header.retired, undefined);
	assert.ok(JSON.stringify(header).length < 512);
	await f.reopen();
	for (const id of ["retired-0", `retired-${MAX_RETIRED_FLOW_IDENTITIES - 1}`, "first", "second"]) {
		assert.equal(f.store.gate().isWorkRetired(id), true);
		await assert.rejects(f.store.registerWork(id, "bg", 3), { code: "stale" });
	}
	assert.deepEqual(await f.store.retire({ ...empty(), work: [first, second] }), { work: 0, waits: 0, executions: 0 });
	assert.deepEqual((await f.store.authoritySnapshot()).work, []);
	await f.store.registerWork("usable", "bg", 3);
});
