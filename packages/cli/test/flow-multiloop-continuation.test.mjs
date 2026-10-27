import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantToolCalls, deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { registerCompactionRequest } from "../dist/compaction-request.js";
import { assembledSession, capturedNotices, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

for (const compact of [false, true])
	test(`a goal advances after a pre-settlement retention snapshot: compaction=${compact}`, {
		timeout: 15000,
	}, async (t) => {
		let f;
		let notices;
		let firstEnd = true;
		let observedPhase;
		let compactions = 0;
		const done = deferred();
		f = await assembledSession(t, {
			persist: true,
			settings: { compaction: { enabled: false, keepRecentTokens: 1 } },
			producerExtensions: [
				...(await installedProducerExtensions({ freshMultiloop: true })),
				{
					name: "continuation-retention-order",
					factory(pi) {
						registerCompactionRequest(pi);
						pi.on("session_before_compact", (event) => {
							compactions++;
							return {
								compaction: {
									summary: "The goal is unfinished. Continue the next unit.",
									firstKeptEntryId: event.preparation.firstKeptEntryId,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
						pi.on("agent_end", async () => {
							if (!firstEnd) return;
							firstEnd = false;
							const branch = f.ingress.branch();
							const state = await branch.attachment.ledger.snapshot();
							observedPhase = state.attempts.find((attempt) => attempt.id === state.activeAttemptId)?.phase;
							// The installed loop has submitted its successor, but the host has not settled
							// its current attempt. Retention reads must not freeze the successor's revision.
							await branch.controller.retentionReferences();
						});
					},
				},
			],
			script: (_body, index) => {
				const target = notices
					.find((notice) => notice.text.startsWith("Goal started:"))
					?.text.match(/Goal started: (\S+)/)?.[1];
				assert.ok(target, "the fixture uses the goal identity returned by the installed extension");
				if (index === 0 || index === 2) {
					const calls = [
						{
							name: "multiloop_log",
							arguments: {
								lane: target.split("/")[0],
								action: "log",
								note: `Unit ${index} finished; more remains.`,
							},
						},
					];
					if (compact && index === 0) calls.push({ name: "compact_context", arguments: {} });
					return assistantToolCalls(...calls);
				}
				if (index === 1 || index === 3) return { text: "This unit is finished; the goal remains open." };
				if (index === 4)
					return assistantToolCalls({
						name: "multiloop_stop",
						arguments: { target },
					});
				done.resolve();
				return { text: "Fixture stopped." };
			},
		});
		notices = capturedNotices(f.session);
		await f.session.prompt("/goal Finish the continuation fixture");
		await done.promise;
		await f.session.waitForIdle();
		await f.ingress.joinPendingOperations();
		assert.equal(observedPhase, "running");
		assert.equal(compactions, compact ? 1 : 0);
		assert.equal(f.bodies.length, 6, "successive goal turns run without user input or an explicit wake");
		const results = f.sessionManager
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
		const attempts = (await f.ingress.branch().attachment.ledger.snapshot()).attempts;
		const loops = attempts.filter((attempt) => attempt.admission?.choice.intent.producer === "multiloop");
		assert.ok(loops.length >= 2, "compaction cannot be the only continuation after the first goal turn");
		assert.ok(attempts.every((attempt) => attempt.outcome === "success"));
		assert.deepEqual(
			loops.map((attempt) => attempt.admission.choice.intent.revision),
			loops.map((_, index) => String(index + 1)),
		);
		assert.match(JSON.stringify(f.bodies[4]), /Continue the active quick goal/);
		assert.deepEqual(f.errors, []);
	});
