import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const deadlineMs = 30_000;
const inheritedSecretEnv = /^(?:JOUZU_|PI_|SHISA_|AI_AGENT|TEXTGUARD_|OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|AWS_|AZURE_)/u;

/**
 * An isolated Jouzu home whose only model, `fixture/slow`, is served by a local OpenAI-compatible
 * provider on `port`. The home survives restarts within the test.
 */
export async function rpcHome(t, port, { input = ["text"] } = {}) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-rpc-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const paths = {
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
	for (const path of Object.values(paths)) await mkdir(path, { recursive: true, mode: 0o700 });
	const model = { id: "slow", name: "slow", input, reasoning: false, contextWindow: 128000, maxTokens: 4096 };
	await mkdir(join(paths.jouzu, "agent"), { recursive: true, mode: 0o700 });
	await writeFile(
		join(paths.jouzu, "agent", "models.json"),
		JSON.stringify({
			providers: {
				fixture: {
					baseUrl: `http://127.0.0.1:${port}/v1`,
					api: "openai-completions",
					apiKey: "fixture",
					models: [{ ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
				},
			},
		}),
	);
	return paths;
}

/** Start the built CLI in RPC mode with flow control on, in a home from `rpcHome`. */
export function launchRpc(t, paths, extraArgs = []) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !inheritedSecretEnv.test(key)));
	Object.assign(env, {
		HOME: paths.home,
		USERPROFILE: paths.home,
		XDG_CONFIG_HOME: paths.config,
		XDG_STATE_HOME: paths.state,
		XDG_CACHE_HOME: paths.cache,
		XDG_RUNTIME_DIR: paths.runtime,
		PI_CODING_AGENT_DIR: paths.agent,
		PI_CODING_AGENT_SESSION_DIR: paths.sessions,
		PI_TELEMETRY: "0",
		DISABLE_AUTOUPDATER: "1",
		JOUZU_HOME: paths.jouzu,
		JOUZU_FLOW_CONTROL: "1",
		LANG: "C.UTF-8",
		TERM: "dumb",
	});
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
			"--provider",
			"fixture",
			"--model",
			"slow",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-context-files",
			"--no-tools",
			"--session-dir",
			paths.sessions,
			...extraArgs,
		],
		{ cwd: paths.workspace, env, stdio: ["pipe", "pipe", "pipe"] },
	);
	t.after(() => {
		if (child.exitCode === null) child.kill("SIGKILL");
	});
	const events = new EventEmitter();
	const frames = [];
	let stderr = "";
	let buffer = "";
	let exit;
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
				stderr += `\nUnexpected stdout: ${line.slice(0, 200)}`;
			}
		}
		events.emit("change");
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {});
	child.on("close", (code, signal) => {
		exit = { code, signal };
		events.emit("change");
	});
	function waitFor(check, label, timeout = deadlineMs) {
		return new Promise((resolve, reject) => {
			const finish = (error, value) => {
				clearTimeout(timer);
				events.off("change", inspect);
				if (error) reject(error);
				else resolve(value);
			};
			const inspect = () => {
				const value = check();
				if (value) finish(undefined, value);
				else if (exit) finish(new Error(`${label}: exited ${JSON.stringify(exit)}; ${stderr}`));
			};
			const timer = setTimeout(
				() => finish(new Error(`${label} deadline; ${stderr}; frames=${JSON.stringify(frames.slice(-3))}`)),
				timeout,
			);
			events.on("change", inspect);
			inspect();
		});
	}
	const send = (...commands) => child.stdin.write(commands.map((command) => `${JSON.stringify(command)}\n`).join(""));
	const stop = async () => {
		if (exit) return exit;
		child.kill("SIGKILL");
		return waitFor(() => exit, "rpc exit");
	};
	return { frames, send, waitFor, stop };
}

export const response = (frames, id) => frames.find((frame) => frame.type === "response" && frame.id === id);
export const count = (frames, type) => frames.filter((frame) => frame.type === type).length;
/** The latest JSON status a Jouzu extension published under `key`. */
export const lastStatus = (frames, key) => {
	const status = frames.findLast(
		(frame) => frame.type === "extension_ui_request" && frame.method === "setStatus" && frame.statusKey === key,
	);
	return status ? JSON.parse(status.statusText) : undefined;
};
export const quiet = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
