import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function replaceOnce(source, before, after) {
	if (source.split(before).length !== 2) throw new Error(`WebAIO diagnostics anchor changed: ${before}`);
	return source.replace(before, after);
}

/** Keep Defuddle diagnostics on the fetch result, including when extraction falls back. */
export function transformWebaioDiagnosticCapture(source) {
	if (source.includes("// Jouzu Defuddle diagnostic capture")) return source;
	const renamed = replaceOnce(
		source,
		"export function createStaticWebFetcher(",
		"function jouzuOriginalCreateStaticWebFetcher(",
	);
	return `// Jouzu Defuddle diagnostic capture
import { createRequire as jouzuCreateRequire } from "node:module";
import { dirname as jouzuDirname, join as jouzuJoin } from "node:path";
const jouzuRequire = jouzuCreateRequire(import.meta.url);
const jouzuDiagnostics = jouzuRequire(jouzuJoin(jouzuDirname(jouzuRequire.resolve("defuddle")), "jouzu-diagnostics.cjs"));
${renamed}
export function createStaticWebFetcher(...dependencies) {
    const fetcher = jouzuOriginalCreateStaticWebFetcher(...dependencies);
    return async (...args) => {
        const captured = await jouzuDiagnostics.capture(() => fetcher(...args), redactErrorText);
        if (!captured.diagnostics.length && !captured.omitted) return captured.value;
        return {
            ...captured.value,
            extractionDiagnostics: captured.diagnostics.map(({level, message}) => ({level, message: redactErrorText(message)})),
            extractionDiagnosticsOmitted: captured.omitted,
        };
    };
}
`;
}

/** Persist bounded diagnostics in tool text and details, and display them inside the tool view. */
export function transformWebaioDiagnosticHistory(source) {
	if (source.includes("// Jouzu Defuddle diagnostic history")) return source;
	let renamed = source;
	for (const name of [
		"detailsFrom",
		"responseText",
		"batchResponseText",
		"createWebFetchTool",
		"createBatchWebFetchTool",
	])
		renamed = replaceOnce(renamed, `function ${name}(`, `function jouzuOriginal${name}(`);
	return `// Jouzu Defuddle diagnostic history
import { Container as JouzuDiagnosticContainer, Text as JouzuDiagnosticText } from "@earendil-works/pi-tui";
${renamed}
function jouzuDiagnosticText(result) {
    const diagnostics = result.extractionDiagnostics ?? [];
    const omitted = result.extractionDiagnosticsOmitted ?? 0;
    if (!diagnostics.length && !omitted) return "";
    const lines = diagnostics.map(entry => "- " + entry.level + ": " + entry.message);
    if (omitted) lines.push("- " + omitted + " additional diagnostics omitted.");
    return "Extraction diagnostics (Defuddle):\\n" + lines.join("\\n");
}
function detailsFrom(result) {
    const details = jouzuOriginaldetailsFrom(result);
    if (!result.extractionDiagnostics?.length && !result.extractionDiagnosticsOmitted) return details;
    return {...details, extractionDiagnostics: result.extractionDiagnostics, extractionDiagnosticsOmitted: result.extractionDiagnosticsOmitted};
}
function responseText(result) {
    const diagnostics = jouzuDiagnosticText(result);
    const text = jouzuOriginalresponseText(result);
    return diagnostics ? jouzuBoundDiagnosticText(diagnostics, 4000) + "\\n\\n" + text : text;
}
function jouzuBoundDiagnosticText(text, bytes) {
    const suffix = " [shortened; expand this tool for retained details]";
    const clean = String(text).replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, " ");
    if (Buffer.byteLength(clean) <= bytes) return clean;
    let bounded = "";
    for (const character of clean) {
        if (Buffer.byteLength(bounded + character + suffix) > bytes) break;
        bounded += character;
    }
    return bounded + suffix;
}
function batchResponseText(requests, results) {
    const summaries = results.flatMap((result, index) => {
        const diagnostics = jouzuDiagnosticText(result);
        if (!diagnostics) return [];
        const url = jouzuBoundDiagnosticText(redactStaticWebFetchUrl(requests[index].url), 200);
        return ["Request " + (index + 1) + ": " + url + "\\n" + jouzuBoundDiagnosticText(diagnostics, 1000)];
    });
    // Reserve at most 24 KB for all 20 requests' summaries before article text can fill the limit.
    const body = jouzuOriginalbatchResponseText(requests, results.map(result => ({...result, extractionDiagnostics: [], extractionDiagnosticsOmitted: 0})));
    return summaries.length ? "Batch extraction diagnostics (Defuddle):\\n\\n" + summaries.join("\\n\\n") + "\\n\\n" + body : body;
}
function jouzuDiagnosticTool(tool) {
    const render = tool.renderResult;
    return {...tool, renderResult(result, options, theme, context) {
        const original = render.call(tool, result, options, theme, context);
        if (options.isPartial) return original;
        const items = result.details?.items ?? (result.details ? [result.details] : []);
        const reported = items.filter(item => item.extractionDiagnostics?.length || item.extractionDiagnosticsOmitted);
        if (!reported.length) return original;
        const count = reported.reduce((total, item) => total + (item.extractionDiagnostics?.length ?? 0) + (item.extractionDiagnosticsOmitted ?? 0), 0);
        const text = options.expanded
            ? reported.map(item => (item.url ? jouzuBoundDiagnosticText(item.url, 200) + "\\n" : "") + jouzuDiagnosticText(item)).join("\\n\\n")
            : count + " extraction diagnostic(s); expand this tool to review.";
        const container = new JouzuDiagnosticContainer();
        container.addChild(original);
        container.addChild(new JouzuDiagnosticText(theme.fg("warning", text), 0, 0));
        return container;
    }};
}
function createWebFetchTool() { return jouzuDiagnosticTool(jouzuOriginalcreateWebFetchTool()); }
function createBatchWebFetchTool() { return jouzuDiagnosticTool(jouzuOriginalcreateBatchWebFetchTool()); }
`;
}

export function applyInstalledWebaioDiagnosticBridge(webaioRoot) {
	for (const [name, transform] of [
		["webfetch-api.js", transformWebaioDiagnosticCapture],
		["jouzu-extension.js", transformWebaioDiagnosticHistory],
	]) {
		const path = join(webaioRoot, "dist", "src", name);
		const source = readFileSync(path, "utf8");
		const transformed = transform(source);
		if (transformed !== source) writeFileSync(path, transformed);
	}
}
