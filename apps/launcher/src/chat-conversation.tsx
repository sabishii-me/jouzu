import { useEffect, useRef, useState } from "react";
import { ArrowDown, Brain } from "lucide-react";
import { Button } from "./components/ui/button";
import { JouzuLoader } from "./components/ui/jouzu-loader";
import { ChatMarkdown } from "./chat-markdown";
import { FlowPanel } from "./tool-renderers/flow-panel";
import type { FlowState } from "./tool-renderers/flow-state";
import type { FlowReportRecord } from "./chat-projection";
import type { ChatMessage, ChatProjection } from "./chat-projection";
import { ToolRenderer } from "./tool-renderers";
import { TurnFooter } from "./turn-footer";

function turnUsageAt(messages: ChatMessage[], end: number) {
  let start = end;
  while (start >= 0 && messages[start].role !== "user") start--;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (let index = Math.max(0, start); index <= end; index++) {
    const item = messages[index].usage;
    if (!item) continue;
    usage.input += item.input ?? 0;
    usage.output += item.output ?? 0;
    usage.cacheRead += item.cacheRead ?? 0;
    usage.cacheWrite += item.cacheWrite ?? 0;
    usage.total += item.total ?? item.totalTokens ?? (item.input ?? 0) + (item.output ?? 0) + (item.cacheRead ?? 0) + (item.cacheWrite ?? 0);
  }
  return { usage, startedAt: messages[start]?.timestamp };
}
function FinalTurnFooter({ messages, index, message }: { messages: ChatMessage[]; index: number; message: ChatMessage }) {
  const metrics = turnUsageAt(messages, index);
  return <TurnFooter message={message} usage={metrics.usage} startedAt={metrics.startedAt} />;
}
function ThinkingRow({ thinking, streaming }: { thinking: string; streaming: boolean }) {
  const preview = thinking.split(/\r?\n/).find(line => line.trim())?.replace(/\s+/g, " ").trim() ?? "";
  return <details className="my-1.5 rounded-lg border border-border bg-muted/20">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
      <Brain className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium text-foreground">Thinking</span>
      <span className="shrink-0" aria-hidden="true">·</span>
      <span className="min-w-0 flex-1 truncate">{preview || "…"}</span>
      {streaming && <JouzuLoader className="jouzu-loader-sm shrink-0" />}
    </summary>
    <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground"><ChatMarkdown text={thinking} /></div>
  </details>;
}

export function ChatConversation({ projection, pending = false, startedAt, opening = false, flow, widgets, statuses, reports }: { projection: ChatProjection; pending?: boolean; startedAt?: number; opening?: boolean; flow: FlowState; widgets: Record<string, string[]>; statuses: Record<string, string>; reports?: readonly FlowReportRecord[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const working = projection.running || pending || opening;
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [projection]);
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [working]);
  const elapsed = working && (projection.turnStartedAt ?? startedAt) ? Math.max(0, Math.floor((now - (projection.turnStartedAt ?? startedAt)!) / 1000)) : null;
  const hasVisibleHistory = projection.messages.some(message => message.role === "user" || message.role === "assistant");
  const showWorking = working && !(opening && hasVisibleHistory);
  const visible = projection.messages.flatMap((message, index) => message.role === "user" || message.role === "assistant" ? [{ message, index }] : []);
  const lastAssistantIndex = visible.filter(item => item.message.role === "assistant").at(-1)?.index;
  return <section aria-label="Conversation" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" onScroll={event => { const view = event.currentTarget; following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; setShowLatest(!following.current); }}>
      {!visible.length && <div className="mx-auto max-w-xl py-16 text-center"><h2 className="text-xl font-semibold">What would you like to work on?</h2><p className="mt-3 text-sm text-muted-foreground">Ask Jouzu to explore your workspace, explain code, or make a change.</p></div>}
      <div className="mx-auto max-w-3xl space-y-6">{visible.map(({ message, index }) => <article key={index} aria-label={`${message.role} message`} className={message.role === "user" ? "ml-6 rounded-xl border border-border bg-muted/50 px-4 py-2" : "min-w-0"}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "assistant" ? "Jouzu" : "You"}</div>
        {message.content.map((block, position) => block.type === "text" ? <ChatMarkdown key={position} text={block.text ?? ""} /> : block.type === "thinking" ? <ThinkingRow key={position} thinking={block.thinking ?? ""} streaming={projection.running && index === lastAssistantIndex} /> : block.type === "toolCall" ? projection.tools[block.id ?? ""] ? <ToolRenderer key={position} tool={projection.tools[block.id!]} /> : <p key={position} className="text-xs text-muted-foreground">{block.name ?? "Tool call"}</p> : block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType ?? "") ? <img key={position} className="my-2 max-h-80 rounded-lg" src={`data:${block.mimeType};base64,${block.data}`} alt="Conversation attachment" /> : <p key={position} className="text-xs text-muted-foreground">Unsupported content: {block.type}</p>)}
        {message.errorMessage && <p role="alert" className="select-text text-sm text-destructive">{message.errorMessage}</p>}
        {message.role === "assistant" && !message.content.some(block => block.type === "toolCall") && message.stopReason !== "toolUse" && <FinalTurnFooter messages={projection.messages} index={index} message={message} />}
      </article>)}
        {showWorking && <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground"><JouzuLoader className="jouzu-loader-sm" /><span>{opening ? "Opening session…" : "Working…"}</span>{!opening && elapsed !== null && <span className="tabular-nums">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</span>}</div>}
      </div>
      {showLatest && <div className="pointer-events-none sticky bottom-0 flex justify-end pt-3"><Button variant="outline" className="pointer-events-auto shadow" onClick={() => { following.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setShowLatest(false); }}><ArrowDown />Latest</Button></div>}
    </div>
    <FlowPanel flow={flow} widgets={widgets} statuses={statuses} reports={reports} />
  </section>;
}
