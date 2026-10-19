import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type ActivityState = "running" | "done" | "error" | "warning" | "idle";
const dot: Record<ActivityState, string> = {
  running: "bg-primary animate-pulse",
  done: "bg-emerald-500",
  error: "bg-destructive",
  warning: "bg-amber-500",
  idle: "bg-muted-foreground/50",
};
export function StateDot({ state }: { state: ActivityState }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${dot[state]}`} aria-hidden="true" />;
}
export function ActivityRow({ title, summary, state, children, defaultOpen = false }: {
  title: string;
  summary?: string | undefined;
  state: ActivityState;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = children !== undefined;
  return <div className="my-1.5 rounded-lg border border-border bg-muted/20">
    <button type="button" onClick={() => { if (expandable) setOpen(value => !value); }} aria-expanded={expandable ? open : undefined} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40">
      <StateDot state={state} />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium">{title}</span>{summary && <span className="block truncate text-muted-foreground">{summary}</span>}</span>
      {expandable && (open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />)}
    </button>
    {open && expandable && <div className="border-t border-border px-3 py-2 text-xs">{children}</div>}
  </div>;
}
