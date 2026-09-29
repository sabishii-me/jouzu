import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { registerCompactionRequest } from "../dist/compaction-request.js";
import { assembledSession, installedProducerExtensions, syntheticProducer } from "./fixtures/flow-assembly.mjs";

test("a goal continues after requested compaction and a host-owned tool turn", { timeout: 15000 }, async (t) => {
	let compactions = 0;
	const done = deferred();
	const f = await assembledSession(t, {
		persist: true,
		settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
		producerExtensions: [
			...(await installedProducerExtensions({ freshMultiloop: true })),
			{
				name: "goal-requested-compaction",
				factory(pi) {
					registerCompactionRequest(pi);
					pi.on("session_before_compact", (event) => {
						compactions++;
						return {
							compaction: {
								summary: "The goal is unfinished. Continue the next experiment.",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			},
		],
		script: (_body, index) => {
			if (index === 0) return { toolCalls: [{ name: "compact_context", arguments: {} }] };
			if (index === 1) return { text: "One experiment is recorded; others remain." };
			if (index === 2)
				return {
					toolCalls: [
						{
							name: "bg_task",
							arguments: { action: "spawn", command: "echo next", notifyOnExit: false, notifyOnOutput: false },
						},
					],
				};
			if (index === 3) return { text: "The next experiment is recorded; the goal remains open." };
			if (index === 4)
				return { toolCalls: [{ name: "multiloop_stop", arguments: { target: "complete-every-experiment" } }] };
			done.resolve();
			return { text: "Fixture stopped." };
		},
	});
	await f.session.prompt("/goal Complete every experiment");
	await done.promise;
	await f.session.waitForIdle();
	assert.equal(compactions, 1);
	assert.equal(f.bodies.length, 6);
	const results = f.session.messages.filter((message) => message.role === "toolResult");
	assert.ok(
		results.every((message) => !message.isError),
		JSON.stringify(results),
	);
	const ledger = await f.ingress.branch().attachment.ledger.snapshot();
	assert.ok(ledger.attempts.some((attempt) => attempt.admission?.choice.intent.producer === "host-automatic"));
	assert.ok(JSON.stringify(f.bodies[4]).includes("Continue the active quick goal"));
	assert.deepEqual(f.errors, []);
});

for (const keepTail of [true, false])
	for (const repairLegacyFailure of [false, true])
		test(`mid-run compaction continues without replay: repairLegacyFailure=${repairLegacyFailure}, keepTail=${keepTail}`, {
			timeout: 20000,
		}, async (t) => {
			let compactions = 0;
			const f = await assembledSession(t, {
				persist: true,
				settings: { compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 7505 } },
				producerExtensions: [
					...(await installedProducerExtensions()),
					{
						name: "split-turn-compaction",
						factory(pi) {
							pi.registerTool({
								name: "large_result",
								label: "Large result",
								description: "Return fixture data.",
								parameters: { type: "object", properties: {} },
								async execute() {
									return { content: [{ type: "text", text: "data ".repeat(6000) }], details: {} };
								},
							});
							pi.on("session_before_compact", (event) => {
								compactions++;
								const firstKept = event.branchEntries.findLast(
									(entry) => entry.type === "message" && entry.message.role === "assistant",
								);
								return {
									compaction: {
										summary: "Continue fixture work after the completed tool.",
										firstKeptEntryId: keepTail ? firstKept.id : "",
										tokensBefore: event.preparation.tokensBefore,
									},
								};
							});
						},
					},
				],
				script: [
					{ text: "Ready." },
					{ toolCalls: [{ name: "large_result", arguments: {} }] },
					{ toolCalls: [{ name: "large_result", arguments: {} }] },
					{ text: "Finished after two compactions." },
				],
			});
			await f.session.prompt("Run the fixture work.");
			const producer = syntheticProducer();
			const registration = f.ingress.registerProducer(producer.producer);
			t.after(() => registration.dispose());
			producer.offer([{ id: "compact-work", revision: "1" }]);
			const ledger = f.ingress.branch().attachment.ledger;
			const prepare = ledger.prepare.bind(ledger);
			if (repairLegacyFailure) t.mock.method(ledger, "prepare", (...args) => prepare(...args.slice(0, 4)));
			await registration.changed();
			await f.session.waitForIdle();
			if (repairLegacyFailure) {
				assert.equal(f.bodies.length, 2);
				assert.match(f.session.agent.state.errorMessage, /Composed model input was withheld after transformation/);
				assert.ok(f.ingress.automatedPause());
				ledger.prepare.mock.restore();
				await f.session.prompt("/flow clear");
				assert.equal(f.bodies.length, 2, "reset does not replay requests");
				await f.session.prompt("/flow resume");
				producer.offer([{ id: "compact-work", revision: "2" }]);
				await registration.changed();
				await f.session.waitForIdle();
			}
			assert.equal(f.bodies.length, 4, f.session.agent.state.errorMessage);
			assert.ok(compactions >= 2);
			assert.ok(JSON.stringify(f.bodies[1]).includes("work compact-work"));
			assert.ok(!JSON.stringify(f.bodies[3]).includes("work compact-work"));
			assert.equal(f.ingress.automatedPause(), undefined);
			const attempts = (await ledger.snapshot()).attempts;
			assert.equal(attempts.length, repairLegacyFailure ? 2 : 1);
			const completed = attempts.at(-1);
			assert.equal(completed.outcome, "success");
			assert.equal(completed.requests.length, repairLegacyFailure ? 2 : 3);
			assert.deepEqual(
				completed.requests.map((r) => r.inclusion[0].disposition),
				repairLegacyFailure ? ["included", "omitted"] : ["included", "omitted", "omitted"],
			);
			assert.ok(completed.requests.every((r) => r.handedOff && r.outcome === "success"));
			assert.deepEqual(f.errors, []);
		});

for (const rounds of [1, 2])
	test(`requested compaction resumes with tool ownership: rounds=${rounds}`, {
		timeout: 20000,
	}, async (t) => {
		let compactions = 0;
		const f = await assembledSession(t, {
			persist: true,
			settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
			producerExtensions: [
				...(await installedProducerExtensions()),
				{
					name: "requested-compaction",
					factory(pi) {
						registerCompactionRequest(pi);
						pi.on("session_before_compact", (event) => {
							compactions++;
							return {
								compaction: {
									summary: "Continue the current work.",
									firstKeptEntryId: event.preparation.firstKeptEntryId,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
					},
				},
			],
			script: [
				...Array.from({ length: rounds }, () => [
					{ toolCalls: [{ name: "compact_context", arguments: {} }] },
					{ text: "Continuing after compaction." },
					{
						toolCalls: [
							{
								name: "bg_task",
								arguments: { action: "spawn", command: "echo resumed", notifyOnExit: false, notifyOnOutput: false },
							},
						],
					},
				]).flat(),
				{ text: "Resumed." },
			],
		});
		await f.session.prompt("Do the work, compact, and continue.");
		const deadline = Date.now() + 5000;
		while (f.bodies.length < rounds * 3 + 1 && !f.ingress.automatedPause() && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		await f.session.waitForIdle();
		await f.ingress.wakeProducers();
		assert.equal(compactions, rounds);
		assert.equal(f.bodies.length, rounds * 3 + 1, f.session.agent.state.errorMessage);
		const results = f.sessionManager
			.getBranch()
			.filter((entry) => entry.type === "message")
			.map((entry) => entry.message)
			.filter((message) => message.role === "toolResult" && message.toolName === "bg_task");
		assert.equal(results.length, rounds);
		for (const result of results) {
			assert.equal(result.isError, false, JSON.stringify(result.content));
			assert.match(result.details.task.flow.work.id, /^automatic:/);
		}
		assert.ok(JSON.stringify(f.bodies[2].messages).includes("Continue the current work from the compaction summary."));
		const receipts = await f.ingress.branch().attachment.ledger.snapshot();
		assert.equal(
			receipts.attempts.filter(
				(attempt) => attempt.admission?.choice.intent.producer === "host-automatic" && attempt.outcome === "success",
			).length,
			rounds,
		);
		assert.equal(f.ingress.automatedPause(), undefined);
		assert.equal(f.ingress.branch().attachment.nativeRequests.recoveryBlocked, false);
		assert.deepEqual(f.errors, []);
	});
