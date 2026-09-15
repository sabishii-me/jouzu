import assert from "node:assert/strict";
import { test } from "node:test";
import { registerCompactionRequest } from "../dist/compaction-request.js";
import { assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

test("requested compaction admits its continuation through the installed flow assembly", {
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
			{ toolCalls: [{ name: "compact_context", arguments: {} }] },
			{ text: "Continuing after compaction." },
			{ text: "Resumed." },
		],
	});
	await f.session.prompt("Do the work, compact, and continue.");
	const deadline = Date.now() + 5000;
	while (f.bodies.length < 3 && !f.ingress.automatedPause() && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 20));
	await f.session.waitForIdle();
	assert.equal(compactions, 1);
	assert.equal(f.bodies.length, 3, f.session.agent.state.errorMessage);
	assert.ok(JSON.stringify(f.bodies[2].messages).includes("Continue the current work from the compaction summary."));
	const receipts = await f.ingress.branch().attachment.nativeRequests.snapshot();
	assert.ok(receipts.some((record) => record.requiredSources?.length && record.outcome === "success"));
	assert.equal(f.ingress.automatedPause(), undefined);
	assert.equal(f.ingress.branch().attachment.nativeRequests.recoveryBlocked, false);
	assert.deepEqual(f.errors, []);
});
