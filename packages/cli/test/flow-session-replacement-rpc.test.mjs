import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const deadlineMs = 20_000;
const inheritedSecretEnv = /^(?:JOUZU_|PI_|SHISA_|AI_AGENT|TEXTGUARD_|OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|AWS_|AZURE_)/u;

const appendRecord = `
import { appendFileSync } from "node:fs";
const record = (value) => appendFileSync(process.env.JOUZU_TEST_LOG, JSON.stringify(value) + "\\n");
`;

/**
 * Launch the built CLI in RPC mode against isolated roots. The fixture extension
 * writes observations to JOUZU_TEST_LOG; the test synchronizes on RPC responses
 * and the process close event, never on elapsed time.
 */
async function launch(t, { extension, prepare } = {}) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-session-replacement-"));
	const paths = {
		root,
		home: join(root, "home"),
		config: join(root, "config"),
		state: join(root, "state"),
		cache: join(root, "cache"),
		runtime: join(root, "runtime"),
		workspace: join(root, "workspace"),
		sessions: join(root, "sessions"),
		agent: join(root, "agent"),
		jouzu: join(root, "jouzu"),
	};
	for (const path of Object.values(paths)) {
		if (path !== root) await mkdir(path, { recursive: true, mode: 0o700 });
	}
	const extensionPath = join(root, "fixture.mjs");
	if (extension) await writeFile(extensionPath, extension);
	const prepared = prepare ? await prepare(paths) : {};
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !inheritedSecretEnv.test(key)));
	Object.assign(
		env,
		{
			HOME: paths.home,
			USERPROFILE: paths.home,
			XDG_CONFIG_HOME: paths.config,
			XDG_STATE_HOME: paths.state,
			XDG_CACHE_HOME: paths.cache,
			XDG_RUNTIME_DIR: paths.runtime,
			PI_CODING_AGENT_DIR: paths.agent,
			PI_CODING_AGENT_SESSION_DIR: paths.sessions,
			PI_OFFLINE: "1",
			PI_TELEMETRY: "0",
			DISABLE_AUTOUPDATER: "1",
			JOUZU_HOME: paths.jouzu,
			JOUZU_TEST_LOG: join(root, "outcome.jsonl"),
			LANG: "C.UTF-8",
			TERM: "dumb",
		},
		prepared,
	);
	const child = spawn(
		process.execPath,
		[
			cli,
			"--jouzu-home",
			paths.jouzu,
			"--jouzu-profile",
			"core",
			"--mode",
			"rpc",
			"--offline",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-context-files",
			"--no-tools",
			"--session-dir",
			paths.sessions,
			...(extension ? ["-e", extensionPath] : []),
		],
		{ cwd: paths.workspace, env, stdio: ["pipe", "pipe", "pipe"] },
	);

	const events = new EventEmitter();
	const frames = [];
	const protocolErrors = [];
	let stderr = "";
	let buffer = "";
	let exit = null;
	let spawnError = null;
	child.stdout.setEncoding("utf8").on("data", (chunk) => {
		buffer += chunk;
		while (buffer.includes("\n")) {
			const newline = buffer.indexOf("\n");
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line.trim()) continue;
			try {
				frames.push(JSON.parse(line));
			} catch {
				protocolErrors.push(line);
			}
		}
		events.emit("change");
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {});
	child.on("error", (error) => {
		spawnError = error;
		events.emit("change");
	});
	child.on("close", (code, signal) => {
		exit = { code, signal };
		events.emit("change");
	});

	function waitFor(predicate, label, { exitFails = true, timeoutMs = deadlineMs } = {}) {
		return new Promise((resolve, reject) => {
			let timer;
			let done = false;
			const finish = (error, value) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				events.off("change", check);
				if (error) reject(error);
				else resolve(value);
			};
			const check = () => {
				if (done) return;
				if (protocolErrors.length > 0) {
					finish(new Error(`${label}: unparseable stdout ${JSON.stringify(protocolErrors)}; stderr: ${stderr}`));
					return;
				}
				if (exitFails && spawnError) {
					finish(new Error(`${label}: spawn failed: ${spawnError.message}; stderr: ${stderr}`));
					return;
				}
				if (exitFails && exit) {
					finish(new Error(`${label}: process exited ${JSON.stringify(exit)}; stderr: ${stderr}`));
					return;
				}
				let value;
				try {
					value = predicate();
				} catch (error) {
					finish(error);
					return;
				}
				if (value) finish(null, value);
			};
			timer = setTimeout(() => {
				if (done) return;
				child.kill("SIGKILL");
				finish(new Error(`${label}: ${timeoutMs}ms deadline exceeded; stderr: ${stderr}`));
			}, timeoutMs);
			events.on("change", check);
			check();
		});
	}

	let sequence = 0;
	async function request(type, data = {}) {
		const id = `replacement-${++sequence}`;
		child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`);
		const frame = await waitFor(() => {
			const replies = frames.filter((value) => value.type === "response" && value.id === id);
			if (replies.length > 1) {
				throw new Error(`Duplicate ${type} response for ${id}: ${JSON.stringify(replies)}`);
			}
			return replies[0];
		}, `${type} response`);
		assert.equal(frame.success, true, `${type} failed: ${JSON.stringify(frame)}; stderr: ${stderr}`);
		return { id, data: frame.data ?? {} };
	}

	function responses(id) {
		return frames.filter((frame) => frame.type === "response" && frame.id === id).length;
	}

	async function records() {
		try {
			const text = await readFile(join(root, "outcome.jsonl"), "utf8");
			return text
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		} catch (error) {
			throw new Error(`Fixture observations unavailable: ${error.message}; stderr: ${stderr}`);
		}
	}

	async function end() {
		child.stdin.end();
		return waitFor(() => exit, "EOF exit", { exitFails: false });
	}

	t.after(async () => {
		if (!exit) {
			child.kill("SIGKILL");
			await waitFor(() => exit ?? (spawnError ? { error: spawnError.message } : null), "cleanup exit", {
				exitFails: false,
				timeoutMs: 5_000,
			}).catch(() => {});
		}
		await rm(root, { recursive: true, force: true });
	});

	return {
		root,
		paths,
		env,
		frames,
		request,
		responses,
		records,
		end,
		get stderr() {
			return stderr;
		},
	};
}

function assertCleanRun(rpc, exit) {
	assert.deepEqual(exit, { code: 0, signal: null }, rpc.stderr);
	assert.equal(rpc.frames.filter((frame) => frame.type === "extension_error").length, 0, JSON.stringify(rpc.frames));
	assert.equal(
		rpc.frames.some((frame) => frame.type === "agent_start"),
		false,
		"a session replacement must not start a model request",
	);
}

test("a registered command replaces its session through withSession and reports handled once", async (t) => {
	const rpc = await launch(t, {
		extension: `${appendRecord}
export default function(pi) {
	pi.registerCommand("replace-session", {
		description: "Replace this session and report the replacement ID.",
		handler: async (_args, ctx) => {
			const outcome = { before: ctx.sessionManager.getSessionId() };
			try {
				outcome.result = await ctx.newSession({
					withSession: async (next) => {
						outcome.withSession = next.sessionManager.getSessionId();
					},
				});
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
			}
			record(outcome);
		},
	});
}
`,
	});
	const before = (await rpc.request("get_state")).data;
	const commands = (await rpc.request("get_commands")).data.commands;
	assert.ok(
		commands.some((command) => command.name === "replace-session" && command.source === "extension"),
		JSON.stringify(commands),
	);
	assert.deepEqual((await rpc.request("get_messages")).data.messages, []);

	const prompt = await rpc.request("prompt", { message: "/replace-session" });
	assert.equal(prompt.data.disposition, "handled");
	const [outcome] = await rpc.records();
	assert.equal(outcome.before, before.sessionId);
	assert.equal(outcome.error, undefined);
	assert.deepEqual(outcome.result, { cancelled: false });
	assert.notEqual(outcome.withSession, outcome.before);
	assert.equal(rpc.responses(prompt.id), 1, "the command must report handled exactly once");

	const after = (await rpc.request("get_state")).data;
	assert.equal(after.sessionId, outcome.withSession);
	assert.notEqual(after.sessionId, before.sessionId);
	assert.notEqual(after.sessionFile, before.sessionFile);
	assert.deepEqual((await rpc.request("get_messages")).data.messages, []);
	const exit = await rpc.end();
	assert.equal(rpc.responses(prompt.id), 1, "the command must report handled exactly once");
	assertCleanRun(rpc, exit);
});

test("a cancelled session_before_switch leaves the old session usable", async (t) => {
	const rpc = await launch(t, {
		extension: `${appendRecord}
export default function(pi) {
	let cancelNext = false;
	pi.on("session_before_switch", () => {
		if (!cancelNext) return;
		cancelNext = false;
		return { cancel: true };
	});
	pi.registerCommand("cancel-replacement", {
		description: "Attempt a replacement that session_before_switch cancels.",
		handler: async (_args, ctx) => {
			const outcome = { kind: "cancel", before: ctx.sessionManager.getSessionId() };
			cancelNext = true;
			try {
				outcome.result = await ctx.newSession();
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
			}
			outcome.after = ctx.sessionManager.getSessionId();
			record(outcome);
		},
	});
	pi.registerCommand("report-session", {
		description: "Report the current session after a cancelled replacement.",
		handler: (_args, ctx) => {
			record({ kind: "report", sessionId: ctx.sessionManager.getSessionId() });
		},
	});
}
`,
	});
	const before = (await rpc.request("get_state")).data;

	const cancel = await rpc.request("prompt", { message: "/cancel-replacement" });
	assert.equal(cancel.data.disposition, "handled");
	const [cancelled] = await rpc.records();
	assert.equal(cancelled.kind, "cancel");
	assert.equal(cancelled.before, before.sessionId);
	assert.equal(cancelled.error, undefined);
	assert.deepEqual(cancelled.result, { cancelled: true });
	assert.equal(cancelled.after, before.sessionId);
	assert.equal(rpc.responses(cancel.id), 1);

	const report = await rpc.request("prompt", { message: "/report-session" });
	assert.equal(report.data.disposition, "handled");
	const observations = await rpc.records();
	assert.equal(observations.length, 2);
	assert.deepEqual(observations[1], { kind: "report", sessionId: before.sessionId });
	assert.equal(rpc.responses(report.id), 1);

	const after = (await rpc.request("get_state")).data;
	assert.equal(after.sessionId, before.sessionId);
	assert.equal(after.sessionFile, before.sessionFile);
	assert.deepEqual((await rpc.request("get_messages")).data.messages, []);
	const exit = await rpc.end();
	assert.equal(rpc.responses(cancel.id), 1);
	assert.equal(rpc.responses(report.id), 1);
	assertCleanRun(rpc, exit);
});

test("native RPC new_session replaces the session without a model request", async (t) => {
	const rpc = await launch(t);
	const before = (await rpc.request("get_state")).data;
	const replacement = await rpc.request("new_session");
	assert.deepEqual(replacement.data, { cancelled: false });
	const after = (await rpc.request("get_state")).data;
	assert.notEqual(after.sessionId, before.sessionId);
	assert.notEqual(after.sessionFile, before.sessionFile);
	assert.deepEqual((await rpc.request("get_messages")).data.messages, []);
	const exit = await rpc.end();
	assert.equal(rpc.responses(replacement.id), 1);
	assertCleanRun(rpc, exit);
});

test("a registered command switches to a seeded local session", async (t) => {
	const rpc = await launch(t, {
		extension: `${appendRecord}
export default function(pi) {
	pi.registerCommand("switch-session", {
		description: "Switch to the seeded local session.",
		handler: async (_args, ctx) => {
			const outcome = { before: ctx.sessionManager.getSessionId() };
			try {
				outcome.result = await ctx.switchSession(process.env.JOUZU_TEST_SEEDED, {
					withSession: async (next) => {
						outcome.withSession = next.sessionManager.getSessionId();
					},
				});
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
			}
			record(outcome);
		},
	});
}
`,
		prepare: (paths) => {
			const seeded = SessionManager.create(paths.workspace, paths.sessions);
			seeded.appendMessage({ role: "user", content: "seeded local message", timestamp: Date.now() });
			return {
				JOUZU_TEST_SEEDED: seeded.getSessionFile(),
				JOUZU_TEST_SEEDED_ID: seeded.getSessionId(),
			};
		},
	});
	const before = (await rpc.request("get_state")).data;
	const prompt = await rpc.request("prompt", { message: "/switch-session" });
	assert.equal(prompt.data.disposition, "handled");
	const [outcome] = await rpc.records();
	assert.equal(outcome.before, before.sessionId);
	assert.equal(outcome.error, undefined);
	assert.deepEqual(outcome.result, { cancelled: false });
	assert.equal(outcome.withSession, rpc.env.JOUZU_TEST_SEEDED_ID);
	assert.equal(rpc.responses(prompt.id), 1);

	const after = (await rpc.request("get_state")).data;
	assert.equal(after.sessionId, rpc.env.JOUZU_TEST_SEEDED_ID);
	assert.equal(after.sessionFile, rpc.env.JOUZU_TEST_SEEDED);
	const messages = (await rpc.request("get_messages")).data.messages;
	assert.equal(messages.length, 1);
	assert.equal(messages[0].role, "user");
	assert.equal(messages[0].content, "seeded local message");
	const exit = await rpc.end();
	assert.equal(rpc.responses(prompt.id), 1);
	assertCleanRun(rpc, exit);
});

test("a registered command forks an isolated local session", async (t) => {
	const rpc = await launch(t, {
		extension: `${appendRecord}
export default function(pi) {
	pi.registerCommand("fork-session", {
		description: "Append a local entry and fork at it.",
		handler: async (_args, ctx) => {
			const outcome = { before: ctx.sessionManager.getSessionId() };
			try {
				const entryId = ctx.sessionManager.appendMessage({
					role: "user",
					content: "fork point",
					timestamp: Date.now(),
				});
				outcome.entryId = entryId;
				outcome.result = await ctx.fork(entryId, {
					position: "at",
					withSession: async (next) => {
						outcome.withSession = next.sessionManager.getSessionId();
					},
				});
			} catch (error) {
				outcome.error = error instanceof Error ? error.message : String(error);
			}
			record(outcome);
		},
	});
}
`,
	});
	const before = (await rpc.request("get_state")).data;
	const prompt = await rpc.request("prompt", { message: "/fork-session" });
	assert.equal(prompt.data.disposition, "handled");
	const [outcome] = await rpc.records();
	assert.equal(outcome.before, before.sessionId);
	assert.equal(outcome.error, undefined);
	assert.deepEqual(outcome.result, { cancelled: false });
	assert.ok(outcome.entryId);
	assert.notEqual(outcome.withSession, outcome.before);
	assert.equal(rpc.responses(prompt.id), 1);

	const after = (await rpc.request("get_state")).data;
	assert.equal(after.sessionId, outcome.withSession);
	assert.notEqual(after.sessionFile, before.sessionFile);
	const messages = (await rpc.request("get_messages")).data.messages;
	assert.equal(messages.length, 1);
	assert.equal(messages[0].role, "user");
	assert.equal(messages[0].content, "fork point");
	const exit = await rpc.end();
	assert.equal(rpc.responses(prompt.id), 1);
	assertCleanRun(rpc, exit);
});
