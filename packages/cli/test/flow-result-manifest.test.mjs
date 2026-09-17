import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context, MemorySessionRepo, setValue, value } from "@earendil-works/pi-agent-core";
import { FlowOwnership } from "../dist/flow-control/ownership.js";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { FlowResultManifestStore } from "../dist/flow-control/result-manifest.js";
import { createFlowResultExtension } from "../dist/flow-control/result-tools.js";
import { afterCleanup } from "./fixtures/cleanup.mjs";

const scope = { sessionId: "parent", branchId: "main" };
const member = (id = "result", status = "success") => ({
	id,
	producer: "worker",
	execution: `exec-${id}`,
	revision: "1",
	status,
	title: `結果 ${id}`,
	reference: `worker-result:${id}`,
	warnings: ["Review required; completion is not approval."],
});
async function rootFor(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-flow-results-"));
	afterCleanup(t, () => rm(root, { recursive: true, force: true }));
	return root;
}
async function memory(t, limits) {
	const ownership = FlowOwnership.acquire(await rootFor(t), scope);
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, context);
	afterCleanup(t, async () => {
		await ownership.close(() => session.close(context));
		await repo.close(context);
	});
	return { session, ownership, store: await FlowResultManifestStore.attach(session, ownership, limits) };
}
const pageOptions = { limit: 20, maxBytes: 20000 };

test("manifest retention freezes membership, is order-independent, and pages exactly after Pi reopen", async (t) => {
	const root = await rootFor(t);
	let attachment = await PiFlowAttachment.open(root, scope);
	afterCleanup(t, () => attachment.close());
	const members = [member("a", "failure"), member("b"), member("c", "cancelled")];
	const saving = attachment.results.retain(members);
	members[0].title = "mutated";
	members[0].warnings.length = 0;
	const reference = await saving;
	assert.equal(
		await attachment.results.retain([member("c", "cancelled"), member("b"), member("a", "failure")]),
		reference,
	);
	const before = await attachment.ledger.snapshot();
	const first = await attachment.results.page(reference, { ...pageOptions, limit: 1 });
	assert.deepEqual(first.counts, { success: 1, failure: 1, cancelled: 1 });
	assert.equal(first.members[0].title, "結果 a");
	assert.equal(first.members[0].warnings.length, 1);
	assert.equal(first.remaining, 2);
	assert.deepEqual(await attachment.ledger.snapshot(), before);
	await attachment.results.retain([member("newest")]);
	assert.equal(await attachment.results.retire(1), 1);
	await attachment.ledger.reset();
	await attachment.close();
	attachment = await PiFlowAttachment.open(root, scope);
	const rest = await attachment.results.page(reference, { ...pageOptions, cursor: first.next });
	assert.deepEqual(
		rest.members.map((item) => item.id),
		["b", "c"],
	);
	assert.equal(rest.next, undefined);
	assert.equal(rest.remaining, 0);
	await assert.rejects(attachment.results.retain([{ ...member("a", "failure"), title: "changed" }]), {
		code: "identity",
	});
});

test("terminal execution/revision cannot change status, reference, or warnings across manifests", async (t) => {
	const { store } = await memory(t);
	await store.retain([member()]);
	for (const update of [{ status: "failure" }, { reference: "changed" }, { warnings: [] }])
		await assert.rejects(store.retain([{ ...member(), ...update }, member("other")]), { code: "identity" });
	await store.retain([{ ...member(), execution: "new-execution", status: "failure" }]);
	await store.retain([{ ...member(), revision: "2", status: "failure" }]);
});

test("pages bound all serialized UTF-8 metadata and reject impossible sizing without truncating warnings", async (t) => {
	const { store } = await memory(t);
	const reference = await store.retain([member("a"), member("b"), member("c")]);
	const one = await store.page(reference, { ...pageOptions, limit: 1 });
	const limit = Buffer.byteLength(JSON.stringify(one));
	const bounded = await store.page(reference, { limit: 20, maxBytes: limit });
	assert.equal(bounded.members.length, 1);
	assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= limit);
	await assert.rejects(store.page(reference, { limit: 20, maxBytes: 10 }), { code: "capacity" });
	assert.deepEqual(bounded.members[0].warnings, member().warnings);
});

test("cursors cannot cross manifests or branches and stale attachments cannot read", async (t) => {
	const root = await rootFor(t);
	const first = await PiFlowAttachment.open(root, scope);
	afterCleanup(t, () => first.close());
	const reference = await first.results.retain([member("a"), member("b")]);
	const cursor = (await first.results.page(reference, { ...pageOptions, limit: 1 })).next;
	const another = await first.results.retain([member("c")]);
	await assert.rejects(first.results.page(another, { ...pageOptions, cursor }), { code: "identity" });
	await first.close();
	await assert.rejects(first.results.page(reference, pageOptions), { code: "closed" });
	const branch = await PiFlowAttachment.open(root, { ...scope, branchId: "another" });
	afterCleanup(t, () => branch.close());
	await assert.rejects(branch.results.page(reference, pageOptions), { code: "identity" });
});

test("manifest count bounds the recent index without losing older membership", async (t) => {
	const { store } = await memory(t, { maxManifests: 1, maxMembers: 20, maxBytes: 20000 });
	const reference = await store.retain([member("a")]);
	await store.retain([member("b")]);
	assert.equal((await store.page(reference, pageOptions)).members[0].id, "a");
});

test("concurrent duplicates share one immutable manifest and changed stored content is refused", async (t) => {
	const { store, session } = await memory(t);
	const references = await Promise.all(Array.from({ length: 10 }, () => store.retain([member()])));
	assert.equal(new Set(references).size, 1);
	const id = references[0].slice(13);
	await session.mutate(
		(mutation, ctx) =>
			mutation.commit(
				[setValue(value("jouzu.flow.result-manifest", id), { version: 1, scope, members: [member("changed")] })],
				ctx,
			),
		context,
	);
	await assert.rejects(store.page(references[0], pageOptions), { code: "identity" });
});

test("invalid and duplicate member identities fail before retention", async (t) => {
	const { store } = await memory(t);
	assert.throws(() => store.retain([member(), member()]), { code: "identity" });
	for (const update of [{ status: "running" }, { execution: "" }, { warnings: [42] }, { reference: "" }])
		assert.throws(() => store.retain([{ ...member(), ...update }]), { code: "schema" });
});

test("maximum retained membership paginates with exact totals and no repeated or missing identities", async (t) => {
	const { store } = await memory(t);
	const members = Array.from({ length: 1024 }, (_, i) =>
		member(String(i).padStart(4, "0"), i % 2 ? "success" : "failure"),
	);
	const reference = await store.retain(members);
	const found = [];
	let cursor;
	do {
		const page = await store.page(reference, { cursor, limit: 37, maxBytes: 16000 });
		assert.equal(page.total, 1024);
		assert.deepEqual(page.counts, { success: 512, failure: 512, cancelled: 0 });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 16000);
		found.push(...page.members.map((item) => item.id));
		cursor = page.next;
	} while (cursor);
	assert.deepEqual(
		found,
		members.map((item) => item.id),
	);
});

test("byte overflow preserves prior manifests and missing indexed content is an explicit failure", async (t) => {
	const { store, session } = await memory(t, { maxManifests: 20, maxMembers: 20, maxBytes: 1500 });
	const reference = await store.retain([member("a")]);
	await assert.rejects(store.retain([{ ...member("b"), title: "結果".repeat(600) }]), { code: "capacity" });
	assert.equal((await store.page(reference, pageOptions)).total, 1);
	await session.mutate(
		(mutation, ctx) =>
			mutation.commit(
				[
					setValue(value("jouzu.flow.result-manifests", "v1"), {
						version: 1,
						scope,
						manifests: [{ id: "a".repeat(64), bytes: 100 }],
					}),
				],
				ctx,
			),
		context,
	);
	await assert.rejects(store.page(`flow-results:${"a".repeat(64)}`, pageOptions), { code: "identity" });
});

test("result tool pages retained membership without acknowledgement and fences branch changes", async (t) => {
	const root = await rootFor(t);
	const attachment = await PiFlowAttachment.open(root, scope);
	afterCleanup(t, () => attachment.close());
	const reference = await attachment.results.retain(Array.from({ length: 25 }, (_, index) => member(`item-${index}`)));
	let active = attachment,
		tool;
	createFlowResultExtension({ attachment: () => active }).factory({
		registerTool(value) {
			tool = value;
		},
	});
	const ctx = { sessionManager: { getSessionId: () => scope.sessionId } };
	const invoke = (args, signal) => tool.execute("page", args, signal, undefined, ctx);
	const before = await attachment.ledger.snapshot();
	const first = JSON.parse((await invoke({ reference, limit: 20 })).content[0].text);
	const second = JSON.parse((await invoke({ reference, cursor: first.next, limit: 20 })).content[0].text);
	assert.equal(first.members.length, 20);
	assert.equal(second.members.length, 5);
	assert.equal(second.remaining, 0);
	assert.deepEqual(await attachment.ledger.snapshot(), before);
	await assert.rejects(invoke({ reference, limit: 21 }), { code: "schema" });
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(invoke({ reference }, abort.signal), { name: "AbortError" });
	const page = attachment.results.page.bind(attachment.results);
	attachment.results.page = async (...args) => {
		const result = await page(...args);
		active = undefined;
		return result;
	};
	await assert.rejects(invoke({ reference }), { code: "scope" });
});

test("manifest retirement protects referenced and pending results and rejects stale retention snapshots", async (t) => {
	const { store } = await memory(t);
	const referenced = await store.retain([member("referenced")]);
	const pending = await store.retain([member("pending")]);
	const old = await store.retain([member("old")]);
	const newest = await store.retain([member("newest")]);
	const references = new Set([referenced]);
	const results = new Set([JSON.stringify(["worker", "pending", "1"])]);
	await assert.rejects(
		store.retire(1, references, results, () => {
			throw new Error("stale references");
		}),
		/stale references/,
	);
	assert.equal((await store.page(old, pageOptions)).members[0].id, "old");
	assert.equal(await store.retire(1, references, results), 1);
	for (const reference of [referenced, pending, newest])
		assert.equal((await store.page(reference, pageOptions)).total, 1);
	assert.equal((await store.page(old, pageOptions)).total, 1);
	assert.equal(await store.retire(1), 2, "released references become eligible for retirement");
});

test("manifest retirement frees the limit and keeps the newest references readable", async (t) => {
	const { store } = await memory(t, { maxManifests: 6, maxMembers: 32, maxBytes: 512 * 1024 });
	const references = [];
	for (let index = 0; index < 6; index++) references.push(await store.retain([member(`r${index}`)]));
	assert.equal(await store.retire(2), 4, "the oldest manifests leave the recent index");
	assert.equal(await store.retire(2), 0, "and retiring again does nothing");
	for (const reference of references.slice(-2)) {
		const page = await store.page(reference, pageOptions);
		assert.equal(page.total, 1, "a kept manifest still pages its exact membership");
	}
	for (const reference of references.slice(0, 4)) assert.equal((await store.page(reference, pageOptions)).total, 1);
	await assert.rejects(store.retain([{ ...member("r0"), status: "failure" }]), { code: "identity" });

	// The freed slots accept new work, which is the point of retiring at all.
	const later = await store.retain([member("after")]);
	assert.equal((await store.page(later, pageOptions)).members[0].id, "after");
});

test("retirement rejects an invalid keep size and survives reopen", async (t) => {
	const root = await rootFor(t);
	let attachment = await PiFlowAttachment.open(root, scope);
	afterCleanup(t, () => attachment.close());
	for (const size of [0, -1, 2.5]) await assert.rejects(attachment.results.retire(size), { code: "capacity" });

	const first = await attachment.results.retain([member("first")]);
	const second = await attachment.results.retain([member("second")]);
	assert.equal(await attachment.results.retire(1), 1);
	await attachment.close();

	attachment = await PiFlowAttachment.open(root, scope);
	assert.equal((await attachment.results.page(first, pageOptions)).members[0].id, "first");
	assert.equal((await attachment.results.page(second, pageOptions)).members[0].id, "second");
	// Retaining an archived duplicate returns the same immutable reference.
	assert.equal(await attachment.results.retain([member("first")]), first);
	assert.equal((await attachment.results.page(first, pageOptions)).members[0].id, "first");
});

test("equal-size batches stay admissible at the exact byte boundary across retirement counts", async (t) => {
	const record = { version: 1, scope, members: [member("00")] };
	const recordBytes = Buffer.byteLength(JSON.stringify(record));
	const header = { version: 1, scope, manifests: [{ id: "a".repeat(64), bytes: recordBytes }], indexed: true };
	const { store } = await memory(t, {
		maxManifests: 1,
		maxMembers: 20,
		maxBytes: Buffer.byteLength(JSON.stringify(header)) + recordBytes,
	});
	const references = [];
	for (let i = 0; i < 20; i++) references.push(await store.retain([member(String(i).padStart(2, "0"))]));
	assert.equal((await store.page(references[0], pageOptions)).members[0].id, "00");
});

function observedSession(session, state) {
	return {
		mutate: (update, context) =>
			session.mutate(
				(mutation, ctx) =>
					update(
						new Proxy(mutation, {
							get(target, property) {
								if (property === "getValue")
									return (...args) => {
										state.reads++;
										return target.getValue(...args);
									};
								if (property === "commit")
									return (...args) => {
										if (state.fail) throw new Error("injected commit failure");
										return target.commit(...args);
									};
								const field = Reflect.get(target, property);
								return typeof field === "function" ? field.bind(target) : field;
							},
						}),
						ctx,
					),
				context,
			),
	};
}

test("indexed history crosses byte limits with bounded queries and rolls back failed writes", async (t) => {
	const limits = { maxManifests: 100, maxMembers: 20, maxBytes: 1600 };
	const { session, ownership } = await memory(t, limits);
	const observed = { reads: 0, fail: false };
	const store = await FlowResultManifestStore.attach(observedSession(session, observed), ownership, limits);
	const references = [];
	for (let i = 0; i < 40; i++) {
		observed.reads = 0;
		references.push(await store.retain([member(`bytes-${i}`)]));
		assert.ok(observed.reads <= 4, `retaining one member needs bounded reads: ${observed.reads}`);
	}
	const header = (await session.getValue(value("jouzu.flow.result-manifests", "v1"), context)).value;
	assert.ok(header.manifests.length < 40);
	assert.ok(
		Buffer.byteLength(JSON.stringify(header)) + header.manifests.reduce((sum, entry) => sum + entry.bytes, 0) <=
			limits.maxBytes,
	);
	observed.reads = 0;
	assert.equal((await store.page(references[0], pageOptions)).members[0].id, "bytes-0");
	assert.equal(observed.reads, 2);
	await assert.rejects(store.retain([{ ...member("bytes-0"), warnings: [] }]), { code: "identity" });
	observed.fail = true;
	await assert.rejects(store.retain([member("failed")]), /injected commit failure/);
	assert.deepEqual((await session.getValue(value("jouzu.flow.result-manifests", "v1"), context)).value, header);
	observed.fail = false;
	const changed = { ...member("failed"), status: "failure" };
	const saved = await store.retain([changed]);
	assert.deepEqual(
		(await store.page(saved, pageOptions)).members,
		[changed],
		"failed transaction leaves no immutable identity behind",
	);
});

test("legacy migration commits metadata indexes atomically and handles a full byte window", async (t) => {
	const { session, ownership } = await memory(t);
	const record = { version: 1, scope, members: [member("legacy")] };
	const id = createHash("sha256").update(JSON.stringify(record)).digest("hex");
	const header = { version: 1, scope, manifests: [{ id, bytes: Buffer.byteLength(JSON.stringify(record)) }] };
	const headerKey = value("jouzu.flow.result-manifests", "v1");
	await session.mutate(
		(mutation, ctx) =>
			mutation.commit([setValue(headerKey, header), setValue(value("jouzu.flow.result-manifest", id), record)], ctx),
		context,
	);
	const limits = {
		maxManifests: 1,
		maxMembers: 20,
		maxBytes: Buffer.byteLength(JSON.stringify(header)) + header.manifests[0].bytes,
	};
	const observed = { reads: 0, fail: true };
	await assert.rejects(
		FlowResultManifestStore.attach(observedSession(session, observed), ownership, limits),
		/injected commit failure/,
	);
	assert.deepEqual((await session.getValue(headerKey, context)).value, header);
	observed.fail = false;
	const store = await FlowResultManifestStore.attach(observedSession(session, observed), ownership, limits);
	assert.equal(
		(await session.getValue(headerKey, context)).value.manifests.length,
		0,
		"migration metadata can evict a full recent index without losing pages",
	);
	assert.deepEqual((await store.page(`flow-results:${id}`, pageOptions)).members, record.members);
	await assert.rejects(store.retain([{ ...member("legacy"), title: "changed" }]), { code: "identity" });
	observed.reads = 0;
	await FlowResultManifestStore.attach(observedSession(session, observed), ownership, limits);
	assert.equal(observed.reads, 1, "reopen does not repeat historical migration");
});
