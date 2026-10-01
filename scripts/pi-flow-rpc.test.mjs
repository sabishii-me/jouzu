import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const pi = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/index.js", import.meta.url).href;

test("RPC reports retained input dispositions and one rejection without starting a model request", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "jouzu-flow-rpc-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const commands = [
		{ id: "held", type: "prompt", message: "retain" },
		{ id: "rejected", type: "prompt", message: "reject" },
		{ id: "steer", type: "steer", message: "retain" },
		{ id: "follow", type: "follow_up", message: "retain" },
		{ id: "history", type: "get_messages" },
	];
	const probe = `
		const { main } = await import(${JSON.stringify(pi)});
		await main(["--mode", "rpc", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"], {
			flowIngressFactory: async () => ({
				version: 1,
				submit(input) { if (input.args[0] === "reject") throw new Error("fixture rejection"); }
			})
		});
	`;
	const child = spawn(process.execPath, ["--input-type=module", "--eval", probe], {
		cwd: root,
		env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	t.after(() => {
		if (child.exitCode === null) child.kill("SIGKILL");
	});
	const frames = [];
	let stderr = "";
	let buffer = "";
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	child.stdout.on("data", (data) => {
		buffer += data;
		while (buffer.includes("\n")) {
			const newline = buffer.indexOf("\n");
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line.trim()) continue;
			try {
				frames.push(JSON.parse(line));
			} catch {
				stderr += `\nUnexpected stdout: ${line}`;
				child.kill("SIGKILL");
			}
		}
		if (commands.every((command) => frames.some((frame) => frame.type === "response" && frame.id === command.id)))
			child.stdin.end();
	});
	const closed = new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`RPC deadline exceeded: ${stderr}`));
		}, 15000);
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal });
		});
	});
	child.stdin.on("error", () => {});
	child.stdin.write(`${commands.map((command) => JSON.stringify(command)).join("\n")}\n`);
	const status = await closed;
	assert.equal(status.signal, null, stderr);
	assert.equal(status.code, 0, stderr);
	for (const command of commands) {
		const replies = frames.filter((frame) => frame.type === "response" && frame.id === command.id);
		assert.equal(replies.length, 1, `${command.id}: ${JSON.stringify(frames)}`);
		if (command.id === "rejected") {
			assert.equal(replies[0].success, false);
			assert.match(replies[0].error, /fixture rejection/);
		} else if (command.id === "history") {
			assert.deepEqual(replies[0].data.messages, []);
		} else {
			assert.equal(replies[0].success, true);
			assert.equal(replies[0].data.disposition, "handled");
		}
	}
	assert.equal(
		frames.some((frame) => frame.type === "agent_start"),
		false,
	);
});
