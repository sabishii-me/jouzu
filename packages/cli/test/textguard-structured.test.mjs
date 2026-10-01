import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { NativeContentPolicy } from "../dist/textguard-policy.js";

const clear = {
	status: "clear",
	findings: [],
	findingCount: 0,
	severityCounts: { info: 0, warn: 0, error: 0 },
	decodeReasons: [],
};
const flagged = {
	...clear,
	status: "findings",
	findings: [{ kind: "bidi", severity: "error", offset: 0, codepoint: "U+202E" }],
	findingCount: 1,
	severityCounts: { info: 0, warn: 0, error: 1 },
};
const gate = (mode = "strict", scan = async (text) => (text.includes("PRIVATE") ? flagged : clear)) =>
	new NativeContentPolicy({
		cwd: process.cwd(),
		mode,
		scanner: { initialize: async () => "a".repeat(64), scan, close: async () => {} },
	});
const request = (name, text = "safe") => ({
	toolName: name,
	toolCallId: "fixture",
	input: { url: "https://example.test" },
	result: { content: [], details: { source: "fixture" }, structuredContent: { nested: [{ text }] } },
});
const externalTools = ["web_fetch", "mcp__fixture__fetch", "read_mcp_resource", "codemode"];

for (const name of externalTools) {
	for (const mode of ["strict", "guarded", "off"]) {
		for (const status of ["clear", "flagged", "unavailable"]) {
			test(`${name}: structured-only ${status} result in ${mode} mode`, async () => {
				let scans = 0;
				const policy = gate(mode, async (text) => {
					scans++;
					assert.match(text, /structuredContent/);
					if (status === "unavailable") throw new Error("PRIVATE scanner failure");
					return status === "flagged" ? flagged : clear;
				});
				const input = request(name, status === "flagged" ? "PRIVATE structured body" : "safe");
				const result = await policy.filterToolResult(input);
				if (mode === "off") {
					assert.equal(result, input.result);
					assert.equal(scans, 0);
				} else if (status === "clear") {
					assert.deepEqual(result.structuredContent, input.result.structuredContent);
					assert.notEqual(result.structuredContent, input.result.structuredContent);
				} else {
					assert.equal(result.structuredContent, undefined);
					assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
					if (mode === "strict") assert.equal(result.isError, true);
					else assert.match(result.content[0].text, /^TextGuard advisory:/);
				}
			});
		}
	}
}

test("structured approval binds the exact payload, not only its text", async () => {
	const policy = gate();
	const input = request("mcp__fixture__fetch", "PRIVATE one");
	input.result.content = [{ type: "text", text: "public" }];
	assert.equal((await policy.filterToolResult(input)).isError, true);
	const review = policy.reviews()[0];
	assert.ok(policy.contentSnapshot(review).body.includes("PRIVATE one"));
	policy.admission.approve(review.id);
	assert.deepEqual((await policy.filterToolResult(input)).structuredContent, input.result.structuredContent);
	input.result.structuredContent.nested[0].text = "PRIVATE two";
	assert.equal((await policy.filterToolResult(input)).isError, true);
});

test("context scans and preserves admitted structured values and nested-call metadata", async () => {
	const policy = gate();
	const input = request("codemode");
	const nestedCalls = {
		calls: [{ id: "fixture/1", name: "web_fetch", arguments: { query: "safe" }, status: "ok" }],
		complete: true,
	};
	const usage = assistant().usage;
	const call = {
		...assistant(),
		content: [{ type: "toolCall", id: input.toolCallId, name: input.toolName, arguments: input.input }],
	};
	const tool = {
		role: "toolResult",
		toolName: input.toolName,
		toolCallId: input.toolCallId,
		timestamp: 1,
		isError: false,
		...input.result,
		nestedCalls,
		usage,
	};
	const [, admitted] = await policy.filterContext([call, tool]);
	assert.deepEqual(admitted.structuredContent, tool.structuredContent);
	assert.deepEqual(admitted.nestedCalls, nestedCalls);
	assert.deepEqual(admitted.usage, usage);
	tool.nestedCalls.calls[0].arguments.query = "PRIVATE nested argument";
	const [, blocked] = await policy.filterContext([call, tool]);
	assert.equal(blocked.isError, true);
	assert.equal(blocked.nestedCalls, undefined);
	assert.equal(blocked.structuredContent, undefined);
	assert.equal(JSON.stringify(blocked).includes("PRIVATE"), false);
});

for (const mode of ["strict", "guarded"]) {
	test(`${mode} omits flagged opaque details from programmatic results`, async () => {
		const input = request("web_fetch");
		input.result.details = { rawBody: "PRIVATE opaque details" };
		const admitted = await gate(mode).filterToolResult(input);
		assert.deepEqual(admitted.details, {});
		assert.equal(JSON.stringify(admitted).includes("PRIVATE"), false);
	});
}

test("guarded advisories use the scanned snapshot and omit flagged programmatic values", async () => {
	const input = request("codemode", "PRIVATE structured body");
	input.result.content = [{ type: "text", text: "public snapshot" }];
	const policy = gate("guarded", async () => {
		input.result.content[0].text = "PRIVATE post-scan mutation";
		input.result.details.source = "PRIVATE post-scan detail";
		return flagged;
	});
	const admitted = await policy.filterToolResult(input);
	assert.equal(admitted.content[1].text, "public snapshot");
	assert.deepEqual(admitted.details, {});
	assert.equal(admitted.structuredContent, undefined);
	assert.equal(JSON.stringify(admitted).includes("PRIVATE"), false);
});

for (const text of ["safe", "PRIVATE structured body"]) {
	test(`nested callers receive the final admitted structured result: ${text}`, async (t) => {
		let nested;
		const policy = gate();
		const { session } = await createFlowSession(t, {
			policy,
			tools: ["codemode", "mcp__fixture__fetch"],
			extensions: [
				(pi) => {
					pi.registerTool({
						name: "mcp__fixture__fetch",
						label: "fetch",
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async () => request("mcp__fixture__fetch", text).result,
					});
					pi.registerTool({
						name: "codemode",
						label: "code",
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async (_id, _args, signal, _update, ctx) => {
							nested = await ctx.executeTool("mcp__fixture__fetch", {}, { signal });
							return { content: [{ type: "text", text: JSON.stringify(nested.result) }], details: {} };
						},
					});
				},
			],
		});
		let first = true;
		session.agent.streamFunction = async () => {
			const final = assistant();
			if (first) {
				first = false;
				final.stopReason = "toolUse";
				final.content = [{ type: "toolCall", id: "outer", name: "codemode", arguments: {} }];
			}
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "done", partial: final };
				},
				result: async () => final,
			};
		};
		await session.prompt("fixture");
		assert.ok(nested, JSON.stringify(session.messages));
		if (text.startsWith("PRIVATE")) {
			assert.equal(nested.isError, true);
			assert.equal(nested.result.structuredContent, undefined);
			assert.equal(JSON.stringify(nested).includes("PRIVATE"), false);
		} else assert.deepEqual(nested.result.structuredContent, { nested: [{ text }] });
	});
}

test("cancelled final admission cannot release raw structured values or terminate the turn", async (t) => {
	const policy = gate("strict", async () => {
		throw new Error("scanner must not run after cancellation");
	});
	const { session } = await createFlowSession(t, { policy });
	Object.defineProperty(session.agent, "signal", { value: AbortSignal.abort(), configurable: true });
	const input = request("mcp__fixture__fetch", "PRIVATE cancelled result");
	const admitted = await session._afterToolCall({
		toolCall: { type: "toolCall", id: input.toolCallId, name: input.toolName, arguments: input.input },
		args: input.input,
		result: { ...input.result, terminate: true },
		isError: false,
		assistantMessage: assistant(),
		context: { messages: session.messages, tools: session.agent.state.tools },
	});
	assert.equal(admitted.isError, true);
	assert.equal(admitted.terminate, false);
	assert.equal(admitted.structuredContent, undefined);
	assert.equal(JSON.stringify(admitted).includes("PRIVATE"), false);
});

for (const scenario of [
	"strict usage",
	"guarded usage",
	"strict opaque",
	"guarded opaque",
	"clear usage",
	"cancelled",
	"scanner failure",
	"nonconfigurable",
	"strict inherited usage",
	"guarded inherited usage",
	"inherited cancelled",
	"inherited scanner failure",
	"inherited clear usage",
	"inherited uninspected",
	"inherited off",
	"uninspected",
	"off",
]) {
	test(`nested admission cannot restore rejected metadata: ${scenario}`, async (t) => {
		let nested;
		const requests = [];
		const mode = scenario.startsWith("guarded") ? "guarded" : scenario.endsWith("off") ? "off" : "strict";
		const policy = gate(mode, async (text) => {
			if (scenario.endsWith("scanner failure")) throw new Error("fixture scanner failure");
			return text.includes("PRIVATE") ? flagged : clear;
		});
		const usage = assistant().usage;
		const toolName = scenario.endsWith("uninspected") ? "trusted_fixture" : "mcp__fixture__fetch";
		const raw = {
			content: [{ type: "text", text: "public result" }],
			details: {},
			usage:
				scenario.includes("opaque") || scenario.endsWith("clear usage")
					? usage
					: { ...usage, rawBody: "PRIVATE usage metadata" },
			...(scenario.endsWith("clear usage") ? { terminate: true } : { opaqueBody: "PRIVATE unknown metadata" }),
		};
		if (scenario.includes("inherited")) {
			Object.setPrototypeOf(raw, { usage: raw.usage });
			delete raw.usage;
		}
		if (scenario === "nonconfigurable")
			Object.defineProperty(raw, "PRIVATE property name", {
				value: "PRIVATE fixed metadata",
				enumerable: true,
				configurable: false,
			});
		const { session } = await createFlowSession(t, {
			policy,
			tools: ["nested_fixture", toolName],
			extensions: [
				(pi) => {
					pi.registerTool({
						name: toolName,
						label: "fetch",
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							if (scenario.endsWith("cancelled"))
								Object.defineProperty(session.agent, "signal", { value: AbortSignal.abort(), configurable: true });
							return raw;
						},
					});
					// The parent is an ordinary, uninspected tool, so it cannot hide a leak with a second scan.
					pi.registerTool({
						name: "nested_fixture",
						label: "parent",
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async (_id, _args, signal, _update, ctx) => {
							nested = await ctx.executeTool(toolName, {}, { signal });
							return { content: [{ type: "text", text: JSON.stringify(nested.result) }], details: {} };
						},
					});
				},
			],
		});
		let first = true;
		session.agent.streamFunction = async (_model, context) => {
			requests.push(structuredClone(context.messages));
			const final = assistant();
			if (first) {
				first = false;
				final.stopReason = "toolUse";
				final.content = [{ type: "toolCall", id: "outer", name: "nested_fixture", arguments: {} }];
			}
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "done", partial: final };
				},
				result: async () => final,
			};
		};
		await session.prompt("fixture");
		assert.ok(nested, JSON.stringify(session.messages));
		if (scenario.endsWith("off") || scenario.endsWith("uninspected")) {
			assert.equal(nested.result.opaqueBody, "PRIVATE unknown metadata");
			assert.equal(nested.result.usage.rawBody, "PRIVATE usage metadata");
			if (scenario.includes("inherited")) assert.ok(Object.getPrototypeOf(raw).usage);
		} else {
			assert.equal(JSON.stringify(nested).includes("PRIVATE"), false);
			assert.equal(JSON.stringify(requests).includes("PRIVATE"), false);
			assert.equal(nested.result.opaqueBody, undefined);
			if (scenario.includes("opaque") || scenario.endsWith("clear usage")) assert.deepEqual(nested.result.usage, usage);
			else assert.equal(nested.result.usage, undefined);
			if (scenario.endsWith("clear usage")) assert.equal(nested.result.terminate, true);
			if (
				(scenario.startsWith("strict") && scenario.endsWith("usage")) ||
				/cancelled|scanner failure|nonconfigurable/.test(scenario)
			)
				assert.equal(nested.isError, true);
		}
	});
}

test("checked nested progress callbacks are refused before any tool side effect", async (t) => {
	let executions = 0;
	let progress = 0;
	const { session } = await createFlowSession(t, {
		policy: gate(),
		tools: ["web_fetch"],
		extensions: [
			(pi) => {
				pi.registerTool({
					name: "web_fetch",
					label: "fetch",
					description: "Fixture",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						executions++;
						return request("web_fetch").result;
					},
				});
			},
		],
	});
	await assert.rejects(
		session._executeNestedToolCall("outer", "web_fetch", {}, { onUpdate: () => progress++ }),
		/Use the final result/,
	);
	assert.equal(executions, 0);
	assert.equal(progress, 0);
});
