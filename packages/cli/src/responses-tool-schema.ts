import type { InlineExtension } from "@earendil-works/pi-coding-agent";

// OpenAPI numeric annotations can make Codex return an empty
// incomplete.max_output_tokens response, including for a nullable int32 alone.
// JSON Schema types and explicit bounds carry the numeric argument contract.
const NUMERIC_FORMATS = new Set([
	"int8",
	"int16",
	"int32",
	"int64",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"float",
	"double",
]);
const SCHEMA_MAPS = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"dependentSchemas",
	"dependencies",
]);
const SCHEMA_ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_VALUES = new Set([
	"items",
	"additionalItems",
	"additionalProperties",
	"unevaluatedItems",
	"unevaluatedProperties",
	"contains",
	"propertyNames",
	"not",
	"if",
	"then",
	"else",
	"contentSchema",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copy only changed branches; defaults, examples and other data are not schemas. */
function normalizeSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return mapChanged(schema, normalizeSchema);
	if (!isRecord(schema)) return schema;
	let result = schema;
	if (typeof schema.format === "string" && NUMERIC_FORMATS.has(schema.format)) {
		result = { ...schema };
		delete result.format;
	}
	for (const [key, value] of Object.entries(schema)) {
		let next = value;
		if (SCHEMA_MAPS.has(key) && isRecord(value)) {
			const entries = Object.entries(value).map(([name, child]) => [name, normalizeSchema(child)] as const);
			if (entries.some(([name, child]) => child !== value[name])) next = Object.fromEntries(entries);
		} else if (SCHEMA_ARRAYS.has(key) && Array.isArray(value)) {
			next = mapChanged(value, normalizeSchema);
		} else if (SCHEMA_VALUES.has(key)) {
			next = normalizeSchema(value);
		}
		if (next !== value) {
			if (result === schema) result = { ...schema };
			result[key] = next;
		}
	}
	return result;
}

function mapChanged(values: unknown[], convert: (value: unknown) => unknown): unknown[] {
	const result = values.map(convert);
	return result.some((value, index) => value !== values[index]) ? result : values;
}

function normalizeTool(tool: unknown): unknown {
	if (!isRecord(tool)) return tool;
	if (tool.type === "namespace") return normalizeToolList(tool);
	if (tool.type !== "function") return tool;
	const parameters = normalizeSchema(tool.parameters);
	return parameters === tool.parameters ? tool : { ...tool, parameters };
}

function normalizeToolList(value: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(value.tools)) return value;
	const tools = mapChanged(value.tools, normalizeTool);
	return tools === value.tools ? value : { ...value, tools };
}

/** Normalize transport declarations, including tools restored from session history. */
export function normalizeResponsesToolSchemas(model: { api: string }, payload: unknown): unknown {
	if (!["openai-responses", "openai-codex-responses", "azure-openai-responses"].includes(model.api)) return payload;
	if (!isRecord(payload)) return payload;
	const result = normalizeToolList(payload);
	if (!Array.isArray(result.input)) return result;
	const input = mapChanged(result.input, (item) =>
		isRecord(item) && (item.type === "additional_tools" || item.type === "tool_search_output")
			? normalizeToolList(item)
			: item,
	);
	return input === result.input ? result : { ...result, input };
}

export function createResponsesToolSchemaExtension(): InlineExtension {
	return {
		name: "jouzu-responses-tool-schema",
		factory(pi) {
			pi.on("before_provider_request", (event) => {
				if (!event.request) return;
				return normalizeResponsesToolSchemas(event.request.model, event.payload);
			});
		},
	};
}
