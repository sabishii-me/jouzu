import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

interface Task {
	id: string; createdAt: number; subject: string; description: string; status: string;
	owner?: string; blockedBy: string[]; metadata: Record<string, unknown>;
}
interface Descriptor { key: string; taskId: string; revision: string; state: "active" | "blocked" | "paused" | "completed"; subject: string; status: string; reason?: string; blockedBy: string[]; }
interface Host {
	version: 1;
	ready(): Promise<void>;
	changed(): void;
	/** Flow control is on for this session. Absent on older hosts, which are treated as live. */
	live?(): boolean;
	/** True while an autonomous multiloop/goal continuation is executing. */
	autonomous?(): boolean;
	submit(input: { key: string; revision: string; requestId: string; build(): string; consumed(): void; cancelled(): void }): void;
	tool<T>(name: string, args: unknown, invoke: () => Promise<T>): Promise<T>;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The loaded task store owns descriptors; message text and tool-supplied metadata never supply work IDs. */
export function installTaskFlow(pi: ExtensionAPI, list: () => Task[], storeIdentity: () => string) {
	let host: Host | undefined;
	let failure: unknown;
	const describe = (task: Task, tasks = list()): Descriptor => {
		if (!task || typeof task.id !== "string" || !task.id.length || !Number.isSafeInteger(task.createdAt) || task.createdAt < 0 || !Array.isArray(task.blockedBy)) throw new Error("Invalid task identity.");
		const { executionStats: _stats, ...metadata } = task.metadata ?? {};
		const control = metadata.flowControl as { waitForUser?: boolean; paused?: boolean } | undefined;
		const invalid = control !== undefined && (!control || typeof control !== "object" || Array.isArray(control) || (control.waitForUser !== undefined && typeof control.waitForUser !== "boolean") || (control.paused !== undefined && typeof control.paused !== "boolean"));
		const key = hash(["task-work-v1", storeIdentity(), task.id, task.createdAt]);
		const blockedBy = task.blockedBy.filter(id => tasks.find(other => other.id === id)?.status !== "completed");
		const autonomous = host?.autonomous?.() === true;
		const state = task.status === "completed" ? "completed" : invalid || control?.paused ? "paused" : control?.waitForUser || blockedBy.length > 0 ? "blocked" : "active";
		const effectiveState = autonomous && (control?.waitForUser || control?.paused) && blockedBy.length === 0 ? "active" : state;
		const reason = task.status === "completed" ? undefined : invalid ? "Task has invalid flow-control settings" : control?.paused ? (autonomous ? "Paused in task settings (overridden for autonomous loop)" : "Paused in task settings") : control?.waitForUser ? (autonomous ? "Waiting for your input (overridden for autonomous loop)" : "Waiting for your input") : blockedBy.length ? `Waiting for ${blockedBy.map(id => `task #${id}`).join(", ")}` : undefined;
		return { key, taskId: task.id, state: effectiveState, subject: task.subject, status: task.status, reason, blockedBy, revision: hash([key, task.subject, task.description, task.status, task.owner, task.blockedBy, metadata, effectiveState, autonomous]) };
	};
	const currentHost = () => { if (failure) throw failure; return host; };
	return {
		progress(task: Task, fallback: number) { return currentHost() ? describe(task).revision : fallback; },
		runnable(task: Task) { currentHost(); return describe(task).state === "active"; },
		async connect(sessionId: string) {
			host = undefined;
			failure = undefined;
			let accepting = true;
			pi.events.emit("jouzu:task-flow", {
				version: 1, sessionId,
				read() { const tasks = list(); return tasks.map(task => describe(task, tasks)); },
				accept(value: Host) {
					if (!accepting || host || value?.version !== 1 || [value.ready, value.changed, value.submit, value.tool].some(fn => typeof fn !== "function")) throw new Error("Invalid task flow handshake.");
					host = value;
				},
				reject(error: unknown) { failure = error; },
			});
			accepting = false;
			try { await currentHost()?.ready(); } catch (error) { failure = error; throw error; }
			return !!host;
		},
		send(task: Task, build: () => string, consumed: () => void, cancelled: () => void): boolean {
			const active = currentHost();
			// While flow control is off the task store drives its own continuations, exactly as it does
			// in a session where flow control was never attached.
			if (!active || active.live?.() === false) return false;
			const descriptor = describe(task);
			let delivered = false;
			active.submit({ ...descriptor, requestId: randomUUID(),
				build() {
					const latest = list().find(item => describe(item).key === descriptor.key);
					if (!latest || describe(latest).revision !== descriptor.revision) throw new Error("Task changed before continuation dispatch.");
					return build();
				},
				consumed() { if (!delivered) { delivered = true; consumed(); } },
				cancelled() { if (!delivered) cancelled(); },
			});
			return true;
		},
		registerTool(tool: ToolDefinition) {
			const execute = tool.execute;
			pi.registerTool({ ...tool, async execute(id, args, signal, update, ctx) {
				const active = currentHost();
				const invoke = async () => {
					const params = args as Record<string, unknown>;
					let effective = args;
					if (tool.name === "TaskUpdate" && (params.waitForUser !== undefined || params.paused !== undefined)) {
						const task = list().find(task => task.id === params.taskId);
						const { waitForUser, paused, ...rest } = params;
						const autonomous = host?.autonomous?.() === true;
						const effectiveWaitForUser = autonomous && waitForUser === true ? false : waitForUser;
						const effectivePaused = autonomous && paused === true ? false : paused;
						effective = { ...rest, metadata: { ...(params.metadata as object ?? {}), flowControl: { ...(task?.metadata.flowControl as object ?? {}), ...(effectiveWaitForUser === undefined ? {} : { waitForUser: effectiveWaitForUser }), ...(effectivePaused === undefined ? {} : { paused: effectivePaused }) } } };
					}
					signal?.throwIfAborted();
					const result = await execute.call(tool, id, effective, signal, update, ctx);
					signal?.throwIfAborted();
					return result;
				};
				return active && active.live?.() !== false ? active.tool(tool.name, args, invoke) : invoke();
			} });
		},
	};
}
