/**
 * Scalar journal storage for flow records.
 *
 * Flow control stores scalar values addressed by namespace and key. This module owns the value
 * and write shapes, serialized read-modify-write callbacks, and a close that drains active work.
 */

import { randomUUID } from "node:crypto";

/** Context marker accepted by flow storage callbacks. */
export interface ScalarContext {
	readonly abortSignal?: AbortSignal | undefined;
}

/** Frozen sentinel for flow storage work that must never be cancelled. */
export const BACKGROUND_CONTEXT: ScalarContext = Object.freeze({ abortSignal: undefined });

declare const storedValueType: unique symbol;

/** Address of one scalar value: namespace equality plus key-prefix scans. */
export interface Value<T> {
	readonly namespace: string;
	readonly key: string;
	readonly kind: "value";
	readonly [storedValueType]?: (value: T) => T;
}

/** One committed scalar value with the sequence number that last wrote it. */
export interface StoredValue<T> {
	readonly address: Value<T>;
	readonly value: T;
	readonly seq: number;
}

/** One requested scalar change before storage assigns its sequence number. */
export interface ValueSetWrite {
	kind: "value";
	op: "set";
	namespace: string;
	key: string;
	value: unknown;
}

export interface ValueDeleteWrite {
	kind: "value";
	op: "delete";
	namespace: string;
	key: string;
}

export type ValueWrite = ValueSetWrite | ValueDeleteWrite;

/** Every write a flow store may commit. Scalar values are the whole durable surface. */
export type Write = ValueWrite;

/** A scalar write with its assigned sequence number. */
export interface CommittedValueSetWrite extends ValueSetWrite {
	seq: number;
}

export interface CommittedValueDeleteWrite extends ValueDeleteWrite {
	seq: number;
}

export type CommittedValueWrite = CommittedValueSetWrite | CommittedValueDeleteWrite;

/** Fields available to a commit caller. Flow stores do not read them. */
export interface CommitResult {
	firstSeq: number;
	seqs: number[];
	timestamp: number;
}

export interface SessionMetadata {
	id: string;
	createdAt: number;
	storageVersion: number;
	cwd?: string;
	parentSessionId?: string;
	legacyParentSessionPath?: string;
}

export interface SessionReader {
	getValue<T>(address: Value<T>, context: ScalarContext): Promise<StoredValue<T> | undefined>;
	scanValues<T>(prefix: Value<T>, context: ScalarContext): Promise<StoredValue<T>[]>;
}

/** Callback-scoped mutation capability. It cannot outlive or release its mutation. */
export interface SessionMutator extends SessionReader {
	/** Exactly zero or one commit attempt. A second attempt rejects, including after a failure. */
	commit(writes: readonly Write[], context: ScalarContext): Promise<CommitResult>;
}

export interface Session<TMetadata extends SessionMetadata = SessionMetadata> extends SessionReader {
	readonly metadata: TMetadata;
	/**
	 * Trusted exclusive callback over the session mutation line. A public writer called from this
	 * callback queues behind it; use the supplied mutator for the callback's own commit.
	 */
	mutate<T>(
		mutation: (mutator: SessionMutator, context: ScalarContext) => T | Promise<T>,
		context: ScalarContext,
	): Promise<T>;
	close(context: ScalarContext): Promise<void>;
}

/** Storage capability behind one scalar session. */
export interface ScalarStorage extends SessionReader {
	commit(writes: readonly Write[], context: ScalarContext): Promise<CommitResult>;
	close(context: ScalarContext): Promise<void>;
}

/** Materialized scalar state shared by the memory and journal backends. */
export interface StoredScalarRecord {
	readonly address: { readonly namespace: string; readonly key: string; readonly kind: "value" };
	readonly value: unknown;
	readonly seq: number;
}

export type ScalarState = Map<string, StoredScalarRecord>;

const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MEMORY_STORAGE_VERSION = 1;

function physicalKey(namespace: string, key: string): string {
	return `${namespace}\u0000${key}`;
}

function compareKeys(left: string, right: string): number {
	const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
	const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index++) {
		const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return leftPoints.length - rightPoints.length;
}

function validateAddress(namespace: string, key: string): void {
	if (typeof namespace !== "string" || namespace.length === 0)
		throw new TypeError("Value namespace must be a non-empty string");
	if (typeof key !== "string") throw new TypeError("Value key must be a string");
	if (namespace.includes("\u0000")) throw new TypeError("Value namespace must not contain \\u0000");
	if (key.includes("\u0000")) throw new TypeError("Value key must not contain \\u0000");
}

/** Address one scalar value. Keys scan by prefix; namespaces compare exactly. */
export function value<T>(namespace: string, key = ""): Value<T> {
	validateAddress(namespace, key);
	return Object.freeze({ namespace, key, kind: "value" as const });
}

export function setValue<T>(address: Value<T>, next: NoInfer<T>): ValueSetWrite {
	return { kind: "value", op: "set", namespace: address.namespace, key: address.key, value: next };
}

export function deleteValue<T>(address: Value<T>): ValueDeleteWrite {
	return { kind: "value", op: "delete", namespace: address.namespace, key: address.key };
}

function commitValueWrite(write: unknown, seq: number): CommittedValueWrite {
	if (typeof write !== "object" || write === null) throw new TypeError("A scalar write must be an object.");
	const candidate = write as { kind?: unknown; op?: unknown; namespace?: unknown; key?: unknown; value?: unknown };
	if (candidate.kind !== "value") throw new TypeError(`Unsupported scalar write kind: ${String(candidate.kind)}`);
	if (candidate.op !== "set" && candidate.op !== "delete")
		throw new TypeError(`Unsupported scalar write operation: ${String(candidate.op)}`);
	if (typeof candidate.namespace !== "string" || candidate.namespace.length === 0)
		throw new TypeError("Value namespace must be a non-empty string");
	if (candidate.namespace.includes("\u0000")) throw new TypeError("Value namespace must not contain \\u0000");
	if (typeof candidate.key !== "string") throw new TypeError("Value key must be a string");
	if (candidate.key.includes("\u0000")) throw new TypeError("Value key must not contain \\u0000");
	if (candidate.op === "delete")
		return { kind: "value", op: "delete", seq, namespace: candidate.namespace, key: candidate.key };
	if (!Object.hasOwn(candidate, "value") || candidate.value === undefined)
		throw new TypeError("A value set write requires a defined value");
	// JSON drops these values entirely, which would leave an unreadable set record behind.
	if (typeof candidate.value === "function" || typeof candidate.value === "symbol")
		throw new TypeError("A value set write requires a JSON-serializable value");
	return { kind: "value", op: "set", seq, namespace: candidate.namespace, key: candidate.key, value: candidate.value };
}

/**
 * Assign sequence numbers and validate every requested scalar change. Callers must run this before
 * writing anything so an invalid or unserializable commit leaves state and storage untouched.
 */
export function prepareValueCommit(
	writes: readonly Write[],
	firstSeq: number,
	timestamp: number,
): { writes: CommittedValueWrite[]; result: CommitResult } {
	if (!Number.isSafeInteger(firstSeq) || firstSeq < 1) throw new Error("Invalid scalar storage sequence.");
	if (firstSeq + writes.length > MAX_SEQUENCE)
		throw new Error("Scalar storage sequence exceeds the safe integer range.");
	const committed = writes.map((write, index) => commitValueWrite(write, firstSeq + index));
	return { writes: committed, result: { firstSeq, seqs: committed.map((write) => write.seq), timestamp } };
}

/** Snapshot inputs at commit invocation, using the same JSON representation as the journal. */
function snapshotValueWrites(writes: readonly Write[]): Write[] {
	const validated = prepareValueCommit(writes, 1, 0).writes;
	const decoded: unknown[] = JSON.parse(JSON.stringify(validated));
	// A custom toJSON method may omit a set value. Refuse that before any append or state change.
	return decoded.map((write, index) => commitValueWrite(write, index + 1));
}

/** Apply committed writes in order, so a later set or delete supersedes an earlier one. */
export function applyValueWrites(state: ScalarState, writes: readonly CommittedValueWrite[]): void {
	for (const write of writes) {
		const key = physicalKey(write.namespace, write.key);
		if (write.op === "delete") state.delete(key);
		else state.set(key, { address: value(write.namespace, write.key), value: write.value, seq: write.seq });
	}
}

export function readStoredValue<T>(state: ScalarState, address: Value<T>): StoredValue<T> | undefined {
	const stored = state.get(physicalKey(address.namespace, address.key));
	return stored === undefined ? undefined : (structuredClone(stored) as StoredValue<T>);
}

export function scanStoredValues<T>(state: ScalarState, prefix: Value<T>): StoredValue<T>[] {
	return [...state.values()]
		.filter((stored) => stored.address.namespace === prefix.namespace && stored.address.key.startsWith(prefix.key))
		.sort((left, right) => compareKeys(left.address.key, right.address.key))
		.map((stored) => structuredClone(stored) as StoredValue<T>);
}

/** Serializes complete read-modify-write jobs for one session. */
class MutationLine {
	private tail: Promise<void> = Promise.resolve();
	private sealed: Error | undefined;

	run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.sealed !== undefined) return Promise.reject(this.sealed);
		const result = this.tail.then(() => {
			if (this.sealed !== undefined) throw this.sealed;
			return operation();
		});
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	seal(error: Error): Promise<void> {
		this.sealed ??= error;
		return this.tail;
	}
}

class ScalarMutator implements SessionMutator {
	private active = true;
	private commitAttempted = false;
	private commitResult: Promise<CommitResult> | undefined;
	private endPromise: Promise<void> | undefined;

	constructor(private readonly storage: ScalarStorage) {}

	commit(writes: readonly Write[], context: ScalarContext): Promise<CommitResult> {
		this.assertActive();
		if (this.commitAttempted) return Promise.reject(new Error("SessionMutator commit already attempted"));
		// Claim the attempt before user-defined JSON serialization can reenter this mutator.
		this.commitAttempted = true;
		let result: Promise<CommitResult>;
		try {
			result = this.storage.commit(snapshotValueWrites(writes), context);
		} catch (error) {
			result = Promise.reject(error);
		}
		this.commitResult = result;
		return result;
	}

	/** Wait for any commit attempt, invalidate the capability, and release the mutation barrier. */
	end(): Promise<void> {
		if (this.endPromise !== undefined) return this.endPromise;
		this.active = false;
		this.endPromise =
			this.commitResult?.then(
				() => undefined,
				() => undefined,
			) ?? Promise.resolve();
		return this.endPromise;
	}

	getValue<T>(address: Value<T>, context: ScalarContext): Promise<StoredValue<T> | undefined> {
		this.assertActive();
		return this.storage.getValue(address, context);
	}

	scanValues<T>(prefix: Value<T>, context: ScalarContext): Promise<StoredValue<T>[]> {
		this.assertActive();
		return this.storage.scanValues(prefix, context);
	}

	private assertActive(): void {
		if (!this.active) throw new Error("SessionMutator cannot be used outside its mutation callback");
	}
}

class StorageBackedScalarSession<TMetadata extends SessionMetadata> implements Session<TMetadata> {
	private readonly mutationLine = new MutationLine();
	private readonly closedError = new Error("Session is closed");
	private state: "open" | "closing" | "closed" = "open";
	private closePromise: Promise<void> | undefined;

	constructor(
		readonly metadata: TMetadata,
		private readonly storage: ScalarStorage,
	) {}

	mutate<T>(
		mutation: (mutator: SessionMutator, context: ScalarContext) => T | Promise<T>,
		context: ScalarContext,
	): Promise<T> {
		if (this.state !== "open") return Promise.reject(this.closedError);
		return this.mutationLine.run(async () => {
			const mutator = new ScalarMutator(this.storage);
			try {
				return await mutation(mutator, context);
			} finally {
				await mutator.end();
			}
		});
	}

	getValue<T>(address: Value<T>, context: ScalarContext): Promise<StoredValue<T> | undefined> {
		if (this.state !== "open") return Promise.reject(this.closedError);
		return this.storage.getValue(address, context);
	}

	scanValues<T>(prefix: Value<T>, context: ScalarContext): Promise<StoredValue<T>[]> {
		if (this.state !== "open") return Promise.reject(this.closedError);
		return this.storage.scanValues(prefix, context);
	}

	/** Refuse queued or new work, then wait for the active mutation and its commit before closing. */
	close(context: ScalarContext): Promise<void> {
		if (this.closePromise !== undefined) return this.closePromise;
		this.state = "closing";
		this.closePromise = this.mutationLine
			.seal(this.closedError)
			.then(() => this.storage.close(context))
			.finally(() => {
				this.state = "closed";
			});
		return this.closePromise;
	}
}

class MemoryScalarStorage implements ScalarStorage {
	private readonly values: ScalarState = new Map();
	private nextSeq = 1;
	private state: "open" | "closing" | "closed" = "open";
	private commitQueue: Promise<void> = Promise.resolve();
	private closePromise: Promise<void> | undefined;

	commit(writes: readonly Write[], _context: ScalarContext): Promise<CommitResult> {
		if (this.state !== "open") return Promise.reject(new Error("Scalar storage is closed"));
		const result = this.commitQueue.then(() => {
			const prepared = prepareValueCommit(writes, this.nextSeq, Date.now());
			applyValueWrites(this.values, prepared.writes);
			this.nextSeq = prepared.result.firstSeq + prepared.writes.length;
			return prepared.result;
		});
		this.commitQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	getValue<T>(address: Value<T>, _context: ScalarContext): Promise<StoredValue<T> | undefined> {
		if (this.state !== "open") return Promise.reject(new Error("Scalar storage is closed"));
		return Promise.resolve(readStoredValue(this.values, address));
	}

	scanValues<T>(prefix: Value<T>, _context: ScalarContext): Promise<StoredValue<T>[]> {
		if (this.state !== "open") return Promise.reject(new Error("Scalar storage is closed"));
		return Promise.resolve(scanStoredValues(this.values, prefix));
	}

	close(_context: ScalarContext): Promise<void> {
		if (this.closePromise !== undefined) return this.closePromise;
		this.state = "closing";
		this.closePromise = this.commitQueue.then(() => {
			this.state = "closed";
		});
		return this.closePromise;
	}
}

/** The minimal session surface shared by the memory and journal backends. */
export function createScalarSession<TMetadata extends SessionMetadata>(
	metadata: TMetadata,
	storage: ScalarStorage,
): Session<TMetadata> {
	return new StorageBackedScalarSession(metadata, storage);
}

/** An in-memory session for tests and non-durable use. */
export function createMemorySession(metadata: Partial<SessionMetadata> = {}): Session {
	return createScalarSession(
		{
			id: metadata.id ?? randomUUID(),
			createdAt: metadata.createdAt ?? Date.now(),
			storageVersion: metadata.storageVersion ?? MEMORY_STORAGE_VERSION,
			...(metadata.cwd === undefined ? {} : { cwd: metadata.cwd }),
			...(metadata.parentSessionId === undefined ? {} : { parentSessionId: metadata.parentSessionId }),
			...(metadata.legacyParentSessionPath === undefined
				? {}
				: { legacyParentSessionPath: metadata.legacyParentSessionPath }),
		},
		new MemoryScalarStorage(),
	);
}
