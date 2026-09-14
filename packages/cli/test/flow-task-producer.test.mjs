import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { captureTasks, TaskFlowProducer, taskWorkBinding } from "../dist/flow-control/task-producer.js";

const signal = () => new AbortController().signal;
async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-task-producer-"));
	const attachment = await PiFlowAttachment.open(root, { sessionId: "session", branchId: "branch" });
	t.after(async () => {
		await attachment.close();
		await rm(root, { recursive: true, force: true });
	});
	const task = { key: "a".repeat(64), taskId: "1", revision: "b".repeat(64), state: "active" };
	let tasks = [task],
		cancelled = 0,
		consumed = 0;
	const producer = new TaskFlowProducer(
		attachment,
		() => tasks,
		() => {},
	);
	await attachment.waits.registerWork("origin", "host-user", 1);
	await attachment.waits.shareWork("origin", "host-user", 1, "tasks", 2);
	await attachment.waits.deriveWorkBinding(taskWorkBinding(task.key), task.revision, { id: "origin", revision: 2 }, 3, [
		"bg",
	]);
	const entry = {
		...task,
		requestId: "request",
		build: () => "Exact task instructions",
		consumed: () => {
			consumed++;
		},
		cancelled: () => {
			cancelled++;
		},
	};
	return {
		attachment,
		producer,
		task,
		entry,
		remove: () => {
			tasks = [];
		},
		counts: () => ({ cancelled, consumed }),
	};
}
for (const change of ["completed", "paused", "blocked", "revision", "deleted"])
	test(`task ${change} invalidates a selected continuation`, async (t) => {
		const f = await fixture(t);
		f.producer.submit(f.entry);
		const [intent] = await f.producer.snapshot(signal());
		assert.equal((await f.producer.build(intent, signal())).text, "Exact task instructions");
		if (change === "revision") f.task.revision = "c".repeat(64);
		else if (change === "deleted") f.remove();
		else f.task.state = change;
		assert.deepEqual(await f.producer.snapshot(signal()), []);
		await assert.rejects(f.producer.build(intent, signal()), { code: "stale" });
		assert.deepEqual(f.counts(), { cancelled: 1, consumed: 0 });
	});
test("foreign or stale task submissions cannot select an existing work", async (t) => {
	const f = await fixture(t);
	assert.throws(() => f.producer.submit({ ...f.entry, key: "d".repeat(64) }), { code: "stale" });
	assert.throws(() => f.producer.submit({ ...f.entry, revision: "d".repeat(64) }), { code: "stale" });
	assert.throws(() => captureTasks([f.task, f.task]), { code: "schema" });
	f.producer.close();
	assert.throws(() => f.producer.submit(f.entry), { code: "stale" });
});

test("task refresh and instruction edits preserve an independent flow pause", async (t) => {
	const f = await fixture(t);
	f.producer.submit(f.entry);
	const work = f.attachment.waits.boundWork(taskWorkBinding(f.task.key));
	await f.attachment.waits.changeWork(work.id, work.owner, work.revision, "paused", "Paused by user", Date.now());
	assert.equal((await f.producer.snapshot(signal()))[0].runnable, false);
	f.task.revision = "c".repeat(64);
	await f.producer.snapshot(signal());
	assert.equal(f.attachment.waits.boundWork(taskWorkBinding(f.task.key)).lifecycle.state, "paused");
	assert.equal(f.attachment.waits.boundWork(taskWorkBinding(f.task.key)).lifecycle.reason, "Paused by user");
});
