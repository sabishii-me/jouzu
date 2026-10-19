import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "./components/ui/button";
import { ChatMarkdown } from "./chat-markdown";
import type { ChatProjection } from "./chat-projection";
import { ToolRenderer } from "./tool-renderers";
import { TurnFooter } from "./turn-footer";

export function ChatConversation({ projection }: { projection: ChatProjection }) {
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [projection]);
  return <section aria-label="Conversation" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" onScroll={event => { const view = event.currentTarget; following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; setShowLatest(!following.current); }}>
      {!projection.messages.length && <div className="mx-auto max-w-xl py-16 text-center"><h2 className="text-xl font-semibold">What would you like to work on?</h2><p className="mt-3 text-sm text-muted-foreground">Ask Jouzu to explore your workspace, explain code, or make a change.</p></div>}
      <div className="mx-auto max-w-3xl space-y-6">{projection.messages.map((message, index) => <article key={index} aria-label={`${message.role} message`} className={message.role === "user" ? "ml-6 rounded-xl border border-border bg-muted/50 px-4 py-2" : "min-w-0"}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "assistant" ? "Jouzu" : message.role === "user" ? "You" : message.role}</div>
        {message.content.map((block, position) => block.type === "text" ? <ChatMarkdown key={position} text={block.text ?? ""} /> : block.type === "thinking" ? <details key={position} className="my-2 border-l-2 border-border pl-3 text-muted-foreground"><summary className="cursor-pointer text-xs">Thinking</summary><ChatMarkdown text={block.thinking ?? ""} /></details> : block.type === "toolCall" ? projection.tools[block.id ?? ""] ? <ToolRenderer key={position} tool={projection.tools[block.id!]} /> : <p key={position} className="text-xs text-muted-foreground">{block.name ?? "Tool call"}</p> : block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType ?? "") ? <img key={position} className="my-2 max-h-80 rounded-lg" src={`data:${block.mimeType};base64,${block.data}`} alt="Conversation attachment" /> : <p key={position} className="text-xs text-muted-foreground">Unsupported content: {block.type}</p>)}
        {message.errorMessage && <p role="alert" className="select-text text-sm text-destructive">{message.errorMessage}</p>}
        {message.role === "assistant" && !message.content.some(block => block.type === "toolCall") && message.stopReason !== "toolUse" && <TurnFooter message={message} startedAt={[...projection.messages.slice(0, index)].reverse().find(item => item.role === "user")?.timestamp} />}
      </article>)}</div>
    </div>
    {showLatest && <Button variant="outline" className="absolute bottom-4 right-6 shadow" onClick={() => { following.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setShowLatest(false); }}><ArrowDown />Latest</Button>}
  </section>;
}
