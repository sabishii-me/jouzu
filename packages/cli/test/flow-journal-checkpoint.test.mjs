import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT, setValue, value } from "@earendil-works/pi-agent-core";
import { checkpointFlowJournal } from "../dist/flow-control/journal-checkpoint.js";
import { openLocalFlowSession } from "../dist/flow-control/local-storage.js";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "flow-checkpoint-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const folder = join(root, "sessions", "fixture");
	await mkdir(folder, { recursive: true });
	const path = join(folder, "2026-09-14T00-00-00-000Z_flow.jsonl");
	const header = { v: 4, kind: "header", id: "flow", storageVersion: 1, createdAt: 1789344000000, cwd: root };
	return { root, path, header };
}
const set = (seq, key, data) => ({ kind: "value", op: "set", seq, namespace: "probe", key, value: data });
const del = (seq, key) => ({ kind: "value", op: "delete", seq, namespace: "probe", key });
const encode = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

test("live history above the threshold does not checkpoint on every append", async (t) => {
	const { root, path, header } = await fixture(t);
	const payload = "x".repeat(1024 * 1024);
	await writeFile(path, encode([header, ...Array.from({ length: 34 }, (_, i) => set(i + 1, `archive-${i}`, payload))]));
	const session = await openLocalFlowSession(root);
	try {
		const baseline = (await readFile(path, "utf8")).split("\n", 1)[0];
		assert.ok((await stat(path)).size > 32 * 1024 * 1024);
		for (let i = 0; i < 10; i++)
			await session.mutate(
				(mutation) => mutation.commit([setValue(value("probe", "input"), i)], BACKGROUND_CONTEXT),
				BACKGROUND_CONTEXT,
			);
		// A checkpoint replaces the header's sequence floor. Appends must leave it alone here.
		assert.equal((await readFile(path, "utf8")).split("\n", 1)[0], baseline);
		assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, 9);
	} finally {
		await session.close(BACKGROUND_CONTEXT);
	}
});

test("checkpoint preserves live values, deletes, sequence high water and subsequent Pi commits", async (t) => {
	const { root, path, header } = await fixture(t);
	await writeFile(
		path,
		encode([
			header,
			set(1, "input", "old"),
			[set(2, "input", "用户\n\u0000🙂"), set(3, "result", { hidden: ["important"] })],
			set(4, "gone", "discard"),
			del(5, "gone"),
		]),
	);
	await checkpointFlowJournal(path, 0);
	const compacted = await readFile(path, "utf8");
	assert.equal(compacted.split("\n").length, 4);
	assert.equal(JSON.parse(compacted.split("\n")[0]).nextSeq, 6);
	let session = await openLocalFlowSession(root);
	assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "用户\n\u0000🙂");
	assert.deepEqual((await session.getValue(value("probe", "result"), BACKGROUND_CONTEXT)).value, {
		hidden: ["important"],
	});
	assert.equal(await session.getValue(value("probe", "gone"), BACKGROUND_CONTEXT), undefined);
	await session.mutate(async (mutation) => {
		await mutation.commit([setValue(value("probe", "next"), "saved")], BACKGROUND_CONTEXT);
	}, BACKGROUND_CONTEXT);
	await session.close(BACKGROUND_CONTEXT);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows.at(-1).seq, 6);
	session = await openLocalFlowSession(root);
	assert.equal((await session.getValue(value("probe", "next"), BACKGROUND_CONTEXT)).value, "saved");
	await session.close(BACKGROUND_CONTEXT);
});

test("invalid complete transactions and unsupported record kinds leave the journal unchanged", async (t) => {
	const { path, header } = await fixture(t);
	for (const suffix of [
		"not-json\n",
		encode([set(1, "a", 1)]),
		encode([{ kind: "list", op: "append", seq: 2, namespace: "probe", key: "a", value: 1 }]),
	]) {
		const original = encode([header, set(1, "a", 1)]) + suffix;
		await writeFile(path, original);
		await assert.rejects(checkpointFlowJournal(path, 0));
		assert.equal(await readFile(path, "utf8"), original);
	}
});

test("a torn final transaction is ignored as a whole and a header sequence floor survives", async (t) => {
	const { path, header } = await fixture(t);
	await writeFile(path, `${encode([{ ...header, nextSeq: 100 }, set(1, "a", 1)])}[{"kind":"value"`);
	await checkpointFlowJournal(path, 0);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows[0].nextSeq, 100);
	assert.deepEqual(rows[1], set(1, "a", 1));
});

test("opening and appending automatically checkpoint accumulated snapshots", async (t) => {
	const { root, path, header } = await fixture(t);
	const payload = "x".repeat(1024 * 1024);
	await writeFile(path, encode([header, ...Array.from({ length: 34 }, (_, i) => set(i + 1, "input", payload))]));
	const session = await openLocalFlowSession(root);
	assert.ok((await stat(path)).size < 2 * 1024 * 1024);
	for (let i = 0; i < 35; i++)
		await session.mutate(async (mutation) => {
			await mutation.commit([setValue(value("probe", "input"), payload + i)], BACKGROUND_CONTEXT);
		}, BACKGROUND_CONTEXT);
	assert.ok((await stat(path)).size < 10 * 1024 * 1024);
	assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, payload + 34);
	await session.close(BACKGROUND_CONTEXT);
});
