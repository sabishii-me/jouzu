import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMOUFOX_CONTENT_CHAR_LIMIT, lazyTool, projectCamoufoxToolResult } from "../dist/camoufox-adapter.js";

const textOf = (result) =>
	result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");

const tenResults = Array.from({ length: 10 }, (_value, index) => ({
	rank: index + 1,
	title: `Title ${index + 1}`,
	url: `https://example.com/${index + 1}`,
	snippet: `Snippet ${index + 1}`,
}));

const searchResult = (details) => ({
	content: [{ type: "text", text: `search_web "q" via duckduckgo → ${details.results.length} result(s)` }],
	details,
});

const fetchResult = (details) => ({
	content: [{ type: "text", text: `fetch_url ${details.url} → ${details.status} (${details.bytes} markdown bytes)` }],
	details,
});

test("search promotes every result, not only the first three", () => {
	const details = { engine: "duckduckgo", query: "q", atLimit: true, results: tenResults };
	const projected = projectCamoufoxToolResult("tff-search_web", searchResult(details));
	const body = textOf(projected);
	for (const result of tenResults) {
		assert.ok(body.includes(result.url), `missing ${result.url}`);
		assert.ok(body.includes(result.title), `missing ${result.title}`);
	}
	assert.ok(body.includes("Snippet 10"), "snippet of the last result is absent");
});

test("search keeps its structured details for the renderer", () => {
	const details = { engine: "duckduckgo", query: "q", atLimit: true, results: tenResults };
	const projected = projectCamoufoxToolResult("tff-search_web", searchResult(details));
	assert.deepEqual(projected.details, details);
});

test("an empty search result list is reported as inconclusive", () => {
	const projected = projectCamoufoxToolResult("tff-search_web", searchResult({ engine: "duckduckgo", results: [] }));
	const body = textOf(projected);
	assert.match(body, /0 result\(s\)/);
	assert.match(body, /inconclusive/);
});

test("a result count at max_results is reported as possibly incomplete", () => {
	const details = { engine: "duckduckgo", query: "q", atLimit: true, results: tenResults };
	const body = textOf(projectCamoufoxToolResult("tff-search_web", searchResult(details)));
	assert.match(body, /10 results, the requested maximum/);
	assert.match(body, /may have had more matches/);
});

test("a result count below max_results carries no completeness note", () => {
	const details = { engine: "duckduckgo", query: "q", atLimit: false, results: tenResults };
	const body = textOf(projectCamoufoxToolResult("tff-search_web", searchResult(details)));
	assert.doesNotMatch(body, /requested maximum/);
});

test("fetch promotes a markdown body into the tool result", () => {
	const markdown = "# Heading\n\nBody text.";
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({ url: "https://example.com", status: 200, format: "markdown", markdown, bytes: 21 }),
	);
	assert.ok(textOf(projected).includes(markdown));
});

test("fetch promotes an html body when html was requested", () => {
	const html = "<html><body>Hello</body></html>";
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({ url: "https://example.com", status: 200, format: "html", html, bytes: 31 }),
	);
	assert.ok(textOf(projected).includes(html));
});

test("fetch keeps the body once, in content, and leaves the fetch metadata in details", () => {
	const markdown = "# Heading\n\nBody text.";
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({
			url: "https://example.com",
			finalUrl: "https://example.com/",
			status: 200,
			format: "markdown",
			markdown,
			bytes: 21,
			truncated: false,
			renderMode: "render",
		}),
	);
	assert.ok(textOf(projected).includes(markdown));
	assert.equal("markdown" in projected.details, false);
	assert.equal("html" in projected.details, false);
	assert.deepEqual(projected.details, {
		url: "https://example.com",
		finalUrl: "https://example.com/",
		status: 200,
		format: "markdown",
		bytes: 21,
		truncated: false,
		renderMode: "render",
	});
});

test("fetch drops an html body from details too", () => {
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({ url: "https://example.com", status: 200, format: "html", html: "<p>hi</p>", bytes: 9 }),
	);
	assert.equal("html" in projected.details, false);
	assert.equal(projected.details.format, "html");
});

test("an oversized body is capped and marked as truncated", () => {
	const markdown = "x".repeat(CAMOUFOX_CONTENT_CHAR_LIMIT + 5_000);
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({ url: "https://example.com", status: 200, format: "markdown", markdown }),
	);
	const body = textOf(projected);
	assert.ok(body.includes("[truncated at"), "the truncation marker is absent");
	assert.ok(body.length < markdown.length, "the projected body was not capped");
});

test("a non-text content block survives projection", () => {
	const image = { type: "image", data: "aGk=", mimeType: "image/png" };
	const projected = projectCamoufoxToolResult("tff-fetch_url", {
		content: [image],
		details: { url: "https://example.com", status: 200, format: "html", html: "<p>hi</p>" },
	});
	assert.deepEqual(
		projected.content.filter((block) => block.type !== "text"),
		[image],
	);
});

test("the registered tool projects its delegate's payload into content", async () => {
	const delegateResult = fetchResult({
		url: "https://example.com",
		status: 200,
		format: "markdown",
		markdown: "# Heading",
		bytes: 9,
	});
	const tool = lazyTool(
		{ name: "tff-fetch_url", label: "Fetch URL", description: "Fetch a URL.", parameters: {} },
		async () => ({ execute: async () => delegateResult }),
	);
	const result = await tool.execute("call-1", {}, undefined, undefined, undefined);
	assert.ok(textOf(result).includes("# Heading"), "the delegate payload did not reach content");
	assert.equal("markdown" in result.details, false);
});

test("the registered tool leaves an unrecognized tool name unchanged", async () => {
	const delegateResult = {
		content: [{ type: "text", text: "summary" }],
		details: { markdown: "# Heading" },
	};
	const tool = lazyTool(
		{ name: "tff-unknown", label: "Unknown", description: "Unknown tool.", parameters: {} },
		async () => ({ execute: async () => delegateResult }),
	);
	const result = await tool.execute("call-1", {}, undefined, undefined, undefined);
	assert.deepEqual(result.content, delegateResult.content);
	assert.deepEqual(result.details, delegateResult.details);
});

test("a screenshot under the limit is attached and dropped from details", () => {
	const data = "aGk=";
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({
			url: "https://example.com",
			status: 200,
			format: "html",
			html: "<p>hi</p>",
			bytes: 9,
			screenshot: { encoding: "base64", mimeType: "image/jpeg", data, bytes: 3 },
		}),
	);
	assert.deepEqual(
		projected.content.filter((block) => block.type === "image"),
		[{ type: "image", data, mimeType: "image/jpeg" }],
	);
	assert.match(textOf(projected), /screenshot: image\/jpeg, 3 B attached to this result\./);
	assert.equal("screenshot" in projected.details, false);
});

test("a screenshot over the limit is reported instead of attached", () => {
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({
			url: "https://example.com",
			status: 200,
			format: "html",
			html: "<p>hi</p>",
			bytes: 9,
			screenshot: { encoding: "base64", mimeType: "image/png", data: "x".repeat(64), bytes: 2 * 1024 * 1024 },
		}),
	);
	assert.equal(projected.content.filter((block) => block.type === "image").length, 0);
	assert.match(textOf(projected), /screenshot omitted: 2\.0 MiB exceeds the 1\.0 MiB attachment limit/);
	assert.equal("screenshot" in projected.details, false);
});

test("a screenshot without a byte count is measured from its encoded data", () => {
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({
			url: "https://example.com",
			status: 200,
			format: "html",
			html: "<p>hi</p>",
			bytes: 9,
			screenshot: { mimeType: "image/png", data: "x".repeat(4 * 1024 * 1024) },
		}),
	);
	assert.equal(projected.content.filter((block) => block.type === "image").length, 0);
	assert.match(textOf(projected), /3\.0 MiB exceeds the 1\.0 MiB attachment limit/);
});

test("a fetch without a screenshot adds no image and no note", () => {
	const projected = projectCamoufoxToolResult(
		"tff-fetch_url",
		fetchResult({ url: "https://example.com", status: 200, format: "html", html: "<p>hi</p>", bytes: 9 }),
	);
	assert.equal(projected.content.filter((block) => block.type === "image").length, 0);
	assert.doesNotMatch(textOf(projected), /screenshot/);
});

const fetchToolWithParams = (seen) =>
	lazyTool({ name: "tff-fetch_url", label: "Fetch URL", description: "Fetch a URL.", parameters: {} }, async () => ({
		execute: async (_toolCallId, params) => {
			seen.params = params;
			return fetchResult({ url: "https://example.com", status: 200, format: "html", html: "<p>hi</p>", bytes: 9 });
		},
	}));

test("a screenshot request without a format is sent as jpeg", async () => {
	const seen = {};
	const tool = fetchToolWithParams(seen);
	await tool.execute(
		"call-1",
		{ url: "https://example.com", screenshot: { full_page: true } },
		undefined,
		undefined,
		undefined,
	);
	assert.deepEqual(seen.params.screenshot, { full_page: true, format: "jpeg" });
});

test("an explicit screenshot format is preserved", async () => {
	const seen = {};
	const tool = fetchToolWithParams(seen);
	await tool.execute(
		"call-1",
		{ url: "https://example.com", screenshot: { format: "png", full_page: false } },
		undefined,
		undefined,
		undefined,
	);
	assert.deepEqual(seen.params.screenshot, { format: "png", full_page: false });
});

test("a fetch without a screenshot passes its parameters through", async () => {
	const seen = {};
	const tool = fetchToolWithParams(seen);
	await tool.execute("call-1", { url: "https://example.com" }, undefined, undefined, undefined);
	assert.deepEqual(seen.params, { url: "https://example.com" });
});
