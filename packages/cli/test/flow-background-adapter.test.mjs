import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { applyBackgroundFlow, applyInstalledBackgroundFlow } from "../../../scripts/apply-background-flow.mjs";
import { paths } from "../../../scripts/background-flow-transform.mjs";
import { createFlowSession, deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { attachBackgroundWaitSource } from "../dist/flow-control/background-adapter.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { createFlowWaitExtension } from "../dist/flow-control/wait-tools.js";
import { createClaimedWorkSource, jobWorkUnits } from "../dist/work-dashboard-sources.js";

const root = resolve(import.meta.dirname, "../../.."),
	installed = join(root, "packages/cli/node_modules/@vanillagreen/pi-background-tasks");

test("background execution patch is applied and idempotent in installed package resolutions", async () => {
	await applyInstalledBackgroundFlow(true);
	assert.equal(await applyBackgroundFlow(installed), 0);
});

test("background patch rejects unknown source before writing any planned replacement", async (t) => {
	const temporary = await mkdtemp(join(tmpdir(), "jouzu-bg-patch-"));
	t.after(() => rm(temporary, { recursive: true, force: true }));
	for (const path of ["package.json", ...paths, "extensions/jouzu-flow.ts"]) {
		await mkdir(dirname(join(temporary, path)), { recursive: true });
		await writeFile(join(temporary, path), await readFile(join(installed, path)));
	}
	const typesPath = join(temporary, "extensions/types.ts");
	const original = (await readFile(typesPath, "utf8")).replace(
		"\n\tflow?: { version: 1; execution: string; scope?: { sessionId: string; branchId: string }; work?: { id: string; revision: number }; result?: import('./jouzu-flow.js').BackgroundTerminalResult };",
		"",
	);
	await writeFile(typesPath, original);
	await writeFile(join(temporary, "extensions/render.ts"), "unexpected source\n");
	await assert.rejects(applyBackgroundFlow(temporary), /hash mismatch/);
	assert.equal(await readFile(typesPath, "utf8"), original);
});

async function loadBackground(t) {
	const directory = await mkdtemp(join(root, "node_modules/.jouzu-bg-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const output = join(directory, "background.mjs");
	await build({
		stdin: {
			contents: `export { default } from ${JSON.stringify(join(installed, "extensions/background-tasks.ts"))}; export { backgroundFlowSource, taskSnapshot, rememberSnapshot } from ${JSON.stringify(join(installed, "extensions/snapshot.ts"))}; export { createBackgroundFlowSource } from ${JSON.stringify(join(installed, "extensions/jouzu-flow.ts"))};`,
			resolveDir: root,
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		packages: "external",
		outfile: output,
		logLevel: "silent",
	});
	return import(pathToFileURL(output).href);
}

async function widgetFixture(t, hasUI = true) {
	const directory = await mkdtemp(join(tmpdir(), "jouzu-bg-widget-"));
	const handlers = new Map(),
		commands = new Map(),
		shortcuts = new Map(),
		widgets = new Map();
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	t.after(async () => {
		try {
			handlers.get("session_shutdown")?.();
		} finally {
			if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prior;
			await rm(directory, { recursive: true, force: true });
		}
	});
	const background = await loadBackground(t);
	const bus = new EventEmitter();
	const events = {
		on(name, handler) {
			bus.on(name, handler);
			return () => bus.off(name, handler);
		},
		emit: (name, value) => bus.emit(name, value),
	};
	let sessionId = "widget-session",
		popups = 0;
	const task = {
		id: "bg-1",
		command: "echo done",
		title: "Widget test",
		status: "completed",
		sessionId,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		exitCode: 0,
		notifyOnExit: false,
		exitNotified: true,
		logFile: join(directory, "output.log"),
	};
	const ctx = {
		hasUI,
		mode: hasUI ? "tui" : "json",
		cwd: directory,
		isProjectTrusted: () => false,
		isIdle: () => true,
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionFile: () => undefined,
			getBranch: () => [
				{ type: "custom", customType: "kendex-background-tasks:state", data: { tasks: [{ ...task, sessionId }] } },
			],
		},
		ui: {
			setWidget(key, value) {
				widgets.get(key)?.dispose?.();
				if (value) widgets.set(key, value({ requestRender() {}, terminal: { rows: 32 } }, {}));
				else widgets.delete(key);
			},
			notify() {},
			custom: async () => {
				popups++;
			},
		},
	};
	background.default({
		events,
		on: (name, handler) => handlers.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
		registerTool() {},
		registerMessageRenderer() {},
		appendEntry() {},
	});
	return {
		ctx,
		events,
		widgets,
		commands,
		shortcuts,
		popups: () => popups,
		start(id = sessionId) {
			sessionId = id;
			handlers.get("session_start")({}, ctx);
		},
		refresh: () => handlers.get("before_agent_start")({}, ctx),
		shutdown: () => handlers.get("session_shutdown")(),
		claim() {
			let release;
			events.emit("background-tasks:widget:claim", {
				version: 1,
				respond: (value) => {
					release = value;
				},
			});
			return release;
		},
		source: background.backgroundFlowSource,
	};
}

test("background widget hands rows to the dashboard and preserves native manager routes", async (t) => {
	const f = await widgetFixture(t);
	assert.equal(f.claim(), undefined, "no claim before a session attaches");
	f.start();
	assert.equal(f.widgets.size, 1);
	const scope = { sessionId: "widget-session", branchId: "branch" };
	const source = createClaimedWorkSource({
		id: "jobs",
		channel: { events: f.events, claim: "background-tasks:widget:claim", ready: "background-tasks:widget:ready" },
		read: (current) => jobWorkUnits(current, f.source.inventory(current.sessionId)),
	});
	const detach = source.subscribe(() => {});
	t.after(detach);
	assert.equal(source.read(scope).units.length, 1);
	assert.equal(f.widgets.size, 0);
	for (let i = 0; i < 4; i++) {
		await f.shortcuts.get("alt+h").handler(f.ctx);
		f.refresh();
		assert.equal(f.widgets.size, 0, "toggle and refresh cannot revive a claimed widget");
	}
	await f.commands.get("bg").handler("", f.ctx);
	await f.commands.get("bg").handler("watch bg-1", f.ctx);
	await f.shortcuts.get("alt+shift+h").handler(f.ctx);
	assert.equal(f.popups(), 3, "native manager routes remain available while claimed");
	detach();
	assert.equal(f.widgets.size, 1, "release restores the native widget");
	await f.shortcuts.get("alt+h").handler(f.ctx);
	assert.equal(f.widgets.size, 0, "native visibility is hidden");
	const release = f.claim();
	release();
	assert.equal(f.widgets.size, 0, "claim never changes the native visibility preference");
});

test("background widget claims are independent, reset per session, and release safely", async (t) => {
	const f = await widgetFixture(t);
	let ready = 0;
	f.events.on("background-tasks:widget:ready", () => ready++);
	f.start();
	const first = f.claim(),
		second = f.claim();
	first();
	first();
	assert.equal(f.widgets.size, 0, "one release does not release another claim");
	f.start("next-widget-session");
	assert.equal(ready, 2);
	assert.equal(f.widgets.size, 1, "session start drops old claims");
	const current = f.claim();
	second();
	assert.equal(f.widgets.size, 0, "stale release does not affect the new session claim");
	current();
	assert.equal(f.widgets.size, 1);
	assert.throws(
		() =>
			f.events.emit("background-tasks:widget:claim", {
				version: 1,
				respond() {
					throw new Error("rejected");
				},
			}),
		/rejected/,
	);
	assert.equal(f.widgets.size, 1, "failed handoff restores the widget");
	f.events.emit("background-tasks:widget:claim", {
		version: 2,
		respond() {
			assert.fail();
		},
	});
	f.events.emit("background-tasks:widget:claim", null);
	const last = f.claim();
	f.shutdown();
	last();
	assert.equal(f.widgets.size, 0);
	assert.equal(f.claim(), undefined);
});

test("background widget does not acknowledge claims without a UI", async (t) => {
	const f = await widgetFixture(t, false);
	f.start();
	assert.equal(f.claim(), undefined);
	assert.equal(f.widgets.size, 0);
});

for (const outcome of ["success", "failure", "stop"]) {
	test(`real background ${outcome} returns exact identity and settles its owned wait`, {
		timeout: 15000,
		skip: process.platform === "win32",
	}, async (t) => {
		const background = await loadBackground(t),
			tools = new Map(),
			failures = [];
		let attachment;
		const { session, requests } = await createFlowSession(t, {
			persist: true,
			extensions: [
				{
					name: "background",
					factory(pi) {
						const proxy = Object.create(pi);
						proxy.registerTool = (tool) => {
							tools.set(tool.name, tool);
							pi.registerTool(tool);
						};
						background.default(proxy);
						createFlowWaitExtension({
							attachment: () => attachment,
							maxDurationMs: 10000,
							authorize(work) {
								if (work !== "work") throw new Error("unauthorized work");
								return { actor: "lane", revision: 2, assertActive() {} };
							},
						}).factory(proxy);
					},
				},
			],
		});
		await session.bindExtensions({ onError: (error) => failures.push(error) });
		assert.ok(tools.has("bg_task"));
		const directory = await mkdtemp(join(tmpdir(), "jouzu-bg-owner-"));
		const scope = { sessionId: session.sessionId, branchId: "background-branch" };
		attachment = await PiFlowAttachment.open(directory, scope);
		t.after(async () => {
			await attachment.close();
			await rm(directory, { recursive: true, force: true });
		});
		await attachment.waits.registerWork("unshared", "host-user", 0);
		await attachment.waits.registerWork("work", "lane", 0);
		await attachment.waits.shareWork("work", "lane", 1, "bg", 0);
		const { retainAutomaticWork } = await import("../dist/flow-control/automatic-work.js");
		await retainAutomaticWork(attachment);
		let currentWork = { id: "work", revision: 2 };
		const source = attachBackgroundWaitSource(
			attachment,
			background.backgroundFlowSource,
			(error) => failures.push(error),
			() => currentWork,
		);
		for (const attribution of [
			undefined,
			{ id: "unknown", revision: 2 },
			{ id: "work", revision: 1 },
			{ id: "unshared", revision: 1 },
		]) {
			currentWork = attribution;
			const launched = await tools.get("bg_task").execute("available", {
				action: "spawn",
				command: "true",
				notifyOnExit: false,
				notifyOnOutput: false,
			});
			assert.ok(launched.details.task.flow.execution);
			await tools.get("bg_task").execute("stop-fixture", { action: "stop", id: launched.details.task.id });
		}
		currentWork = { id: "work", revision: 2 };
		const result = await tools.get("bg_task").execute("spawn", {
			action: "spawn",
			command: outcome === "stop" ? "sleep 5" : outcome === "failure" ? "sleep 0.2; exit 7" : "sleep 0.2",
			notifyOnExit: false,
			notifyOnOutput: false,
			timeoutSeconds: 5,
		});
		const task = result.details.task;
		assert.match(task.flow.execution, /^[0-9a-f-]{36}$/);
		assert.deepEqual(task.flow.scope, scope);
		assert.deepEqual(task.flow.work, { id: "work", revision: 2 });
		assert.ok(result.content[0].text.includes(task.flow.execution));
		assert.ok(result.content[0].text.includes('"until":"exit"'));
		const identity = { workId: "work", handle: task.id, execution: task.flow.execution };
		await attachment.waits.registerWork("other", "lane", 0);
		await attachment.waits.shareWork("other", "lane", 1, "bg", 0);
		await assert.rejects(source.bind({ ...identity, workId: "other" }, 2), /work/);
		currentWork = { id: "other", revision: 2 };
		await source.bind(identity, 2);
		await attachment.close();
		attachment = await PiFlowAttachment.open(directory, scope);
		attachBackgroundWaitSource(
			attachment,
			background.backgroundFlowSource,
			(error) => failures.push(error),
			() => currentWork,
		);
		const restoration = await attachment.waitProducers.restorePending();
		assert.deepEqual(restoration.missing, []);
		if (outcome === "stop") assert.ok(restoration.restored >= 1);
		const expected = outcome === "success" ? "resolved" : "failed";
		const completed = deferred();
		const unsubscribe = attachment.waits.onChanged(
			() => {
				void attachment.waits.snapshot().then(
					(waits) => {
						if (waits[0]?.state === expected) completed.resolve();
					},
					(error) => failures.push(error),
				);
			},
			(error) => failures.push(error),
		);
		const wait = (
			await tools.get("agent_wait").execute(
				"wait",
				{
					work: "work",
					reason: "background process exit",
					mode: "all",
					deadline: "10s",
					on: [{ producer: "bg", handle: task.id, execution: task.flow.execution, until: "exit" }],
				},
				undefined,
				undefined,
				{ sessionManager: session.sessionManager },
			)
		).details;
		if (outcome === "stop") await tools.get("bg_task").execute("stop", { action: "stop", id: task.id });
		if (wait.state !== expected) await completed.promise;
		unsubscribe();
		assert.equal((await attachment.waits.snapshot())[0].state, expected);
		assert.deepEqual(requests, []);
		assert.deepEqual(failures, []);
		await attachment.close();
		// The source lease closes with the attachment and can be reactivated for the same branch.
		const reopened = await PiFlowAttachment.open(directory, scope);
		try {
			await attachBackgroundWaitSource(reopened, background.backgroundFlowSource, assert.ifError, () => ({
				id: "work",
				revision: 2,
			})).bind(identity, 2);
			assert.equal((await reopened.waits.snapshot())[0].state, expected);
			const foreign = background.backgroundFlowSource.activate(
				{ sessionId: "foreign", branchId: scope.branchId },
				() => ({ id: "work", revision: 2 }),
			);
			await assert.rejects(
				foreign.snapshot(
					{ ...identity, scope: { sessionId: "foreign", branchId: scope.branchId } },
					new AbortController().signal,
				),
				/unavailable/,
			);
			foreign.close();
		} finally {
			await reopened.close();
		}
	});
}

test("a native user prompt spawns background work and declares its wait from the returned handle", {
	timeout: 15000,
	skip: process.platform === "win32",
}, async (t) => {
	const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
	const { PiSessionFlowIngress } = await import("../dist/flow-control/pi-session-ingress.js");
	const background = await loadBackground(t),
		errors = [],
		directory = await mkdtemp(join(tmpdir(), "jouzu-native-bg-wait-"));
	let session,
		wrapped,
		dependency,
		requests = 0;
	const ingress = new PiSessionFlowIngress({
		root: directory,
		maxInputBytes: 100000,
		maxResultBytes: 100000,
		userWorkParticipants: ["bg"],
		host: {
			maxPayloadBytes: 1000000,
			containsUserInput: () => true,
		},
		policy: () => ({ userPending: false, recoveryBlocked: false, waitingWorkIds: [] }),
		async attachWaitSources(attachment) {
			attachBackgroundWaitSource(
				attachment,
				background.backgroundFlowSource,
				(error) => errors.push(error),
				() => ingress.branch().workContext.current(),
			);
		},
	});
	const created = await createFlowSession(t, {
		persist: true,
		tools: ["bg_task", "agent_wait"],
		extensions: [
			{ name: "background", factory: background.default },
			createFlowWaitExtension({
				attachment: () => ingress.branch().attachment,
				maxDurationMs: 5000,
			}),
		],
		ingress: {
			version: 1,
			async attach(attached) {
				attached.agent.streamFunction = (model, context, options) =>
					stream({ ...model, baseUrl: "https://fixture.invalid/v1" }, context, {
						...options,
						apiKey: "fixture",
						maxRetries: 0,
						fetch: async (_url, init) => {
							requests++;
							const body = JSON.parse(init.body);
							let name, args;
							if (requests === 1) {
								name = "bg_task";
								args = {
									action: "spawn",
									command: "sleep 0.3",
									notifyOnExit: false,
									notifyOnOutput: false,
									timeoutSeconds: 5,
								};
							} else if (requests === 2) {
								const result = body.messages.findLast((message) => message.role === "tool").content;
								dependency = JSON.parse(result.split("Wait dependency: ")[1]);
								name = "agent_wait";
								args = {
									work: dependency.work.id,
									reason: "Wait for background exit",
									deadline: "5s",
									on: [
										{
											producer: dependency.producer,
											handle: dependency.handle,
											execution: dependency.execution,
											until: dependency.until,
										},
									],
								};
							}
							const delta = name
								? {
										tool_calls: [
											{
												index: 0,
												id: `call-${requests}`,
												type: "function",
												function: { name, arguments: JSON.stringify(args) },
											},
										],
									}
								: { content: "Waiting for the process." };
							return new Response(
								`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason: name ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
								{ headers: { "content-type": "text/event-stream" } },
							);
						},
					});
				await ingress.attach(attached);
				wrapped = attached.agent.streamFunction;
			},
			submit: (...args) => ingress.submit(...args),
			beforeBranchChange: () => ingress.beforeBranchChange(),
			branchChanged: () => ingress.branchChanged(),
			dispose: () => ingress.dispose(),
		},
	});
	session = created.session;
	session.agent.streamFunction = wrapped;
	await session.bindExtensions({ onError: (error) => errors.push(error) });
	t.after(async () => {
		await ingress.dispose();
		await rm(directory, { recursive: true, force: true });
	});
	await session.prompt("Run a short background process and wait for its exit.");
	assert.equal(requests, 3);
	assert.ok(
		session.agent.state.messages
			.filter((message) => message.role === "toolResult")
			.every((message) => !message.isError),
	);
	assert.match(dependency.work.id, /^user:/);
	const attachment = ingress.branch().attachment;
	const authority = await attachment.waits.authoritySnapshot();
	assert.equal(authority.work.find((work) => work.id === dependency.work.id).owner, "host-user");
	assert.equal(authority.executions[0].workId, dependency.work.id);
	const completed = deferred();
	const unsubscribe = attachment.waits.onChanged(
		() => {
			void attachment.waits.snapshot().then(
				(waits) => {
					if (waits[0]?.state === "resolved") completed.resolve();
				},
				(error) => errors.push(error),
			);
		},
		(error) => errors.push(error),
	);
	if ((await attachment.waits.snapshot())[0].state !== "resolved") await completed.promise;
	unsubscribe();
	assert.equal(requests, 3);
	assert.equal((await attachment.waits.snapshot())[0].workId, dependency.work.id);
	assert.deepEqual(errors, []);
});

test("result work lookup survives task cleanup and rejects foreign identities", async (t) => {
	const { backgroundFlowSource: source } = await loadBackground(t);
	const scope = { sessionId: "work-lookup", branchId: "branch" };
	const lease = source.activate(scope, () => ({ id: "work", revision: 1 }));
	t.after(() => lease.close());
	const results = source.activateResults(scope, () => {});
	const owned = {
		id: "task",
		sessionId: scope.sessionId,
		status: "completed",
		notifyOnExit: true,
		flow: { version: 1, execution: "execution", scope, work: { id: "work", revision: 1 } },
		logFile: "/log",
	};
	// An execution without owning work never publishes a result, so every published one resolves.
	const unowned = {
		id: "unowned",
		sessionId: scope.sessionId,
		status: "completed",
		notifyOnExit: true,
		flow: { version: 1, execution: "unowned-execution", scope },
		logFile: "/log",
	};
	for (const task of [owned, unowned]) {
		source.prepareResult(task);
		source.commitResults([task]);
	}
	assert.equal(unowned.flow.result, undefined);
	const [first] = results.snapshot();
	assert.equal(first.id, "bg-result:execution");
	assert.deepEqual(results.workForResult(first.id, first.revision), { id: "work", revision: 1 });
	assert.equal(results.workForResult(first.id, "9"), undefined, "a stale revision has no work");
	assert.equal(results.workForResult("bg-result:elsewhere", first.revision), undefined, "a foreign result has no work");
	lease.close();
	assert.throws(() => results.workForResult(first.id, first.revision), /detached/);
});

test("the job inventory lists one session's live tasks and reports every published change", async (t) => {
	const { backgroundFlowSource: source, rememberSnapshot } = await loadBackground(t);
	let changes = 0;
	const unwatch = source.watchInventory(() => changes++);
	t.after(unwatch);
	const task = (id, sessionId) => ({
		id,
		sessionId,
		status: "running",
		command: "sleep 1",
		startedAt: 1,
		updatedAt: 1,
		logFile: "/log",
	});
	rememberSnapshot(task("inventory-a", "inventory-session"));
	rememberSnapshot(task("inventory-b", "inventory-other"));
	assert.equal(changes, 2);
	const listed = source.inventory("inventory-session");
	assert.deepEqual(
		listed.map((job) => [job.id, job.status, job.startedAt]),
		[["inventory-a", "running", 1]],
	);
	listed[0].status = "mutated";
	assert.equal(source.inventory("inventory-session")[0].status, "running", "the inventory is a copy");
	unwatch();
	rememberSnapshot({ ...task("inventory-a", "inventory-session"), status: "completed" });
	assert.equal(changes, 2);
	assert.equal(source.inventory("inventory-session")[0].status, "completed");
});

test("background read receipts require terminal state, durable publication, and an active branch", async (t) => {
	const { backgroundFlowSource: source } = await loadBackground(t);
	const scope = { sessionId: "reads", branchId: "branch" };
	const lease = source.activate(scope, () => ({ id: "work", revision: 1 }));
	t.after(() => lease.close());
	const results = source.activateResults(scope, () => {});
	const task = {
		id: "task",
		sessionId: scope.sessionId,
		status: "running",
		notifyOnExit: true,
		flow: { version: 1, execution: "execution", scope, work: { id: "work", revision: 1 } },
		logFile: "/log",
	};
	const content = [{ type: "text", text: "task: completed\n\noutput" }];
	assert.equal(source.recordTerminalRead(task, "running", "bg_task", content), false);
	assert.deepEqual(results.readReceipts(), []);
	task.status = "completed";
	source.prepareResult(task);
	source.commitResults([task]);
	assert.equal(source.recordTerminalRead(task, "read", "bg_task", content), true);
	assert.deepEqual(results.readReceipts(), []);
	source.commitResults([task]);
	assert.equal(results.readReceipts().length, 1);
	assert.equal(source.recordTerminalRead(task, "read", "bg_task", content), false);
	assert.throws(() => source.recordTerminalRead(task, "read", "bg_task", []), /identity changed/);
	assert.throws(() => source.recordTerminalRead(task, "list", "bg_list", content), /Invalid terminal read/);
	assert.equal(results.snapshot().length, 1);
	lease.close();
	assert.equal(source.recordTerminalRead(task, "stale", "bg_task", content), false);
	assert.throws(() => results.readReceipts(), /detached/);
});

test("background activity and unread output retain work without a declared wait", async (t) => {
	const { createBackgroundFlowSource } = await loadBackground(t);
	const scope = { sessionId: "unwaited", branchId: "branch" };
	const task = {
		id: "task",
		sessionId: scope.sessionId,
		status: "running",
		notifyOnExit: false,
		flow: { version: 1, execution: "execution", scope, work: { id: "work", revision: 1 } },
		logFile: "/log",
	};
	const source = createBackgroundFlowSource(() => [task]);
	const lease = source.activate(scope, () => ({ id: "work", revision: 1 }));
	t.after(() => lease.close());
	const results = source.activateResults(scope, () => {});
	assert.deepEqual(results.retainedWorkIds(), ["work"]);
	task.status = "completed";
	source.prepareResult(task);
	source.commitResults([task]);
	assert.deepEqual(results.snapshot(), []);
	assert.deepEqual(results.retainedWorkIds(), ["work"]);
	task.flow.result.observed = true;
	assert.deepEqual(results.retainedWorkIds(), ["work"]);
	source.commitResults([task]);
	assert.deepEqual(results.retainedWorkIds(), []);
	task.status = "running";
	assert.deepEqual(results.retainedWorkIds(), ["work"]);
	lease.close();
	assert.throws(() => results.retainedWorkIds(), /detached/);
});

test("a result receipt survives the live task being cleared", async (t) => {
	// "Background tasks cleared" empties the task map while a manifest is still pending delivery, so a
	// receipt written only onto a live task would be lost with it. The controller would then be told
	// the result is unavailable, offer it again, and retain its work forever.
	const { createBackgroundFlowSource } = await loadBackground(t);
	const scope = { sessionId: "cleared", branchId: "branch" };
	let live = [
		{
			id: "task",
			sessionId: scope.sessionId,
			status: "completed",
			notifyOnExit: true,
			exitNotified: false,
			flow: { version: 1, execution: "execution", scope, work: { id: "work", revision: 1 } },
			logFile: "/log",
		},
	];
	const source = createBackgroundFlowSource(() => live);
	const lease = source.activate(scope, () => ({ id: "work", revision: 1 }));
	t.after(() => lease.close());
	const results = source.activateResults(scope, () => {});
	source.prepareResult(live[0]);
	source.commitResults(live);
	const [manifest] = results.snapshot();
	assert.equal(manifest.id, "bg-result:execution");

	live = [];
	// The store outlives the task, so the pending manifest is still offered and still acknowledgeable.
	assert.deepEqual(
		results.snapshot().map((value) => value.id),
		[manifest.id],
	);
	assert.equal(source.setResultReceipt(manifest.id, manifest.revision, "delivered", true), true);
	assert.deepEqual(results.snapshot(), []);
	// A second acknowledgement is a no-op rather than an error, and a rollback restores the offer.
	assert.equal(source.setResultReceipt(manifest.id, manifest.revision, "delivered", true), false);
	assert.equal(source.setResultReceipt(manifest.id, manifest.revision, "delivered", undefined), true);
	assert.deepEqual(
		results.snapshot().map((value) => value.id),
		[manifest.id],
	);
	// Observation retains work until it is recorded, and an unknown identity is still refused.
	assert.deepEqual(results.retainedWorkIds(), ["work"]);
	assert.equal(source.setResultReceipt(manifest.id, manifest.revision, "observed", true), true);
	assert.deepEqual(results.retainedWorkIds(), []);
	assert.throws(() => source.setResultReceipt("bg-result:missing", "1", "delivered", true), /unavailable/);
});

test("real background snapshot probing keeps a quiet process waitable and detects a missed exit", async (t) => {
	const { spawn } = await import("node:child_process");
	const { once } = await import("node:events");
	const { FlowWaitHealthMonitor } = await import("../dist/flow-control/wait-health-monitor.js");
	const { createBackgroundFlowSource } = await loadBackground(t);
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	await once(child, "spawn");
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exit = once(child, "exit");
			child.kill();
			await exit;
		}
	});
	const directory = await mkdtemp(join(tmpdir(), "jouzu-health-real-"));
	const scope = { sessionId: "health-real", branchId: "branch" };
	const attachment = await PiFlowAttachment.open(directory, scope);
	const now = Date.now();
	t.mock.timers.enable({ apis: ["Date"], now });
	const { systemWaitClock } = await import("../dist/flow-control/wait-deadlines.js");
	t.mock.method(systemWaitClock, "now", () => Date.now());
	const task = {
		id: "quiet",
		sessionId: scope.sessionId,
		status: "running",
		pid: child.pid,
		flow: { version: 1, execution: "quiet-execution", scope, work: { id: "work", revision: 2 } },
	};
	const api = createBackgroundFlowSource(() => [task]);
	const errors = [];
	await attachment.waits.registerWork("work", "lane", now);
	await attachment.waits.shareWork("work", "lane", 1, "bg", now);
	attachBackgroundWaitSource(
		attachment,
		api,
		(error) => errors.push(error),
		() => ({ id: "work", revision: 2 }),
	);
	const identity = { producer: "bg", handle: task.id, execution: task.flow.execution };
	await attachment.waitProducers.bindForWait(
		"bg",
		{ workId: "work", handle: task.id, execution: task.flow.execution },
		2,
	);
	const handle = { ...identity, until: "exit", health: "bg-process-alive-v1" };
	const request = {
		token: "first",
		scope,
		workId: "work",
		reason: "quiet process",
		mode: "all",
		on: [handle],
		expiresAt: now + 1000000,
	};
	await attachment.waits.declareOwned("lane", 2, request, now, 1000000);
	const monitor = new FlowWaitHealthMonitor({
		store: attachment.waits,
		policy: (h) =>
			attachment.waitProducers.healthPolicy(
				h.producer,
				{ workId: "work", handle: h.handle, execution: h.execution },
				h.health,
			),
		probe: (h, signal) => attachment.waitProducers.probeExecution(h.producer, h.execution, signal),
		clock: { now: () => Date.now(), after: () => () => {} },
		onError: (error) => errors.push(error),
	});
	t.after(async () => {
		await monitor.stop();
		await attachment.close();
		await rm(directory, { recursive: true, force: true });
	});
	t.mock.timers.tick(120000);
	await monitor.refresh();
	assert.equal(
		(await attachment.waits.authoritySnapshot()).executions[0].healthEvidence.observedAt,
		Date.now(),
		"a probe actually rechecks the quiet process",
	);
	t.mock.timers.tick(35000);
	await monitor.refresh();
	assert.equal((await attachment.waits.snapshot())[0].state, "waiting");
	const exited = once(child, "exit");
	child.kill();
	await exited;
	// The producer intentionally still says running: no producer exit event was emitted.
	t.mock.timers.tick(120000);
	await monitor.refresh();
	assert.equal((await attachment.waits.snapshot())[0].state, "unhealthy");
	assert.deepEqual((await attachment.waits.authoritySnapshot()).executions[0].predicates, [
		{ until: "exit", state: "pending" },
	]);
	assert.equal(await attachment.waitProducers.closeTerminalSubscriptions(), 0);
	const next = await attachment.waits.declareOwned(
		"lane",
		2,
		{ ...request, token: "next", on: [{ ...identity, until: "exit" }] },
		Date.now(),
		1000000,
	);
	assert.equal(next.state, "waiting", "a health decision does not poison the execution");
	task.status = "completed";
	api.publish(task);
	await attachment.waitProducers.probeExecution("bg", task.flow.execution);
	assert.equal((await attachment.waits.snapshot()).find((w) => w.token === "next").state, "resolved");
	assert.equal((await attachment.waits.snapshot()).find((w) => w.token === "first").state, "unhealthy");
	assert.deepEqual(errors, []);
});
