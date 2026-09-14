import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

test("continuous extension followups retire superseded receipts before capacity fails", {
	timeout: 60000,
}, async (t) => {
	let endings = 0;
	const done = deferred();
	const f = await assembledSession(t, {
		producerExtensions: [
			...(await installedProducerExtensions()),
			{
				name: "continuation-probe",
				factory(pi) {
					pi.on("agent_end", () => {
						endings++;
						if (endings < 160) pi.sendUserMessage(`Continue probe ${endings}`, { deliverAs: "followUp" });
					});
					pi.on("agent_settled", () => {
						if (endings >= 160) done.resolve();
					});
				},
			},
		],
	});
	await f.session.prompt("Start probe");
	await done.promise;
	await f.session.waitForIdle();
	const errors = f.sessionManager
		.getEntries()
		.filter((e) => e.type === "message" && e.message.errorMessage)
		.map((e) => e.message.errorMessage);
	assert.equal(f.bodies.length, 160);
	assert.deepEqual(errors, []);
	assert.deepEqual(f.errors, []);
	assert.ok((await f.ingress.branch().attachment.nativeRequests.snapshot()).length <= 3);
});
