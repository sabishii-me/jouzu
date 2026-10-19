import { useEffect, useState } from "react";
import { Database, Gauge, Timer } from "lucide-react";
import type { SessionStats } from "./chat-connection";

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}
function duration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
/** Session-wide counters, aligned with the reference composer footer. */
export function SessionStatsBar({ stats, startedAt }: { stats?: SessionStats; startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stats) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stats]);
  if (!stats) return null;
  const tokens = stats.tokens ?? {};
  const total = Number.isFinite(tokens.total) ? tokens.total! : (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
  const prompt = (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
  const cached = prompt > 0 ? Math.round((tokens.cacheRead ?? 0) / prompt * 100) : null;
  const turns = stats.userMessages ?? 0;
  const steps = stats.toolCalls ?? 0;
  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  const rate = elapsed > 0 && (tokens.output ?? 0) > 0 ? Math.round((tokens.output ?? 0) / elapsed) : null;  const percent = stats.contextUsage?.percent;
  if (!total && !turns && !steps && percent == null) return null;
  return <div aria-label="Session usage" className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-1 px-2 py-1.5 text-[11px] text-muted-foreground">
    <span className="inline-flex items-center gap-1.5"><Gauge className="size-3.5" aria-hidden="true" />{turns} turns · {steps} steps{rate !== null && rate > 0 ? ` · ${compact(rate)} tok/s` : ""}</span>
    {!!total && <span className="inline-flex items-center gap-1.5"><Database className="size-3.5" aria-hidden="true" />{compact(total)} tok{cached !== null ? ` · ${cached}% cached` : ""}</span>}
    {percent != null && <span className="inline-flex items-center gap-1.5"><Timer className="size-3.5" aria-hidden="true" />{Math.round(percent)}%</span>}
    {elapsed > 0 && <span className="ml-auto tabular-nums">{duration(elapsed)}</span>}
  </div>;
}
