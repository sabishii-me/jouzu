import { ActivityRow, type ActivityState } from "./activity-row";
import { object, type ToolView } from "../chat-projection";
import type { ToolRendererProps } from "./types";

function argsOf(tool: ToolView): Record<string, unknown> {
  if (object(tool.args)) return tool.args;
  if (typeof tool.args === "string") { try { const value = JSON.parse(tool.args); return object(value) ? value : {}; } catch { return {}; } }
  return {};
}

/** Task mutations are summarized here only. The authoritative task list is the
 * session-scoped Flow dock, so the transcript never renders a second todo list. */
export function TaskRenderer({ tool }: ToolRendererProps) {
  const args = argsOf(tool);
  const count = Array.isArray(args.tasks) ? args.tasks.length : typeof args.subject === "string" ? 1 : 0;
  const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
  const phase: ActivityState = tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done";
  const title = tool.name === "TaskCreateMany" || tool.name === "TaskCreate" ? "Tasks updated"
    : tool.name === "TaskUpdate" ? "Task updated"
      : tool.name === "TaskExecute" ? "Task execution" : "Tasks";
  const summary = taskId ? `#${taskId}${typeof args.status === "string" ? ` · ${args.status.replaceAll("_", " ")}` : ""}`
    : count ? `${count} task${count === 1 ? "" : "s"}` : undefined;
  return <ActivityRow title={title} summary={summary} state={phase} />;
}
