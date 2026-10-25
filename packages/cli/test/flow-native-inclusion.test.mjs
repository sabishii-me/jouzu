import assert from "node:assert/strict";
import { test } from "node:test";
import { deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { nativeProjectionDelivered, nativeSourceDelivered } from "../dist/flow-control/native-inclusion.js";
import { afterFlowCleanup, assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";
import { controlledBackground } from "./fixtures/flow-background-gate.mjs";
import { campaignScript } from "./fixtures/flow-campaign.mjs";

const hash = "a".repeat(64);
/** One retained source at `index`, with the model status Pi recorded for it. */
const request = ({ sources = [], projections = [], wire = true, outcome = "success" } = {}) => ({
	id: "request",
	ownerId: "owner",
	sourceHash: hash,
	transformedHash: hash,
	modelHash: hash,
	systemHash: hash,
	outcome,
	...(sources.length
		? {
				sourceCapture: {
					hash,
					count: sources.length,
					members: sources.map((_status, index) => ({
						index,
						operationId: "operation",
						messageHash: hash,
						prompt: { inputIndex: 0, messageIndex: 0 },
					})),
					model: {
						hash,
						count: sources.length,
						members: sources.map((status, index) => ({ sourceIndex: index, status, index, messageHash: hash })),
					},
				},
			}
		: {}),
	...(projections.length
		? {
				projectionCapture: {
					hash,
					count: projections.length,
					members: projections.map((_status, index) => ({
						index,
						messageHash: hash,
						message: { role: "custom", customType: "flow", content: "text", display: false, timestamp: 0 },
					})),
					model: {
						hash,
						count: projections.length,
						members: projections.map((status, index) => ({ sourceIndex: index, status, index, messageHash: hash })),
					},
				},
			}
		: {}),
	...(wire ? { payload: { hash, bytes: 1000, api: "openai-completions", provider: "fixture", model: "fixture" } } : {}),
});

test("only intact and converted sources acknowledge delivery", () => {
	const record = request({ sources: ["intact", "converted", "changed", "unresolved"] });
	assert.equal(nativeSourceDelivered(record, 0), true);
	assert.equal(nativeSourceDelivered(record, 1), true);
	// Pi records `changed` when it replaces content, such as removing an image. Replaced content is
	// not what the controller retained, so it cannot acknowledge that the instruction was delivered.
	assert.equal(nativeSourceDelivered(record, 2), false);
	assert.equal(nativeSourceDelivered(record, 3), false);
	// An index no capture member claims is not delivered by omission.
	assert.equal(nativeSourceDelivered(record, 9), false);
	assert.equal(nativeSourceDelivered(request(), 0), false);
});

test("a projection acknowledges delivery only when it converted intact", () => {
	const record = request({ projections: ["converted", "changed", "unresolved"] });
	assert.equal(nativeProjectionDelivered(record, 0), true);
	assert.equal(nativeProjectionDelivered(record, 1), false);
	assert.equal(nativeProjectionDelivered(record, 2), false);
	assert.equal(nativeProjectionDelivered(record, 9), false);
});

test("the two layers agree on every request a real campaign produces", async (t) => {
	const background = await controlledBackground(t);
	const wakeEntered = deferred(),
		releaseWake = deferred(),
		wakeSettled = deferred();
	const script = campaignScript({ command: background.command, goal: "Compare inclusion layers" });
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: async (body, index) => {
			if (index === 4) {
				wakeEntered.resolve();
				await releaseWake.promise;
			}
			return script(body, index);
		},
	});
	afterFlowCleanup(t, () => releaseWake.resolve());
	const store = f.ingress.branch().attachment.nativeRequests;
	const finish = store.finish.bind(store);
	const seen = new Map();
	let wakeId;
	// Capture each terminal receipt before the next request or idle maintenance can retire it.
	t.mock.method(store, "finish", async (...args) => {
		await finish(...args);
		const record = (await store.snapshot()).find((request) => request.id === args[0]);
		assert.ok(record, `finished request ${args[0]} remains available at settlement`);
		seen.set(record.id, record);
		if (record.id === wakeId) wakeSettled.resolve();
	});
	await f.session.prompt("start the sweep and wait");
	assert.equal(f.bodies.length, 4, "the campaign starts its lane, job, and wait before replying");
	const waits = await f.ingress.branch().attachment.waits.snapshot();
	assert.equal(waits.length, 1, "the campaign declares one wait");
	assert.equal(waits[0].state, "waiting", "the dependency remains gated until the wait is recorded");
	await background.release();
	await wakeEntered.promise;
	const pending = (await store.snapshot()).filter((request) => request.outcome === undefined);
	assert.equal(pending.length, 1, "the wake request is waiting for its provider response");
	const inFlight = pending[0];
	wakeId = inFlight.id;
	assert.ok(inFlight.payload, "the wake reached the provider");
	assert.ok(inFlight.sourceCapture?.members.length, "the wake carries retained sources");
	// Model delivery precedes the provider's outcome. A polling collector can retain this snapshot
	// after the request succeeds and is retired, so it cannot infer non-delivery from no outcome.
	for (const member of inFlight.sourceCapture.members)
		assert.equal(nativeSourceDelivered(inFlight, member.index), true, `in-flight source ${member.index}`);
	releaseWake.resolve();
	await wakeSettled.promise;
	await f.session.waitForIdle();
	assert.equal(inFlight.outcome, undefined, "a pre-response snapshot does not acquire the later outcome");
	assert.equal(seen.get(wakeId)?.outcome, "success", "settlement captures the wake's completed receipt");

	const requests = [...seen.values()];
	assert.equal(f.bodies.length, 5, "the dependency produces one composed wake");
	assert.equal(requests.length, f.bodies.length, "every provider request has a captured terminal receipt");
	assert.ok(requests.length >= 2, `the campaign made several provider requests, saw ${requests.length}`);
	assert.ok(
		requests.some((request) => request.sourceCapture?.members.length),
		"at least one request carried retained sources",
	);
	// Projections are composed by the wait-decision context path rather than this campaign, so their
	// real-fixture agreement is proven where that path already runs: the ingress, wait-observation,
	// and background-results suites exercise it once their readers move to the model layer.
	// Every retained source in a successful request reached the adapter as composed.
	for (const request of requests) {
		assert.equal(request.outcome, "success", `request ${request.id} completed successfully`);
		for (const member of request.sourceCapture?.members ?? [])
			assert.equal(
				nativeSourceDelivered(request, member.index),
				request.outcome === "success",
				`request ${request.id} source ${member.index}`,
			);
	}
	assert.deepEqual(f.errors, []);
});
