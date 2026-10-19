import { useEffect, useRef, useState } from "react";
import { ArrowDown, ImagePlus, Send, Square, X } from "lucide-react";
import { IMAGE_ACCEPT, MAX_IMAGES, type ImageAttachment } from "./chat-attachments";
import { Button } from "./components/ui/button";
import { ChatMarkdown } from "./chat-markdown";
import { object, type ChatProjection, type ToolView } from "./chat-projection";

function ToolCard({ tool }: { tool: ToolView }) {
  const result = tool.result;
  const blocks = object(result) && Array.isArray(result.content) ? result.content : [];
  return <details className="my-2 rounded-lg border border-border bg-muted/30"><summary className="cursor-pointer px-3 py-2 text-xs"><span className="font-medium">{tool.name}</span><span className={`ml-3 ${tool.phase === "error" ? "text-destructive" : "text-muted-foreground"}`}>{tool.phase}</span></summary><div className="space-y-2 border-t border-border p-3"><pre className="select-text overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(tool.args, null, 2)}</pre>{blocks.map((block, index) => object(block) && block.type === "text" && typeof block.text === "string" ? <pre key={index} className="max-h-96 select-text overflow-auto whitespace-pre-wrap text-xs">{block.text}</pre> : <p key={index} className="text-xs text-muted-foreground">Non-text tool output</p>)}</div></details>;
}
export interface ConversationProps {
  projection: ChatProjection;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  connected: boolean;
  pending: boolean;
  error?: string | null;
  attachments?: readonly ImageAttachment[];
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
  readingImages?: boolean;
  attachmentError?: string | null;
}
export function ChatConversation({ projection, draft, onDraft, onSend, onStop, connected, pending, error, attachments = [], onAddImages, onRemoveImage, readingImages = false, attachmentError }: ConversationProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  useEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [projection]);
  const busy = projection.running || pending;
  return <section aria-label="Conversation" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8" onScroll={event => { const view = event.currentTarget; following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; setShowLatest(!following.current); }}>
      {!projection.messages.length && <div className="mx-auto max-w-xl py-16 text-center"><h2 className="text-xl font-semibold">What would you like to work on?</h2><p className="mt-3 text-sm text-muted-foreground">Ask Jouzu to explore your workspace, explain code, or make a change.</p></div>}
      <div className="mx-auto max-w-3xl space-y-6">{projection.messages.map((message, index) => <article key={index} aria-label={`${message.role} message`} className={message.role === "user" ? "ml-6 rounded-xl border border-border bg-muted/50 px-4 py-2" : "min-w-0"}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">{message.role === "assistant" ? "Jouzu" : message.role === "user" ? "You" : message.role}</div>
        {message.content.map((block, position) => block.type === "text" ? <ChatMarkdown key={position} text={block.text ?? ""} /> : block.type === "thinking" ? <details key={position} className="my-2 border-l-2 border-border pl-3 text-muted-foreground"><summary className="cursor-pointer text-xs">Thinking</summary><ChatMarkdown text={block.thinking ?? ""} /></details> : block.type === "toolCall" ? projection.tools[block.id ?? ""] ? <ToolCard key={position} tool={projection.tools[block.id!]} /> : <p key={position} className="text-xs text-muted-foreground">{block.name ?? "Tool call"}</p> : block.type === "image" && typeof block.data === "string" && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(block.mimeType ?? "") ? <img key={position} className="my-2 max-h-80 rounded-lg" src={`data:${block.mimeType};base64,${block.data}`} alt="Conversation attachment" /> : <p key={position} className="text-xs text-muted-foreground">Unsupported content: {block.type}</p>)}
        {message.errorMessage && <p role="alert" className="select-text text-sm text-destructive">{message.errorMessage}</p>}
      </article>)}</div>
    </div>
    {showLatest && <Button variant="outline" className="absolute bottom-40 right-6 shadow" onClick={() => { following.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setShowLatest(false); }}><ArrowDown />Latest</Button>}
    <div className="border-t border-border px-4 py-3 sm:px-8">
      {error && <p role="alert" className="mb-2 select-text text-sm text-destructive">{error}</p>}
      {!!projection.compatibility.length && <p role="status" className="mb-2 text-xs text-muted-foreground">Some runtime events have no display: {projection.compatibility.join(", ")}</p>}
      <form className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-3 focus-within:ring-1 focus-within:ring-ring" onSubmit={event => { event.preventDefault(); if (connected && !busy && !readingImages && draft.trim()) onSend(); }}>
        {attachmentError && <p role="alert" className="mb-2 text-sm text-destructive">{attachmentError}</p>}
        {!!attachments.length && <ul aria-label="Attached images" className="mb-3 flex flex-wrap gap-3">{attachments.map(item => <li key={item.id} className="relative max-w-36 rounded-lg border border-border p-2"><img src={`data:${item.image.mimeType};base64,${item.image.data}`} alt={`Preview of ${item.name}`} className="h-20 w-28 object-contain" /><p className="truncate text-xs" title={item.name}>{item.name}</p><Button type="button" variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => onRemoveImage?.(item.id)}><X className="size-4" />Remove</Button></li>)}</ul>}
        {onAddImages && <div className="mb-2 flex flex-wrap items-center gap-2"><input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" aria-label="Choose images" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; onAddImages(files); }} /><Button type="button" variant="outline" disabled={readingImages || attachments.length >= MAX_IMAGES} onClick={() => imageInput.current?.click()}><ImagePlus className="size-4" />Attach images</Button><span role="status" className="text-xs text-muted-foreground">{readingImages ? "Reading images…" : "PNG, JPEG, WebP, GIF · Up to 4 images, 1 MiB total · Include a message"}</span></div>}
        <textarea aria-label="Message Jouzu" placeholder="Message Jouzu…" value={draft} onChange={event => onDraft(event.target.value)} rows={3} className="max-h-60 min-h-20 w-full resize-y bg-transparent text-sm outline-none" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (connected && !busy && !readingImages && draft.trim()) onSend(); } }} />
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{!connected ? "Connecting…" : busy ? "Jouzu is working" : "Enter to send · Shift+Enter for newline"}</span>{busy ? <Button type="button" variant="outline" disabled={!connected} onClick={onStop}><Square className="size-4" />Stop</Button> : <Button type="submit" disabled={!connected || readingImages || !draft.trim()}><Send className="size-4" />Send</Button>}</div>
      </form>
    </div>
  </section>;
}
