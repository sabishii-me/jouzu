import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, CircleSlash, ListTodo, LoaderCircle } from "lucide-react";
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

/** Session status chip in the header. Its trigger is layout-stable; task/report
 * changes only affect the popover, never the conversation layout. */
export function FlowMenu({ flow, widgets, statuses, reports = [] }: {
  flow: FlowState;
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
  reports?: readonly FlowReportRecord[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!hasFlow(flow) && !reports.length) return null;
  const tasks = flow.tasks.filter(task => task.status !== "deleted");
  const completed = tasks.filter(task => task.status === "completed").length;
  const active = tasks.find(task => task.status === "in_progress");
  const running = tasks.filter(task => task.status === "in_progress").length;
  const pending = tasks.filter(task => task.status === "pending").length;
  const waiting = flow.waits.filter(wait => wait.state === "running").length;
  const background = flow.background.filter(job => job.state === "running").length;
  const summary = [
    active ? active.subject : tasks.length ? `${completed}/${tasks.length} tasks` : "",
    running ? `${running} running` : "",
    pending ? `${pending} pending` : "",
    waiting ? `${waiting} waiting` : "",
    background ? `${background} background` : "",
  ].filter(Boolean).join(" · ") || "Session activity";
  return <div ref={root} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-label="Flow" aria-haspopup="dialog" aria-expanded={open} className="flex h-7 w-40 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-muted/50 sm:w-44">
      <ListTodo className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden min-w-0 flex-1 truncate sm:inline">{summary}</span>
      <span className="flex-1 sm:hidden">{tasks.length ? `${completed}/${tasks.length}` : "Flow"}</span>
      <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open && <div role="dialog" aria-label="Flow details" className="absolute right-0 top-full z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ListTodo className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">Tasks</span>
        {tasks.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{completed}/{tasks.length}</span>}
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">{summary}</span>
      </div>
      <div className="max-h-[min(24rem,60vh)] overflow-y-auto px-3 py-2">
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
        {flowWidgetEntries(widgets).map(([key, lines]) => <div key={key} className="mb-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{widgetLabel(key)}</p>
          <ul className="space-y-0.5">{lines.slice(0, 12).map((line, index) => <li key={index} className="truncate whitespace-pre text-[11px] text-muted-foreground">{line}</li>)}</ul>
        </div>)}
        {flowStatusEntries(statuses).map(([key, text]) => <p key={key} className="mb-1 text-[11px] text-muted-foreground">{text}</p>)}
      </div>
    </div>}
  </div>;
}
