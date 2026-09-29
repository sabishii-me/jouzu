import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assembledSession, installedProducerExtensions, replacedSession } from "./fixtures/flow-assembly.mjs";

for (const transition of ["new", "resume", "fork", "tree"])
	test(`tool ownership is renewed after ${transition} without reviving old callbacks`, {
		timeout: 15000,
	}, async (t) => {
		let active;
		const observations = [];
		const extensions = [
			...(await installedProducerExtensions()),
			{
				name: "transition-ownership",
				factory(pi) {
					pi.registerTool({
						name: "ownership_probe",
						label: "Ownership probe",
						description: "Capture fixture ownership and its lifetime.",
						parameters: { type: "object", properties: {} },
						async execute() {
							const branch = active.ingress.branch();
							const work = branch.workContext.current();
							assert.ok(work);
							const authority = branch.workContext.authorize(work.id);
							authority.assertActive();
							assert.deepEqual(branch.attachment.waits.captureExecutionWork(work.id, work.revision, "bg"), work);
							observations.push({ work, scope: branch.scope, authority });
							return { content: [{ type: "text", text: "verified" }], details: {} };
						},
					});
				},
			},
		];
		const script = (_body, index) =>
			index % 2 === 0 ? { toolCalls: [{ name: "ownership_probe", arguments: {} }] } : { text: "Finished." };
		active = await assembledSession(t, { persist: true, producerExtensions: extensions, script });
		await active.session.prompt("Verify fixture ownership.");
		assert.equal(observations.length, 1);
		const first = active;
		const history = first.sessionManager.getSessionFile();
		if (transition === "tree") {
			const user = first.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "user");
			await first.session.navigateTree(user.id);
		} else {
			const sessionManager =
				transition === "resume"
					? SessionManager.open(history)
					: transition === "fork"
						? SessionManager.forkFrom(history, first.root)
						: undefined;
			active = await replacedSession(t, first, {
				reason: transition,
				sessionManager,
				persist: true,
				producerExtensions: extensions,
				script,
			});
		}
		assert.throws(() => observations[0].authority.assertActive(), { code: "stale" });
		await active.session.prompt("Verify fixture ownership.");
		assert.equal(
			observations.length,
			2,
			JSON.stringify(active.session.messages.filter((message) => message.role === "toolResult")),
		);
		assert.notEqual(observations[0].work.id, observations[1].work.id);
		assert.equal(
			observations[0].scope.sessionId === observations[1].scope.sessionId,
			transition === "resume" || transition === "tree",
		);
		assert.equal(observations[0].scope.branchId === observations[1].scope.branchId, transition === "resume");
		assert.throws(() => observations[0].authority.assertActive(), { code: "stale" });
		assert.throws(() => observations[1].authority.assertActive(), { code: "stale" });
		assert.deepEqual(active.errors, []);
	});
