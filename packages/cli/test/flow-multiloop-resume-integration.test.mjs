import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assistantToolCalls, deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { assembledSession, capturedNotices, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

for (const disambiguate of [false, true])
	test(`a reopened session resumes a detached loop without continue: disambiguate=${disambiguate}`, {
		timeout: 15000,
	}, async (t) => {
		const first = await assembledSession(t, {
			persist: true,
			producerExtensions: await installedProducerExtensions({ freshMultiloop: true }),
		});
		first.ingress.pauseAutomated("Hold setup until restart");
		const notices = capturedNotices(first.session);
		await first.session.prompt("/goal Finish the persisted campaign");
		const target = notices
			.find((notice) => notice.text.startsWith("Goal started:"))
			?.text.match(/Goal started: (\S+)/)?.[1];
		assert.ok(target);
		assert.equal(first.bodies.length, 0);
		const history = first.sessionManager.getSessionFile();
		await first.shutdown("resume", history);
		const done = deferred();
		const second = await assembledSession(t, {
			root: first.root,
			persist: true,
			sessionManager: SessionManager.open(history),
			producerExtensions: await installedProducerExtensions({ freshMultiloop: true }),
			script: (_body, index) => {
				if (disambiguate && index === 0) return assistantToolCalls({ name: "multiloop_resume", arguments: { target } });
				if (index === (disambiguate ? 1 : 0))
					return assistantToolCalls({ name: "multiloop_stop", arguments: { target } });
				done.resolve();
				return { text: "Campaign handled" };
			},
		});
		const resumedNotices = capturedNotices(second.session);
		await second.session.prompt(`/multiloop resume ${disambiguate ? "<lane/run-tag>" : target}`);
		await done.promise;
		await second.session.waitForIdle();
		assert.equal(second.bodies.length, disambiguate ? 3 : 2);
		assert.ok(
			JSON.stringify(second.bodies[0]).includes(disambiguate ? "<lane/run-tag>" : "Finish the persisted campaign"),
		);
		assert.equal(
			resumedNotices.some((notice) => notice.text.includes("Could not resolve")),
			disambiguate,
		);
		assert.deepEqual(second.errors, []);
		assert.deepEqual(first.errors, []);
	});
