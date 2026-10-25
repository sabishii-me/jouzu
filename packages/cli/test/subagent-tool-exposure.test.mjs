import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AGENT_TOOLS, defaultAgentConfig } from "../dist/subagents/roles.js";
import { runWorker } from "../dist/subagents/worker.js";

const iterationTools = ["multiloop_iterate", "multiloop_measure", "multiloop_decide", "multiloop_log"];
const extensionTools = ["multiloop_start", "multiloop_stop", "TaskCreate", "vcc_recall", "web_fetch", "agent_wait"];

for (const roleId of ["coder", "reviewer"])
	test(`child ${roleId} preserves idle withholding and activates iteration tools only for a loop`, {
		timeout: 30_000,
	}, async () => {
		const root = mkdtempSync(join(tmpdir(), "jouzu-child-tool-exposure-"));
		const cwd = join(root, "workspace");
		const directory = join(root, "child");
		const userAgentDir = join(root, "user-agent");
		for (const path of [cwd, directory, userAgentDir]) mkdirSync(path);
		const previous = { ...process.env };
		const requests = [];
		let session;
		let startup;
		const server = createServer(async (req, res) => {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			requests.push({
				body: JSON.parse(Buffer.concat(chunks).toString()),
				active: session.getActiveToolNames(),
				registered: session.getAllTools().map((tool) => tool.name),
			});
			const call = [
				["multiloop_start", { lane: "fixture", runTag: "run", mode: "research", goal: "Check child tool exposure" }],
				["multiloop_stop", { target: "fixture/run" }],
			][requests.length - 1];
			const delta = call
				? {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: `call_${requests.length}`,
								type: "function",
								function: { name: call[0], arguments: JSON.stringify(call[1]) },
							},
						],
					}
				: { role: "assistant", content: "Done." };
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
			res.write(
				`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
			);
			res.end("data: [DONE]\n\n");
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const role = { ...defaultAgentConfig().roles.find((role) => role.id === roleId), thinking: "off", maxTurns: 5 };
		try {
			await runWorker(
				{
					cwd,
					directory,
					userAgentDir,
					role,
					task: "Start the fixture loop, stop it, and report Done.",
					auth: { apiKey: "fixture" },
					model: {
						provider: "fixture",
						id: "test",
						name: "Fixture",
						api: "openai-completions",
						baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 128000,
						maxTokens: 512,
					},
				},
				(value) => {
					session = value;
					startup = session.getActiveToolNames();
				},
			);
			assert.equal(requests.length, 3, "one idle request, one active loop request, then one stopped request");
			assert.deepEqual(startup, requests[0].active);
			for (const [index, { body, active, registered }] of requests.entries()) {
				const visible = body.tools.map((tool) => tool.function.name);
				assert.deepEqual([...visible].sort(), [...active].sort(), "provider receives the live active tool set");
				for (const name of iterationTools) {
					assert.ok(registered.includes(name), `${name} stays registered at request ${index}`);
					assert.equal(active.includes(name), index === 1, `${name} active at request ${index}`);
					assert.equal(visible.includes(name), index === 1, `${name} model-visible at request ${index}`);
				}
				for (const name of extensionTools) assert.ok(visible.includes(name), `${name} remains available`);
				for (const name of AGENT_TOOLS) {
					assert.equal(visible.includes(name), role.tools.includes(name), `${name} follows the ${roleId} role`);
					assert.equal(registered.includes(name), role.tools.includes(name), `${name} registration is role-limited`);
				}
				for (const name of ["subagent", "schedule_prompt"]) assert.ok(!registered.includes(name), name);
			}
			const entries = readFileSync(session.sessionFile, "utf8").trim().split("\n").map(JSON.parse);
			const results = entries.filter((entry) => entry.type === "message" && entry.message.role === "toolResult");
			assert.deepEqual(
				results.map((entry) => entry.message.toolName),
				["multiloop_start", "multiloop_stop"],
			);
			for (const { message } of results) assert.equal(message.isError, false, JSON.stringify(message));
		} finally {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
			Object.assign(process.env, previous);
			rmSync(root, { recursive: true, force: true });
		}
	});
