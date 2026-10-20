import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleSlash, ListTodo, LoaderCircle } from "lucide-react";
import { ActivityRow } from "./activity-row";
import { FlowReportSummary } from "./flow-report";
import { flowStatusEntries, flowWidgetEntries, hasFlow, widgetLabel, type FlowState, type FlowTask } from "./flow-state";
import type { FlowReportRecord } from "../chat-projection";

function TaskIcon({ status }: { status: FlowTask["status"] }) {
  if (status === "completed") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Completed" />;
  if (status === "in_progress") return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" aria-label="In progress" />;
  if (status === "deleted") return <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Deleted" />;
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Pending" />;
}

/** The session's task/flow dock. It lives at the bottom of the conversation surface,
 * not in a second layout column, so switching sessions swaps one session-scoped view. */
export function FlowPanel({ flow, widgets, statuses, reports = [] }: {
  flow: FlowState;
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
  reports?: readonly FlowReportRecord[];
}) {
  const [open, setOpen] = useState(true);
  if (!hasFlow(flow) && !reports.length) return null;
  const tasks = flow.tasks.filter(task => task.status !== "deleted");
  const completed = tasks.filter(task => task.status === "completed").length;
  const active = tasks.find(task => task.status === "in_progress");
  const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const summary = active?.subject ?? (tasks.length ? `${completed} of ${tasks.length} tasks` : "Session activity");
  const statusPills = flowStatusEntries(statuses);
  const widgetEntries = flowWidgetEntries(widgets);
  return <section aria-label="Flow" className={`mx-auto mb-3 w-[calc(100%-2rem)] max-w-3xl shrink-0 overflow-hidden rounded-xl border border-border bg-card/95 shadow-sm sm:w-[calc(100%-4rem)] ${open ? "flex h-56 flex-col" : ""}`}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40">
      <ListTodo className="size-4 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs font-semibold">Tasks</span>
      {tasks.length > 0 && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{completed}/{tasks.length}</span>}
      {tasks.length > 0 && <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></span>}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
      <span className="flex max-w-1/2 shrink-0 gap-1 overflow-hidden">{statusPills.map(([key, text]) => <span key={key} className="truncate rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{text}</span>)}</span>
      {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
    </button>
    {open && <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2">
      {tasks.length > 0 && <ul className="space-y-1" aria-label="Session tasks">{tasks.map(task => <li key={task.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-xs">
        <TaskIcon status={task.status} />
        <span className="min-w-0 flex-1">
          <span className={`block break-words ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`}>{task.subject}</span>
          <span className="block text-[10px] text-muted-foreground">#{task.id}{task.status === "in_progress" ? " · in progress" : ""}{task.blockedBy.length ? ` · blocked by #${task.blockedBy.join(", #")}` : ""}</span>
        </span>
      </li>)}</ul>}
      {flow.waits.map((wait, index) => <ActivityRow key={index} title="Waiting" summary={wait.reason} state={wait.state} defaultOpen={wait.handles.length > 0}>
        {wait.handles.length > 0 && <ul className="space-y-0.5">{wait.handles.map(handle => <li key={handle} className="truncate font-mono text-[10px] text-muted-foreground">{handle}</li>)}</ul>}
      </ActivityRow>)}
      {flow.background.map((job, index) => <ActivityRow key={index} title="Background task" summary={job.command} state={job.state} />)}
      {reports.filter((report, index, all) => all.findIndex(item => item.text === report.text) === index).slice(-3).map((report, index) => <FlowReportSummary key={`${report.timestamp ?? index}-${report.kind}`} text={report.text} />)}
      {widgetEntries.map(([key, lines]) => <div key={key} className="mb-2">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(key)}</p>
        <ul className="space-y-0.5">{lines.slice(0, 12).map((line, index) => <li key={index} className="truncate whitespace-pre text-[11px] text-muted-foreground">{line}</li>)}</ul>
      </div>)}
    </div>}
  </section>;
}
