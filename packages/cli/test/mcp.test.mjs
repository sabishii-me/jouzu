import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent";
import { assistant, createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { classicHostBuiltinOverrides } from "../dist/classic-host-policy.js";
import { deferredMcpConfig } from "../dist/mcp.js";

test("MCP defaults and script exposure become deferred without mutating configuration", () => {
	for (const exposure of [undefined, "codemode", "deferred", "direct", "hidden"]) {
		const config = {
			command: "fixture",
			exposure,
			toolExposure: { search: "codemode", private: "hidden", info: "direct" },
		};
		const original = structuredClone(config);
		assert.deepEqual(deferredMcpConfig(config), {
			...config,
			exposure: exposure === undefined || exposure === "codemode" ? "deferred" : exposure,
			toolExposure: { search: "deferred", private: "hidden", info: "direct" },
		});
		assert.deepEqual(config, original);
	}
});

const server = `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
 const request = JSON.parse(line);
 if (request.id === undefined) return;
 let result;
 if (request.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
 else if (request.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo fixture text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
 else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: request.params.arguments.text }] };
 else result = {};
 process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});`;

test("configured MCP tools are discovered and called directly while codemode stays disabled", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-mcp-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	const config = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ["-e", server] } } });
	await writeFile(join(root, "mcp.json"), config);
	const { session } = await createFlowSession(t, {
		root,
		tools: ["tool_search", "mcp__fixture__echo"],
		shutdownExtensions: true,
		additionalExtensionPaths: ["builtin:mcp", "builtin:codemode"],
		extensions: [...classicHostBuiltinOverrides(), createToolSearchExtension()],
	});
	await session.bindExtensions({
		onError: (error) => {
			throw new Error(JSON.stringify(error));
		},
	});
	assert.ok(session.getActiveToolNames().includes("tool_search"), JSON.stringify(session.getAllTools()));
	assert.ok(!session.getActiveToolNames().includes("mcp__fixture__echo"));
	assert.ok(!session.getAllTools().some((tool) => tool.name === "codemode"));
	let turn = 0;
	session.agent.streamFunction = async () => {
		const response = assistant();
		if (turn < 2) {
			const search = turn === 0;
			response.content = [
				{
					type: "toolCall",
					id: `call-${turn}`,
					name: search ? "tool_search" : "mcp__fixture__echo",
					arguments: search ? { query: "echo fixture" } : { text: "MCP works" },
				},
			];
			response.stopReason = "toolUse";
		}
		turn++;
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: "done", partial: response };
			},
			result: async () => response,
		};
	};
	await session.prompt("Find the echo tool and use it.");
	const result = session.messages.find(
		(message) => message.role === "toolResult" && message.toolName === "mcp__fixture__echo",
	);
	assert.ok(result, JSON.stringify(session.messages));
	assert.equal(result.isError, false);
	assert.match(JSON.stringify(result.content), /MCP works/);
	assert.ok(session.getActiveToolNames().includes("mcp__fixture__echo"));
	assert.equal(await readFile(join(root, "mcp.json"), "utf8"), config);
});
