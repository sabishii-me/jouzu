import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assembledSession, capturedNotices } from "./fixtures/flow-assembly.mjs";
import { fixture, lifecycleProducer } from "./fixtures/flow-session-ingress.mjs";

test("flow reset permits another prompt after consumed input", async (t) => {
	const f = await assembledSession(t);
	const notices = capturedNotices(f.session);
	await f.session.prompt("First request");
	assert.equal(f.bodies.length, 1);
	await f.session.prompt("/flow reset confirm");
	assert.match(notices.at(-1).text, /Flow reset completed/);
	await f.session.prompt("After reset");
	assert.equal(f.bodies.length, 2);
	assert.equal(f.session.agent.state.errorMessage, undefined);
});

test("reset discards queued and deferred input without replay and keeps conversation history", async (t) => {
	const f = await fixture(t, { provider: true, admit: null });
	await f.session.prompt("keep this conversation");
	await f.session.followUp("discard queued input");
	await f.session.sendCustomMessage(
		{ customType: "note", content: "discard deferred input", display: false },
		{ deliverAs: "nextTurn" },
	);
	assert.ok(f.session.agent.inspectQueuedMessages().length > 0);
	await f.ingress.resetFlow();
	assert.deepEqual(f.session.agent.inspectQueuedMessages(), []);
	await f.session.prompt("new input");
	assert.equal(f.sent.length, 2);
	assert.match(JSON.stringify(f.sent[1]), /keep this conversation/);
	assert.doesNotMatch(JSON.stringify(f.sent[1]), /discard queued|discard deferred/);
	const authority = await f.ingress.branch().attachment.waits.authoritySnapshot();
	assert.ok(authority.work.some((work) => work.id === f.ingress.branch().workContext.current().id));
	await f.ingress.dispose();
	const next = await fixture(t, {
		root: f.root,
		provider: true,
		admit: null,
		manager: SessionManager.open(f.session.sessionManager.getSessionFile()),
	});
	await next.session.prompt("after reopen");
	assert.equal(next.sent.length, 1);
});

test("reset retires retained callbacks instead of leaving user priority or replay behind", async (t) => {
	let allow = false;
	const f = await fixture(t, { provider: true, admit: async () => allow });
	await f.session.prompt("discard retained input");
	const [held] = await f.ingress.branch().attachment.submissions.snapshot(false);
	assert.ok(held);
	await f.ingress.resetFlow();
	assert.equal(f.ingress.branch().host.gate().userPending, false);
	allow = true;
	await assert.rejects(f.ingress.release(held.id, held.revision), { code: "stale" });
	await f.ingress.releaseReady();
	await f.session.prompt("new user input");
	assert.equal(f.sent.length, 1);
	assert.doesNotMatch(JSON.stringify(f.sent), /discard retained input/);
});

for (const kind of ["native", "history", "wait-source"]) {
	test(`reset clears the shared ${kind} recovery gate before automatic work`, async (t) => {
		const f = await fixture(t, { provider: true, admit: null });
		const branch = f.ingress.branch();
		if (kind === "native") branch.sourceRecovery.unresolved = 1;
		if (kind === "history") branch.recovery.unresolved = 1;
		if (kind === "wait-source") branch.waitSourceRecovery.missing.push("missing-producer");
		assert.equal(branch.host.gate().recoveryBlocked, true);
		const reset = await f.ingress.resetFlow();
		assert.equal(reset.recoveryHeld, false);
		assert.equal(branch.host.gate().recoveryBlocked, false);
		branch.controller.register(lifecycleProducer());
		await branch.controller.wake();
		assert.equal(f.sent.length, 1);
	});
}
