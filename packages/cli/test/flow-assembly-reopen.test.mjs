import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getShellConfig } from "../node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js";
import {
	afterFlowCleanup,
	assembledSession,
	installedProducerExtensions,
	replacedSession,
} from "./fixtures/flow-assembly.mjs";
import { controlledBackground } from "./fixtures/flow-background-gate.mjs";
import { campaignScript, liveWait } from "./fixtures/flow-campaign.mjs";

const idle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Guards against a missing event, not a speed check: a loaded runner can take seconds per turn.
const until = async (predicate, label, timeoutMs = 30_000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await idle(10);
	}
	assert.fail(`timed out waiting for ${label}`);
};
const settled = (session) => session.isIdle && !session.isStreaming;

async function persistentRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-flow-reopen-"));
	afterFlowCleanup(t, () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
	return root;
}

/** Drive one campaign to a live wait, then tear the session down the way a reopen does. */
async function campaignThenReopen(t) {
	const root = await persistentRoot(t);
	const producers = await installedProducerExtensions();
	const background = await controlledBackground(t);
	const first = await assembledSession(t, {
		root,
		persist: true,
		producerExtensions: producers,
		script: campaignScript({ command: background.command, goal: "Survive a reopen" }),
	});
	await first.session.prompt("start the sweep and wait");

	const before = first.ingress.branch();
	const wait = await liveWait(first.ingress, "one live wait before the teardown");
	await background.started;
	const authorityBefore = await before.attachment.waits.authoritySnapshot();
	const campaign = authorityBefore.work.find((work) => work.owner === "multiloop");
	assert.ok(campaign, "the lane registered campaign work");

	const sessionFile = first.session.sessionManager.getSessionFile();
	// `AgentSessionRuntime.teardownCurrent` emits this before it opens the next session file.
	await first.shutdown("resume", sessionFile);

	const next = await assembledSession(t, {
		root,
		persist: true,
		producerExtensions: producers,
		sessionManager: SessionManager.open(sessionFile),
	});
	return { root, first, next, campaign, wait, before };
}

test("fixture cleanup joins a surviving background child before removing its working directory", async (t) => {
	let cleanup;
	const scope = {
		after: (callback) => {
			cleanup = callback;
		},
	};
	const root = await persistentRoot(scope);
	const background = await controlledBackground(scope);
	const { shell, args, commandTransport } = getShellConfig();
	const child = spawn(shell, commandTransport === "stdin" ? args : [...args, background.command], {
		cwd: root,
		detached: process.platform !== "win32",
		stdio: ["pipe", "ignore", "ignore"],
	});
	const exited = once(child, "exit");
	child.stdin.end(commandTransport === "stdin" ? `${background.command}\n` : undefined);
	t.after(async () => {
		// Reap the test-owned process even if the cleanup assertion fails.
		if (child.exitCode === null && child.signalCode === null) {
			if (process.platform === "win32") {
				const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
					encoding: "utf8",
					timeout: 10_000,
					windowsHide: true,
				});
				assert.equal(stopped.status, 0, stopped.error?.message ?? stopped.stderr);
			} else process.kill(-child.pid, "SIGKILL");
		}
		await exited;
		await background.close();
		await rm(root, { recursive: true, force: true });
	});
	await Promise.race([
		background.started,
		exited.then(() => assert.fail("the controlled child exited before the teardown regression")),
	]);
	assert.equal(child.exitCode, null, "the command is live without a producer shutdown hook");
	await cleanup();
	assert.deepEqual(await exited, [0, null]);
	assert.equal(existsSync(root), false, "shared cleanup removed the child's working directory");
});

test("a campaign, its wait, and its original deadline survive a reopen", async (t) => {
	const { first, next, campaign, wait, before } = await campaignThenReopen(t);
	const after = next.ingress.branch();
	assert.equal(after.scope.sessionId, before.scope.sessionId, "the reopened branch keeps its scope");

	const authorityAfter = await after.attachment.waits.authoritySnapshot();
	const restored = authorityAfter.work.find((work) => work.id === campaign.id);
	assert.ok(restored, "the campaign work survives reopen");
	assert.equal(restored.owner, "multiloop", "its owning producer survives with it");

	const waitsAfter = await after.attachment.waits.snapshot();
	const restoredWait = waitsAfter.find((record) => record.token === wait.token);
	assert.ok(restoredWait, "the wait token survives reopen");
	assert.equal(restoredWait.expiresAt, wait.expiresAt, "the original deadline is preserved, not restarted");
	assert.equal(restoredWait.workId, wait.workId, "the wait stays bound to the campaign work");
	assert.deepEqual(first.errors, []);
	assert.deepEqual(next.errors, []);
});

test("a shutdown-terminated dependency delivers one decision after reopen and never replays", async (t) => {
	const { next, wait } = await campaignThenReopen(t);
	// The task extension kills every running task on session_shutdown, whatever its reason, so the
	// wait is decided while no session can receive it. The decision must survive to the next one.
	const decisions = () =>
		next.bodies.map((body) => JSON.stringify(body.messages.at(-1))).filter((text) => text.includes('kind\\":\\"wait'));
	// The wake turn must finish first: a plain prompt while the agent is streaming is rejected by Pi.
	await until(() => decisions().length > 0 && settled(next.session), "the reopened session to deliver the decision");
	const delivered = decisions();
	assert.equal(delivered.length, 1, "the pending wait decision is delivered exactly once after reopen");
	assert.ok(delivered[0].includes(wait.token), "it carries the original wait token");
	assert.ok(
		delivered[0].includes('kind\\":\\"result'),
		"the terminated execution's result composes into the same wake",
	);

	// A new user turn and the active loop's work turns are not replayed wait decisions.
	await next.session.prompt("continue after the wait decision");
	await until(() => settled(next.session), "the user turn to finish");
	await idle(300);
	assert.deepEqual(
		decisions(),
		delivered,
		`a delivered decision is not replayed on later turns: ${JSON.stringify({
			appended: next.bodies.map((body) => body.messages.at(-1)),
			attempts: (await next.ingress.branch().attachment.ledger.snapshot()).attempts,
		})}`,
	);
	assert.deepEqual(next.errors, []);
});

/**
 * Session replacement through the host's own sequence. `/new`, resume, session switch, fork, and
 * rewind all tear the current session down and then ask the flow runtime for a fresh ingress. Every
 * one of them aborted while the runtime refused that second call, and the assembly suite had
 * asserted the refusal as intended, so nothing caught it. These drive the sequence instead.
 */
for (const reason of ["new", "resume"]) {
	test(`flow control keeps working across a ${reason} session replacement`, async (t) => {
		const root = await persistentRoot(t);
		const first = await assembledSession(t, { root, persist: true });
		await first.session.prompt("work in the first session");
		const before = first.ingress.branch();
		assert.equal((await before.attachment.submissions.snapshot()).length, 1);

		const next = await replacedSession(t, first, { reason, persist: true });
		assert.notEqual(next.ingress, first.ingress, "the replacement gets its own ingress");
		assert.notEqual(
			next.ingress.branch().scope.sessionId,
			before.scope.sessionId,
			"and its own session scope, so the two sessions never share retained state",
		);

		// The point of the whole exercise: input still reaches the provider afterwards.
		await next.session.prompt("work in the replacement session");
		const records = await next.ingress.branch().attachment.submissions.snapshot();
		assert.equal(records.length, 1, "the replacement starts with only its own input");
		assert.equal(records[0].dispatch.phase, "returned");
		assert.ok(
			JSON.stringify(next.bodies).includes("work in the replacement session"),
			"the prompt was transmitted, not held",
		);
		// The outgoing session is closed rather than left admitting in the background.
		assert.throws(() => first.ingress.releaseReady(), { code: "stale" });
	});
}

test("a replacement session accepts automated input once its own producers are ready", async (t) => {
	const root = await persistentRoot(t);
	const producers = await installedProducerExtensions();
	const first = await assembledSession(t, { root, persist: true, producerExtensions: producers });
	await first.session.prompt("work in the first session");

	const next = await replacedSession(t, first, { reason: "new", persist: true, producerExtensions: producers });
	// An extension follow-up is the shape a task list uses to hand back its next task. It must be
	// admitted in the new session, since the starvation gates are rebuilt along with the ingress.
	await next.session.sendUserMessage("Continue by working on the next task", { deliverAs: "followUp" });
	const automated = (await next.ingress.branch().attachment.submissions.snapshot()).find(
		(record) => record.submission.args[0] === "Continue by working on the next task",
	);
	assert.ok(automated, "the automated send was captured by the replacement's ingress");
	assert.ok(automated.dispatch, "and dispatched rather than held by state from the replaced session");
});
