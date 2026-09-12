import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantToolCalls, deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { createJouzuCamoufoxExtension } from "../dist/camoufox-adapter.js";
import { assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

const probe = { name: "probe", arguments: {} };
const search = { name: "tff-search_web", arguments: { query: "fixture" } };
const fetch = { name: "tff-fetch_url", arguments: { url: "https://example.com" } };

for (const [label, calls, outcome] of [
	["search batch", [search, search], "success"],
	["fetch makes a mixed batch sequential", [probe, fetch, probe], "success"],
	["search makes a mixed batch sequential", [probe, search, probe], "success"],
	["ordinary batch stays parallel", [probe, probe], "success"],
	["browser failure", [search, fetch, probe], "failure"],
	["browser cancellation", [search, fetch, probe], "abort"],
]) {
	test(`Camoufox scheduling through flow control: ${label}`, { timeout: 30000 }, async (t) => {
		let f;
		let active = 0;
		let peak = 0;
		const started = [],
			authorities = [],
			workIds = [];
		const entered = deferred();
		const escaped = deferred();
		const staleChecks = [];
		async function execute(id, _args, signal) {
			active++;
			peak = Math.max(peak, active);
			started.push(id);
			const context = f.ingress.branch().workContext;
			const work = context.current();
			assert.ok(work?.id, "each tool receives the native turn's work scope");
			workIds.push(work.id);
			const authority = context.authorize(work.id);
			authorities.push(authority);
			staleChecks.push(escaped.promise.then(() => assert.throws(() => context.current(), { code: "stale" })));
			try {
				entered.resolve();
				if (outcome === "abort" && id === "call-0") {
					await new Promise((resolve) => {
						if (signal.aborted) resolve();
						else signal.addEventListener("abort", resolve, { once: true });
					});
					throw new Error("fixture browser cancelled");
				}
				await new Promise((resolve) => setImmediate(resolve));
				authority.assertActive();
				if (outcome === "failure" && id === "call-0") throw new Error("fixture browser failure");
				return { content: [{ type: "text", text: id }], details: {} };
			} finally {
				active--;
			}
		}
		f = await assembledSession(t, {
			producerExtensions: [
				...(await installedProducerExtensions()),
				{
					name: "browser-scheduling",
					factory(pi) {
						// Keep the real adapter's schemas and scheduling metadata. Only browser
						// execution is replaced; Pi and the flow assembly execute the batch.
						createJouzuCamoufoxExtension(
							new Proxy(pi, {
								get(target, key) {
									if (key === "registerTool") return (definition) => pi.registerTool({ ...definition, execute });
									return Reflect.get(target, key);
								},
							}),
							"/unused-browser-runtime",
						);
						pi.registerTool({
							name: "probe",
							label: "Probe",
							description: "Observe scheduling",
							parameters: { type: "object", properties: {} },
							execute,
						});
					},
				},
			],
			script: (_body, index) => (index === 0 ? assistantToolCalls(...calls) : { text: "done" }),
		});
		f.session.agent.toolExecution = "parallel";
		const turn = f.session.prompt("run the batch");
		if (outcome === "abort") {
			await entered.promise;
			await f.session.abort();
		}
		await turn;
		assert.equal(active, 0);
		assert.equal(peak, calls.every((call) => call.name === "probe") ? 2 : 1);
		assert.deepEqual(started, outcome === "abort" ? ["call-0"] : calls.map((_call, i) => `call-${i}`));
		assert.equal(new Set(workIds).size, 1);
		for (const authority of authorities) assert.throws(() => authority.assertActive(), { code: "stale" });
		escaped.resolve();
		await Promise.all(staleChecks);
		const firstResult = f.session.agent.state.messages.find(
			(m) => m.role === "toolResult" && m.toolCallId === "call-0",
		);
		assert.equal(firstResult?.isError, outcome !== "success");
		const before = f.bodies.length;
		await f.session.prompt("continue after the batch");
		assert.equal(f.bodies.length, before + 1, "the next native input is admitted exactly once");
		assert.equal(f.session.agent.state.messages.at(-1).stopReason, "stop");
		assert.deepEqual(f.errors, []);
	});
}
