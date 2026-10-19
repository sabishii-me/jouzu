import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { ActivityRow, StateDot } from "./activity-row";
import { flowWidgetEntries, hasFlow, widgetLabel, type FlowState } from "./flow-state";

const taskState = { pending: "idle", in_progress: "running", completed: "done", deleted: "warning" } as const;
export function FlowPanel({ flow, widgets, statuses }: {
  flow: FlowState;
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
}) {
  const [open, setOpen] = useState(true);
  if (!hasFlow(flow, widgets, statuses)) return null;
  const active = flow.tasks.filter(task => task.status === "in_progress").length;
  const pending = flow.tasks.filter(task => task.status === "pending").length;
  const waiting = flow.waits.filter(wait => wait.state === "running").length;
  const summary = [active ? `${active} active` : "", pending ? `${pending} pending` : "", waiting ? `${waiting} waiting` : ""].filter(Boolean).join(" · ") || "Session work";
  return <section aria-label="Flow" className="border-b border-border bg-muted/20">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-muted/40">
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">Flow</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
      <span className="flex max-w-1/2 gap-1 overflow-hidden">{Object.entries(statuses).map(([key, text]) => <span key={key} className="truncate rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{text}</span>)}</span>
      {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
    </button>
    {open && <div className="max-h-64 overflow-y-auto px-3 pb-2">
      {flow.tasks.length > 0 && <div className="mb-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tasks</p>
        <ul className="space-y-0.5">{flow.tasks.map(task => <li key={task.id} className="flex items-start gap-2 text-xs">
          <span className="mt-1"><StateDot state={taskState[task.status]} /></span>
          <span className="min-w-0 flex-1"><span className={`block truncate ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`}>{task.subject}</span><span className="block text-[10px] text-muted-foreground">#{task.id} · {task.status.replaceAll("_", " ")}{task.blockedBy.length ? ` · blocked by #${task.blockedBy.join(", #")}` : ""}</span></span>
        </li>)}</ul>
      </div>}
      {flow.waits.map((wait, index) => <ActivityRow key={index} title="Waiting" summary={wait.reason} state={wait.state} defaultOpen={wait.handles.length > 0}>
        {wait.handles.length > 0 && <ul className="space-y-0.5">{wait.handles.map(handle => <li key={handle} className="truncate font-mono text-[10px] text-muted-foreground">{handle}</li>)}</ul>}
      </ActivityRow>)}
      {flow.background.map((job, index) => <ActivityRow key={index} title="Background task" summary={job.command} state={job.state} />)}
      {flowWidgetEntries(widgets).map(([key, lines]) => <div key={key} className="mb-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(key)}</p>
        <ul className="space-y-0.5">{lines.slice(0, 12).map((line, index) => <li key={index} className="truncate whitespace-pre text-[11px] text-muted-foreground">{line}</li>)}</ul>
      </div>)}
    </div>}
  </section>;
}
