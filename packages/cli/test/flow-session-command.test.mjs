import assert from "node:assert/strict";
import { test } from "node:test";
import { createFlowSession, deferred, model } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { PiHostBoundary } from "../dist/flow-control/pi-host-boundary.js";
import { fixture } from "./fixtures/flow-session-ingress.mjs";

// Commands can replace the session, so their handlers cannot own a native dispatch
// that disposal must join. Their model-bound sends still need their own admission.
test("a registered host command can dispose its session without an unfinished native dispatch", async (t) => {
	let session, ingress, outcome;
	const f = await fixture(t, {
		extensions: [
			(pi) =>
				pi.registerCommand("close-session", {
					handler: async () => {
						try {
							assert.deepEqual(await ingress.branch().attachment.submissions.snapshot(), []);
							await session.dispose();
							outcome = "closed";
						} catch (error) {
							outcome = error;
						}
					},
				}),
		],
	});
	({ session, ingress } = f);
	const reported = [];
	await session.prompt("/close-session", { preflightResult: (value) => reported.push(value) });
	assert.equal(outcome, "closed");
	assert.deepEqual(reported, ["handled"]);
	assert.equal(f.sent.length, 0);
	await session.dispose();
});

test("local commands release user priority without retaining input or work", async (t) => {
	let ingress;
	const pending = [];
	const f = await fixture(t, {
		extensions: [
			(pi) =>
				pi.registerCommand("local", {
					handler: () => pending.push(ingress.branch().host.gate().userPending),
				}),
		],
	});
	ingress = f.ingress;
	const before = (await ingress.branch().attachment.waits.authoritySnapshot()).work;
	await f.session.prompt("/local");
	await f.session.prompt("/local");
	assert.deepEqual(pending, [true, true]);
	assert.equal(ingress.branch().host.gate().userPending, false);
	assert.deepEqual(await ingress.branch().attachment.submissions.snapshot(), []);
	assert.deepEqual((await ingress.branch().attachment.waits.authoritySnapshot()).work, before);
	assert.equal(f.sent.length, 0);
});

test("control commands remain reachable while their sends and unknown slash input are held", async (t) => {
	let ran = 0;
	const f = await fixture(t, {
		admit: async () => false,
		extensions: [
			{
				name: "control",
				factory: (pi) =>
					pi.registerCommand("control", {
						handler: () => {
							ran++;
							pi.sendUserMessage("command message");
						},
					}),
			},
		],
	});
	await f.session.prompt("/control");
	await f.session.prompt("/unknown");
	await f.session.prompt("/control", { expandPromptTemplates: false });
	const records = await f.ingress.branch().attachment.submissions.snapshot();
	assert.equal(ran, 1);
	assert.deepEqual(
		records.map((record) => record.submission.args[0]),
		["command message", "/unknown", "/control"],
	);
	assert.ok(records.every((record) => record.dispatch === undefined));
	assert.equal(records[0].submission.userCommand.name, "control");
	assert.equal(records[0].submission.origin.id, "<inline:control>");
	assert.equal(records[1].submission.userCommand, undefined);
	assert.equal(records[2].submission.userCommand, undefined);
	assert.equal(f.sent.length, 0);
});

test("command disposal drains an independent admission before closing its storage", async (t) => {
	const entered = deferred(),
		release = deferred(),
		closing = deferred();
	t.after(() => release.resolve());
	let session, commandResult;
	const f = await fixture(t, {
		admit: async () => {
			entered.resolve();
			await release.promise;
			return true;
		},
		extensions: [
			(pi) =>
				pi.registerCommand("close", {
					handler: async () => {
						closing.resolve();
						try {
							await session.dispose();
							commandResult = "closed";
						} catch (error) {
							commandResult = error;
						}
					},
				}),
		],
	});
	session = f.session;
	const sending = assert.rejects(session.prompt("pending input"), { code: "stale" });
	await entered.promise;
	const command = session.prompt("/close");
	await closing.promise;
	assert.equal(commandResult, undefined);
	release.resolve();
	await Promise.all([sending, command]);
	assert.equal(commandResult, "closed");
	assert.equal(f.sent.length, 0);
});

test("command disposal joins an independent overlapping command without joining itself", async (t) => {
	const entered = deferred(),
		release = deferred(),
		closing = deferred();
	t.after(() => release.resolve());
	let session, outcome;
	const f = await fixture(t, {
		extensions: [
			(pi) => {
				pi.registerCommand("hold", {
					handler: async () => {
						entered.resolve();
						await release.promise;
					},
				});
				pi.registerCommand("close", {
					handler: async () => {
						try {
							await session.dispose();
							outcome = "closed";
						} catch (error) {
							outcome = error;
						}
					},
				});
			},
		],
	});
	session = f.session;
	const boundary = f.ingress.branch().host.boundary;
	const join = boundary.abortAndJoin.bind(boundary);
	t.mock.method(boundary, "abortAndJoin", () => {
		const result = join();
		closing.resolve();
		return result;
	});
	const holding = session.prompt("/hold");
	await entered.promise;
	const replacing = session.prompt("/close");
	await closing.promise;
	assert.equal(outcome, undefined);
	release.resolve();
	await Promise.all([holding, replacing]);
	assert.equal(outcome, "closed");
	await session.dispose();
	assert.equal(f.sent.length, 0);
});

test("a nested command callback cannot relinquish its parent's host boundary", async (t) => {
	let boundary, session, outcome;
	const seen = [];
	({ session } = await createFlowSession(t, {
		extensions: [
			(pi) => {
				pi.on("model_select", async () => {
					await assert.rejects(boundary.abortAndJoin(), { code: "busy" });
					await assert.rejects(session.dispose(), { code: "busy" });
					seen.push("nested refused");
				});
				pi.registerCommand("close", {
					handler: async () => {
						try {
							await session.setModel({ ...model, id: "other" });
							assert.deepEqual(await boundary.atIdle(async () => "usable"), { kind: "idle", value: "usable" });
							await session.dispose();
							await boundary.abortAndJoin();
							outcome = "closed";
						} catch (error) {
							outcome = error;
						}
					},
				});
			},
		],
	}));
	boundary = new PiHostBoundary(session);
	t.after(() => boundary.close());
	await session.prompt("/close");
	assert.deepEqual(seen, ["nested refused"]);
	assert.equal(outcome, "closed");
	await assert.rejects(session.prompt("after closure"), { code: "stale" });
	await boundary.abortAndJoin();
});

test("replacement reservations release on cancellation and failure across reload and navigation", async (t) => {
	const { session } = await fixture(t);
	const calls = [];
	const options = { parentSession: "fixture-parent" };
	await session.bindExtensions({
		commandContextActions: {
			newSession: async (received) => {
				calls.push(received);
				if (received?.fail) throw new Error("replacement failed before teardown");
				return { cancelled: true };
			},
			reload: () => session.reload(),
		},
	});
	const ctx = session.extensionRunner.createCommandContext();
	assert.deepEqual(await ctx.newSession(options), { cancelled: true });
	await assert.rejects(ctx.newSession({ fail: true }), /replacement failed before teardown/);
	assert.deepEqual(await ctx.newSession(options), { cancelled: true });
	await ctx.reload();
	const reloaded = session.extensionRunner.createCommandContext();
	assert.deepEqual(await reloaded.newSession(options), { cancelled: true });
	const target = session.sessionManager.appendMessage({ role: "user", content: "target", timestamp: 1 });
	session.sessionManager.appendMessage({ role: "user", content: "later", timestamp: 2 });
	await session.navigateTree(target);
	const navigated = session.extensionRunner.createCommandContext();
	assert.deepEqual(await navigated.newSession(options), { cancelled: true });
	assert.deepEqual(calls, [options, { fail: true }, options, options, options]);
});

for (const competing of ["newSession", "fork", "switchSession", "reload"]) {
	test(`replacement commands reserve teardown before ${competing} can emit shutdown`, async (t) => {
		const shutdownEntered = deferred(),
			releaseShutdown = deferred(),
			invalidated = deferred();
		const errors = [];
		const outcomes = [];
		let shutdowns = 0;
		const f = await fixture(t, {
			extensions: [
				(pi) => {
					pi.on("session_shutdown", async (_event, ctx) => {
						if (++shutdowns === 1) {
							shutdownEntered.resolve();
							await releaseShutdown.promise;
						} else {
							// Without the reservation, let the first teardown invalidate this
							// context while the competing shutdown handler is still running.
							releaseShutdown.resolve();
							await invalidated.promise;
						}
						assert.equal(ctx.mode, "rpc");
					});
					pi.registerCommand("replace", {
						handler: async (method, ctx) => {
							try {
								await ctx[method]();
								outcomes.push("replaced");
							} catch (error) {
								outcomes.push(error.code);
							} finally {
								releaseShutdown.resolve();
							}
						},
					});
				},
			],
		});
		const { session } = f;
		const runner = session.extensionRunner;
		const invalidate = runner.invalidate.bind(runner);
		t.mock.method(runner, "invalidate", (...args) => {
			invalidate(...args);
			invalidated.resolve();
		});
		// Match AgentSessionRuntime teardown: shutdown handlers precede disposal.
		const replace = async () => {
			await runner.emit({ type: "session_shutdown", reason: "new" });
			await session.dispose();
			return { cancelled: false };
		};
		await session.bindExtensions({
			mode: "rpc",
			onError: (error) => errors.push(error),
			commandContextActions: {
				newSession: replace,
				fork: replace,
				switchSession: replace,
				reload: replace,
			},
		});
		const first = session.prompt("/replace newSession");
		await shutdownEntered.promise;
		const second = session.prompt(`/replace ${competing}`);
		await Promise.all([first, second]);
		assert.deepEqual(errors, []);
		assert.equal(shutdowns, 1);
		assert.deepEqual(outcomes.sort(), ["busy", "replaced"]);
		assert.equal(f.sent.length, 0);
	});
}

test("overlapping commands cannot join each other's session disposal", { timeout: 10000 }, async (t) => {
	const release = deferred(),
		bothEntered = deferred();
	let session,
		entered = 0;
	const outcomes = [];
	const f = await fixture(t, {
		extensions: [
			(pi) =>
				pi.registerCommand("close", {
					handler: async () => {
						if (++entered === 2) bothEntered.resolve();
						await release.promise;
						try {
							await session.dispose();
							outcomes.push("closed");
						} catch (error) {
							outcomes.push(error.code);
						}
					},
				}),
		],
	});
	session = f.session;
	const first = session.prompt("/close");
	const second = session.prompt("/close");
	await bothEntered.promise;
	release.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(outcomes.sort(), ["busy", "closed"]);
	await session.dispose();
	assert.equal(f.sent.length, 0);
});
