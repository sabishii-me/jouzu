import type { LogWriter } from "./log-writer.js";
import type { ManagedTask } from "./types.js";

/** Publish the terminal transition only after its log flush completes or reaches its deadline. */
export async function finalizeAfterLogFlush(task: ManagedTask, writer: LogWriter, hooks: {
 clearTimers(task: ManagedTask): void;
 isCurrent(task: ManagedTask): boolean;
 finalize(): void;
}): Promise<void> {
 if (task.closed) return;
 task.closed = true;
 task.child = null;
 hooks.clearTimers(task);
 const pending = writer.flush(task.logFile);
 if (pending) await pending;
 if (!hooks.isCurrent(task)) return;
 if (!writer.settled(task.logFile)) task.logWarning = "Task log may be incomplete because a write failed or stalled.";
 // The lifecycle transition owns the closed gate once the log is ready.
 task.closed = false;
 hooks.finalize();
}
