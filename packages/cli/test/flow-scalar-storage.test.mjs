import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJournalSession, openJournalSession } from "../dist/flow-control/journal-storage.js";
import {
	BACKGROUND_CONTEXT,
	createMemorySession,
	deleteValue,
	setValue,
	value,
} from "../dist/flow-control/scalar-storage.js";

const HEADER = { v: 4, kind: "header", id: "flow", storageVersion: 1, createdAt: 1789344000000, cwd: "/flow" };
const header = (overrides = {}) => ({ ...HEADER, ...overrides });
const set = (seq, key, data, namespace = "probe") => ({ kind: "value", op: "set", seq, namespace, key, value: data });
const del = (seq, key, namespace = "probe") => ({ kind: "value", op: "delete", seq, namespace, key });
const encode = (rows) => `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

async function fixture(t, rows = []) {
	const root = await mkdtemp(join(tmpdir(), "flow-scalar-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "sessions", "flow", "flow.jsonl");
	await mkdir(join(root, "sessions", "flow"), { recursive: true });
	if (rows.length) await writeFile(path, encode(rows));
	return { root, path };
}

function gate() {
	let enter;
	const opened = new Promise((resolve) => {
		enter = resolve;
	});
	return { opened, enter };
}

test("memory sessions serialize read-modify-write jobs", async () => {
	const session = createMemorySession({ id: "flow", cwd: "/flow" });
	const counter = value("probe", "counter");
	const observed = [];
	await Promise.all(
		Array.from({ length: 8 }, () =>
			session.mutate(async (mutator) => {
				const current = (await mutator.getValue(counter, BACKGROUND_CONTEXT))?.value ?? 0;
				observed.push(current);
				await mutator.commit([setValue(counter, current + 1)], BACKGROUND_CONTEXT);
			}, BACKGROUND_CONTEXT),
		),
	);
	assert.deepEqual(observed, [0, 1, 2, 3, 4, 5, 6, 7]);
	assert.equal((await session.getValue(counter, BACKGROUND_CONTEXT)).value, 8);
	await session.close(BACKGROUND_CONTEXT);
});

test("journal sessions serialize read-modify-write and replay them on reopen", async (t) => {
	const { path } = await fixture(t, [header()]);
	const session = await openJournalSession(path);
	const counter = value("probe", "counter");
	await Promise.all(
		Array.from({ length: 4 }, () =>
			session.mutate(async (mutator) => {
				const current = (await mutator.getValue(counter, BACKGROUND_CONTEXT))?.value ?? 0;
				await mutator.commit([setValue(counter, current + 1)], BACKGROUND_CONTEXT);
			}, BACKGROUND_CONTEXT),
		),
	);
	assert.equal((await session.getValue(counter, BACKGROUND_CONTEXT)).value, 4);
	await session.close(BACKGROUND_CONTEXT);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.deepEqual(
		rows.slice(1).map((row) => row.seq),
		[1, 2, 3, 4],
	);
	const reopened = await openJournalSession(path);
	assert.equal((await reopened.getValue(counter, BACKGROUND_CONTEXT)).value, 4);
	await reopened.close(BACKGROUND_CONTEXT);
});

test("a mutator commits at most once, including after a failed attempt", async () => {
	const session = createMemorySession();
	const address = value("probe", "value");
	const result = await session.mutate(async (mutator) => {
		await assert.rejects(
			mutator.commit([{ kind: "value", op: "bogus", namespace: "probe", key: "value" }], BACKGROUND_CONTEXT),
			/Unsupported scalar write operation/,
		);
		await assert.rejects(mutator.commit([setValue(address, "second")], BACKGROUND_CONTEXT), /already attempted/);
		return "callback finished";
	}, BACKGROUND_CONTEXT);
	assert.equal(result, "callback finished");
	assert.equal(await session.getValue(address, BACKGROUND_CONTEXT), undefined);
	await session.mutate(async (mutator) => {
		await mutator.commit([setValue(address, "first")], BACKGROUND_CONTEXT);
		await assert.rejects(mutator.commit([setValue(address, "second")], BACKGROUND_CONTEXT), /already attempted/);
	}, BACKGROUND_CONTEXT);
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, "first");
	await session.close(BACKGROUND_CONTEXT);
});

test("JSON serialization cannot reenter a mutator for a second commit", async () => {
	const session = createMemorySession();
	const address = value("probe", "value");
	let reentered;
	await session.mutate(async (mutator) => {
		const input = {
			toJSON() {
				reentered = mutator.commit([setValue(address, "nested")], BACKGROUND_CONTEXT);
				reentered.catch(() => {});
				return "outer";
			},
		};
		await mutator.commit([setValue(address, input)], BACKGROUND_CONTEXT);
		await assert.rejects(reentered, /already attempted/);
	}, BACKGROUND_CONTEXT);
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, "outer");
	await session.close(BACKGROUND_CONTEXT);
});

test("a mutator is unusable outside its mutation callback", async () => {
	const session = createMemorySession();
	const address = value("probe", "value");
	let escaped;
	await session.mutate(async (mutator) => {
		escaped = mutator;
		await mutator.commit([setValue(address, 1)], BACKGROUND_CONTEXT);
	}, BACKGROUND_CONTEXT);
	assert.throws(() => escaped.getValue(address, BACKGROUND_CONTEXT), /outside its mutation callback/);
	assert.throws(() => escaped.scanValues(value("probe"), BACKGROUND_CONTEXT), /outside its mutation callback/);
	assert.throws(() => escaped.commit([setValue(address, 2)], BACKGROUND_CONTEXT), /outside its mutation callback/);
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, 1);
	await session.close(BACKGROUND_CONTEXT);
});

test("a callback that throws before commit applies nothing and releases the line", async () => {
	const session = createMemorySession();
	const address = value("probe", "value");
	await assert.rejects(
		session.mutate(async () => {
			throw new Error("callback failed before commit");
		}, BACKGROUND_CONTEXT),
		/callback failed before commit/,
	);
	await session.mutate(
		(mutator) => mutator.commit([setValue(address, "after")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	const stored = await session.getValue(address, BACKGROUND_CONTEXT);
	assert.equal(stored.value, "after");
	assert.equal(stored.seq, 1, "a callback that never committed must not consume a sequence number");
	await session.close(BACKGROUND_CONTEXT);
});

test("a commit that succeeded remains after its callback throws", async (t) => {
	const { path } = await fixture(t, [header()]);
	const session = await openJournalSession(path);
	const address = value("probe", "value");
	await assert.rejects(
		session.mutate(async (mutator) => {
			await mutator.commit([setValue(address, "kept")], BACKGROUND_CONTEXT);
			throw new Error("callback failed after commit");
		}, BACKGROUND_CONTEXT),
		/callback failed after commit/,
	);
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, "kept");
	await session.close(BACKGROUND_CONTEXT);
	const reopened = await openJournalSession(path);
	assert.equal((await reopened.getValue(address, BACKGROUND_CONTEXT)).value, "kept");
	await reopened.close(BACKGROUND_CONTEXT);
});

test("close rejects queued work and waits the active mutation and unawaited commit", async () => {
	const session = createMemorySession();
	const address = value("probe", "value");
	const started = [];
	const release = gate();
	const running = gate();
	const active = session.mutate(async (mutator) => {
		started.push("active");
		running.enter();
		await release.opened;
		// Deliberately unawaited: close must still wait for this commit to finish.
		mutator.commit([setValue(address, "committed")], BACKGROUND_CONTEXT).then(() => started.push("commit settled"));
	}, BACKGROUND_CONTEXT);
	await running.opened;
	const queued = session.mutate(async () => {
		started.push("queued");
	}, BACKGROUND_CONTEXT);
	const queuedRejection = assert.rejects(queued, /Session is closed/);
	const closing = session.close(BACKGROUND_CONTEXT);
	assert.deepEqual(started, ["active"]);
	release.enter();
	await queuedRejection;
	await active;
	await closing;
	assert.deepEqual(started, ["active", "commit settled"]);
	await assert.rejects(
		session.mutate(async () => {}, BACKGROUND_CONTEXT),
		/Session is closed/,
	);
	await assert.rejects(session.getValue(address, BACKGROUND_CONTEXT), /Session is closed/);
});

test("a detached read sees the committed input value, not an in-flight write", async () => {
	const session = createMemorySession();
	const address = value("probe", "input");
	await session.mutate(
		(mutator) => mutator.commit([setValue(address, "first")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	const release = gate();
	const running = gate();
	const pending = session.mutate(async (mutator) => {
		running.enter();
		await release.opened;
		await mutator.commit([setValue(address, "second")], BACKGROUND_CONTEXT);
	}, BACKGROUND_CONTEXT);
	await running.opened;
	const detached = await session.getValue(address, BACKGROUND_CONTEXT);
	assert.equal(detached.value, "first");
	assert.equal(detached.seq, 1);
	release.enter();
	await pending;
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, "second");
	await session.close(BACKGROUND_CONTEXT);
});

for (const backend of ["memory", "journal"]) {
	test(`${backend} storage detaches commit inputs and returned values`, async (t) => {
		const { path } = await fixture(t);
		const session =
			backend === "memory" ? createMemorySession() : await createJournalSession(path, { id: "flow", cwd: "/flow" });
		t.after(() => session.close(BACKGROUND_CONTEXT));
		const address = value("probe", "object");
		const input = { nested: { count: 1 }, items: ["original"] };
		await session.mutate(async (mutator) => {
			const committing = mutator.commit([setValue(address, input)], BACKGROUND_CONTEXT);
			input.nested.count = 2;
			await committing;
		}, BACKGROUND_CONTEXT);
		input.items.push("later");
		const first = await session.getValue(address, BACKGROUND_CONTEXT);
		assert.deepEqual(first.value, { nested: { count: 1 }, items: ["original"] });
		first.value.nested.count = 3;
		const scanned = await session.scanValues(value("probe"), BACKGROUND_CONTEXT);
		assert.equal(scanned[0].value.nested.count, 1);
		scanned[0].value.items.push("read alias");
		await session.mutate(async (mutator) => {
			const inside = await mutator.getValue(address, BACKGROUND_CONTEXT);
			assert.deepEqual(inside.value, { nested: { count: 1 }, items: ["original"] });
			inside.value.nested.count = 4;
		}, BACKGROUND_CONTEXT);
		assert.deepEqual((await session.getValue(address, BACKGROUND_CONTEXT)).value, {
			nested: { count: 1 },
			items: ["original"],
		});
		if (backend === "journal") {
			await session.close(BACKGROUND_CONTEXT);
			const reopened = await openJournalSession(path);
			try {
				assert.deepEqual((await reopened.getValue(address, BACKGROUND_CONTEXT)).value, {
					nested: { count: 1 },
					items: ["original"],
				});
			} finally {
				await reopened.close(BACKGROUND_CONTEXT);
			}
		}
	});

	test(`${backend} storage rejects unserializable data and normalizes durable values`, async (t) => {
		const { path } = await fixture(t);
		const session =
			backend === "memory" ? createMemorySession() : await createJournalSession(path, { id: "flow", cwd: "/flow" });
		t.after(() => session.close(BACKGROUND_CONTEXT));
		const address = value("probe", "object");
		await assert.rejects(
			session.mutate(
				(mutator) => mutator.commit([setValue(address, { nested: 1n })], BACKGROUND_CONTEXT),
				BACKGROUND_CONTEXT,
			),
			/BigInt/,
		);
		await session.mutate(
			(mutator) =>
				mutator.commit([setValue(address, { date: new Date(0), number: NaN, missing: undefined })], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		);
		assert.deepEqual((await session.getValue(address, BACKGROUND_CONTEXT)).value, {
			date: "1970-01-01T00:00:00.000Z",
			number: null,
		});
		assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).seq, 1);
	});
}

test("value helpers validate addresses and scans order keys by code point", async () => {
	assert.deepEqual(value("probe", "key"), { namespace: "probe", key: "key", kind: "value" });
	assert.deepEqual(value("probe"), { namespace: "probe", key: "", kind: "value" });
	assert.throws(() => value(""), /namespace must be a non-empty string/);
	assert.throws(() => value("pro\u0000be"), /namespace must not contain/);
	assert.throws(() => value("probe", "a\u0000b"), /key must not contain/);

	const session = createMemorySession();
	const keys = ["\u{1F600}", "a", "\uFFFD", "A"];
	await session.mutate(
		(mutator) =>
			mutator.commit(
				keys.map((key, index) => setValue(value("probe", key), index)),
				BACKGROUND_CONTEXT,
			),
		BACKGROUND_CONTEXT,
	);
	await session.mutate(
		(mutator) =>
			mutator.commit(
				[
					setValue(value("probe", "prefix-a"), "a"),
					setValue(value("probe", "prefix-ab"), "ab"),
					setValue(value("probe", "prefix-b"), "b"),
					setValue(value("other", "prefix-a"), "other"),
				],
				BACKGROUND_CONTEXT,
			),
		BACKGROUND_CONTEXT,
	);
	const scanned = await session.scanValues(value("probe"), BACKGROUND_CONTEXT);
	// UTF-16 code-unit order would place the surrogate pair before U+FFFD; code points do not.
	assert.deepEqual(
		scanned.map((stored) => stored.address.key),
		["A", "a", "prefix-a", "prefix-ab", "prefix-b", "\uFFFD", "\u{1F600}"],
	);
	assert.deepEqual(
		scanned.map((stored) => stored.value),
		[3, 1, "a", "ab", "b", 2, 0],
	);
	const prefixed = await session.scanValues(value("probe", "prefix-"), BACKGROUND_CONTEXT);
	assert.deepEqual(
		prefixed.map((stored) => stored.value),
		["a", "ab", "b"],
	);
	assert.deepEqual(await session.scanValues(value("probe", "missing"), BACKGROUND_CONTEXT), []);
	assert.deepEqual(
		(await session.scanValues(value("other"), BACKGROUND_CONTEXT)).map((stored) => stored.address.namespace),
		["other"],
	);
	const stored = await session.getValue(value("probe", "prefix-a"), BACKGROUND_CONTEXT);
	assert.equal(stored.address.kind, "value");
	assert.equal(stored.address.namespace, "probe");
	await session.close(BACKGROUND_CONTEXT);
});

test("set and delete order decides the committed value", async (t) => {
	const { path } = await fixture(t, [header()]);
	const session = await openJournalSession(path);
	const address = value("probe", "value");
	await session.mutate(
		(mutator) =>
			mutator.commit([setValue(address, "first"), deleteValue(address), setValue(address, "last")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	const stored = await session.getValue(address, BACKGROUND_CONTEXT);
	assert.equal(stored.value, "last");
	assert.equal(stored.seq, 3);
	await session.mutate(
		(mutator) => mutator.commit([setValue(address, "gone"), deleteValue(address)], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	assert.equal(await session.getValue(address, BACKGROUND_CONTEXT), undefined);
	await session.close(BACKGROUND_CONTEXT);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	// A multi-write commit is one line holding an array; order is preserved within it.
	const writes = rows.slice(1).flatMap((row) => (Array.isArray(row) ? row : [row]));
	assert.deepEqual(
		writes.map((row) => row.op),
		["set", "delete", "set", "set", "delete"],
	);
	assert.deepEqual(
		writes.map((row) => row.seq),
		[1, 2, 3, 4, 5],
	);
	const reopened = await openJournalSession(path);
	assert.equal(await reopened.getValue(address, BACKGROUND_CONTEXT), undefined);
	await reopened.close(BACKGROUND_CONTEXT);
});

test("an unserializable commit leaves state and the journal unchanged", async (t) => {
	const { path } = await fixture(t, [header()]);
	const session = await openJournalSession(path);
	const address = value("probe", "value");
	await assert.rejects(
		session.mutate((mutator) => mutator.commit([setValue(address, 1n)], BACKGROUND_CONTEXT), BACKGROUND_CONTEXT),
		/BigInt/,
	);
	assert.equal(await session.getValue(address, BACKGROUND_CONTEXT), undefined);
	await session.mutate((mutator) => mutator.commit([setValue(address, "ok")], BACKGROUND_CONTEXT), BACKGROUND_CONTEXT);
	const stored = await session.getValue(address, BACKGROUND_CONTEXT);
	assert.equal(stored.value, "ok");
	assert.equal(stored.seq, 1, "a failed serialization must not consume a sequence number");
	await session.close(BACKGROUND_CONTEXT);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows.length, 2);
	assert.equal(rows[1].seq, 1);
});

test("a set write without a defined value is rejected before any append", async (t) => {
	const { path } = await fixture(t, [header()]);
	const session = await openJournalSession(path);
	await assert.rejects(
		session.mutate(
			(mutator) => mutator.commit([{ kind: "value", op: "set", namespace: "probe", key: "value" }], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		),
		/requires a defined value/,
	);
	assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
	await session.close(BACKGROUND_CONTEXT);
});

test("createJournalSession writes a v4 header and preserves metadata on reopen", async (t) => {
	const { path } = await fixture(t);
	const session = await createJournalSession(path, {
		id: "flow",
		cwd: "/flow",
		createdAt: 1789344000000,
		parentSessionId: "parent",
		legacyParentSessionPath: "/legacy",
	});
	assert.deepEqual(JSON.parse((await readFile(path, "utf8")).trim()), {
		v: 4,
		kind: "header",
		id: "flow",
		storageVersion: 1,
		createdAt: 1789344000000,
		cwd: "/flow",
		parentSessionId: "parent",
		legacyParentSessionPath: "/legacy",
	});
	assert.equal(session.metadata.path, path);
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "input"), "saved")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await session.close(BACKGROUND_CONTEXT);
	const reopened = await openJournalSession(path);
	assert.deepEqual(reopened.metadata, {
		id: "flow",
		createdAt: 1789344000000,
		storageVersion: 1,
		cwd: "/flow",
		path,
		parentSessionId: "parent",
		legacyParentSessionPath: "/legacy",
	});
	assert.equal((await reopened.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "saved");
	await reopened.close(BACKGROUND_CONTEXT);
});

test("createJournalSession refuses to replace an existing journal", async (t) => {
	const { path } = await fixture(t, [header(), set(1, "kept", "yes")]);
	const original = await readFile(path, "utf8");
	await assert.rejects(createJournalSession(path, { id: "flow", cwd: "/flow" }), /EEXIST/);
	assert.equal(await readFile(path, "utf8"), original);
});

test("createJournalSession validates metadata before creating a file", async (t) => {
	const { path } = await fixture(t);
	await assert.rejects(createJournalSession(path, { id: "", cwd: "/flow" }), /session id/);
	await assert.rejects(createJournalSession(path, { id: "flow", cwd: "/flow", createdAt: -1 }), /creation time/);
	await assert.rejects(createJournalSession(path, { id: "flow", cwd: "/flow", nextSeq: 0 }), /sequence floor/);
	await assert.rejects(readFile(path, "utf8"), /ENOENT/);
});

test("an existing v4 journal replays single and multi-write transactions", async (t) => {
	const { path } = await fixture(t, [
		header({ nextSeq: 1 }),
		set(1, "input", "old"),
		[set(2, "input", "用户\n\u0000🙂"), set(3, "result", { hidden: ["important"] })],
		set(4, "gone", "discard"),
		del(5, "gone"),
	]);
	const session = await openJournalSession(path);
	assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "用户\n\u0000🙂");
	assert.deepEqual((await session.getValue(value("probe", "result"), BACKGROUND_CONTEXT)).value, {
		hidden: ["important"],
	});
	assert.equal(await session.getValue(value("probe", "gone"), BACKGROUND_CONTEXT), undefined);
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "next"), "saved")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await session.close(BACKGROUND_CONTEXT);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows.at(-1).seq, 6);
});

test("a header sequence floor outranks replayed sequences", async (t) => {
	const { path } = await fixture(t, [header({ nextSeq: 100 }), set(1, "input", "old")]);
	const session = await openJournalSession(path);
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "next"), "saved")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await session.close(BACKGROUND_CONTEXT);
	assert.equal((await readFile(path, "utf8")).trim().split("\n").map(JSON.parse).at(-1).seq, 100);

	// A floor below the replayed sequence advances past it instead of repeating it.
	const { path: lower } = await fixture(t, [header({ nextSeq: 2 }), set(4, "input", "old")]);
	const second = await openJournalSession(lower);
	await second.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "next"), "saved")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await second.close(BACKGROUND_CONTEXT);
	assert.equal((await readFile(lower, "utf8")).trim().split("\n").map(JSON.parse).at(-1).seq, 5);
});

test("a sequence floor that cannot advance rejects the commit", async (t) => {
	const { path } = await fixture(t, [header({ nextSeq: Number.MAX_SAFE_INTEGER })]);
	const session = await openJournalSession(path);
	await assert.rejects(
		session.mutate(
			(mutator) => mutator.commit([setValue(value("probe", "value"), 1)], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		),
		/safe integer/,
	);
	await session.close(BACKGROUND_CONTEXT);
	assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 1);
});

test("invalid headers and complete records leave the journal unchanged", async (t) => {
	const { path } = await fixture(t);
	const valid = JSON.stringify(header());
	const cases = [
		`${JSON.stringify(header({ v: 3 }))}\n`,
		`${JSON.stringify(header({ kind: "session" }))}\n`,
		`${JSON.stringify(header({ storageVersion: 2 }))}\n`,
		`${JSON.stringify(header({ id: "" }))}\n`,
		`${JSON.stringify(header({ createdAt: -1 }))}\n`,
		`${JSON.stringify(header({ cwd: 7 }))}\n`,
		`${JSON.stringify(header({ nextSeq: 0 }))}\n`,
		`${JSON.stringify(header({ parentSessionId: 7 }))}\n`,
		`${valid}`, // A torn header is not repaired.
		"not-json\n",
		"",
		`${valid}\nnot-json\n`,
		`${valid}\n${JSON.stringify({ kind: "list", op: "append", seq: 1, namespace: "probe", key: "a", value: 1 })}\n`,
		`${valid}\n${JSON.stringify({ kind: "value", op: "set", seq: 1, namespace: "probe", key: "a" })}\n`,
		`${valid}\n${JSON.stringify(set(2, "a", 1))}\n${JSON.stringify(set(2, "b", 2))}\n`,
		`${valid}\n${JSON.stringify(set(1, "a", 1))}\n${JSON.stringify(set(1, "b", 2))}\n`,
		`${valid}\n${JSON.stringify(set(Number.MAX_SAFE_INTEGER, "a", 1))}\n`,
		`${valid}\n${JSON.stringify(set(1, "a\u0000b", 1))}\n`,
		`${valid}\n${JSON.stringify(set(1, "a", 1))}\n${JSON.stringify({ kind: "list", op: "delete", seq: 2, namespace: "probe", key: "a" })}\n[{"kind":"value"`,
	];
	for (const [index, original] of cases.entries()) {
		await writeFile(path, original);
		await assert.rejects(openJournalSession(path), Error, `expected a rejection for case ${index}`);
		assert.equal(await readFile(path, "utf8"), original, `expected the journal to stay unchanged for case ${index}`);
	}
});

test("metadata validation runs before repair and refuses an unchanged journal", async (t) => {
	const { path } = await fixture(t);
	const original = `${encode([header(), set(1, "kept", "yes")])}${JSON.stringify(set(2, "torn", "no")).slice(0, 16)}`;
	await writeFile(path, original);
	let seen;
	await assert.rejects(
		openJournalSession(path, {
			validateMetadata: (metadata) => {
				seen = metadata;
				throw new Error("identity refused");
			},
		}),
		/identity refused/,
	);
	assert.equal(seen.id, "flow");
	assert.equal(seen.cwd, "/flow");
	assert.equal(seen.path, path);
	assert.equal(await readFile(path, "utf8"), original, "a refused identity must not repair the torn tail");
});

test("a torn final transaction is repaired before append and survives reopen", async (t) => {
	const { path } = await fixture(t);
	const original = `${encode([header({ nextSeq: 10 }), set(10, "kept", "yes")])}${JSON.stringify(set(11, "torn", "no")).slice(0, 20)}`;
	await writeFile(path, original);
	const session = await openJournalSession(path);
	assert.equal(await session.getValue(value("probe", "torn"), BACKGROUND_CONTEXT), undefined);
	assert.equal((await session.getValue(value("probe", "kept"), BACKGROUND_CONTEXT)).value, "yes");
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "next"), "saved")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await session.close(BACKGROUND_CONTEXT);
	const text = await readFile(path, "utf8");
	assert.ok(text.endsWith("\n"));
	const rows = text.trim().split("\n").map(JSON.parse);
	assert.equal(rows.length, 3);
	assert.equal(rows[1].key, "kept");
	assert.equal(rows[2].seq, 11);
	assert.equal(rows[2].key, "next");
	const reopened = await openJournalSession(path);
	assert.equal(await reopened.getValue(value("probe", "torn"), BACKGROUND_CONTEXT), undefined);
	assert.equal((await reopened.getValue(value("probe", "next"), BACKGROUND_CONTEXT)).value, "saved");
	await reopened.close(BACKGROUND_CONTEXT);
});

test("torn-tail repair counts UTF-8 bytes and preserves complete Japanese receipts", async (t) => {
	const { path } = await fixture(t);
	const complete = encode([header({ cwd: "/日本語/🙂" }), set(1, "入力", "日本語の保存済み🙂")]);
	const torn = Buffer.from(JSON.stringify(set(2, "torn", "未完了🙂")));
	await writeFile(path, Buffer.concat([Buffer.from(complete), torn.subarray(0, torn.length - 5)]));
	const session = await openJournalSession(path);
	try {
		assert.equal(await readFile(path, "utf8"), complete);
		await session.mutate(
			(mutator) => mutator.commit([setValue(value("probe", "next"), "再開後の入力")], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		);
	} finally {
		await session.close(BACKGROUND_CONTEXT);
	}
	const reopened = await openJournalSession(path);
	try {
		assert.equal((await reopened.getValue(value("probe", "入力"), BACKGROUND_CONTEXT)).value, "日本語の保存済み🙂");
		assert.equal((await reopened.getValue(value("probe", "next"), BACKGROUND_CONTEXT)).value, "再開後の入力");
	} finally {
		await reopened.close(BACKGROUND_CONTEXT);
	}
});

test("metadata rejection and invalid complete records precede forced compaction", async (t) => {
	const { path } = await fixture(t);
	const original = encode([header(), set(1, "kept", "x".repeat(2048)), set(2, "kept", "saved")]);
	await writeFile(path, original);
	await assert.rejects(
		openJournalSession(path, {
			checkpointBytes: 0,
			validateMetadata: () => {
				throw new Error("identity refused");
			},
		}),
		/identity refused/,
	);
	assert.equal(await readFile(path, "utf8"), original);
	for (const invalid of [[], set(2, "bad\u0000key", "invalid"), set(2, "key", "invalid", "")]) {
		const text = encode([header(), invalid, del(3, "key")]);
		await writeFile(path, text);
		await assert.rejects(openJournalSession(path, { checkpointBytes: 0 }));
		assert.equal(await readFile(path, "utf8"), text);
	}
});

test("invalid UTF-8 in complete records is rejected without changing journal bytes", async (t) => {
	const { path } = await fixture(t);
	const transaction = Buffer.from(encode([set(1, "input", "MARKER")]));
	const marker = transaction.indexOf("MARKER");
	const malformed = Buffer.concat([
		Buffer.from(encode([header()])),
		transaction.subarray(0, marker),
		Buffer.from([0xff]),
		transaction.subarray(marker + "MARKER".length),
	]);
	for (const suffix of [Buffer.alloc(0), Buffer.from('[{"kind":"value","value":"未完了🙂')]) {
		const original = Buffer.concat([malformed, suffix]);
		await writeFile(path, original);
		await assert.rejects(openJournalSession(path, { checkpointBytes: 0 }), /UTF-8/);
		assert.deepEqual(await readFile(path), original);
	}
});

test("an incomplete UTF-8 character in a torn tail does not invalidate complete receipts", async (t) => {
	const { path } = await fixture(t);
	const complete = Buffer.from(encode([header(), set(1, "input", "保存済み🙂")]));
	const torn = Buffer.concat([Buffer.from('{"kind":"value","value":"'), Buffer.from([0xf0, 0x9f])]);
	await writeFile(path, Buffer.concat([complete, torn]));
	const session = await openJournalSession(path, { checkpointBytes: 0 });
	try {
		assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "保存済み🙂");
		const rows = (await readFile(path, "utf8")).trimEnd().split("\n").map(JSON.parse);
		assert.equal(rows.length, 2);
		assert.equal(rows[1].value, "保存済み🙂");
	} finally {
		await session.close(BACKGROUND_CONTEXT);
	}
});

test("a complete append that rejects is fenced live and recovered on reopen", async (t) => {
	const { path } = await fixture(t, [header(), set(1, "value", "old")]);
	let appends = 0;
	const session = await openJournalSession(path, {
		append: async (target, text) => {
			appends++;
			await appendFile(target, text);
			throw new Error("completed append reported failure");
		},
	});
	const address = value("probe", "value");
	await assert.rejects(
		session.mutate(
			(mutator) => mutator.commit([setValue(address, "complete")], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		),
		/completed append reported failure/,
	);
	assert.equal((await session.getValue(address, BACKGROUND_CONTEXT)).value, "old");
	await assert.rejects(
		session.mutate((mutator) => mutator.commit([setValue(address, "later")], BACKGROUND_CONTEXT), BACKGROUND_CONTEXT),
		/reopen the journal/,
	);
	assert.equal(appends, 1);
	await session.close(BACKGROUND_CONTEXT);
	const reopened = await openJournalSession(path);
	try {
		const stored = await reopened.getValue(address, BACKGROUND_CONTEXT);
		assert.equal(stored.value, "complete");
		assert.equal(stored.seq, 2);
		await reopened.mutate(
			(mutator) => mutator.commit([setValue(address, "next")], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		);
		assert.equal((await reopened.getValue(address, BACKGROUND_CONTEXT)).seq, 3);
	} finally {
		await reopened.close(BACKGROUND_CONTEXT);
	}
});

test("journal close waits for a blocked unawaited append and rejects unstarted mutations", async (t) => {
	const { path } = await fixture(t, [header()]);
	const started = gate(),
		release = gate();
	const session = await openJournalSession(path, {
		append: async (target, text) => {
			started.enter();
			await release.opened;
			await appendFile(target, text);
		},
	});
	let commit;
	const mutation = session.mutate((mutator) => {
		commit = mutator.commit([setValue(value("probe", "value"), "saved")], BACKGROUND_CONTEXT);
	}, BACKGROUND_CONTEXT);
	await started.opened;
	const queued = session.mutate(() => assert.fail("queued callback ran"), BACKGROUND_CONTEXT);
	const rejected = assert.rejects(queued, /Session is closed/);
	let closed = false;
	const closing = session.close(BACKGROUND_CONTEXT).then(() => {
		closed = true;
	});
	await new Promise((done) => setImmediate(done));
	assert.equal(closed, false);
	release.enter();
	await Promise.all([commit, mutation, closing, rejected]);
	assert.equal(closed, true);
	const reopened = await openJournalSession(path);
	try {
		assert.equal((await reopened.getValue(value("probe", "value"), BACKGROUND_CONTEXT)).value, "saved");
	} finally {
		await reopened.close(BACKGROUND_CONTEXT);
	}
});

test("an uncertain append fences commits until reopen", async (t) => {
	const { path } = await fixture(t, [header()]);
	let failNext = true;
	const append = async (target, text) => {
		if (!failNext) return appendFile(target, text, "utf8");
		failNext = false;
		await appendFile(target, text.slice(0, Math.max(1, Math.floor(text.length / 2))), "utf8");
		throw new Error("append interrupted");
	};
	const session = await openJournalSession(path, { append });
	const address = value("probe", "value");
	await assert.rejects(
		session.mutate(
			(mutator) => mutator.commit([setValue(address, "uncertain")], BACKGROUND_CONTEXT),
			BACKGROUND_CONTEXT,
		),
		/append interrupted/,
	);
	assert.equal(
		await session.getValue(address, BACKGROUND_CONTEXT),
		undefined,
		"an uncertain append must not apply in memory",
	);
	await assert.rejects(
		session.mutate((mutator) => mutator.commit([setValue(address, "second")], BACKGROUND_CONTEXT), BACKGROUND_CONTEXT),
		/reopen the journal/,
	);
	await session.close(BACKGROUND_CONTEXT);
	const reopened = await openJournalSession(path);
	assert.equal(await reopened.getValue(address, BACKGROUND_CONTEXT), undefined);
	await reopened.mutate(
		(mutator) => mutator.commit([setValue(address, "recovered")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	assert.equal((await reopened.getValue(address, BACKGROUND_CONTEXT)).value, "recovered");
	await reopened.close(BACKGROUND_CONTEXT);
});

test("opening compacts above the threshold and then backs off proportionally", async (t) => {
	const { path } = await fixture(t);
	const payload = "x".repeat(1024);
	await writeFile(
		path,
		encode([header(), ...Array.from({ length: 8 }, (_, index) => set(index + 1, "input", payload))]),
	);
	const session = await openJournalSession(path, { checkpointBytes: 1024 });
	const compacted = await readFile(path, "utf8");
	assert.equal(compacted.trim().split("\n").length, 2, "compaction keeps one record per live key");
	assert.equal(JSON.parse(compacted.split("\n")[0]).nextSeq, 9);
	const baseline = compacted.split("\n", 1)[0];
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "input"), "next")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	assert.equal(
		(await readFile(path, "utf8")).split("\n", 1)[0],
		baseline,
		"proportional backoff skips the next checkpoint",
	);
	assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "next");
	await session.close(BACKGROUND_CONTEXT);
});

test("a commit checkpoints before appending once the journal grows past the threshold", async (t) => {
	const { path } = await fixture(t, [header(), set(1, "input", "x".repeat(400))]);
	const session = await openJournalSession(path, { checkpointBytes: 1024 });
	assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2, "no checkpoint below the threshold");
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "input"), "y".repeat(2048))], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	await session.mutate(
		(mutator) => mutator.commit([setValue(value("probe", "input"), "final")], BACKGROUND_CONTEXT),
		BACKGROUND_CONTEXT,
	);
	const rows = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
	assert.equal(rows.length, 3, "the checkpoint replaced the superseded record");
	assert.equal(rows[0].nextSeq, 3);
	assert.deepEqual(
		rows.slice(1).map((row) => row.seq),
		[2, 3],
	);
	assert.equal(rows[2].value, "final");
	assert.equal((await session.getValue(value("probe", "input"), BACKGROUND_CONTEXT)).value, "final");
	await session.close(BACKGROUND_CONTEXT);
});
