import assert from "node:assert/strict";
import { test } from "node:test";
import { assistant, createFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { createChildToolPolicy } from "../dist/subagents/tool-policy.js";

function scriptedCall(session, name) {
	let first = true;
	session.agent.streamFunction = async () => {
		const final = assistant();
		if (first) {
			first = false;
			final.content = [{ type: "toolCall", id: "outer", name, arguments: {} }];
			final.stopReason = "toolUse";
		}
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: "done", partial: final };
			},
			result: async () => final,
		};
	};
}
const definition = (name, execute, extra = {}) => ({
	name,
	label: name,
	description: "Fixture",
	parameters: { type: "object", properties: {} },
	execute,
	...extra,
});
const result = () => ({ content: [{ type: "text", text: "Done" }], details: {} });

test("the child tool budget counts nested calls before their side effects", async (t) => {
	let executions = 0;
	let exhausted = 0;
	const outcomes = [];
	const { session } = await createFlowSession(t, {
		tools: ["caller", "read"],
		extensions: [
			createChildToolPolicy({ maxCalls: 2, onExhausted: () => exhausted++ }),
			(pi) => {
				pi.registerTool(
					definition("read", async () => {
						executions++;
						return result();
					}),
				);
				pi.registerTool(
					definition("caller", async (_id, _args, signal, _update, ctx) => {
						for (let index = 0; index < 2; index++) outcomes.push(await ctx.executeTool("read", {}, { signal }));
						return result();
					}),
				);
			},
		],
	});
	scriptedCall(session, "caller");
	await session.prompt("fixture");
	assert.equal(executions, 1);
	assert.equal(exhausted, 1);
	assert.equal(outcomes[0].isError, false);
	assert.equal(outcomes[1].isError, true);
	assert.match(outcomes[1].result.content[0].text, /Tool limit reached/);
});

test("the same child tool budget also applies to direct calls", async (t) => {
	let executions = 0;
	let exhausted = 0;
	const { session } = await createFlowSession(t, {
		tools: ["read"],
		extensions: [
			createChildToolPolicy({ maxCalls: 1, onExhausted: () => exhausted++ }),
			(pi) => {
				pi.registerTool(
					definition("read", async () => {
						executions++;
						return result();
					}),
				);
			},
		],
	});
	for (let index = 0; index < 2; index++) {
		scriptedCall(session, "read");
		await session.prompt("fixture");
	}
	assert.equal(executions, 1);
	assert.equal(exhausted, 1);
});

test("a deferred callable tool cannot bypass the child's active-tool permission check", async (t) => {
	let executions = 0;
	let nested;
	const { session } = await createFlowSession(t, {
		tools: ["caller", "hidden"],
		extensions: [
			createChildToolPolicy({ maxCalls: 10, onExhausted: () => assert.fail("unexpected exhaustion") }),
			(pi) => {
				pi.registerTool(
					definition(
						"hidden",
						async () => {
							executions++;
							return result();
						},
						{ exposure: "deferred" },
					),
				);
				pi.registerTool(
					definition("caller", async (_id, _args, signal, _update, ctx) => {
						nested = await ctx.executeTool("hidden", {}, { signal });
						return result();
					}),
				);
			},
		],
	});
	session.setActiveToolsByName(["caller"]);
	assert.ok(session.getCallableToolNames().includes("hidden"), "the fixture must expose the upstream nested-call path");
	scriptedCall(session, "caller");
	await session.prompt("fixture");
	assert.equal(executions, 0);
	assert.equal(nested.isError, true);
	assert.match(nested.result.content[0].text, /not enabled for this child session/);
});
