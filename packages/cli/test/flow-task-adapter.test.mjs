import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assistantToolCalls } from "../../../scripts/fixtures/pi-flow-session.mjs";
import {
	afterFlowCleanup,
	assembledSession,
	installedProducerExtensions,
	installedTaskExtension,
	replacedSession,
} from "./fixtures/flow-assembly.mjs";
import { controlledBackground } from "./fixtures/flow-background-gate.mjs";
import { waitDependencyFrom } from "./fixtures/flow-wait-dependency.mjs";

async function setup(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-task-adapter-"));
	afterFlowCleanup(t, () => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".pi"));
	await writeFile(
		join(root, ".pi/tasks-config.json"),
		JSON.stringify({ autoMode: "cascade", autoClearCompleted: "never" }),
	);
	const taskFile = join(root, "tasks.json");
	const producerExtensions = [...(await installedProducerExtensions()), await installedTaskExtension(taskFile)];
	return { root, taskFile, producerExtensions };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function until(f, predicate) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await tick();
	}
	assert.fail(
		JSON.stringify({
			flow: f.errors,
			agent: f.session.agent.state.errorMessage,
			bodies: f.bodies.length,
			inspect: await f.ingress.inspect(),
		}),
	);
}
const call = (name, args) => assistantToolCalls({ name, arguments: args });
const messages = (f) =>
	f.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
		.map((entry) => entry.message);

test("installed task continuation owns background execution and waits", { timeout: 20000 }, async (t) => {
	const setupData = await setup(t);
	const background = await controlledBackground(t);
	let phase = 0,
		workId;
	const f = await assembledSession(t, {
		...setupData,
		persist: true,
		script: (body) => {
			switch (phase++) {
				case 0:
					return call("TaskCreate", { subject: "Probe", description: "Run a background probe" });
				case 1:
					return { text: "Task created" };
				case 2:
					return call("bg_task", { action: "spawn", command: background.command });
				case 3: {
					const dependency = waitDependencyFrom(body);
					assert.ok(dependency, "task continuation has background execution authority");
					workId = dependency.work.id;
					return call("agent_wait", {
						work: workId,
						reason: "Wait for probe",
						deadline: "30m",
						on: [
							{
								producer: dependency.producer,
								handle: dependency.handle,
								execution: dependency.execution,
								until: dependency.until,
							},
						],
					});
				}
				case 4:
					return { text: "Waiting for probe" };
				case 5:
					return call("TaskUpdate", { taskId: "1", status: "completed" });
				default:
					return { text: "Completed" };
			}
		},
	});
	await f.session.prompt("Create and run the probe task");
	await until(f, () => phase >= 5);
	const before = f.bodies.length;
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(f.bodies.length, before, "waiting task produces no continuation requests");
	const work = (await f.ingress.branch().attachment.waits.authoritySnapshot()).work.find((work) => work.id === workId);
	assert.equal(work.owner, "tasks");
	assert.ok(work.origin?.id.startsWith("user:"));
	await background.release();
	await until(f, () => phase >= 7);
	await f.session.waitForIdle();
	assert.equal(f.bodies.length, 7);
	assert.deepEqual(f.errors, []);
	assert.ok(
		messages(f).every((message) => !message.isError),
		JSON.stringify(messages(f)),
	);
});

for (const control of ["waitForUser", "paused"])
	test(`task ${control} holds automation until explicitly cleared`, { timeout: 20000 }, async (t) => {
		const setupData = await setup(t);
		let phase = 0;
		const f = await assembledSession(t, {
			...setupData,
			script: () => {
				switch (phase++) {
					case 0:
						return call("TaskCreate", { subject: "Blocked", description: "Needs input" });
					case 1:
						return call("TaskUpdate", { taskId: "1", [control]: true });
					case 2:
						return { text: "Waiting for input" };
					case 3:
						return call("TaskUpdate", { taskId: "1", status: "in_progress", [control]: false });
					case 4:
						return { text: "Input received" };
					case 5:
						return call("TaskUpdate", { taskId: "1", status: "completed" });
					default:
						return { text: "Completed" };
				}
			},
		});
		await f.session.prompt("Create a task that needs input");
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal(f.bodies.length, 3);
		await f.session.prompt("The input is available; resume the task");
		await until(f, () => phase >= 7);
		await f.session.waitForIdle();
		assert.equal(f.bodies.length, 7);
		assert.ok(
			messages(f).every((message) => !message.isError),
			JSON.stringify(messages(f)),
		);
		assert.deepEqual(f.errors, []);
	});

test("task continuations stop after three admitted attempts without task progress", { timeout: 15000 }, async (t) => {
	const setupData = await setup(t);
	const f = await assembledSession(t, {
		...setupData,
		script: (_body, index) =>
			index === 0
				? call("TaskCreate", { subject: "Unchanged", description: "No progress fixture" })
				: { text: "No task changes" },
	});
	await f.session.prompt("Create the task");
	await until(f, () => f.bodies.length >= 5);
	await f.session.waitForIdle();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(f.bodies.length, 5, "two initial requests and three admitted continuations");
	assert.deepEqual(f.errors, []);
});

test("a completed dependency releases the next task with its own work identity", { timeout: 15000 }, async (t) => {
	const setupData = await setup(t);
	const f = await assembledSession(t, {
		...setupData,
		script: (_body, index) => {
			if (index === 0)
				return call("TaskCreateMany", {
					tasks: [
						{ subject: "First", description: "First task" },
						{ subject: "Second", description: "Depends on first" },
					],
				});
			if (index === 1) return call("TaskUpdate", { taskId: "2", addBlockedBy: ["1"] });
			if (index === 2) return { text: "Tasks ready" };
			if (index === 3) return call("TaskUpdate", { taskId: "1", status: "completed" });
			if (index === 5) return call("TaskUpdate", { taskId: "2", status: "completed" });
			return { text: "Task complete" };
		},
	});
	await f.session.prompt("Run two dependent tasks");
	await until(f, () => f.bodies.length >= 7);
	await f.session.waitForIdle();
	const attempts = (await f.ingress.branch().attachment.ledger.snapshot()).attempts.filter(
		(attempt) => attempt.admission?.choice.intent.producer === "tasks",
	);
	assert.equal(attempts.length, 2);
	assert.notEqual(attempts[0].admission.choice.intent.workId, attempts[1].admission.choice.intent.workId);
	assert.ok(
		messages(f).every((message) => !message.isError),
		JSON.stringify(messages(f)),
	);
	assert.deepEqual(f.errors, []);
});

for (const interactive of [false, true])
	test(`session resume preserves task work (interactive=${interactive})`, {
		timeout: 20000,
	}, async (t) => {
		const { SessionManager } = await import("@earendil-works/pi-coding-agent");
		const { replacedSession } = await import("./fixtures/flow-assembly.mjs");
		const setupData = await setup(t);
		let f;
		f = await assembledSession(t, {
			...setupData,
			interactive,
			persist: true,
			script: (_body, index) => {
				if (index === 0) return call("TaskCreate", { subject: "Resume", description: "Continue after resume" });
				f.ingress.pauseAutomated("a turn was interrupted");
				return { text: "Interrupted before task continuation" };
			},
		});
		await f.session.prompt("Create a resumable task");
		await f.session.waitForIdle();
		assert.equal(f.bodies.length, 2);
		const original = (await f.ingress.branch().attachment.waits.authoritySnapshot()).work.find(
			(work) => work.owner === "tasks",
		);

		const next = await replacedSession(t, f, {
			reason: "resume",
			persist: true,
			sessionManager: SessionManager.open(f.sessionManager.getSessionFile()),
			producerExtensions: setupData.producerExtensions,
			script: (_body, index) =>
				index === 0 ? call("TaskUpdate", { taskId: "1", status: "completed" }) : { text: "Completed after resume" },
		});
		if (interactive) {
			assert.equal(next.ingress.automatedPause(), "the session was reopened");
			await next.ingress.releaseReady();
			await new Promise((resolve) => setTimeout(resolve, 100));
			assert.equal(next.bodies.length, 0, "startup task continuations remain held");
			await next.session.prompt("/flow");
			assert.equal(next.ingress.automatedPause(), "the session was reopened");
			assert.equal(next.bodies.length, 0, "inspection does not resume automation");
			await next.session.prompt("/flow resume");
		}
		await until(next, () => next.bodies.length >= 2);
		await next.session.waitForIdle();
		const attempts = (await next.ingress.branch().attachment.ledger.snapshot()).attempts.filter(
			(attempt) => attempt.admission?.choice.intent.producer === "tasks",
		);
		assert.equal(attempts.at(-1).admission.choice.intent.workId, original.id);
		assert.ok(
			messages(next).every((message) => !message.isError),
			JSON.stringify(messages(next)),
		);
		assert.deepEqual(next.errors, []);
	});

test("an unadapted extension turn cannot borrow preceding user authority to create task work", {
	timeout: 15000,
}, async (t) => {
	const setupData = await setup(t);
	const f = await assembledSession(t, {
		...setupData,
		script: (_body, index) =>
			index === 1
				? call("TaskCreate", { subject: "Foreign", description: "Unadapted extension work" })
				: { text: "Done" },
	});
	await f.session.prompt("A prior authorized user turn");
	await f.session.sendCustomMessage(
		{ customType: "unadapted", content: "Continue by working on task #1", display: true },
		{ triggerTurn: true },
	);
	await f.session.waitForIdle();
	assert.equal(f.bodies.length, 3);
	assert.ok(
		messages(f).some((message) => message.isError && JSON.stringify(message.content).includes("authorized invocation")),
	);
	assert.ok(
		!(await f.ingress.branch().attachment.waits.authoritySnapshot()).work.some((work) => work.owner === "tasks"),
	);
	assert.deepEqual(f.errors, []);
});

test("an existing unbound task requires an explicit start from an authorized turn", { timeout: 15000 }, async (t) => {
	const setupData = await setup(t);
	await writeFile(
		setupData.taskFile,
		JSON.stringify({
			nextId: 2,
			tasks: [
				{
					id: "1",
					subject: "Imported",
					description: "Previously saved task",
					status: "pending",
					createdAt: 1,
					updatedAt: 1,
					blockedBy: [],
					blocks: [],
					metadata: {},
				},
			],
		}),
	);
	const f = await assembledSession(t, {
		...setupData,
		script: (_body, index) =>
			index === 0
				? call("TaskExecute", { task_ids: ["1"] })
				: index === 2
					? call("TaskUpdate", { taskId: "1", status: "completed" })
					: { text: "Done" },
	});
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(f.bodies.length, 0, "saved task text cannot create authority on attachment");
	const bridge = f.flow.extensions.find((extension) => extension.name === "jouzu-task-controller");
	assert.equal(bridge.unboundTasks().length, 1);
	await f.session.prompt("Start the saved task");
	await until(f, () => f.bodies.length >= 4);
	await f.session.waitForIdle();
	assert.equal(f.bodies.length, 4);
	assert.ok(
		messages(f).every((message) => !message.isError),
		JSON.stringify(messages(f)),
	);
	assert.deepEqual(f.errors, []);
});

test("task completion after queue consumption prevents a stale provider request", { timeout: 15000 }, async (t) => {
	const setupData = await setup(t);
	let completed = false;
	setupData.producerExtensions.push({
		name: "late-task-completion",
		factory(pi) {
			pi.on("message_start", async (event) => {
				if (completed || event.message.role !== "custom" || event.message.customType !== "jouzu-flow") return;
				completed = true;
				const saved = JSON.parse(await readFile(setupData.taskFile, "utf8"));
				saved.tasks[0].status = "completed";
				saved.tasks[0].updatedAt++;
				await writeFile(setupData.taskFile, JSON.stringify(saved));
			});
		},
	});
	const f = await assembledSession(t, {
		...setupData,
		script: (_body, index) =>
			index === 0
				? call("TaskCreate", { subject: "Late completion", description: "Complete before transport" })
				: { text: "Done" },
	});
	await f.session.prompt("Create the task");
	await until(f, () => completed);
	await f.session.waitForIdle();
	assert.equal(f.bodies.length, 2, "completed task sends no stale continuation to the provider");
	await f.session.prompt("Explain the completed task");
	assert.equal(f.bodies.length, 3);
	assert.deepEqual(f.errors, []);
	assert.equal(f.ingress.automatedPause(), undefined);
});

test("stale task cancellation preserves joined results through provider delivery and reopen", {
	timeout: 15000,
}, async (t) => {
	const setupData = await setup(t);
	let capturedSource;
	const queuedUser = "保存する user instruction arriving during cancellation";
	let completed = false,
		offer = false;
	setupData.producerExtensions.push({
		name: "complete-task-with-results",
		factory(pi) {
			pi.on("message_start", async (event) => {
				if (completed || event.message.role !== "custom" || event.message.customType !== "jouzu-flow") return;
				completed = true;
				capturedSource = structuredClone(event.message);
				const saved = JSON.parse(await readFile(setupData.taskFile, "utf8"));
				saved.tasks[0].status = "completed";
				await writeFile(setupData.taskFile, JSON.stringify(saved));
				await f.session.followUp(queuedUser);
			});
		},
	});
	const f = await assembledSession(t, {
		...setupData,
		persist: true,
		script: (_body, index) => {
			if (index === 0)
				return call("TaskCreate", { subject: "Stale with results", description: "Cancel only this work" });
			if (index === 1) offer = true;
			return { text: "Received" };
		},
	});
	const result = {
		id: "important",
		revision: "1",
		producer: "preserve",
		execution: "exec-important",
		status: "failure",
		title: "重要な結果",
		reference: "log:important",
		warnings: ["Do not lose this warning"],
	};
	const registration = f.ingress.registerProducer({
		version: 1,
		namespace: "preserve",
		snapshot: async () =>
			offer
				? [
						{
							id: result.id,
							revision: "1",
							producer: "preserve",
							sequence: 0,
							rank: 6,
							independent: true,
							runnable: true,
						},
					]
				: [],
		build: () => assert.fail("use result metadata"),
		describeResult: async () => result,
	});
	t.after(() => registration.dispose());
	await f.session.prompt("Create the task");
	await until(f, () => completed && f.bodies.length >= 3);
	await f.session.waitForIdle();
	const body = f.bodies.find((body) => JSON.stringify(body).includes("Do not lose this warning"));
	assert.ok(body, "the joined result reaches the provider despite task cancellation");
	assert.ok(JSON.stringify(body).includes("task instruction in the preceding flow message is cancelled"));
	await until(f, async () =>
		(await f.ingress.branch().attachment.ledger.snapshot()).attempts.some((a) => a.phase === "settled"),
	);
	const attempts = (await f.ingress.branch().attachment.ledger.snapshot()).attempts;
	assert.ok(
		attempts.some(
			(attempt) =>
				attempt.phase === "settled" &&
				attempt.members.some((member) => member.kind === "work") &&
				attempt.members.some((member) => member.id === result.id),
		),
	);
	await f.session.prompt("/flow reset");
	await f.session.prompt("User input after cancellation");
	assert.ok(JSON.stringify(f.bodies.at(-1)).includes("User input after cancellation"));
	assert.ok(
		f.bodies.some((body) => JSON.stringify(body).includes(queuedUser)),
		"queued user input survives cancellation",
	);
	registration.dispose();
	const file = f.sessionManager.getSessionFile();
	const next = await replacedSession(t, f, {
		reason: "resume",
		persist: true,
		producerExtensions: setupData.producerExtensions,
		sessionManager: SessionManager.open(file),
	});
	await next.session.prompt("Continue after reopening mixed input");
	const restored = next.sessionManager
		.getBranch()
		.find((entry) => entry.type === "custom_message" && entry.details?.attemptId === capturedSource.details.attemptId);
	assert.deepEqual(restored.content, capturedSource.content, "original composed bytes survive reload");
	assert.deepEqual(restored.details, capturedSource.details);
	assert.ok(JSON.stringify(next.bodies).includes(queuedUser));
	assert.ok(JSON.stringify(next.bodies).includes("Do not lose this warning"));
	assert.ok(JSON.stringify(next.bodies).includes("task instruction in the preceding flow message is cancelled"));
	assert.deepEqual(next.errors, []);
	assert.deepEqual(f.errors, []);
});
