import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { count, lastStatus, launchRpc, quiet, response, rpcHome } from "./fixtures/rpc-runtime.mjs";

/** An OpenAI-compatible provider that streams slowly, so a Stop always lands inside the run. */
async function slowProvider(t) {
	const requests = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", async () => {
			if (!req.url.includes("chat/completions")) {
				res.writeHead(404).end();
				return;
			}
			const { model } = JSON.parse(body);
			requests.push(model);
			res.writeHead(200, { "content-type": "text/event-stream" });
			const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model };
			let closed = false;
			res.on("close", () => {
				closed = true;
			});
			for (let i = 1; i <= 50 && !closed; i++) {
				res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: `part${i} ` } }] })}\n\n`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			if (closed) return;
			res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
			res.end("data: [DONE]\n\n");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	t.after(() => server.closeAllConnections?.());
	return { port: server.address().port, requests };
}

test("Stop is final at every point of a prompt and never leaves Flow work behind", async (t) => {
	const provider = await slowProvider(t);
	const f = launchRpc(t, await rpcHome(t, provider.port));
	f.send({ id: "ready", type: "get_state" });
	await f.waitFor(() => response(f.frames, "ready"), "rpc ready");

	// Stop delivered together with the prompt: the prompt is cancelled before any run starts.
	const runsBefore = count(f.frames, "agent_start");
	f.send({ id: "p0", type: "prompt", message: "first" }, { id: "a0", type: "abort" });
	const p0 = await f.waitFor(() => response(f.frames, "p0"), "immediate stop response");
	assert.equal(p0.success, true, JSON.stringify(p0));
	assert.equal(p0.data?.disposition, "aborted");
	await quiet(500);
	assert.equal(count(f.frames, "agent_start"), runsBefore, "an aborted prompt must not start a run");
	assert.equal(provider.requests.length, 0);

	// Stop shortly after the prompt and while the reply streams: each run ends aborted.
	for (const [index, delay] of [30, 60, 400].entries()) {
		const id = `p${index + 1}`;
		const settled = count(f.frames, "agent_settled");
		f.send({ id, type: "prompt", message: `prompt ${id}` });
		await quiet(delay);
		f.send({ id: `a${index + 1}`, type: "abort" });
		const reply = await f.waitFor(() => response(f.frames, id), `${id} response`);
		assert.equal(reply.success, true, JSON.stringify(reply));
		if (reply.data?.disposition === "aborted") continue;
		await f.waitFor(() => count(f.frames, "agent_settled") > settled, `${id} settled`);
		const end = f.frames.findLast((frame) => frame.type === "agent_end");
		assert.equal(end.messages.at(-1)?.stopReason, "aborted", `${id} after ${delay}ms`);
	}

	// Nothing runs on its own after the Stops, and Flow holds nothing back.
	const runsAfterStops = count(f.frames, "agent_start");
	await quiet(1000);
	assert.equal(count(f.frames, "agent_start"), runsAfterStops, "Flow must not start work after Stop");

	// The next message runs normally instead of being held for a recovery decision.
	const settled = count(f.frames, "agent_settled");
	f.send({ id: "next", type: "prompt", message: "after the stops" });
	const next = await f.waitFor(() => response(f.frames, "next"), "next response");
	assert.equal(next.data?.disposition, "started", JSON.stringify(next));
	await f.waitFor(() => count(f.frames, "agent_settled") > settled, "next settled", 15_000);
	assert.equal(f.frames.findLast((frame) => frame.type === "agent_end").messages.at(-1)?.stopReason, "stop");
	const status = lastStatus(f.frames, "jouzu-flow");
	assert.ok(status, "flow status published");
	assert.equal(status.recovery, undefined, JSON.stringify(status));
	assert.deepEqual(status.held, []);
	assert.deepEqual(status.withheld, []);
	assert.deepEqual(status.uncertain, []);
	assert.equal((await f.close()).code, 0, "the runtime shuts down cleanly after the Stops");
});
