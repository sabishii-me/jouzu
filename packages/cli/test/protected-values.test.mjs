import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageError, usageErrorMessage } from "../dist/args.js";
import {
	CliMessageId,
	humanMessage,
	protectedCommand,
	protectedDigest,
	protectedErrorCode,
	protectedModelId,
	protectedPath,
	protectedSourceError,
	protectedUrl,
	resolveHumanMessage,
} from "../dist/human-messages.js";
import { handleMainCliError } from "../dist/main-cli.js";
import { protectedJouzuPaths } from "../dist/paths.js";

test("protected value constructors carry a distinguishing kind", () => {
	const values = {
		command: protectedCommand("doctor"),
		path: protectedPath("/home/user/.config/jouzu"),
		url: protectedUrl("https://example.test/dashboard"),
		"model-id": protectedModelId("shisa/deepseek-v4-flash"),
		"error-code": protectedErrorCode("doctor.pi.lockUnqualified"),
		"source-error": protectedSourceError("Cannot find module 'x'"),
		digest: protectedDigest("a".repeat(64)),
	};
	assert.deepEqual(
		Object.fromEntries(Object.entries(values).map(([kind, value]) => [kind, value.kind])),
		Object.fromEntries(Object.keys(values).map((kind) => [kind, kind])),
	);
	assert.deepEqual(
		Object.values(values).map((value) => value.value),
		[
			"doctor",
			"/home/user/.config/jouzu",
			"https://example.test/dashboard",
			"shisa/deepseek-v4-flash",
			"doctor.pi.lockUnqualified",
			"Cannot find module 'x'",
			"a".repeat(64),
		],
	);
});

test("resolveHumanMessage renders a protected value as its text", () => {
	const message = humanMessage(CliMessageId.optionValueRequired, { option: protectedCommand("--jouzu-home") });
	assert.equal(resolveHumanMessage(message), "--jouzu-home requires a value");
});

function renderMainError(error) {
	const lines = [];
	const originalError = console.error;
	const originalExitCode = process.exitCode;
	console.error = (...args) => lines.push(args.join(" "));
	process.exitCode = undefined;
	try {
		handleMainCliError(error);
	} finally {
		console.error = originalError;
		process.exitCode = originalExitCode;
	}
	return lines;
}

test("a UsageError renders from its descriptor, not its cached text", () => {
	const parserError = new UsageError(
		humanMessage(CliMessageId.optionValueRequired, { option: protectedCommand("--jouzu-home") }),
	);
	// The descriptor is the rendering source, so a stale cached message cannot freeze it.
	parserError.message = "stale cached text";
	assert.equal(usageErrorMessage(parserError), "--jouzu-home requires a value");
	assert.equal(renderMainError(parserError)[0], "Error: --jouzu-home requires a value");

	const plainError = new UsageError("plain parser failure");
	assert.equal(usageErrorMessage(plainError), "plain parser failure");
	assert.equal(renderMainError(plainError)[0], "Error: plain parser failure");
});

test("a locale without a table falls back to English", () => {
	const message = humanMessage(CliMessageId.usageHint);
	assert.equal(resolveHumanMessage(message, "en"), resolveHumanMessage(message));
	assert.equal(resolveHumanMessage(message, "ja"), resolveHumanMessage(message));
	assert.equal(resolveHumanMessage(message, "zh-Hant"), resolveHumanMessage(message));
});

test("protectedJouzuPaths marks all seven Jouzu paths as protected", () => {
	const paths = {
		configDir: "/home/user/.config/jouzu",
		agentDir: "/home/user/.config/jouzu/agent",
		stateDir: "/home/user/.local/state/jouzu",
		cacheDir: "/home/user/.cache/jouzu",
		sessionDir: "/home/user/.local/state/jouzu/sessions",
		profileStatePath: "/home/user/.local/state/jouzu/profile-state.json",
		backupDir: "/home/user/.local/state/jouzu/backups",
	};
	const protectedPaths = protectedJouzuPaths(paths);
	assert.deepEqual(Object.keys(protectedPaths), Object.keys(paths));
	for (const [key, value] of Object.entries(protectedPaths)) {
		assert.equal(value.kind, "path", `${key} is a protected path`);
		assert.equal(value.value, paths[key], `${key} keeps its value`);
	}
});
