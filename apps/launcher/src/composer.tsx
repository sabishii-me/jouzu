import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ChevronDown, Cpu, Download, ImagePlus, Minimize2, Plus, Send, Square, X } from "lucide-react";
import { IMAGE_ACCEPT, MAX_IMAGES, type ImageAttachment } from "./chat-attachments";
import type { ChatModel } from "./chat-connection";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

function providerLabel(provider: string) {
  if (!provider.startsWith("catalog:")) return provider;
  const id = provider.split(":")[2] ?? provider;
  return id.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function ModelMenu({ open, onOpenChange, models, model, onSelect, thinkingLevel, thinkingLevels, onThinking, onOpen }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: readonly ChatModel[];
  model?: string;
  onSelect: (provider: string, id: string) => void;
  thinkingLevel?: string;
  thinkingLevels: readonly string[];
  onThinking: (level: string) => void;
  onOpen?: () => void;
}) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open, onOpenChange]);
  const visible = models.filter(item => `${item.provider} ${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
  const providers = [...new Set(visible.map(item => item.provider))];
  return <div ref={root} className="relative">
    <Button type="button" variant="ghost" className="h-8 gap-1 px-2 text-xs" aria-label="Model" aria-expanded={open} onClick={() => { const next = !open; onOpenChange(next); if (next) { setQuery(""); onOpen?.(); } }}>
      <Cpu className="size-4 shrink-0" aria-hidden="true" />
      <span className="max-w-40 truncate">{model ?? "Select model"}</span>
      <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
    </Button>
    {open && <div role="menu" aria-label="Model selection" className="absolute bottom-full right-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 shadow-xl">
      <Input autoFocus aria-label="Search models" placeholder="Search models" value={query} onChange={event => setQuery(event.target.value)} className="mb-2" />
      <div className="max-h-72 overflow-y-auto">
        {!models.length && <p className="px-2 py-3 text-sm text-muted-foreground">No models available. Configure a provider in Settings.</p>}
        {!!models.length && !visible.length && <p className="px-2 py-3 text-sm text-muted-foreground">No matching models</p>}
        {providers.map(provider => <section key={provider} className="mb-2">
          <h3 className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{providerLabel(provider)}</h3>
          {visible.filter(item => item.provider === provider).map(item => <button key={`${item.provider}/${item.id}`} type="button" role="menuitemradio" aria-checked={item.name === model} onClick={() => { onSelect(item.provider, item.id); onOpenChange(false); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent">
            <span className="truncate">{item.name}</span>
            {item.name === model && <span className="text-xs text-primary">Current</span>}
          </button>)}
        </section>)}
      </div>
      {thinkingLevels.length > 1 && <div className="mt-2 border-t border-border pt-2">
        <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Thinking</h3>
        <div className="flex flex-wrap gap-1 px-1">{thinkingLevels.map(level => <Button key={level} type="button" variant={level === thinkingLevel ? "outline" : "ghost"} className="h-7 px-2 text-xs" onClick={() => onThinking(level)}>{level}</Button>)}</div>
      </div>}
    </div>}
  </div>;
}

function AddMenu({ open, onOpenChange, onAddImage, onCompact, onModel, onExport, compactDisabled, exportDisabled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddImage?: () => void;
  onCompact?: () => void;
  onModel: () => void;
  onExport?: () => void;
  compactDisabled: boolean;
  exportDisabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onOpenChange(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open, onOpenChange]);
  const item = "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-45";
  return <div ref={root} className="relative">
    <Button type="button" variant="ghost" className="size-8 p-0" aria-label="Add files or run commands" aria-haspopup="menu" aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <Plus className="size-4" />
    </Button>
    {open && <div role="menu" aria-label="Add files or run commands" className="absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover p-2 shadow-xl">
      <h3 className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">Add</h3>
      <button type="button" role="menuitem" className={item} disabled={!onAddImage} onClick={() => { onOpenChange(false); onAddImage?.(); }}>
        <ImagePlus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm">Image</span><span className="block text-xs text-muted-foreground">Attach up to four images</span></span>
      </button>
      <h3 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Commands</h3>
      <button type="button" role="menuitem" className={item} disabled={compactDisabled || !onCompact} onClick={() => { onOpenChange(false); onCompact?.(); }}>
        <Minimize2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm">Compact</span><span className="block text-xs text-muted-foreground">Summarize earlier conversation</span></span>
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => { onOpenChange(false); onModel(); }}>
        <Cpu className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm">Model</span><span className="block text-xs text-muted-foreground">Choose this session's model</span></span>
      </button>
      <button type="button" role="menuitem" className={item} disabled={exportDisabled || !onExport} onClick={() => { onOpenChange(false); onExport?.(); }}>
        <Download className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0"><span className="block text-sm">Export conversation</span><span className="block text-xs text-muted-foreground">Save the transcript as an HTML file</span></span>
      </button>
    </div>}
  </div>;
}

export interface ComposerProps {
  hero?: boolean;
  connected: boolean;
  pending: boolean;
  running: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onCompact?: () => void;
  onExport?: () => void;
  error?: string | null;
  compatibility?: readonly string[];
  attachments?: readonly ImageAttachment[];
  onAddImages?: (files: File[]) => void;
  onRemoveImage?: (id: string) => void;
  readingImages?: boolean;
  attachmentError?: string | null;
  models: readonly ChatModel[];
  model?: string;
  onSelectModel: (provider: string, id: string) => void;
  onRefreshModels?: () => void;
  thinkingLevel?: string;
  thinkingLevels: readonly string[];
  onThinkingLevel: (level: string) => void;
}
export function Composer({ hero = false, connected, pending, running, draft, onDraft, onSend, onStop, onCompact, onExport, error, compatibility = [], attachments = [], onAddImages, onRemoveImage, readingImages = false, attachmentError, models, model, onSelectModel, onRefreshModels, thinkingLevel, thinkingLevels, onThinkingLevel }: ComposerProps) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const submit = () => { if (connected && !pending && !readingImages && draft.trim()) onSend(); };
  const compactDisabled = !connected || pending || running;
  const exportDisabled = !connected || pending;
  const pasteFiles = (event: ClipboardEvent<HTMLElement>) => {
    if (!onAddImages) return;
    const selected = Array.from(event.clipboardData.files);
    const fallback = Array.from(event.clipboardData.items)
      .filter(item => item.kind === "file")
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    const files = selected.length ? selected : fallback;
    if (!files.length) return;
    event.preventDefault();
    onAddImages(files);
  };
  return <div className={hero ? "px-0 pb-0 pt-0" : "px-3 pb-3 pt-2 sm:px-6"}>
    {error && <p role="alert" className="mx-auto mb-2 max-w-3xl select-text text-sm text-destructive">{error}</p>}
    {!!compatibility.length && <p role="status" className="mx-auto mb-2 max-w-3xl text-xs text-muted-foreground">Some runtime events have no display: {compatibility.join(", ")}</p>}
    <form aria-label="Message composer" onPaste={pasteFiles} className={`mx-auto flex max-w-3xl flex-col gap-2 border border-border bg-card shadow-[0_8px_30px_rgba(0,0,0,0.12)] focus-within:ring-1 focus-within:ring-ring ${hero ? "rounded-3xl p-3" : "rounded-2xl p-2.5"}`} onSubmit={event => { event.preventDefault(); submit(); }}>
      {attachmentError && <p role="alert" className="px-1 text-sm text-destructive">{attachmentError}</p>}
      {!!attachments.length && <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-1">{attachments.map(item => <li key={item.id} className="relative max-w-36 rounded-lg border border-border p-1.5"><img src={`data:${item.image.mimeType};base64,${item.image.data}`} alt={`Preview of ${item.name}`} className="h-16 w-24 object-contain" /><div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate text-xs" title={item.name}>{item.name}</p><Button type="button" variant="ghost" className="size-6 p-0" aria-label={`Remove ${item.name}`} onClick={() => onRemoveImage?.(item.id)}><X className="size-3" /></Button></div></li>)}</ul>}
      <textarea aria-label="Message Jouzu" placeholder="Message Jouzu…" value={draft} onChange={event => onDraft(event.target.value)} rows={3} className="max-h-60 min-h-16 w-full resize-y bg-transparent px-1 text-sm outline-none" onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {onAddImages && <><input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" aria-label="Choose images" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; onAddImages(files); }} /></>}
          <AddMenu open={addOpen} onOpenChange={setAddOpen} onAddImage={onAddImages && !readingImages && attachments.length < MAX_IMAGES ? () => imageInput.current?.click() : undefined} onCompact={onCompact} onModel={() => setModelOpen(true)} onExport={onExport} compactDisabled={compactDisabled} exportDisabled={exportDisabled || readingImages} />
          {readingImages && <span role="status" className="text-xs text-muted-foreground">Reading images…</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">{!connected ? "Connecting…" : pending ? "Sending…" : running ? "Enter to steer" : "Enter to send · Shift+Enter for newline"}</span>
          <ModelMenu open={modelOpen} onOpenChange={setModelOpen} models={models} model={model} onSelect={onSelectModel} onOpen={onRefreshModels} thinkingLevel={thinkingLevel} thinkingLevels={thinkingLevels} onThinking={onThinkingLevel} />
          {running && <Button type="button" variant="outline" className="h-8 px-2" onClick={onStop}><Square className="size-3.5" />Stop</Button>}
          <Button type="submit" className="h-8 px-2" disabled={!connected || pending || readingImages || !draft.trim()}><Send className="size-3.5" />{running ? "Steer" : "Send"}</Button>
        </div>
      </div>
    </form>
  </div>;
}
