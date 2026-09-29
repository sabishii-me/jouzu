import assert from "node:assert/strict";
import { test } from "node:test";
import { assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

for (const recovery of ["threshold", "overflow", "retry"])
	for (const owner of ["user", "goal"])
		test(`tool authority survives ${recovery} recovery for ${owner} work`, { timeout: 15000 }, async (t) => {
			const identities = [];
			const compactions = [];
			const f = await assembledSession(t, {
				persist: true,
				settings: {
					compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: recovery === "threshold" ? 7505 : 1 },
					retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
				},
				producerExtensions: [
					...(await installedProducerExtensions({ freshMultiloop: true })),
					{
						name: "ownership-probe",
						factory(pi) {
							pi.registerTool({
								name: "ownership_probe",
								label: "Ownership probe",
								description: "Verify the current fixture work authority.",
								parameters: { type: "object", properties: {} },
								async execute() {
									const branch = f.ingress.branch();
									const work = branch.workContext.current();
									assert.ok(work, "every authorized recovery tool must have owning work");
									assert.deepEqual(branch.attachment.waits.captureExecutionWork(work.id, work.revision, "bg"), work);
									identities.push(work);
									return {
										content: [
											{
												type: "text",
												text: recovery === "threshold" && identities.length === 1 ? "data ".repeat(6000) : "verified",
											},
										],
										details: {},
									};
								},
							});
							pi.on("session_before_compact", (event) => {
								compactions.push(event.reason);
								return {
									compaction: {
										summary: "Continue the authorized fixture work.",
										firstKeptEntryId: "",
										tokensBefore: event.preparation.tokensBefore,
									},
								};
							});
						},
					},
				],
				script: (_body, requestIndex) => {
					if (requestIndex === 0) return { text: "Earlier fixture history." };
					const index = requestIndex - 1;
					if (index === 0) return { toolCalls: [{ name: "ownership_probe", arguments: {} }] };
					if (index === 1 && recovery !== "threshold")
						return {
							httpStatus: recovery === "overflow" ? 400 : 503,
							httpBody: {
								error: {
									message:
										recovery === "overflow"
											? "This model's maximum context length is 262144 tokens. However, you requested 87591 output tokens and your prompt contains at least 174554 input tokens, for a total of at least 262145 tokens. Please reduce the length of the input prompt or the number of requested output tokens. (parameter=input_tokens, value=174554)"
											: "Service unavailable",
									type: recovery === "overflow" ? "BadRequestError" : "server_error",
									code: recovery === "overflow" ? 400 : 503,
								},
							},
						};
					if (index === (recovery === "threshold" ? 1 : 2))
						return { toolCalls: [{ name: "ownership_probe", arguments: {} }] };
					if (owner === "goal" && index === (recovery === "threshold" ? 2 : 3))
						return { toolCalls: [{ name: "multiloop_stop", arguments: { target: "verify-ownership" } }] };
					return { text: "Finished." };
				},
			});
			if (recovery !== "threshold") await f.session.setModel({ ...f.session.model, contextWindow: 262144 });
			await f.session.prompt("Establish earlier fixture history.");
			await f.session.prompt(owner === "goal" ? "/goal Verify ownership" : "Verify ownership across recovery.");
			await f.ingress.wakeProducers();
			await f.session.waitForIdle();
			assert.equal(
				identities.length,
				2,
				JSON.stringify(f.session.messages.filter((message) => message.role === "toolResult")),
			);
			assert.deepEqual(identities[1], identities[0]);
			assert.match(identities[0].id, owner === "goal" ? /^multiloop-work:/ : /^user:/);
			assert.equal(f.bodies.length, (recovery === "threshold" ? 4 : 5) + (owner === "goal" ? 1 : 0));
			assert.deepEqual(compactions, recovery === "retry" ? [] : [recovery]);
			assert.equal(f.ingress.automatedPause(), undefined);
			assert.deepEqual(f.errors, []);
		});
