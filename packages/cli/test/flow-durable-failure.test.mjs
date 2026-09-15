import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { assistant } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { formatFlowStatus, projectFlowStatus } from "../dist/flow-control/flow-status.js";
import { captureFlowStatusContext } from "../dist/flow-control/flow-status-context.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { nativeRequests } from "./fixtures/native-requests.mjs";

for (const kind of ["provider", "admission"])
	test(`${kind} failure cause survives reopening and reset without becoming delivery evidence`, async (t) => {
		const f = await nativeRequests(t, {
			retainInputs: true,
			enforceRequiredSources: true,
			...(kind === "provider"
				? {
						native: async () => ({
							async *[Symbol.asyncIterator]() {},
							result: async () => ({
								...assistant(),
								stopReason: "error",
								errorMessage: "Invalid endpoint api_key=private-token",
							}),
						}),
					}
				: {
						contextHandler: ({ messages }) => ({ messages: structuredClone(messages) }),
					}),
		});
		await f.session.prompt("Retain the cause");
		const [before] = await f.store.snapshot();
		assert.equal(before.failure?.stage, kind === "provider" ? "provider-preparation" : "payload-admission");
		assert.equal(before.failure.transmission, "not-admitted");
		assert.equal(before.failure.provider, "fixture");
		assert.match(before.failure.message, kind === "provider" ? /Invalid endpoint/ : /required input/);
		assert.ok(Number.isSafeInteger(before.failure.recordedAt));
		assert.doesNotMatch(JSON.stringify(before), /private-token/);
		for (const change of [
			{ transmission: "admitted" },
			{ message: "api_key=do-not-store" },
			{ recordedAt: -1 },
			{ message: "\u0301".repeat(10000) },
			{ stack: "Do not persist unbounded diagnostics" },
		])
			await assert.rejects(f.store.finish(before.id, "withheld", { ...before.failure, ...change }), { code: "schema" });
		await assert.rejects(f.store.finish(before.id, "success", before.failure), { code: "schema" });
		await f.store.finish(before.id, "withheld", {
			...before.failure,
			message: "A later error must not overwrite the cause",
		});
		assert.deepEqual((await f.store.snapshot())[0].failure, before.failure);
		await f.bridge.close();
		await f.dispatch.close();
		await f.attachment.close();
		const reopened = await PiFlowAttachment.open(join(f.root, "receipts"), f.scope);
		try {
			const [after] = await reopened.nativeRequests.snapshot();
			assert.deepEqual(after.failure, before.failure);
			const records = await reopened.submissions.snapshot();
			const views = await reopened.submissionViews();
			const context = captureFlowStatusContext(records, [after]);
			const report = formatFlowStatus(
				projectFlowStatus(f.scope, views, [], [], [], [], undefined, context),
				Date.now(),
			);
			assert.match(report, kind === "provider" ? /Invalid endpoint/ : /required input/);
			await reopened.nativeRequests.reset();
			const [reset] = await reopened.nativeRequests.snapshot();
			assert.deepEqual(reset.failure, before.failure);
			assert.equal(reset.payload, undefined);
			assert.equal(reset.outcome, "withheld");
			assert.equal(reset.reset, true);
		} finally {
			await reopened.close();
		}
	});

test("diagnostic capacity cannot prevent recording the withheld disposition", async (t) => {
	const f = await nativeRequests(t);
	await f.store.begin({
		id: "near-capacity",
		sourceHash: "a".repeat(64),
		transformedHash: "b".repeat(64),
		modelHash: "c".repeat(64),
		systemHash: "d".repeat(64),
	});
	const diagnostic = {
		stage: "provider-preparation",
		transmission: "not-admitted",
		code: "provider",
		message: "Provider preparation failed",
		api: "openai-completions",
		provider: "fixture",
		model: "fixture",
		recordedAt: 1,
	};
	const byteLength = Buffer.byteLength.bind(Buffer);
	t.mock.method(Buffer, "byteLength", (value, ...args) =>
		typeof value === "string" && value.startsWith("[") && value.includes('"failure":')
			? 1024 * 1024 + 1
			: byteLength(value, ...args),
	);
	await f.store.finish("near-capacity", "withheld", diagnostic);
	t.mock.restoreAll();
	const [record] = await f.store.snapshot();
	assert.equal(record.outcome, "withheld");
	assert.equal(record.failure, undefined);
});
