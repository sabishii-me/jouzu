import { ActivityRow, StateDot, type ActivityState } from "./activity-row";
import { parseTaskLines } from "./flow-state";
import { object, type ToolView } from "../chat-projection";
import { toolText, type ToolRendererProps } from "./types";

const statusState: Record<string, ActivityState> = { pending: "idle", in_progress: "running", completed: "done", deleted: "warning" };
function argsOf(tool: ToolView): Record<string, unknown> {
  if (object(tool.args)) return tool.args;
  if (typeof tool.args === "string") { try { const value = JSON.parse(tool.args); return object(value) ? value : {}; } catch { return {}; } }
  return {};
}
export function TaskRenderer({ tool }: ToolRendererProps) {
  const args = argsOf(tool);
  const text = toolText(tool.result);
  const listed = parseTaskLines(text);
  const created = Array.isArray(args.tasks)
    ? args.tasks.flatMap(value => { const item = object(value) ? value : {}; return typeof item.subject === "string" ? [item.subject] : []; })
    : typeof args.subject === "string" ? [args.subject] : [];
  const rows = listed.length ? listed : created.map((subject, index) => ({ id: String(index + 1), subject, status: "pending", blockedBy: [] as string[] }));
  const phase: ActivityState = tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done";
  const title = tool.name === "TaskCreateMany" || tool.name === "TaskCreate" ? "Tasks created"
    : tool.name === "TaskUpdate" ? "Task updated"
      : tool.name === "TaskExecute" ? "Task execution" : "Task list";
  const summary = typeof args.taskId === "string" ? `Task #${args.taskId}${typeof args.status === "string" ? ` · ${args.status.replaceAll("_", " ")}` : ""}`
    : rows.length ? `${rows.length} task${rows.length === 1 ? "" : "s"}` : undefined;
  return <ActivityRow title={title} summary={summary} state={phase} defaultOpen={rows.length > 0 && rows.length <= 6}>
    {rows.length > 0 && <ul className="space-y-1">{rows.map(row => <li key={`${row.id}-${row.subject}`} className="flex items-start gap-2">
      <StateDot state={statusState[row.status] ?? phase} />
      <span className="min-w-0 flex-1"><span className="block truncate text-foreground">{row.subject}</span><span className="block text-[11px] text-muted-foreground">#{row.id} · {row.status.replaceAll("_", " ")}{row.blockedBy.length ? ` · blocked by #${row.blockedBy.join(", #")}` : ""}</span></span>
    </li>)}</ul>}
    {!rows.length && <p className="text-muted-foreground">{text || "No task details returned."}</p>}
  </ActivityRow>;
}
