import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assistant, createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { automaticWorkId, retainAutomaticWork } from "../dist/flow-control/automatic-work.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { FlowWorkContext } from "../dist/flow-control/work-context.js";

async function probeSession(t, { automatic }) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-tool-work-"));
	const observed = [],
		errors = [];
	const { session } = await createFlowSession(t, {
		tools: ["probe"],
		extensions: [
			{
				name: "probe",
				factory(pi) {
					pi.registerTool({
						name: "probe",
						label: "Probe",
						description: "Inspect attribution",
						parameters: { type: "object", properties: {}, additionalProperties: false },
						async execute(id) {
							observed.push(context.current());
							return { content: [{ type: "text", text: id }], details: {} };
						},
					});
				},
			},
		],
	});
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	const attachment = await PiFlowAttachment.open(root, {
		sessionId: session.sessionId,
		branchId: "branch",
	});
	const context = new FlowWorkContext(() => attachment, automatic ? () => retainAutomaticWork(attachment) : undefined);
	if (automatic) await context.attach();
	t.after(async () => {
		await attachment.close();
		await rm(root, { recursive: true, force: true });
	});
	await attachment.waits.registerWork("work", "host", 0);
	const calls = (count) => {
		let requests = 0;
		session.agent.streamFunction = async () => {
			const result = assistant();
			if (++requests === 1) {
				result.content = Array.from({ length: count }, (_, i) => ({
					type: "toolCall",
					id: `call-${i}`,
					name: "probe",
					arguments: {},
				}));
				result.stopReason = "toolUse";
			}
			return { async *[Symbol.asyncIterator]() {}, result: async () => result };
		};
	};
	return { attachment, context, session, observed, errors, calls };
}

for (const parallel of [false, true])
	test(`agent tools run on attribution with no per-tool wrapper: parallel=${parallel}`, async (t) => {
		const f = await probeSession(t, { automatic: true });
		f.session.agent.toolExecution = parallel ? "parallel" : "sequential";
		f.calls(2);
		await f.context.run({ id: "work", actor: "host", revision: 1 }, () => f.session.prompt("inspect"));
		assert.deepEqual(f.observed, [
			{ id: "work", revision: 1 },
			{ id: "work", revision: 1 },
		]);
		assert.deepEqual(f.errors, []);
		// Outside any invocation the same tools run on the branch host identity.
		f.observed.length = 0;
		f.calls(1);
		await f.session.prompt("inspect outside");
		assert.equal(f.observed.at(-1).id, automaticWorkId(f.attachment.ledger.scope));
		assert.deepEqual(f.errors, []);
	});

test("a missing work context never blocks a tool", async (t) => {
	const f = await probeSession(t, { automatic: false });
	f.calls(1);
	// No invocation and no branch identity: attribution is simply absent.
	await f.session.prompt("inspect");
	assert.deepEqual(f.observed, [undefined]);
	assert.deepEqual(f.errors, []);
});

test("a stale work revision never blocks a tool", async (t) => {
	const f = await probeSession(t, { automatic: true });
	f.calls(1);
	await f.context.run({ id: "work", actor: "host", revision: 1 }, async () => {
		await f.attachment.waits.shareWork("work", "host", 1, "bg", 1);
		await f.session.prompt("inspect");
	});
	assert.equal(f.observed.at(-1).id, "work");
	assert.deepEqual(f.errors, []);
});
