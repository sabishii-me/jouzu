import { isDeepStrictEqual } from "node:util";
import type { FlowIntent } from "./admission.js";
import type { FlowProducer } from "./controller.js";
import type { FlowInputItem } from "./model-input.js";
import type { PiFlowAttachment } from "./pi-attachment.js";
import { type FlowAttempt, FlowLedgerError } from "./receipt-ledger.js";
import type { FlowWorkBinding, FlowWorkStatus } from "./wait-authority.js";

export interface FlowTask {
	key: string;
	taskId: string;
	revision: string;
	state: "active" | "blocked" | "paused" | "completed";
}
export interface TaskContinuation {
	key: string;
	revision: string;
	requestId: string;
	build(): string;
	consumed(): void;
	cancelled(): void;
}
export const taskWorkBinding = (key: string): FlowWorkBinding => ({ producer: "tasks", key: [key] });
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function captureTasks(input: FlowTask[]): FlowTask[] {
	if (
		!Array.isArray(input) ||
		input.length > 1024 ||
		input.some(
			(task) =>
				!task ||
				!hash(task.key) ||
				!hash(task.revision) ||
				typeof task.taskId !== "string" ||
				!/^[a-zA-Z0-9._:-]+$/.test(task.taskId) ||
				task.taskId.length > 512 ||
				!["active", "blocked", "paused", "completed"].includes(task.state),
		) ||
		new Set(input.map((task) => task.key)).size !== input.length
	)
		throw new FlowLedgerError("schema", "Invalid task flow inventory.");
	return input.map(({ key, taskId, revision, state }) => ({ key, taskId, revision, state }));
}

/** Task identity and state come from the loaded store, never from continuation prose. */
export class TaskFlowProducer implements FlowProducer {
	readonly version = 1 as const;
	readonly namespace = "tasks";
	private readonly pending = new Map<string, TaskContinuation>();
	private closed = false;
	private retained: string[] = [];
	constructor(
		private readonly attachment: PiFlowAttachment,
		private readonly read: () => FlowTask[],
		private readonly changed: () => void,
	) {}
	inventory(): FlowTask[] {
		if (this.closed) throw new FlowLedgerError("stale", "Task flow attachment is closed.");
		return captureTasks(this.read());
	}
	unboundTasks(): FlowTask[] {
		return this.inventory().filter(
			(task) => task.state !== "completed" && !this.attachment.waits.boundWork(taskWorkBinding(task.key)),
		);
	}

	submit(input: TaskContinuation): void {
		const task = this.inventory().find((task) => task.key === input?.key);
		if (
			!task ||
			task.revision !== input.revision ||
			task.state !== "active" ||
			typeof input.requestId !== "string" ||
			!input.requestId.length ||
			input.requestId.length > 512 ||
			[input.build, input.consumed, input.cancelled].some((fn) => typeof fn !== "function")
		)
			throw new FlowLedgerError("stale", "Task continuation no longer matches runnable task state.");
		if (!this.attachment.waits.boundWork(taskWorkBinding(task.key)))
			throw new FlowLedgerError(
				"identity",
				"Task has no authorized work. Start it with TaskUpdate or TaskExecute from a user turn.",
			);
		const existing = this.pending.get(task.key);
		if (existing) {
			if (existing.requestId === input.requestId && existing.revision === input.revision) return;
			existing.cancelled();
		}
		this.pending.set(task.key, {
			key: input.key,
			revision: input.revision,
			requestId: input.requestId,
			build: input.build.bind(input),
			consumed: input.consumed.bind(input),
			cancelled: input.cancelled.bind(input),
		});
		this.changed();
	}
	async synchronize(): Promise<FlowTask[]> {
		const tasks = this.inventory();
		const authority = await this.attachment.waits.authoritySnapshot();
		for (const work of authority.work) {
			this.inventory();
			if (
				work.binding?.producer !== this.namespace ||
				["stopped", "completed"].includes(work.lifecycle?.state ?? "active")
			)
				continue;
			const task = tasks.find((task) => task.key === work.binding?.key[0]);
			let state: FlowWorkStatus = !task ? "stopped" : task.state === "blocked" ? "paused" : task.state;
			// A producer refresh must not release a separate /flow pause.
			if (
				state === "active" &&
				work.lifecycle?.state === "paused" &&
				work.lifecycle.reason !== "Producer state changed"
			)
				state = "paused";
			if (work.producerRevision !== task?.revision || (work.lifecycle?.state ?? "active") !== state)
				await this.attachment.waits.synchronizeWorkBinding(
					work.binding,
					task?.revision ?? work.producerRevision ?? "deleted",
					state,
					Date.now(),
				);
		}
		this.inventory();
		this.retained = tasks.flatMap((task) => {
			const work = this.attachment.waits.boundWork(taskWorkBinding(task.key));
			return work ? [work.id, ...(work.origin ? [work.origin.id] : [])] : [];
		});
		return tasks;
	}
	retainedWorkIds(): readonly string[] {
		return this.retained;
	}
	async snapshot(signal: AbortSignal): Promise<FlowIntent[]> {
		const tasks = await this.synchronize();
		signal.throwIfAborted();
		const intents: FlowIntent[] = [];
		for (const [key, entry] of this.pending) {
			const task = tasks.find((task) => task.key === key);
			const work = this.attachment.waits.boundWork(taskWorkBinding(key));
			if (!task || task.revision !== entry.revision || task.state !== "active" || !work) {
				this.pending.delete(key);
				entry.cancelled();
				continue;
			}
			intents.push({
				id: `task-${key}`,
				revision: entry.requestId,
				producer: this.namespace,
				sequence: intents.length,
				rank: 4,
				workId: work.id,
				workRevision: `${work.revision}:${entry.revision}:${entry.requestId}`,
				independent: false,
				runnable: (work.lifecycle?.state ?? "active") === "active",
			});
		}
		return intents;
	}
	async build(intent: FlowIntent, signal: AbortSignal): Promise<FlowInputItem> {
		const current = (await this.snapshot(signal)).find((item) => item.id === intent.id);
		const entry = [...this.pending.values()].find((item) => `task-${item.key}` === intent.id);
		if (!current || !entry || !isDeepStrictEqual(current, intent))
			throw new FlowLedgerError("stale", "Task changed before continuation build.");
		const text = entry.build();
		if (typeof text !== "string" || !text.length) throw new FlowLedgerError("schema", "Task continuation is empty.");
		return { id: intent.id, revision: intent.revision, kind: "work", text };
	}
	async validAttempt(attempt: FlowAttempt): Promise<boolean> {
		return (await this.snapshot(new AbortController().signal)).some((intent) =>
			isDeepStrictEqual(intent, attempt.admission?.choice.intent),
		);
	}

	admitted(attempt: FlowAttempt): void {
		const intent = attempt.admission?.choice.intent;
		if (intent?.producer !== this.namespace) return;
		if (attempt.phase !== "claimed" || !attempt.consumed)
			throw new FlowLedgerError("identity", "Task continuation has no native consumption receipt.");
		const entry = [...this.pending.values()].find(
			(item) => `task-${item.key}` === intent.id && item.requestId === intent.revision,
		);
		if (!entry) throw new FlowLedgerError("stale", "Consumed task continuation is no longer attached.");
		// Keep the descriptor until settlement: the controller revalidates it at provider handoff.
		entry.consumed();
	}
	close(): void {
		this.closed = true;
		for (const entry of this.pending.values()) entry.cancelled();
		this.pending.clear();
	}
}
