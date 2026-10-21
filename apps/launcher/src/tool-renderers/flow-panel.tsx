import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, CircleSlash, ListTodo, LoaderCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { ActivityRow } from "./activity-row";
import { FlowReportSummary } from "./flow-report";
import { flowStatusEntries, flowWidgetEntries, widgetLabel, type FlowState, type FlowTask } from "./flow-state";
import type { FlowReportRecord } from "../chat-projection";

function TaskIcon({ status }: { status: FlowTask["status"] }) {
  if (status === "completed") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Completed" />;
  if (status === "in_progress") return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" aria-label="In progress" />;
  if (status === "deleted") return <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Deleted" />;
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Pending" />;
}

/** Session status chip in the header. Its trigger is layout-stable; task/report
 * changes only affect the popover, never the conversation layout. */
export function FlowMenu({ flow, widgets, statuses, reports = [], onCommand, busy = false }: {
  flow: FlowState;
  widgets: Record<string, string[]>;
  statuses: Record<string, string>;
  reports?: readonly FlowReportRecord[];
  onCommand?: (command: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [page, setPage] = useState("");
  const [resetArmed, setResetArmed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
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
  const live = running > 0 || waiting > 0 || background > 0;
  return <div ref={root} className="relative">
    <button type="button" onClick={() => setOpen(value => !value)} aria-label="Flow" aria-haspopup="dialog" aria-expanded={open} className={`flex h-7 w-40 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted/50 sm:w-44 ${live ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      {live ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : <ListTodo className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="hidden min-w-0 flex-1 truncate sm:inline" aria-live="polite">{summary}</span>
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
      {onCommand && <div className="space-y-2 border-b border-border px-2 py-2" aria-label="Flow commands">
        <div className="flex flex-wrap gap-1">
          {[["/flow", "Status"], ["/flow pause", "Pause"], ["/flow resume", "Resume"], ["/flow clear", "Clear"], ["/flow runtime", "Runtime"]].map(([command, label]) => <Button key={command} variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => { setOpen(false); onCommand(command); }}>{label}</Button>)}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => { setOpen(false); onCommand("/flow off"); }}>Off</Button>
          <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => { setOpen(false); onCommand("/flow on"); }}>On</Button>
          <input aria-label="Flow details page" inputMode="numeric" placeholder="Page" value={page} onChange={event => setPage(event.target.value.replace(/[^\d]/gu, ""))} className="h-6 w-14 rounded border border-border bg-background px-1 text-[10px]" />
          <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => { setOpen(false); onCommand(`/flow details${page ? ` ${page}` : ""}`); }}>Details</Button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <input aria-label="Flow request or token" placeholder="Request / token" value={target} onChange={event => setTarget(event.target.value)} className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[10px]" />
          <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={busy || !target.trim()} onClick={() => { setOpen(false); onCommand(`/flow retry ${target.trim()}`); }}>Retry</Button>
          <Button variant="outline" className="h-6 px-2 text-[10px]" disabled={busy || !target.trim()} onClick={() => { setOpen(false); onCommand(`/flow cancel ${target.trim()}`); }}>Cancel</Button>
        </div>
        <Button variant={resetArmed ? "default" : "outline"} className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => { if (!resetArmed) { setResetArmed(true); return; } setResetArmed(false); setOpen(false); onCommand("/flow reset confirm"); }}>{resetArmed ? "Confirm reset" : "Reset…"}</Button>
      </div>}
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
        {!tasks.length && !flow.waits.length && !flow.background.length && !reports.length && !flowWidgetEntries(widgets).length && !flowStatusEntries(statuses).length && <p className="py-2 text-xs text-muted-foreground">No flow activity in this session yet.</p>}
      </div>
    </div>}
  </div>;
}
