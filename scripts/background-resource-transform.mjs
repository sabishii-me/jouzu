import { readFileSync } from "node:fs";

const edits = JSON.parse(
	readFileSync(new URL("../upstream/background-flow/resource-edits.json", import.meta.url), "utf8"),
);
export const resourcePaths = Object.keys(edits);
export const resourceHelpers = [
	"coalesce.ts",
	"log-writer.ts",
	"log-tail.ts",
	"probes.ts",
	"output-matcher.ts",
	"jouzu-resources.ts",
];

export function transformBackgroundResources(path, source, reverse = false) {
	const replacements = edits[path] ?? [];
	for (const edit of reverse ? [...replacements].reverse() : replacements) {
		const from = reverse ? edit.after : edit.before;
		const to = reverse ? edit.before : edit.after;
		if (source.split(from).length !== 2) throw new Error(`Background resource source anchor changed: ${path}`);
		source = source.replace(from, to);
	}
	return source;
}
