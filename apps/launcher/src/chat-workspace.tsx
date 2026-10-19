import { useEffect, useRef, useState } from "react";
import { FolderOpen, PanelLeft, Plus, Settings, SquareTerminal, X } from "lucide-react";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { Button } from "./components/ui/button";
import { ChatConversation } from "./chat-conversation";
import { Composer } from "./composer";
import { ChatConnection, type ChatSnapshot } from "./chat-connection";
import { readImageAttachment, removeSubmittedImages, validateImageSelection, type ImageAttachment } from "./chat-attachments";
import { emptyProjection } from "./chat-projection";
import { beginDialogResponse, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog, type DialogAnswer, type DialogQueue } from "./dialog-queue";

interface WorkspaceItem { id: string; path: string }
export interface ChatWorkspaceProps {
  path: string;
  revision?: number;
  onBusyChange?: (busy: boolean) => void;
  catalogRefreshing?: boolean;
  canRefreshModels?: boolean;
  onModelsMissing?: () => void;
  workspaces: readonly WorkspaceItem[];
  onSelect: (path: string) => void;
  onAddFolder: () => void;
  onRemove: (id: string) => void;
  onTerminal: (path: string) => void;
  onSettings: () => void;
}
export function ChatWorkspace({ path, revision = 0, onBusyChange, catalogRefreshing = false, canRefreshModels = false, onModelsMissing, workspaces, onSelect, onAddFolder, onRemove, onTerminal, onSettings }: ChatWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const attachmentRef = useRef(attachments);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const readingRef = useRef(false);
  const [choosingSession, setChoosingSession] = useState(false);
  const sessionChange = useRef(false);
  const [dialogs, setDialogs] = useState(emptyDialogQueue);
  const queue = useRef(dialogs);
  const dialog = dialogs.items[0] ?? null;
  const [answer, setAnswer] = useState("");
  const [notification, setNotification] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const connection = useRef<ChatConnection | null>(null);
  function updateDialogs(next: DialogQueue) { queue.current = next; setDialogs(next); }
  function updateAttachments(next: ImageAttachment[]) { attachmentRef.current = next; setAttachments(next); }
  useEffect(() => {
    updateDialogs(emptyDialogQueue());
    setSnapshot({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
    setDraft(""); updateAttachments([]); setAttachmentError(null);
    const client = new ChatConnection(state => {
      setSnapshot(state);
      if (!state.connected && state.error) updateDialogs(emptyDialogQueue());
    }, request => {
      if (["select", "confirm", "input", "editor"].includes(String(request.method))) {
        const result = enqueueDialog(queue.current, request, Date.now());
        updateDialogs(result.queue);
        if (result.status === "full" && typeof request.id === "string") {
          setNotification("Too many extension requests to display. The additional request was cancelled.");
          void client.reply(request.id, { cancelled: true }).catch(error => {
            if (connection.current === client) setNotification(`The additional request could not be cancelled. ${String(error)}`);
          });
        }
        else if (result.status === "invalid") setNotification("An invalid extension request could not be displayed.");
      }
      else if (request.method === "notify") setNotification(String(request.message ?? ""));
      else if (request.method === "set_editor_text") setDraft(String(request.text ?? ""));
    });
    connection.current = client;
    void client.start(path);
    return () => { connection.current = null; void client.close().catch(() => {}); };
  }, [path, revision]);
  useEffect(() => { onBusyChange?.(snapshot.pending || snapshot.projection.running || draft.trim().length > 0); }, [snapshot.pending, snapshot.projection.running, draft, onBusyChange]);
  useEffect(() => {
    if (snapshot.connected && snapshot.modelsLoaded === true && (snapshot.models?.length ?? 0) === 0 && canRefreshModels) onModelsMissing?.();
  }, [snapshot.connected, snapshot.models, snapshot.modelsLoaded, canRefreshModels, onModelsMissing]);
  useEffect(() => { setAnswer(dialog?.prefill ?? ""); }, [dialog?.id, dialog?.prefill]);
  useEffect(() => {
    const deadline = nextDialogDeadline(dialogs);
    if (deadline === null) return;
    const timer = setTimeout(() => updateDialogs(expireDialogs(queue.current, Date.now())), Math.min(2147483647, Math.max(0, deadline - Date.now())));
    return () => clearTimeout(timer);
  }, [dialogs]);
  async function reply(fields: DialogAnswer) {
    const client = connection.current;
    if (!dialog || !client || !snapshot.transportReady) return;
    const id = dialog.id;
    const claimed = beginDialogResponse(queue.current, id, fields, Date.now());
    updateDialogs(claimed.queue);
    if (!claimed.response) return;
    try { await client.reply(id, claimed.response); }
    catch (error) { if (connection.current === client) setNotification(`The response could not be confirmed. ${String(error)}`); }
    finally { if (connection.current === client) updateDialogs(removeDialog(queue.current, id)); }
  }
  async function addImages(files: File[]) {
    if (readingRef.current || !files.length) return;
    readingRef.current = true; setReadingImages(true); setAttachmentError(null);
    try {
      validateImageSelection(attachmentRef.current, files);
      const added = await Promise.all(files.map(readImageAttachment));
      validateImageSelection(attachmentRef.current, added.map(item => ({ size: item.size, type: item.image.mimeType })));
      updateAttachments([...attachmentRef.current, ...added]);
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
    finally { readingRef.current = false; setReadingImages(false); }
  }
  async function send() {
    const client = connection.current;
    if (!client || readingRef.current) return;
    const value = draft;
    const submitted = attachmentRef.current;
    const running = snapshot.projection.running;
    try {
      await client.sendOrSteer(value, submitted.map(item => item.image), running);
      if (connection.current !== client) return;
      setDraft(current => current === value ? "" : current);
      updateAttachments(removeSubmittedImages(attachmentRef.current, submitted));
    } catch { /* Keep the draft and images available after rejection. */ }
  }
  const working = choosingSession || (snapshot.connected && (snapshot.pending || snapshot.projection.running));
  const name = path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
  async function compactConversation() {
    const client = connection.current;
    if (!client) return;
    try {
      await client.compact();
      if (connection.current === client) setNotification("Earlier conversation compacted.");
    } catch (error) { if (connection.current === client) setNotification(String(error).replace(/^Error:\s*/u, "")); }
  }
  async function exportConversation() {
    const client = connection.current;
    if (!client || !snapshot.connected) return;
    const selected = await save({ title: "Export conversation", defaultPath: `${name}-conversation.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (typeof selected !== "string" || connection.current !== client) return;
    try {
      await client.exportHtml(selected);
      if (connection.current === client) setNotification(`Conversation exported to ${selected}`);
    } catch (error) { if (connection.current === client) setNotification(String(error)); }
  }
  async function changeSession(resume: boolean) {
    const client = connection.current;
    if (!client || !snapshot.connected || working || sessionChange.current || queue.current.items.length) return;
    sessionChange.current = true;
    setChoosingSession(true);
    try {
      if (resume) {
        const selected = await open({ title: "Resume conversation", multiple: false, directory: false, filters: [{ name: "Conversation history", extensions: ["jsonl"] }] });
        if (typeof selected !== "string" || connection.current !== client) return;
        await client.resumeSession(selected);
      } else await client.newSession();
    } catch (error) { if (connection.current === client) setNotification(String(error)); }
    finally { sessionChange.current = false; setChoosingSession(false); }
  }
  async function switchWorkspace(next: string) {
    if (next === path) return;
    if (snapshot.projection.running && !await confirm("Stop the current run and switch workspace?", { title: "Switch workspace", kind: "warning" })) return;
    onSelect(next);
  }
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    {sidebar && <aside aria-label="Workspaces" className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[85%] flex-col border-r border-border bg-background shadow-xl md:static md:z-auto md:shadow-none">
      <div className="flex items-center justify-between border-b border-border px-3 py-2"><h2 className="text-sm font-semibold">Workspaces</h2><div className="flex items-center gap-1"><Button variant="ghost" className="size-8 p-0" aria-label="Add folder" title="Add folder" onClick={onAddFolder}><Plus className="size-4" /></Button><Button variant="ghost" className="size-8 p-0" aria-label="Hide workspaces" onClick={() => setSidebar(false)}><X className="size-4" /></Button></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {workspaces.map(workspace => <div key={workspace.id} className={`group mb-1 flex items-center gap-1 rounded-lg ${workspace.path === path ? "bg-accent" : "hover:bg-muted/60"}`}>
          <button type="button" onClick={() => void switchWorkspace(workspace.path)} className="min-w-0 flex-1 px-2 py-1.5 text-left" title={workspace.path}>
            <span className="block truncate text-sm">{workspace.path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? workspace.path}</span>
            <span className="block truncate text-xs text-muted-foreground">{workspace.path}</span>
          </button>
          <Button variant="ghost" className="mr-1 size-7 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${workspace.path}`} title="Remove" onClick={() => onRemove(workspace.id)}><X className="size-3.5" /></Button>
        </div>)}
        {!workspaces.length && <p className="p-3 text-sm text-muted-foreground">No workspaces yet.</p>}
      </div>
      <div className="space-y-1 border-t border-border p-2">
        <Button variant="ghost" className="w-full justify-start" onClick={onAddFolder}><Plus className="size-4" />Add folder</Button>
        <Button variant="ghost" className="w-full justify-start" onClick={() => onTerminal(path)}><SquareTerminal className="size-4" />Open in terminal</Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onSettings}><Settings className="size-4" />Settings</Button>
        <p className="px-2 pt-1 text-xs text-muted-foreground">{catalogRefreshing ? "Refreshing models…" : snapshot.connected ? "Connected" : snapshot.transportReady ? "Starting Jouzu…" : "Connecting…"}</p>
      </div>
    </aside>}
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2 sm:px-3">
        <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={sidebar ? "Hide workspaces" : "Show workspaces"} title="Workspaces" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft className="size-4" /></Button>
        <div className="min-w-0 flex-1 px-1"><h2 className="truncate text-sm font-semibold" title={path}>{name}</h2><p className="truncate text-xs text-muted-foreground" title={path}>{snapshot.model ?? path}</p></div>
        <Button variant="ghost" className="h-8 px-2" disabled={working || !snapshot.connected} onClick={() => void changeSession(false)}><Plus className="size-4" />New chat</Button>
        <Button variant="ghost" className="h-8 px-2" disabled={working || !snapshot.connected} onClick={() => void changeSession(true)}><FolderOpen className="size-4" />Resume</Button>
      </div>
      {notification && <div role="status" className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs"><span className="min-w-0 truncate">{notification}</span><Button variant="ghost" className="h-7 px-2" onClick={() => setNotification("")}>Dismiss</Button></div>}
      {dialog && <section role="dialog" aria-modal="false" aria-label={dialog.title} className="m-3 rounded-xl border border-primary bg-card p-4"><h3 className="font-semibold">{dialog.title}</h3>{dialog.message && <p className="my-2 text-sm">{dialog.message}</p>}{["input", "editor"].includes(dialog.method) && <textarea aria-label="Response" disabled={dialog.responding} className="my-2 w-full rounded border border-border bg-background p-2" value={answer} onChange={event => setAnswer(event.target.value)} />}
        <fieldset disabled={dialog.responding || !snapshot.transportReady} className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void reply({ cancelled: true })}>Cancel</Button>{dialog.method === "confirm" ? <><Button variant="outline" onClick={() => void reply({ confirmed: false })}>No</Button><Button onClick={() => void reply({ confirmed: true })}>Yes</Button></> : dialog.method === "select" ? dialog.options.map(option => <Button key={option} onClick={() => void reply({ value: option })}>{option}</Button>) : <Button onClick={() => void reply({ value: answer })}>Submit</Button>}</fieldset></section>}
      <ChatConversation projection={snapshot.projection} />
      <Composer connected={snapshot.connected} pending={snapshot.pending || choosingSession} running={snapshot.projection.running} draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void connection.current?.abort()} onCompact={() => void compactConversation()} onExport={() => void exportConversation()} error={snapshot.error} compatibility={snapshot.projection.compatibility} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} models={snapshot.models ?? []} model={snapshot.model} onSelectModel={(provider, id) => void connection.current?.selectModel(provider, id)} onRefreshModels={() => void connection.current?.loadModels()} thinkingLevel={snapshot.thinkingLevel} thinkingLevels={snapshot.thinkingLevels ?? []} onThinkingLevel={level => void connection.current?.setThinkingLevel(level)} />
    </section>
  </div>;
}
