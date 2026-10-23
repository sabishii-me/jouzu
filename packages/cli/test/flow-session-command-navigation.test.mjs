import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { test } from "node:test";
import { createFlowSession, deferred, model } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { fixture } from "./fixtures/flow-session-ingress.mjs";

async function navigationFixture(t, { extensions = [], ...options } = {}) {
	const outcomes = [];
	const targets = [];
	const f = await fixture(t, {
		autoRelease: false,
		...options,
		extensions: [
			(pi) =>
				pi.registerCommand("navigate-local", {
					handler: async (args, ctx) => {
						try {
							for (const index of args.split(" "))
								outcomes.push(await ctx.navigateTree(targets[Number(index)], { summarize: false }));
						} catch (error) {
							outcomes.push(error);
						}
					},
				}),
			...extensions,
		],
	});
	for (let index = 0; index < 2; index++)
		targets.push(f.session.sessionManager.appendCustomEntry("navigation-anchor", { index }));
	f.session.sessionManager.appendCustomEntry("navigation-tail", {});
	await f.session.bindExtensions({
		commandContextActions: {
			navigateTree: (target, options) => f.session.navigateTree(target, options),
		},
	});
	return { ...f, outcomes, targets };
}

for (const enabled of [true, false])
	test(`a command can await repeated tree navigation with flow ${enabled ? "on" : "off"}`, async (t) => {
		const f = await navigationFixture(t);
		if (!enabled) await f.ingress.suspend();
		const original = f.ingress.branch();
		const oldPrompt = f.session.prompt.bind(f.session);
		await f.session.prompt("/navigate-local 0 1");
		assert.equal(f.outcomes.length, 2);
		assert.ok(
			f.outcomes.every((outcome) => outcome.cancelled === false),
			String(f.outcomes),
		);
		assert.notEqual(f.ingress.branch().scope.branchId, original.scope.branchId);
		assert.throws(() => original.host.atIdle(async () => {}), { code: "stale" });
		await assert.rejects(oldPrompt("stale input"), { code: "stale" });
		assert.deepEqual(await f.ingress.branch().host.atIdle(async () => "usable"), { kind: "idle", value: "usable" });
		assert.equal(f.sent.length, 0);
		await f.session.prompt("new branch input");
		assert.equal(f.sent.length, 1);
	});

test("an awaited command continuation uses the new branch but ended callbacks retain their old fence", async (t) => {
	let f, late, outcome;
	f = await navigationFixture(t, {
		extensions: [
			(pi) =>
				pi.registerCommand("navigate-and-send", {
					handler: async (_args, ctx) => {
						late = AsyncLocalStorage.snapshot();
						try {
							await ctx.navigateTree(f.targets[0], { summarize: false });
							await f.session.prompt("input after navigation");
							outcome = "completed";
						} catch (error) {
							outcome = error;
						}
					},
				}),
		],
	});
	await f.session.prompt("/navigate-and-send");
	assert.equal(outcome, "completed");
	assert.equal(f.sent.length, 1);
	const branch = f.ingress.branch();
	const records = await branch.attachment.submissions.snapshot();
	await assert.rejects(
		late(() => f.session.prompt("late old-branch input")),
		/replaced attachment/,
	);
	assert.deepEqual(await branch.attachment.submissions.snapshot(), records);
	assert.equal(f.sent.length, 1);
	assert.equal((await branch.host.atIdle(async () => {})).kind, "idle");
});

test("a captured input dispatch cannot follow a live command across navigation", async (t) => {
	let session, target, retained, outcome;
	({ session } = await createFlowSession(t, {
		ingress: {
			version: 1,
			submit: (_submission, dispatch) => {
				retained = dispatch;
			},
		},
		extensions: [
			(pi) =>
				pi.registerCommand("navigate-held", {
					handler: async (_args, ctx) => {
						try {
							await session.prompt("retained before navigation");
							await ctx.navigateTree(target, { summarize: false });
							await assert.rejects(retained(), /replaced attachment/);
							outcome = "fenced";
						} catch (error) {
							outcome = error;
						}
					},
				}),
		],
	}));
	target = session.sessionManager.appendCustomEntry("anchor", {});
	session.sessionManager.appendCustomEntry("tail", {});
	await session.bindExtensions({
		commandContextActions: {
			navigateTree: (target, options) => session.navigateTree(target, options),
		},
	});
	await session.prompt("/navigate-held");
	assert.equal(outcome, "fenced");
});

test("native tree navigation remains a separate successful control", async (t) => {
	const f = await navigationFixture(t);
	const original = f.ingress.branch();
	assert.equal((await f.session.navigateTree(f.targets[0], { summarize: false })).cancelled, false);
	assert.notEqual(f.ingress.branch().scope.branchId, original.scope.branchId);
	assert.equal((await f.ingress.branch().host.atIdle(async () => {})).kind, "idle");
	assert.equal(f.sent.length, 0);
});

test("cancelled command navigation retains the attachment and permits another navigation", async (t) => {
	let cancel = true;
	const f = await navigationFixture(t, {
		extensions: [(pi) => pi.on("session_before_tree", () => ({ cancel }))],
	});
	const original = f.ingress.branch();
	const leaf = f.session.sessionManager.getLeafId();
	await f.session.prompt("/navigate-local 0");
	assert.deepEqual(f.outcomes, [{ cancelled: true }]);
	assert.equal(f.ingress.branch(), original);
	assert.equal(f.session.sessionManager.getLeafId(), leaf);
	assert.equal((await original.host.atIdle(async () => {})).kind, "idle");
	cancel = false;
	await f.session.prompt("/navigate-local 1");
	assert.equal(f.outcomes[1].cancelled, false, String(f.outcomes[1]));
	assert.equal(f.sent.length, 0);
});

for (const busy of ["queued input", "overlapping command"])
	test(`command navigation refuses ${busy} before callbacks or branch mutation`, async (t) => {
		const entered = deferred(),
			release = deferred();
		t.after(() => release.resolve());
		let callbacks = 0;
		const f = await navigationFixture(t, {
			extensions: [
				(pi) => {
					pi.on("session_before_tree", () => {
						callbacks++;
					});
					pi.registerCommand("hold-local", {
						handler: async () => {
							entered.resolve();
							await release.promise;
						},
					});
				},
			],
		});
		const original = f.ingress.branch();
		const leaf = f.session.sessionManager.getLeafId();
		let holding, queued;
		if (busy === "queued input") queued = f.session.agent.followUp({ role: "user", content: "queued", timestamp: 1 });
		else {
			holding = f.session.prompt("/hold-local");
			await entered.promise;
		}
		await f.session.prompt("/navigate-local 0");
		assert.equal(f.outcomes[0].code, "busy", String(f.outcomes[0]));
		assert.equal(callbacks, 0);
		assert.equal(f.ingress.branch(), original);
		assert.equal(f.session.sessionManager.getLeafId(), leaf);
		if (queued) f.session.agent.cancelQueuedMessage(queued.id, queued.revision);
		release.resolve();
		await holding;
		assert.equal((await original.host.atIdle(async () => {})).kind, "idle");
		await f.session.prompt("usable after refusal");
		assert.equal(f.sent.length, 1);
	});

test("operations waiting behind maintenance recheck the navigation reservation", async (t) => {
	const maintenanceEntered = deferred(),
		releaseMaintenance = deferred();
	const navigationEntered = deferred(),
		releaseNavigation = deferred();
	t.after(() => {
		releaseMaintenance.resolve();
		releaseNavigation.resolve();
	});
	const f = await navigationFixture(t, {
		extensions: [
			(pi) =>
				pi.on("session_before_tree", async () => {
					navigationEntered.resolve();
					await releaseNavigation.promise;
					return { cancel: true };
				}),
		],
	});
	const maintenance = f.ingress.branch().host.atIdle(async () => {
		maintenanceEntered.resolve();
		await releaseMaintenance.promise;
	});
	await maintenanceEntered.promise;
	const navigating = f.session.navigateTree(f.targets[0], { summarize: false });
	const changing = assert.rejects(f.session.setModel({ ...model, id: "other" }), { code: "busy" });
	releaseMaintenance.resolve();
	await navigationEntered.promise;
	await changing;
	releaseNavigation.resolve();
	assert.equal((await navigating).cancelled, true);
	await maintenance;
	assert.equal((await f.ingress.branch().host.atIdle(async () => {})).kind, "idle");
});

test("navigation preparation fences new host work and native queue writes until cancellation", async (t) => {
	const entered = deferred(),
		release = deferred();
	t.after(() => release.resolve());
	const f = await navigationFixture(t, {
		extensions: [
			(pi) =>
				pi.on("session_before_tree", async () => {
					entered.resolve();
					await release.promise;
					return { cancel: true };
				}),
		],
	});
	const original = f.ingress.branch();
	const navigating = f.session.prompt("/navigate-local 0");
	await entered.promise;
	await assert.rejects(f.session.setModel({ ...model, id: "other" }), { code: "busy" });
	await assert.rejects(f.session.prompt("concurrent input"), { code: "busy" });
	assert.throws(() => f.session.agent.followUp({ role: "user", content: "late queue", timestamp: 1 }), {
		code: "busy",
	});
	release.resolve();
	await navigating;
	assert.deepEqual(f.outcomes, [{ cancelled: true }]);
	assert.equal(f.ingress.branch(), original);
	assert.equal(f.session.agent.hasQueuedMessages(), false);
	await f.session.prompt("usable after cancellation");
	assert.equal(f.sent.length, 1);
});
