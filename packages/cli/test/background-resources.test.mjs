import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { extensionPatchFixture } from "../../../scripts/fixtures/extension-flow-patch.mjs";

const root = resolve(import.meta.dirname, "../../..");
const fixture = await extensionPatchFixture({ after }, "background", process.env.JOUZU_BACKGROUND_SOURCE);
await fixture.apply(fixture.packageRoot);
const directory = await mkdtemp(join(root, "node_modules/.jouzu-bg-resources-"));
after(() => rm(directory, { recursive: true, force: true }));
const modules = [
	"format",
	"snapshot",
	"orphan-watcher",
	"lifecycle",
	"log-tail",
	"log-writer",
	"probes",
	"jouzu-resources",
];
const output = join(directory, "resources.mjs");
await build({
	stdin: {
		contents:
			modules
				.filter((name) => existsSync(join(fixture.packageRoot, `extensions/${name}.ts`)))
				.map((name) => `export * from ${JSON.stringify(join(fixture.packageRoot, `extensions/${name}.ts`))};`)
				.join("\n") +
			`\nexport { default as backgroundTasks } from ${JSON.stringify(join(fixture.packageRoot, "extensions/background-tasks.ts"))};`,
		loader: "ts",
		resolveDir: root,
	},
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	outfile: output,
	logLevel: "silent",
});
const api = await import(pathToFileURL(output).href);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Bounded observation: 100 samples 10 ms apart, then the same predicate as a final assertion.
const until = async (predicate, label) => {
	for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await pause(10);
	assert.equal(predicate(), true, `waiting for ${label}`);
};
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

function task(overrides = {}) {
	return {
		id: "bg-1",
		command: "test",
		title: "test",
		cwd: directory,
		logFile: join(directory, "output.log"),
		pid: 123,
		status: "running",
		startedAt: 1,
		updatedAt: 1,
		output: "",
		outputBytes: 0,
		lastAnnouncedLength: 0,
		notifyOnExit: true,
		notifyOnOutput: false,
		exitNotified: false,
		sessionId: "resources",
		child: null,
		closed: false,
		restored: true,
		stopReason: null,
		pendingWakes: [],
		wakeEvents: [],
		voidedWakes: new Set(),
		...overrides,
	};
}

// Run unsafe inputs in a subprocess so an unprotected matcher cannot hang the suite.
test("pathological output regex stops within its deadline and disables after one diagnostic", async () => {
	const child = join(directory, "regex-child.mjs");
	await writeFile(
		child,
		`import assert from 'node:assert/strict'; import * as api from './resources.mjs';
const matcher = api.parseOutputMatcher('/(a+)+$/');
let error; try { matcher('a'.repeat(10000) + '!'); } catch (caught) { error = caught; }
assert.equal(error?.constructor.name, 'OutputMatcherBudgetError');
assert.equal(matcher('a'.repeat(10000) + '!'), false);
assert.equal(api.parseOutputMatcher('/ready/g')('ready'), true);
assert.equal(api.parseOutputMatcher('/[/')('literal /[/'), true);
`,
	);
	await promisify(execFile)(process.execPath, [child], { timeout: 3000 });
});

test("large sparse log reads return a bounded UTF-8 tail and preserve truncation", async () => {
	assert.equal(typeof api.createTaskOutputReader, "function", "async bounded log reader is installed");
	const file = join(directory, "large.log");
	const fd = await open(file, "w");
	await fd.truncate(3 * 1024 * 1024 * 1024);
	const suffix = "日本語🙂".repeat(200);
	await fd.write(suffix, 3 * 1024 * 1024 * 1024 - Buffer.byteLength(suffix), "utf8");
	await fd.close();
	const reader = api.createTaskOutputReader((_, error) => assert.fail(error));
	const result = await reader.readTail(task({ logFile: file }), 100);
	assert.equal(result.text, suffix.slice(-100));
	assert.equal(result.truncated, true);
	assert.ok(!result.text.includes("�"));
	assert.equal((await reader.readTail(task({ output: suffix }), 100)).text, suffix.slice(-100));
});

test("log backpressure waits for a delayed write and terminal publication follows flush", async () => {
	assert.equal(typeof api.createLogWriter, "function", "bounded asynchronous log writer is installed");
	assert.equal(typeof api.finalizeAfterLogFlush, "function");
	const gate = deferred();
	const writes = [];
	const order = [];
	const writer = api.createLogWriter({
		append: async (_file, text) => {
			writes.push(text);
			if (writes.length === 1) await gate.promise;
			order.push("written");
		},
		logDiagnostic() {},
	});
	const current = task();
	writer.append(current.logFile, "a".repeat(api.LOG_WRITE_NOW_BYTES));
	const held = writer.append(current.logFile, "b".repeat(api.LOG_MAX_PENDING_BYTES));
	assert.ok(held instanceof Promise);
	let resumed = false;
	void held.then(() => {
		resumed = true;
	});
	const done = api.finalizeAfterLogFlush(current, writer, {
		clearTimers() {},
		isCurrent: () => true,
		finalize() {
			order.push("terminal");
		},
	});
	await pause(20);
	assert.equal(resumed, false);
	assert.equal(current.closed, true);
	assert.equal(order.includes("terminal"), false);
	gate.resolve();
	await done;
	assert.deepEqual(order, ["written", "written", "terminal"]);
	assert.equal(writes.join(""), "a".repeat(api.LOG_WRITE_NOW_BYTES) + "b".repeat(api.LOG_MAX_PENDING_BYTES));
	assert.equal(writer.settled(current.logFile), true);
});

test("failed writes and stalled writers release terminal delivery with counted loss", async () => {
	assert.equal(typeof api.createLogWriter, "function");
	const messages = [];
	const writes = [];
	let fail = true;
	const writer = api.createLogWriter({
		append: async (_file, text) => {
			if (fail) throw new Error("disk full");
			writes.push(text);
		},
		logDiagnostic: (message) => messages.push(message),
	});
	writer.append("failed.log", "lost");
	await writer.flush("failed.log");
	assert.equal(writer.settled("failed.log"), false);
	fail = false;
	writer.append("failed.log", "kept");
	await writer.flush("failed.log");
	assert.match(writes.join(""), /log dropped 4 bytes: log write failed: disk full/);
	assert.match(writes.join(""), /kept/);
	assert.equal(messages.length, 1);
	const timers = [];
	const gate = deferred();
	const recovered = [];
	const stalled = api.createLogWriter({
		append: async (_file, text) => {
			recovered.push(text);
			if (recovered.length === 1) await gate.promise;
		},
		logDiagnostic() {},
		setTimer(cb, ms) {
			const timer = { cb, ms, unref() {} };
			timers.push(timer);
			return timer;
		},
		clearTimer() {},
	});
	stalled.append("stalled.log", "x".repeat(api.LOG_WRITE_NOW_BYTES));
	await Promise.resolve();
	stalled.append("stalled.log", "y".repeat(api.LOG_MAX_PENDING_BYTES));
	const flush = stalled.flush("stalled.log");
	timers.find((timer) => timer.ms === api.LOG_WRITE_STALL_MS).cb();
	await flush;
	for (let i = 0; i < 100; i++) stalled.append("stalled.log", "z".repeat(65536));
	assert.equal(stalled.settled("stalled.log"), false);
	gate.resolve();
	await pause(10);
	await stalled.drain();
	assert.match(recovered.join(""), /log dropped \d+ bytes: log write stalled/);
	assert.ok(recovered.reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) < 2 * api.LOG_MAX_PENDING_BYTES);
});

test("timed-out process probes remain unknown and cannot finalize restored tasks", async () => {
	const reading = await api.defaultReadProcessIdentity(123, {
		platform: "darwin",
		run: async () => ({ kind: "unsettled", cause: "timed-out" }),
	});
	assert.equal(reading?.kind, "unknown");
	const restored = api.restoredTaskFromSnapshot(task(), { sessionId: "resources" });
	assert.equal(restored.status, "running");
	let exits = 0;
	const hooks = {
		rememberSnapshot: (value) => value,
		persistSnapshots() {},
		sendTaskEvent() {
			exits++;
			return true;
		},
		refreshUi() {},
		clearTaskTimers() {},
	};
	const watcher = api.createOrphanWatcher({ getTasks: () => [restored], hooks, identityProbe: async () => reading });
	await watcher.checkOnce();
	assert.equal(exits, 0);
	assert.equal(restored.status, "running");
	const gone = api.createOrphanWatcher({
		getTasks: () => [restored],
		hooks,
		identityProbe: async () => ({ kind: "gone" }),
	});
	await gone.checkOnce();
	assert.equal(exits, 1);
	assert.equal(restored.terminationReason, "orphaned-pid-gone");
});

test("probe subprocess timeout is finite and tagged as uncertainty", async () => {
	assert.equal(typeof api.runProbe, "function");
	const started = Date.now();
	const answer = await api.runProbe(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
	assert.deepEqual(answer, { kind: "unsettled", cause: "timed-out" });
	assert.ok(Date.now() - started < 2500);
});

test("orphan passes share four probe slots and ignore stopped or replaced tasks", async () => {
	const pending = [];
	const tasks = Array.from({ length: 12 }, (_, index) => task({ id: `bg-${index}`, pid: index + 1 }));
	let active = 0;
	let maximum = 0;
	let exits = 0;
	const hooks = {
		rememberSnapshot: (value) => value,
		persistSnapshots() {},
		sendTaskEvent() {
			exits++;
			return true;
		},
		refreshUi() {},
		clearTaskTimers() {},
	};
	const watcher = api.createOrphanWatcher({
		getTasks: () => tasks,
		hooks,
		identityProbe: async () => {
			active++;
			maximum = Math.max(maximum, active);
			const gate = deferred();
			pending.push(gate);
			await gate.promise;
			active--;
			return { kind: "gone" };
		},
	});
	const first = watcher.checkOnce();
	assert.equal(watcher.checkOnce(), first);
	await pause(5);
	assert.equal(maximum, 4);
	watcher.stop();
	for (let offset = 0; offset < 12; offset += 4) {
		for (const gate of pending.splice(0)) gate.resolve();
		await pause(5);
	}
	await first;
	assert.equal(maximum, 4);
	assert.equal(exits, 0);
	const delayed = deferred();
	let current = task();
	const original = current;
	const replacement = api.createOrphanWatcher({
		getTasks: () => [current],
		hooks,
		identityProbe: () => delayed.promise,
	});
	const check = replacement.checkOnce();
	current = task();
	delayed.resolve({ kind: "gone" });
	await check;
	assert.equal(original.status, "running");
	assert.equal(exits, 0);
});

test("pathological output retains terminal completion and publication waits for the log", async (t) => {
	const runDirectory = join(directory, "extension");
	await mkdir(runDirectory);
	const oldAgent = process.env.PI_CODING_AGENT_DIR;
	const oldLogs = process.env.PI_BG_TASK_DIR;
	process.env.PI_CODING_AGENT_DIR = runDirectory;
	process.env.PI_BG_TASK_DIR = runDirectory;
	await writeFile(
		join(runDirectory, "settings.json"),
		JSON.stringify({
			kendex: { extensionManager: { config: { "@vanillagreen/pi-background-tasks": { outputSettleMs: 10 } } } },
		}),
	);
	const handlers = new Map();
	const tools = new Map();
	const bus = new EventEmitter();
	const messages = [];
	const notices = [];
	const pi = {
		events: {
			on(name, handler) {
				bus.on(name, handler);
				return () => bus.off(name, handler);
			},
			emit: (name, value) => bus.emit(name, value),
		},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		registerShortcut() {},
		registerMessageRenderer() {},
		appendEntry() {},
		sendMessage(message) {
			messages.push(message);
		},
	};
	const emit = async (name, ...args) => {
		for (const handler of handlers.get(name) ?? []) await handler(...args);
	};
	const flushGate = deferred();
	let releaseChild = () => {};
	t.after(async () => {
		// Unblock the fixture child and any gated log flush so shutdown never waits on them.
		releaseChild();
		flushGate.resolve();
		await emit("session_shutdown");
		if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = oldAgent;
		if (oldLogs === undefined) delete process.env.PI_BG_TASK_DIR;
		else process.env.PI_BG_TASK_DIR = oldLogs;
	});
	api.backgroundTasks(pi);
	let branch = [];
	const ctx = {
		hasUI: false,
		cwd: runDirectory,
		isProjectTrusted: () => false,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => "resource-integration",
			getSessionFile: () => undefined,
			getBranch: () => branch,
		},
		ui: { notify: (message) => notices.push(message), setWidget() {} },
	};
	await emit("session_start", {}, ctx);
	let flushReached = false;
	const originalFlush = api.taskLogs.flush.bind(api.taskLogs);
	t.mock.method(api.taskLogs, "flush", (file) => {
		flushReached = true;
		return Promise.resolve(originalFlush(file)).then(() => flushGate.promise);
	});
	// The child writes its first chunk, then waits for the test's second write and for its
	// release, so no assertion depends on how long the child or a settle timer lives.
	const chunk = `${"a".repeat(10000)}!`;
	const secondWrite = join(runDirectory, "second-write");
	const releaseFile = join(runDirectory, "release-child");
	const script = [
		"const { existsSync } = require('node:fs');",
		"const chunk = 'a'.repeat(10000) + '!';",
		`const second = ${JSON.stringify(secondWrite)}, release = ${JSON.stringify(releaseFile)}; let wroteSecond = false;`,
		"process.stdout.write(chunk);",
		"const timer = setInterval(() => {",
		"if (!wroteSecond && existsSync(second)) { wroteSecond = true; process.stdout.write(chunk); }",
		"if (existsSync(release)) { clearInterval(timer); process.exit(0); }",
		"}, 5);",
	].join(" ");
	// Keep JavaScript path literals out of shell arguments: Git Bash on Windows removes
	// a layer of backslashes from the inline script before Node evaluates it.
	const scriptFile = join(runDirectory, "output-child.cjs");
	await writeFile(scriptFile, script);
	const launched = await tools.get("bg_task").execute("launch", {
		action: "spawn",
		command: `${api.shellQuote(process.execPath)} ${api.shellQuote(scriptFile)}`,
		notifyOnOutput: true,
		notifyPattern: "/(a+)+$/",
	});
	releaseChild = () => writeFileSync(releaseFile, "");
	const warnings = () => notices.filter((message) => /output matching is disabled/.test(message)).length;
	const inventory = () => api.backgroundFlowSource.inventory("resource-integration")[0];
	await until(() => warnings() === 1, "the disabled-matching warning");
	assert.equal(
		inventory().outputBytes,
		Buffer.byteLength(chunk),
		"the first chunk reached the task before the second write",
	);
	await writeFile(secondWrite, "");
	await until(() => inventory().outputBytes === 2 * Buffer.byteLength(chunk), "the second chunk");
	await until(
		() => inventory().wakeEvents?.some((event) => event.droppedReason === "notify-pattern-no-match"),
		"the disabled matcher to drop the second output",
	);
	assert.equal(warnings(), 1, "the disabled matcher warns once");
	releaseChild();
	await until(() => flushReached, "the child exit to reach the gated log flush");
	assert.equal(messages.length, 0, "no completion before the delayed flush");
	assert.equal(inventory().status, "running");
	assert.equal(warnings(), 1);
	flushGate.resolve();
	await until(() => messages.length === 1, "the completion message");
	assert.equal(messages.length, 1);
	assert.equal(inventory().status, "completed");
	const log = await readFile(launched.details.task.logFile, "utf8");
	assert.equal(log, chunk.repeat(2));
	const inspected = await tools.get("bg_task").execute("inspect", { action: "log", id: launched.details.task.id });
	assert.match(inspected.content[0].text, /completed/);
	assert.match(inspected.content[0].text, /truncated/);
	// A disk failure still delivers completion with a warning in its persisted task metadata.
	await emit("session_shutdown");
	ctx.sessionManager.getSessionId = () => "resource-warning";
	await emit("session_start", {}, ctx);
	t.mock.method(api.taskLogs, "settled", () => false);
	await tools.get("bg_task").execute("failed-log", {
		action: "spawn",
		command: `${api.shellQuote(process.execPath)} -e "process.stdout.write('partial')"`,
	});
	await until(() => messages.length === 2, "the disk-failure completion");
	assert.equal(messages.length, 2);
	assert.match(messages[1].content, /log may be incomplete/i);
	assert.match(messages[1].details.tasks[0].logWarning, /log may be incomplete/i);
	await emit("session_shutdown");
	ctx.sessionManager.getSessionId = () => "resource-flow-warning";
	await emit("session_start", {}, ctx);
	const scope = { sessionId: "resource-flow-warning", branchId: "branch" };
	const lease = api.backgroundFlowSource.activate(scope, () => ({ id: "work", revision: 1 }));
	const results = api.backgroundFlowSource.activateResults(scope, () => {});
	await tools.get("bg_task").execute("flow-warning", {
		action: "spawn",
		command: `${api.shellQuote(process.execPath)} -e "process.stdout.write('partial')"`,
	});
	await until(() => results.snapshot().length > 0, "the flow result");
	assert.match(results.snapshot()[0].warnings[0], /log may be incomplete/i);
	lease.close();
	t.mock.restoreAll();
	// Restored tasks have no in-memory output. Their exit still carries the same identity,
	// and inspecting the log reads its bounded tail from disk.
	await emit("session_shutdown");
	const restoredLog = join(runDirectory, "restored.log");
	await writeFile(restoredLog, `${"r".repeat(20000)}restored-tail`);
	const snapshot = {
		...launched.details.task,
		id: "bg-restored",
		pid: 2147483647,
		logFile: restoredLog,
		status: "running",
		exitNotified: false,
		notifyOnOutput: false,
		notifyPattern: undefined,
		procIdent: { pid: 2147483647, startToken: "original", comm: "test" },
	};
	branch = [{ type: "custom", customType: "kendex-background-tasks:state", data: { tasks: [snapshot] } }];
	ctx.sessionManager.getSessionId = () => "resource-restored";
	snapshot.sessionId = "resource-restored";
	await emit("session_start", {}, ctx);
	await until(() => messages.length === 3, "the restored-task completion");
	assert.equal(messages.length, 3);
	assert.equal(messages[2].details.tasks[0].id, "bg-restored");
	assert.equal(messages[2].details.tasks[0].startedAt, snapshot.startedAt);
	assert.equal(messages[2].details.tasks[0].logFile, restoredLog);
	const restoredOutput = await tools.get("bg_task").execute("restored-inspect", { action: "log", id: "bg-restored" });
	assert.match(restoredOutput.content[0].text, /restored-tail/);
	assert.match(restoredOutput.content[0].text, /truncated/);
	assert.deepEqual(api.backgroundFlowSource.inventory("resource-restored")[0].procIdent, snapshot.procIdent);
});

test("strict log inspection rejects an unreadable file", async () => {
	const reader = api.createTaskOutputReader(() => {});
	await assert.rejects(reader.read(task({ logFile: join(directory, "missing.log") }), 100, true), /log|ENOENT/);
});

test("packaged runtime receipts include every installed background resource helper", async () => {
	const destination = join(directory, "receipt", "pi.lock.json");
	await promisify(execFile)(process.execPath, [join(root, "scripts/copy-pi-lock.mjs"), destination], { cwd: root });
	const receipts = JSON.parse(await readFile(join(directory, "receipt", "flow-patches.json"), "utf8"));
	const background = receipts.find((receipt) => receipt.package === fixture.lock.package);
	for (const [name, hash] of Object.entries(fixture.lock.helpers))
		assert.equal(background.files[`extensions/${name}`], hash, name);
	assert.equal(background.files["extensions/jouzu-store.ts"], fixture.lock.store);
});
