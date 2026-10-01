import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, createFlowSession, model } from "../../../scripts/fixtures/pi-flow-session.mjs";
import {
	classicHostBuiltinOverrides,
	createDirectToolPolicyExtension,
	requiresDirectToolCall,
} from "../dist/classic-host-policy.js";

const directTools = [
	"agent_wait",
	"agent_wait_cancel",
	"agent_no_reply",
	"agent_results",
	"subagent",
	"bg_task",
	"bg_status",
	"schedule_prompt",
	"compact_context",
	"get_goal",
	"update_goal",
	"TaskCreateMany",
	"TaskCreate",
	"TaskGet",
	"TaskList",
	"TaskUpdate",
	"TaskReorder",
	"TaskExecute",
	"TaskOutput",
	"TaskStop",
	"multiloop_start",
	"multiloop_iterate",
	"multiloop_measure",
	"multiloop_decide",
	"multiloop_log",
	"multiloop_resume",
	"multiloop_pause",
	"multiloop_stop",
	"multiloop_archive",
];

test("receipt-sensitive tools require direct calls; ordinary tools remain callable", () => {
	for (const name of directTools) assert.equal(requiresDirectToolCall(name), true, name);
	for (const name of ["read", "write", "edit", "bash", "web_fetch", "mcp__docs__search", "codemode"])
		assert.equal(requiresDirectToolCall(name), false, name);
});

for (const name of [
	"agent_wait",
	"agent_no_reply",
	"bg_task",
	"subagent",
	"TaskUpdate",
	"schedule_prompt",
	"multiloop_start",
]) {
	test(`nested ${name} is blocked before side effects, while a direct call executes`, async (t) => {
		let executions = 0;
		let nested;
		const { session } = await createFlowSession(t, {
			tools: ["fanout", name],
			extensions: [
				createDirectToolPolicyExtension(),
				(pi) => {
					pi.registerTool({
						name,
						label: name,
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							executions++;
							return { content: [{ type: "text", text: "observed directly" }], details: {} };
						},
					});
					pi.registerTool({
						name: "fanout",
						label: "fanout",
						description: "Fixture",
						parameters: { type: "object", properties: {} },
						execute: async (_id, _args, signal, _update, ctx) => {
							nested = await ctx.executeTool(name, {}, { signal });
							return { content: [{ type: "text", text: "fanout finished" }], details: {} };
						},
					});
				},
			],
		});
		let call;
		session.agent.streamFunction = async () => {
			const final = assistant();
			if (call) {
				final.content = [{ type: "toolCall", id: "outer", name: call, arguments: {} }];
				final.stopReason = "toolUse";
				call = undefined;
			}
			return {
				async *[Symbol.asyncIterator]() {
					yield { type: "done", partial: final };
				},
				result: async () => final,
			};
		};
		call = "fanout";
		await session.prompt("nested call");
		assert.equal(executions, 0);
		assert.equal(nested.isError, true);
		assert.match(nested.result.content[0].text, /Call .* directly/);
		assert.equal(
			session.messages.some((message) => message.role === "toolResult" && message.toolName === name),
			false,
		);
		call = name;
		await session.prompt("direct call");
		assert.equal(executions, 1);
		assert.ok(
			session.messages.some(
				(message) => message.role === "toolResult" && message.toolName === name && !message.isError,
			),
		);
	});
}

for (const guard of ["flow", "content"]) {
	test(`a virtual selection is withheld before routing under ${guard} admission`, async (t) => {
		const { session, requests } = await createFlowSession(t, {
			model: { ...model, api: "pi-virtual" },
			...(guard === "flow"
				? { ingress: { version: 1, submit: (_input, dispatch) => dispatch() } }
				: {
						policy: {
							filterSkills: async (skills) => skills,
							readSkill: async () => undefined,
							shouldInspectTool: () => true,
							filterToolResult: async (event) => event.result,
							filterContext: async (messages) => messages,
						},
					}),
		});
		let routed = 0;
		session.modelRuntime.resolveModel = async () => {
			routed++;
			throw new Error("router must not run");
		};
		await session.prompt("route a request");
		assert.equal(routed, 0);
		assert.equal(requests.length, 0);
		assert.ok(
			session.messages.some(
				(message) => message.role === "assistant" && /physical model/.test(message.errorMessage ?? ""),
			),
		);
		await assert.rejects(session._getSummarizationRequestAuth(session.model), /physical model/);
		assert.equal(routed, 0);
	});
}

test("classic built-in overrides prevent server instructions and script model requests", async (t) => {
	let started = 0;
	const { session, requests } = await createFlowSession(t, {
		additionalExtensionPaths: ["builtin:mcp", "builtin:codemode"],
		extensions: [
			{
				name: "mcp",
				builtin: true,
				factory: () => {
					started++;
					throw new Error("native server must not start");
				},
			},
			{
				name: "codemode",
				builtin: true,
				factory: () => {
					started++;
					throw new Error("native script runtime must not start");
				},
			},
			...classicHostBuiltinOverrides(),
		],
	});
	await session.prompt("ordinary turn");
	assert.equal(started, 0);
	assert.equal(requests.length, 1);
	assert.ok(session.extensionRunner.getCommand("mcp"));
	assert.equal(
		session.getAllTools().some((tool) => tool.name.startsWith("mcp__") || tool.name === "codemode"),
		false,
	);
});
