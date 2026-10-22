import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const before = String.raw`snippet.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)`;
const after = String.raw`snippet.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?=[\t\n\f\r />])[^>]*>/gi)`;

/** Recognize HTML script end tags without executing scripts or changing URL validation. */
export function transformWebaioRedirectParsing(source) {
	const originalCount = source.split(before).length - 1;
	const correctedCount = source.split(after).length - 1;
	if (originalCount === 0 && correctedCount === 1) return source;
	if (originalCount !== 1 || correctedCount !== 0) throw new Error("WebAIO redirect parser anchor changed");
	return source.replace(before, after);
}

export function applyInstalledWebaioRedirectParsing(webaioRoot) {
	const path = join(webaioRoot, "dist", "src", "webfetch-api.js");
	const source = readFileSync(path, "utf8");
	const transformed = transformWebaioRedirectParsing(source);
	if (transformed !== source) writeFileSync(path, transformed);
}
