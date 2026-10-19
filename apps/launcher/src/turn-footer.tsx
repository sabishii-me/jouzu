import { useState } from "react";
import { Check, Copy, Database, Share2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { StatCard, StatPopover, StatRow } from "./components/stat-popover";
import type { ChatMessage } from "./chat-projection";

function compact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}
function exact(value: number) {
  return value.toLocaleString("en-US");
}
function percentage(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
function providerLabel(provider?: string) {
  if (!provider) return "—";
  if (!provider.startsWith("catalog:")) return provider;
  const parts = provider.split(":");
  return parts[2] || parts[1] || provider;
}
function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function messageText(message: ChatMessage) {
  return message.content.filter(block => block.type === "text").map(block => block.text ?? "").join("\n").trim();
}
/** End-of-turn actions: copy/share and the turn's own usage. Feedback is intentionally omitted. */
export function TurnFooter({ message, usage, startedAt }: { message: ChatMessage; usage?: ChatMessage["usage"]; startedAt?: number }) {
  const [copied, setCopied] = useState(false);
  const text = messageText(message);
  const turnUsage = usage ?? message.usage;
  const total = turnUsage ? (turnUsage.total ?? turnUsage.totalTokens ?? (turnUsage.input ?? 0) + (turnUsage.output ?? 0) + (turnUsage.cacheRead ?? 0) + (turnUsage.cacheWrite ?? 0)) : 0;
  const prompt = turnUsage ? (turnUsage.input ?? 0) + (turnUsage.cacheRead ?? 0) + (turnUsage.cacheWrite ?? 0) : 0;
  const cacheHit = prompt > 0 ? (turnUsage!.cacheRead ?? 0) / prompt * 100 : null;
  const elapsed = message.endedAt && startedAt ? message.endedAt - startedAt : undefined;
  if (!text) return null;
  const copy = async (share: boolean) => {
    try {
      if (share && typeof navigator.share === "function") await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* Clipboard or share unavailable; leave the transcript unchanged. */ }
  };
  return <div role="group" aria-label="Turn actions" className="mt-2 flex items-center gap-1 text-muted-foreground">
    <Button type="button" variant="ghost" className="size-7 p-0" aria-label="Copy response" title="Copy response" onClick={() => void copy(false)}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</Button>
    <Button type="button" variant="ghost" className="size-7 p-0" aria-label="Share response" title="Share response" onClick={() => void copy(true)}><Share2 className="size-3.5" /></Button>
    {!!total && <span className="ml-2"><StatPopover label={<><Database className="size-3.5" aria-hidden="true" />Usage {compact(total)} tok{elapsed !== undefined && elapsed >= 0 ? ` · ${duration(elapsed)}` : ""}</>}>
      <StatCard title="Turn usage" value={`${exact(total)} tok`}>
        <StatRow label="Provider / model" value={`${providerLabel(message.provider)} / ${message.model ?? "—"}`} />
        {cacheHit !== null && <StatRow label="Cache hit" value={percentage(cacheHit)} />}
        <StatRow label="Uncached input" value={`${exact(turnUsage?.input ?? 0)} tok`} />
        <StatRow label="Cache read" value={`${exact(turnUsage?.cacheRead ?? 0)} tok`} />
        <StatRow label="Cache write" value={`${exact(turnUsage?.cacheWrite ?? 0)} tok`} />
        <StatRow label="Output" value={`${exact(turnUsage?.output ?? 0)} tok`} />
      </StatCard>
    </StatPopover></span>}
    {!total && elapsed !== undefined && elapsed >= 0 && <span className="ml-2 text-[11px] tabular-nums">{duration(elapsed)}</span>}
  </div>;
}
