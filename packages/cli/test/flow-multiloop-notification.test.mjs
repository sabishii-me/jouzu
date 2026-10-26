import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantToolCalls, deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { createNotificationInbox } from "../dist/notifications/inbox.js";
import { assembledSession, capturedNotices, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

const text = (message) =>
	typeof message?.content === "string"
		? message.content
		: (message?.content ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join(" ");

test("a notification-only acknowledgement does not strand the attached goal", { timeout: 15_000 }, async (t) => {
	const records = [];
	const errors = [];
	const inbox = { current: undefined };
	const acknowledged = { result: undefined, error: undefined };
	const notificationRequests = [];
	const unexpected = [];
	let observed;
	const done = deferred();
	let flow;
	let notices;
	let goalTarget;

	flow = await assembledSession(t, {
		producerExtensions: [
			...(await installedProducerExtensions({ freshMultiloop: true })),
			{
				name: "fixture-retention-order",
				factory(pi) {
					let firstEnd = true;
					pi.on("agent_end", async () => {
						if (!firstEnd) return;
						firstEnd = false;
						const branch = flow.ingress.branch();
						const state = await branch.attachment.ledger.snapshot();
						const attempt = state.attempts.find((item) => item.id === state.activeAttemptId);
						observed = {
							phase: attempt?.phase,
							producer: attempt?.admission?.choice.intent.producer,
							revision: attempt?.admission?.choice.intent.revision,
						};
						// The installed loop has submitted its successor, but the host has not settled
						// its current attempt. Retention reads must not freeze the successor's revision.
						await branch.controller.retentionReferences();
					});
				},
			},
			{
				name: "fixture-notification",
				factory(pi) {
					const created = createNotificationInbox({
						pi,
						customType: "fixture-notification",
						records: () => records,
						save: (id, change) =>
							Object.assign(
								records.find((record) => record.id === id),
								change,
							),
						observed: () => new Set(),
						build: (batchId) => ({ content: `Notification ${batchId}`, display: true, details: {} }),
						reportError: (error) => errors.push(error),
					});
					inbox.current = created;
					pi.on("session_start", (_event, ctx) => created.start(ctx));
					pi.registerTool({
						name: "ack_notification",
						label: "Acknowledge notification",
						description: "Acknowledge the notification batch delivered in this run.",
						parameters: {
							type: "object",
							properties: { batchId: { type: "string" } },
							required: ["batchId"],
						},
						execute: async (_id, params) => {
							try {
								acknowledged.result = created.acknowledge(params.batchId);
							} catch (error) {
								acknowledged.error = error;
							}
							return acknowledged.result ?? { content: [{ type: "text", text: "Acknowledgement failed." }] };
						},
					});
				},
			},
		],
		script: (body, index) => {
			const last = text(body.messages.at(-1));
			const target = notices
				.find((notice) => notice.text.startsWith("Goal started:"))
				?.text.match(/Goal started: (\S+)/)?.[1];
			assert.ok(target, "the fixture uses the goal identity returned by the installed extension");
			goalTarget = target;
			if (index === 0) {
				// The goal's first continuation is running; a notification arrives during that turn.
				records.push({ id: "run-1", revision: "terminal-1", handled: false });
				inbox.current.request();
				return assistantToolCalls({
					name: "multiloop_log",
					arguments: {
						lane: target.split("/")[0],
						action: "log",
						note: `Unit ${index} finished; more remains.`,
					},
				});
			}
			if (index === 1 || index === 4) return { text: "This unit is finished; the goal remains open." };
			if (index === 2) {
				const batch = last.match(/^Notification ([0-9a-f-]{36})$/)?.[1];
				if (batch) {
					notificationRequests.push(index);
					return assistantToolCalls({ name: "ack_notification", arguments: { batchId: batch } });
				}
			}
			if (index === 3) {
				return assistantToolCalls({
					name: "multiloop_log",
					arguments: {
						lane: target.split("/")[0],
						action: "log",
						note: `Unit ${index} finished; more remains.`,
					},
				});
			}
			if (index === 5) return assistantToolCalls({ name: "multiloop_stop", arguments: { target } });
			if (index === 6) {
				done.resolve();
				return { text: "Fixture stopped." };
			}
			unexpected.push({ index, last: last.slice(0, 160) });
			return { text: "Unexpected request." };
		},
	});
	notices = capturedNotices(flow.session);

	await flow.session.prompt("/goal Finish the notification campaign");
	// Pre-fix the successor is pinned to its predecessor's revision and filtered, so the loop
	// never reaches its stop turn and this barrier times out instead of advancing.
	await done.promise;
	await flow.session.waitForIdle();
	await flow.ingress.joinPendingOperations();

	assert.deepEqual(observed, { phase: "running", producer: "multiloop", revision: "1" });
	assert.equal(acknowledged.error, undefined);
	assert.equal(acknowledged.result?.terminate, true, "the production inbox acknowledgement ends that turn");
	assert.equal(records[0].handled, true, "the acknowledged notification is marked handled");
	assert.deepEqual(notificationRequests, [2], "the notification is delivered in its own turn");
	assert.equal(flow.bodies.length, 7, "the goal advances through two continuations and an explicit stop");
	const attempts = (await flow.ingress.branch().attachment.ledger.snapshot()).attempts;
	const loops = attempts.filter((attempt) => attempt.admission?.choice.intent.producer === "multiloop");
	assert.deepEqual(
		loops.map((attempt) => attempt.admission.choice.intent.revision),
		["1", "2", "3"],
		"the continuation after the acknowledged notification keeps the next revision",
	);
	assert.ok(loops.every((attempt) => attempt.phase === "settled" && attempt.outcome === "success"));
	const resumed = JSON.parse(text(flow.bodies[3].messages.at(-1)));
	assert.equal(resumed.kind, "work");
	assert.match(resumed.content, /Continue the active quick goal/);
	assert.ok(resumed.content.includes(goalTarget));
	const results = flow.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
		.map((entry) => entry.message);
	assert.ok(
		results.every((result) => !result.isError),
		JSON.stringify(results),
	);
	const logs = results.filter((result) => result.toolName === "multiloop_log");
	assert.equal(logs.length, 2);
	assert.ok(logs.every((result) => /Recorded log iteration/.test(JSON.stringify(result.content))));
	const notificationTurn = flow.session.messages.find(
		(message) => message.role === "custom" && message.customType === "fixture-notification",
	);
	const notificationReply = flow.session.messages[flow.session.messages.indexOf(notificationTurn) + 1];
	assert.equal(
		notificationReply?.content.some((part) => part.type === "text"),
		false,
		"the acknowledgement turn produces no assistant reply",
	);
	assert.equal(
		notificationReply?.content.some((part) => part.type === "toolCall" && part.name === "ack_notification"),
		true,
	);
	assert.deepEqual(unexpected, []);
	assert.deepEqual(errors, []);
	assert.deepEqual(flow.errors, []);
});
