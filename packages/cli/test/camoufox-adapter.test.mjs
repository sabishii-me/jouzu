import assert from "node:assert/strict";
import { test } from "node:test";
import { createJouzuCamoufoxExtension, projectCamoufoxToolResult } from "../dist/camoufox-adapter.js";
import { resolveCatalog } from "../dist/locale-catalog.js";

const textOf = (result) =>
	result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");

/** A pi stub that records registered tools without loading the Camoufox runtime. */
function toolHarness() {
	const tools = new Map();
	return {
		tools,
		pi: {
			registerTool: (tool) => tools.set(tool.name, tool),
			on: () => {},
		},
	};
}

test("the browser tool labels come from the resolved catalog in both locales", () => {
	const english = toolHarness();
	createJouzuCamoufoxExtension(english.pi, "/tmp/jouzu-unused-state-dir");
	assert.equal(english.tools.get("tff-fetch_url").label, "Fetch URL");
	assert.equal(english.tools.get("tff-search_web").label, "Search web");

	const japanese = toolHarness();
	createJouzuCamoufoxExtension(japanese.pi, "/tmp/jouzu-unused-state-dir", {
		catalog: resolveCatalog("ja").bundle,
	});
	assert.equal(japanese.tools.get("tff-fetch_url").label, "URL を取得");
	assert.equal(japanese.tools.get("tff-search_web").label, "ウェブを検索");
});

test("the tool names and parameter names are protocol values and stay unchanged", () => {
	const { tools, pi } = toolHarness();
	createJouzuCamoufoxExtension(pi, "/tmp/jouzu-unused-state-dir", {
		catalog: resolveCatalog("ja").bundle,
	});
	const fetch = tools.get("tff-fetch_url");
	const search = tools.get("tff-search_web");
	assert.equal(fetch.name, "tff-fetch_url");
	assert.equal(search.name, "tff-search_web");
	assert.deepEqual(Object.keys(fetch.parameters.properties).sort(), [
		"format",
		"isolate",
		"max_bytes",
		"render_mode",
		"screenshot",
		"selector",
		"timeout_ms",
		"url",
		"wait_for_selector",
	]);
	assert.deepEqual(Object.keys(search.parameters.properties).sort(), ["engine", "max_results", "query", "timeout_ms"]);
});

test("the screenshot result lines render from the resolved catalog in both locales", () => {
	const result = (details) =>
		projectCamoufoxToolResult("tff-fetch_url", {
			content: [{ type: "text", text: "header" }],
			details,
		});
	const attached = { screenshot: { mimeType: "image/jpeg", data: "AAAA", bytes: 3 } };
	assert.match(textOf(result(attached)), /screenshot: image\/jpeg, 3 B attached to this result\./);

	const japanese = resolveCatalog("ja").bundle;
	const attachedJa = projectCamoufoxToolResult(
		"tff-fetch_url",
		{ content: [{ type: "text", text: "header" }], details: attached },
		japanese,
	);
	assert.match(textOf(attachedJa), /スクリーンショット: image\/jpeg、3 B をこの結果に添付しました。/);

	const oversized = { screenshot: { mimeType: "image/png", data: "x".repeat(64), bytes: 2 * 1024 * 1024 } };
	const omittedJa = projectCamoufoxToolResult(
		"tff-fetch_url",
		{ content: [{ type: "text", text: "header" }], details: oversized },
		japanese,
	);
	assert.match(
		textOf(omittedJa),
		/スクリーンショットを省略: 2\.0 MiB が添付上限 1\.0 MiB を超えています。screenshot\.full_page=false で再試行するか、screenshot\.quality を下げてください。/,
	);
});
