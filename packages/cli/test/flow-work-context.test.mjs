import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { automaticWorkId, retainAutomaticWork } from "../dist/flow-control/automatic-work.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { FlowWorkContext } from "../dist/flow-control/work-context.js";

async function fixture(t, options = {}) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-work-context-"));
	const attachment = await PiFlowAttachment.open(root, { sessionId: "session", branchId: "branch" });
	t.after(async () => {
		await attachment.close();
		await rm(root, { recursive: true, force: true });
	});
	await attachment.waits.registerWork("work", "lane", 0);
	await attachment.waits.registerWork("other", "lane", 0);
	let current = attachment;
	const context = new FlowWorkContext(
		() => current,
		options.automatic ? () => retainAutomaticWork(current) : undefined,
	);
	if (options.automatic) await context.attach();
	return {
		attachment,
		context,
		changeBranch: (replacement) => {
			current = replacement;
		},
	};
}
const work = { id: "work", actor: "lane", revision: 1 };

test("attribution is optional and never blocks a tool", async (t) => {
	const { context } = await fixture(t);
	// No branch host identity is registered, so there is nothing to attribute to.
	assert.equal(context.current(), undefined);
	assert.equal(typeof context.authorize, "undefined", "authority checks are gone");
	// Running without attribution still works and reports none.
	await context.run(undefined, async () => assert.equal(context.current(), undefined));
	assert.equal(context.busy, false);
});

test("a branch host identity is available outside any invocation", async (t) => {
	const { context, attachment } = await fixture(t, { automatic: true });
	const host = context.current();
	assert.equal(host.id, automaticWorkId(attachment.ledger.scope));
	assert.ok(host.revision >= 1);
	await context.run(work, async () => assert.equal(context.current().id, "work"));
	assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope), "selection is released");
});

test("overlapping invocations cannot replace work and failures release the reservation", async (t) => {
	const { context } = await fixture(t);
	const started = deferred(),
		finish = deferred();
	const running = context.run(work, async () => {
		started.resolve();
		await finish.promise;
		throw new Error("fixture failure");
	});
	await started.promise;
	await assert.rejects(
		context.run({ ...work, id: "other" }, async () => {}),
		{ code: "busy" },
	);
	finish.resolve();
	await assert.rejects(running, /fixture failure/);
	await context.run({ ...work, id: "other" }, async () => assert.equal(context.current().id, "other"));
});

test("withOperation shares the outer invocation instead of nesting", async (t) => {
	const { context } = await fixture(t);
	await context.run(work, async () => {
		assert.equal(await context.withOperation(async () => context.current().id), "work");
	});
	await context.withOperation(async () => assert.equal(context.current(), undefined));
});

test("revocation falls back to branch attribution without ending the run", async (t) => {
	const { context, attachment } = await fixture(t, { automatic: true });
	await context.run(work, async () => {
		context.revoke();
		context.revoke();
		assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope));
		await assert.rejects(
			context.run({ ...work, id: "other" }, async () => {}),
			{ code: "busy" },
		);
	});
	assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope));
});

test("a live tool selects attribution for following tools", async (t) => {
	const { context } = await fixture(t);
	await context.run(work, async () => {
		assert.equal(await context.selectToolWork({ id: "other", actor: "lane", revision: 1 }), true);
		assert.equal(context.current().id, "other");
		await context.selectToolWork(work);
		assert.equal(context.current().id, "work");
	});
});

const otherWork = { id: "other", actor: "lane", revision: 1 };
test("task selection returns to the retained parent, or to branch attribution", async (t) => {
	const { context, attachment } = await fixture(t, { automatic: true });
	await context.run(work, async () => {
		await context.selectToolWork(otherWork, true);
		assert.equal(await context.returnFromToolWork(), false, "active child cannot return");
		await attachment.waits.changeWork("other", "lane", 1, "completed", "Done", 1);
		assert.equal(await context.returnFromToolWork(), true);
		assert.equal(context.current().id, "work");
	});
	// A completed task with no retained parent falls back to branch attribution.
	await attachment.waits.registerWork("solo", "lane", 0);
	await context.run({ id: "solo", actor: "lane", revision: 1 }, async () => {
		await attachment.waits.changeWork("solo", "lane", 1, "completed", "Done", 2);
		assert.equal(await context.returnFromToolWork(), true);
		assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope));
	});
});

test("returning from a completed task refuses to cross a branch change", async (t) => {
	const f = await fixture(t);
	const replacement = await fixture(t);
	await f.context.run(work, async () => {
		await f.attachment.waits.changeWork("work", "lane", 1, "completed", "Done", 1);
		const original = f.attachment.waits.authoritySnapshot.bind(f.attachment.waits);
		f.attachment.waits.authoritySnapshot = async () => {
			const state = await original();
			f.changeBranch(replacement.attachment);
			return state;
		};
		await assert.rejects(f.context.returnFromToolWork(), { code: "stale" });
	});
});

for (const change of ["none", "revision", "paused", "completed", "revoked"])
	test(`completed task tools stay available after origin ${change}`, async (t) => {
		const { context, attachment } = await fixture(t, { automatic: true });
		await attachment.waits.shareWork("work", "lane", 1, "tasks", 1);
		const child = await attachment.waits.deriveWorkBinding(
			{ producer: "tasks", key: ["continuation"] },
			"1",
			{ id: "work", revision: 2 },
			2,
			["bg", "tasks"],
		);
		await context.run({ id: child.id, actor: "tasks", revision: child.revision }, async () => {
			await attachment.waits.changeWork(child.id, "tasks", child.revision, "completed", "Done", 3);
			if (change === "revision") await attachment.waits.shareWork("work", "lane", 2, "bg", 4);
			if (["paused", "completed"].includes(change))
				await attachment.waits.changeWork("work", "lane", 2, change, "Origin changed", 4);
			if (change === "revoked") context.revoke();
			await context.returnFromToolWork();
			const current = context.current();
			assert.equal(current.id, automaticWorkId(attachment.ledger.scope));
			assert.deepEqual(attachment.waits.captureExecutionWork(current.id, current.revision, "bg"), current);
		});
	});

const resultIntent = (workId) => ({
	id: "bg-result:execution",
	revision: "1",
	producer: "bg",
	sequence: 0,
	rank: 6,
	independent: true,
	runnable: true,
	...(workId === undefined ? {} : { workId, workRevision: "2" }),
});
const selectedAttempt = (attachment, intent) => {
	attachment.ledger.snapshot = async () => ({
		activeAttemptId: "attempt",
		attempts: [{ id: "attempt", phase: "queued", admission: { choice: { intent } } }],
	});
};

test("result delivery attributes the work that owns its execution", async (t) => {
	const { context, attachment } = await fixture(t);
	await attachment.waits.shareWork("work", "lane", 1, "bg", 1);
	selectedAttempt(attachment, resultIntent("work"));
	await context.runSelected("attempt", async () => {
		assert.deepEqual(context.current(), { id: "work", revision: 2 });
		// The spawn path captures exactly this attribution before any process starts.
		assert.deepEqual(attachment.waits.captureExecutionWork("work", 2, "bg"), { id: "work", revision: 2 });
	});
});

for (const variant of ["paused", "completed", "missing", "absent"])
	test(`result delivery without live owning work keeps its tools: ${variant}`, async (t) => {
		const { context, attachment } = await fixture(t, { automatic: true });
		await attachment.waits.shareWork("work", "lane", 1, "bg", 1);
		if (["paused", "completed"].includes(variant))
			await attachment.waits.changeWork("work", "lane", 2, variant, "Lifecycle test", 2);
		selectedAttempt(attachment, resultIntent(variant === "absent" ? undefined : "elsewhere"));
		await context.runSelected("attempt", async () => {
			const current = context.current();
			assert.equal(current.id, automaticWorkId(attachment.ledger.scope));
			// The fallback identity is registered and usable for a derived producer origin.
			assert.deepEqual(attachment.waits.captureExecutionWork(current.id, current.revision, "bg"), {
				id: current.id,
				revision: current.revision,
			});
			const derived = await attachment.waits.deriveWorkBinding(
				{ producer: "tasks", key: ["created-in-a-wake-turn"] },
				"task-revision",
				current,
				1,
				["bg", "tasks"],
			);
			assert.deepEqual(derived.origin, { id: current.id, revision: current.revision });
		});
	});

test("result delivery attributes exact work even without a producer grant", async (t) => {
	const { context, attachment } = await fixture(t);
	selectedAttempt(attachment, resultIntent("work"));
	await context.runSelected("attempt", async () => assert.deepEqual(context.current(), { id: "work", revision: 1 }));
});

test("a task chain does not leak between invocations", async (t) => {
	const { context, attachment } = await fixture(t);
	await attachment.waits.registerWork("nested", "lane", 0);
	await context.run(work, async () => {
		await context.selectToolWork(otherWork, true);
		await context.selectToolWork({ id: "nested", actor: "lane", revision: 1 }, true);
	});
	// A later invocation starts with no retained parent from the previous chain.
	await context.run(otherWork, async () => {
		await attachment.waits.changeWork("other", "lane", 1, "completed", "Done", 1);
		assert.equal(await context.returnFromToolWork(), true);
		assert.equal(context.current(), undefined, "no parent leaks from the earlier turn");
	});
});

for (const rank of [2, 3, 6])
	test(`automated rank ${rank} falls back to branch work only when the host supplies it`, async (t) => {
		const plain = await fixture(t);
		await plain.attachment.waits.shareWork("work", "lane", 1, "bg", 1);
		selectedAttempt(plain.attachment, { ...resultIntent("work"), rank });
		await plain.context.runSelected("attempt", async () => {
			if (rank === 6) assert.deepEqual(plain.context.current(), { id: "work", revision: 2 });
			else assert.equal(plain.context.current(), undefined, "no branch identity is invented without a host supplier");
		});
	});

test("producer-bound attempts never borrow branch host work", async (t) => {
	const { context, attachment } = await fixture(t, { automatic: true });
	selectedAttempt(attachment, {
		id: "task-continuation",
		revision: "1",
		producer: "tasks",
		sequence: 0,
		rank: 4,
		independent: false,
		runnable: true,
		workId: "elsewhere",
		workRevision: "1",
	});
	await context.runSelected("attempt", async () =>
		assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope)),
	);
});

for (const boundary of ["attempt", "authority"])
	test(`unclassified selected work cannot cross a branch change during ${boundary} read`, async (t) => {
		const f = await fixture(t);
		const replacement = await fixture(t);
		selectedAttempt(f.attachment, { ...resultIntent("missing"), rank: 4 });
		const source = boundary === "attempt" ? f.attachment.ledger : f.attachment.waits;
		const method = boundary === "attempt" ? "snapshot" : "authoritySnapshot";
		const original = source[method].bind(source);
		source[method] = async () => {
			const state = await original();
			f.changeBranch(replacement.attachment);
			return state;
		};
		let invoked = false;
		await assert.rejects(
			f.context.runSelected("attempt", async () => {
				invoked = true;
			}),
			{ code: "stale" },
		);
		assert.equal(invoked, false);
	});

for (const rank of [4, 5])
	for (const state of ["paused", "completed", "stopped"])
		test(`producer rank ${rank} refuses ${state} work without borrowing branch authority`, async (t) => {
			const { context, attachment } = await fixture(t, { automatic: true });
			await attachment.waits.changeWork("work", "lane", 1, state, "Lifecycle fixture", 1);
			selectedAttempt(attachment, { ...resultIntent("work"), producer: "lane", rank });
			let invoked = false;
			await assert.rejects(
				context.runSelected("attempt", async () => {
					invoked = true;
				}),
				{ code: "transition" },
			);
			assert.equal(invoked, false);
			assert.equal(context.busy, false);
		});

for (const variant of ["valid", "foreign-work", "foreign-branch", "paused", "completed"])
	test(`wait-decision attribution validates its durable identity: ${variant}`, async (t) => {
		const { waitDecisionIntent } = await import("../dist/flow-control/wait-decisions.js");
		const { context, attachment } = await fixture(t, { automatic: true });
		const wait = {
			token: "wait",
			scope: attachment.ledger.scope,
			workId: "work",
			state: "expired",
			createdAt: 0,
			endedAt: 1,
		};
		const intent = waitDecisionIntent(wait);
		if (variant === "foreign-work") intent.workId = "other";
		if (variant === "foreign-branch")
			intent.id = waitDecisionIntent({ ...wait, scope: { ...wait.scope, branchId: "elsewhere" } }).id;
		attachment.waits.snapshot = async () => [wait];
		attachment.ledger.snapshot = async () => ({
			activeAttemptId: "attempt",
			attempts: [{ id: "attempt", phase: "queued", admission: { choice: { intent } } }],
		});
		if (["paused", "completed"].includes(variant))
			await attachment.waits.changeWork("work", "lane", 1, variant, "Lifecycle test", 1);
		const invoke = () =>
			context.runSelected("attempt", async () => {
				if (variant === "valid") assert.equal(context.current().id, "work");
				else assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope));
			});
		if (variant === "foreign-branch" || variant === "foreign-work") await assert.rejects(invoke(), { code: "stale" });
		else await invoke();
	});

test("a wait decision for finished work keeps its tools through branch work", async (t) => {
	const { waitDecisionIntent } = await import("../dist/flow-control/wait-decisions.js");
	const { context, attachment } = await fixture(t, { automatic: true });
	const wait = {
		token: "wait",
		scope: attachment.ledger.scope,
		workId: "work",
		state: "expired",
		createdAt: 0,
		endedAt: 1,
	};
	attachment.waits.snapshot = async () => [wait];
	selectedAttempt(attachment, waitDecisionIntent(wait));
	await attachment.waits.changeWork("work", "lane", 1, "completed", "Done", 1);
	await context.runSelected("attempt", async () =>
		assert.equal(context.current().id, automaticWorkId(attachment.ledger.scope)),
	);
});
