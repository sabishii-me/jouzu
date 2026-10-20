// Node test reporter that records one JSON line per finished test for timing analysis.
// scripts/run-tests.mjs adds it beside TAP when JOUZU_TEST_TIMINGS_DIR is set; see docs/testing.md.
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function repositoryPath(file) {
	if (!file) return null;
	const path = relative(root, file.startsWith("file:") ? fileURLToPath(file) : file);
	return path.split(sep).join("/");
}

function status(type, data) {
	if (data.skip !== undefined) return "skip";
	if (data.todo !== undefined) return "todo";
	if (type === "test:pass") return "pass";
	return data.details?.error?.failureType === "cancelledByParent" ? "cancelled" : "fail";
}

export default async function* timingReporter(source) {
	// Parent names per file: events from concurrently running files interleave.
	const stacks = new Map();
	for await (const event of source) {
		const { type, data } = event;
		if (type === "test:start") {
			const stack = stacks.get(data.file) ?? [];
			stack.length = data.nesting;
			stack.push(data.name);
			stacks.set(data.file, stack);
			continue;
		}
		if (type !== "test:pass" && type !== "test:fail") continue;
		const parents = (stacks.get(data.file) ?? []).slice(0, data.nesting);
		yield `${JSON.stringify({
			type: "test",
			file: repositoryPath(data.file),
			test: [...parents, data.name].join(" > "),
			nesting: data.nesting,
			duration_ms: Math.round((data.details?.duration_ms ?? 0) * 1000) / 1000,
			status: status(type, data),
		})}\n`;
	}
}
