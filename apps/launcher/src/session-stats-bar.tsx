import { CircleGauge, Database, Gauge } from "lucide-react";
import type { SessionStats } from "./chat-connection";

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}
/** Whole-session counters from the runtime. Deliberately no wall-clock timer:
 * elapsed time belongs to a turn footer, not the session totals. */
export function SessionStatsBar({ stats }: { stats?: SessionStats }) {
  if (!stats) return null;
  const tokens = stats.tokens ?? {};
  const total = Number.isFinite(tokens.total) ? tokens.total! : (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
  const prompt = (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
  const cached = prompt > 0 ? Math.round((tokens.cacheRead ?? 0) / prompt * 100) : null;
  const turns = stats.userMessages ?? 0;
  const steps = stats.assistantMessages ?? 0;
  const percent = stats.contextUsage?.percent;
  if (!total && !steps && percent == null) return null;
  return <div aria-label="Session usage" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-1 px-2 py-1.5 text-[11px] text-muted-foreground">
    {steps > 0 && <span className="inline-flex items-center gap-1.5"><Gauge className="size-3.5" aria-hidden="true" />{turns} turns · {steps} steps</span>}
    {!!total && <span className="inline-flex items-center gap-1.5"><Database className="size-3.5" aria-hidden="true" />{compact(total)} tok{cached !== null ? ` · ${cached}% cached` : ""}</span>}
    {percent != null && <span className="inline-flex items-center gap-1.5"><CircleGauge className="size-3.5" aria-hidden="true" />{Math.round(percent)}%</span>}
  </div>;
}
