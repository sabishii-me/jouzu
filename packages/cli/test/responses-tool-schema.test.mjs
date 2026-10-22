import assert from "node:assert/strict";
import { test } from "node:test";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { createResponsesToolSchemaExtension, normalizeResponsesToolSchemas } from "../dist/responses-tool-schema.js";

const model = {
	id: "gpt-6-astra",
	name: "Astra fixture",
	api: "openai-responses",
	provider: "catalog:fixture",
	baseUrl: "https://fixture.invalid/v1",
	reasoning: true,
	thinkingLevelMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
	input: ["text"],
	contextWindow: 1050000,
	maxTokens: 128000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const nullableInteger = { anyOf: [{ type: "integer" }, { type: "null" }], format: "int32", default: null };
const parameters = () => ({
	type: "object",
	properties: {
		settings: {
			anyOf: [{ type: "object", properties: { delay: structuredClone(nullableInteger) } }, { type: "null" }],
		},
		level: { anyOf: [{ type: "integer" }, { type: "null" }], format: "uint8", minimum: 0, maximum: 255 },
		format: { type: "string", default: "json", enum: ["json", "table"] },
		timestamp: { type: "string", format: "date-time" },
	},
	required: ["settings"],
	additionalProperties: false,
});
const tool = () => ({ type: "function", name: "device", strict: false, parameters: parameters() });

test("Responses tool schemas omit numeric format annotations and preserve the argument contract", () => {
	const payload = { model: model.id, tools: [tool()], input: [{ role: "user", content: "Continue" }] };
	const original = structuredClone(payload);
	const normalized = normalizeResponsesToolSchemas(model, payload);
	assert.notEqual(normalized, payload);
	assert.equal(normalized.tools[0].parameters.properties.settings.anyOf[0].properties.delay.format, undefined);
	assert.equal(normalized.tools[0].parameters.properties.level.format, undefined);
	const expected = structuredClone(original);
	delete expected.tools[0].parameters.properties.settings.anyOf[0].properties.delay.format;
	delete expected.tools[0].parameters.properties.level.format;
	assert.deepEqual(normalized, expected);
	assert.deepEqual(payload, original, "saved tool definitions must remain untouched");
	assert.equal(normalized.input, payload.input);
	assert.equal(normalizeResponsesToolSchemas(model, normalized), normalized);
});

test("schema traversal preserves data literals, format-named properties and supported string formats", () => {
	const literal = { format: "int32", properties: { value: { format: "uint8" } } };
	const schema = {
		type: "object",
		properties: { format: { type: "string" }, example: { const: literal, default: literal, examples: [literal] } },
		$defs: { number: { type: "number", format: "double", minimum: 0 } },
		patternProperties: { "^n": { type: "integer", format: "int64" } },
		additionalProperties: { type: "number", format: "float" },
		allOf: [{ properties: { values: { type: "array", items: { ...nullableInteger } } } }],
	};
	const payload = { tools: [{ ...tool(), parameters: schema }] };
	const normalized = normalizeResponsesToolSchemas(model, payload).tools[0].parameters;
	assert.equal(normalized.$defs.number.format, undefined);
	assert.equal(normalized.patternProperties["^n"].format, undefined);
	assert.equal(normalized.additionalProperties.format, undefined);
	assert.equal(normalized.allOf[0].properties.values.items.format, undefined);
	assert.deepEqual(normalized.properties, schema.properties);
	assert.deepEqual(normalized.$defs.number, { type: "number", minimum: 0 });
});

test("deferred Responses tool declarations are normalized without altering conversation content", () => {
	const text = { role: "user", content: [{ type: "input_text", text: JSON.stringify(nullableInteger) }] };
	const payload = {
		tools: [{ type: "namespace", name: "devices", tools: [tool()] }],
		input: [
			text,
			{ type: "additional_tools", role: "developer", tools: [tool()] },
			{ type: "tool_search_output", call_id: "search", tools: [{ ...tool(), defer_loading: true }] },
			{ type: "function_call_output", call_id: "data", output: JSON.stringify(nullableInteger) },
		],
	};
	const result = normalizeResponsesToolSchemas(model, payload);
	for (const t of [result.tools[0].tools[0], ...result.input[1].tools, ...result.input[2].tools]) {
		assert.equal(t.parameters.properties.level.format, undefined);
	}
	assert.equal(result.input[0], text);
	assert.equal(result.input[3], payload.input[3]);
	assert.equal(result.input[2].tools[0].defer_loading, true);
});

test("normalization uses the prepared Responses protocol and leaves other payloads alone", () => {
	const payload = { tools: [tool()] };
	for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
		assert.notEqual(normalizeResponsesToolSchemas({ api }, payload), payload);
	}
	for (const api of ["anthropic-messages", "google-generative-ai", "openai-completions"]) {
		assert.equal(normalizeResponsesToolSchemas({ api }, payload), payload);
	}
	const grammar = { tools: [{ type: "custom", name: "grammar", format: { type: "grammar", definition: "root" } }] };
	assert.equal(normalizeResponsesToolSchemas(model, grammar), grammar);
	for (const value of [null, [], "text", { tools: [] }, { input: "Hello" }]) {
		assert.equal(normalizeResponsesToolSchemas(model, value), value);
	}
	const handlers = new Map();
	createResponsesToolSchemaExtension().factory({ on: (name, handler) => handlers.set(name, handler) });
	const handler = handlers.get("before_provider_request");
	assert.equal(handler({ payload }), undefined);
	assert.equal(handler({ payload, request: { model: { api: "anthropic-messages" } } }, { model }), payload);
	assert.notEqual(handler({ payload, request: { model } }, { model: { api: "anthropic-messages" } }), payload);
});

test("Pi sends normalized tool schemas through the Responses transport without changing saved schemas", async () => {
	const handlers = new Map();
	createResponsesToolSchemaExtension().factory({ on: (name, handler) => handlers.set(name, handler) });
	const schema = parameters();
	const before = structuredClone(schema);
	const messages = [
		{
			role: "system",
			content: "Test",
			toolsAdded: [{ name: "device", description: "Device settings", parameters: schema }],
			timestamp: 1,
		},
		{ role: "user", content: "Reply OK", timestamp: 2 },
	];
	let body;
	await streamSimple(
		model,
		{ messages },
		{
			apiKey: "fixture",
			reasoning: "xhigh",
			onPayload: (payload, selected) =>
				handlers.get("before_provider_request")({ payload, request: { model: selected } }),
			fetch: async (_url, init) => {
				body = JSON.parse(init.body);
				return new Response(JSON.stringify({ error: { message: "fixture capture" } }), {
					status: 400,
					headers: { "content-type": "application/json" },
				});
			},
		},
	).result();
	assert.equal(body.tools[0].parameters.properties.level.format, undefined);
	assert.equal(body.tools[0].parameters.properties.settings.anyOf[0].properties.delay.format, undefined);
	assert.deepEqual(schema, before);
	assert.equal(body.reasoning.effort, "xhigh");
	assert.equal(body.max_output_tokens, 128000);
});
