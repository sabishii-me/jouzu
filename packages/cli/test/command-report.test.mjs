import assert from "node:assert/strict";
import { test } from "node:test";

import { CommandReport, commandReportKey, pluralize, wrapTerminalWords } from "../dist/command-report.js";

const PLAIN = { colorEnabled: false, columns: 60 };
const ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

function stripAnsi(value) {
	return value.replace(ANSI_SEQUENCE, "");
}

function report(options = {}) {
	return new CommandReport({ ...PLAIN, ...options });
}

test("a report aligns every section against one shared label column", () => {
	const text = report()
		.title("Jouzu example", "1.0.0", "linux x64")
		.section("Short", [{ label: "One", value: "a" }])
		.section("Long", [{ label: "A much longer label", value: "b" }])
		.toString();
	assert.equal(
		text,
		[
			"Jouzu example 1.0.0 · linux x64",
			"",
			"Short",
			"   One                  a",
			"",
			"Long",
			"   A much longer label  b",
		].join("\n"),
	);
});

test("markers and keys carry status without color", () => {
	const text = report()
		.entries("Notes", [
			{ status: "problem", key: "git", message: "Git was not found." },
			{ status: "warning", key: "profile", message: "The profile is not applied." },
			{ status: "idle", key: "catalog", message: "No catalog is configured." },
			{ status: "update", key: "updates", message: "1.1.0 is available." },
		])
		.toString();
	assert.equal(
		text,
		[
			"Notes",
			"   ✗ git      Git was not found.",
			"   ⚠ profile  The profile is not applied.",
			"   ○ catalog  No catalog is configured.",
			"   ↑ updates  1.1.0 is available.",
		].join("\n"),
	);
});

test("color adds styling without changing the text a user reads", () => {
	const build = (options) =>
		report(options)
			.entries("Notes", [{ status: "warning", key: "catalog", message: "Two offerings declare no levels." }])
			.rule()
			.section("Runtime", [{ label: "Node", value: "v22.19.0" }], { status: "ok", detail: "supported" })
			.tally([
				{ status: "ok", text: "0 problems" },
				{ status: "warning", text: "1 warning" },
			])
			.toString();
	const plain = build({ colorEnabled: false });
	const colored = build({ colorEnabled: true, colorMode: "16" });
	assert.ok(!plain.includes(ESCAPE));
	assert.ok(colored.includes(`${ESCAPE}[33m⚠${ESCAPE}[39m`), "a warning marker is yellow");
	assert.ok(colored.includes(`${ESCAPE}[1mRuntime${ESCAPE}[22m`), "a section heading is bold");
	assert.equal(stripAnsi(colored), plain);
});

test("color stays off for a redirected stream and turns on for FORCE_COLOR", () => {
	const build = (options) => new CommandReport({ columns: 60, ...options }).title("Jouzu example").toString();
	const bold = `${ESCAPE}[1m`;
	assert.ok(!build({ env: { TERM: "xterm-256color" }, stdoutIsTTY: false }).includes(ESCAPE));
	assert.ok(build({ env: { TERM: "xterm-256color" }, stdoutIsTTY: true }).includes(bold));
	assert.ok(build({ env: { TERM: "xterm-256color", FORCE_COLOR: "1" }, stdoutIsTTY: false }).includes(bold));
	assert.ok(!build({ env: { TERM: "xterm-256color", NO_COLOR: "1" }, stdoutIsTTY: true }).includes(ESCAPE));
});

test("a narrow terminal stacks values instead of clipping a label", () => {
	const fields = [{ label: "A label that is thirty chars..", value: "one two three four five six" }];
	const text = report({ columns: 40 }).section("Roots", fields).toString();
	assert.equal(text, ["Roots", "   A label that is thirty chars..", "     one two three four five six"].join("\n"));
	for (const line of text.split("\n")) assert.ok(line.length <= 40, line);
});

test("wrapping never splits a token, so paths survive a copy and paste", () => {
	const path = "/home/user/.local/state/jouzu/sessions/2026-09-13";
	assert.deepEqual(wrapTerminalWords(`State root ${path}`, 20), ["State root", path]);
	assert.deepEqual(wrapTerminalWords("一 二 三 四 五 六", 8), ["一 二 三", "四 五 六"]);
});

test("only ASCII spaces break a line, so an ideographic space stays inside a path", () => {
	const path = "/tmp/端末　上手/agent";
	assert.deepEqual(wrapTerminalWords(path, 12), [path], "the path is never broken at its wide space");
	const text = report({ columns: 60 })
		.section("Roots", [{ label: "Agent root", value: path }])
		.toString();
	assert.ok(text.includes(path), text);
});

test("external text is stripped of escape sequences before styling", () => {
	const text = report()
		.section("Catalog", [{ label: "Label", value: `${ESCAPE}[31mred${ESCAPE}[0m model` }])
		.toString();
	assert.ok(!text.includes(ESCAPE));
	assert.match(text, /^ {3}Label {2}red model$/mu);
});

test("a diagnosis key is the first segment of its identifier", () => {
	assert.equal(commandReportKey("extensions.optionalUnavailable"), "extensions");
	assert.equal(commandReportKey("catalog"), "catalog");
});

test("counts read naturally in a summary line", () => {
	assert.equal(pluralize(0, "problem"), "0 problems");
	assert.equal(pluralize(1, "warning"), "1 warning");
	assert.equal(pluralize(2, "entry", "entries"), "2 entries");
});
