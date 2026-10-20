import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronRight, FolderOpen, FolderPlus, MessageSquare, PanelLeft, Plus, Search, Settings, Sparkles, SquareTerminal, X } from "lucide-react";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { ChatConversation } from "./chat-conversation";
import { Composer } from "./composer";
import { ChatConnection, type ChatSnapshot } from "./chat-connection";
import { readImageAttachment, removeSubmittedImages, validateImageSelection, type ImageAttachment } from "./chat-attachments";
import { emptyProjection, type FlowReportRecord } from "./chat-projection";
import { beginDialogResponse, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog, type DialogAnswer, type DialogQueue } from "./dialog-queue";
import { deriveFlow, FlowMenu } from "./tool-renderers";
import { SessionStatsBar } from "./session-stats-bar";
import type { SessionTiming } from "./chat-connection";

interface WorkspaceItem { id: string; path: string }
interface SessionSummary { path: string; title: string; workspace: string; updated: number }
export interface ChatWorkspaceProps {
  path: string;
  revision?: number;
  newSession?: boolean;
  onNewSession?: () => void;
  onStartSession?: () => void;
  onRetry?: () => void;
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
const lastSegment = (path: string) => path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
const normalizedPath = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
function relativeTime(updated: number) {
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - updated));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function ChatWorkspace({ path, revision = 0, newSession = true, onNewSession, onStartSession, onRetry, onBusyChange, catalogRefreshing = false, canRefreshModels = false, onModelsMissing, workspaces, onSelect, onAddFolder, onRemove, onTerminal, onSettings }: ChatWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({ projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const attachmentRef = useRef(attachments);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const readingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [openedSession, setOpenedSession] = useState<string | null>(null);
  const sessionChange = useRef(false);
  const [dialogs, setDialogs] = useState(emptyDialogQueue);
  const queue = useRef(dialogs);
  const dialog = dialogs.items[0] ?? null;
  const [answer, setAnswer] = useState("");
  const [notification, setNotification] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [hero, setHero] = useState(newSession);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [diskReports, setDiskReports] = useState<FlowReportRecord[]>([]);
  const [reportsSession, setReportsSession] = useState("");
  const [timing, setTiming] = useState<SessionTiming>();
  const [workingStartedAt, setWorkingStartedAt] = useState<number>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const connection = useRef<ChatConnection | null>(null);
  const historyCache = useRef(new Map<string, unknown[]>());
  const previousNewSession = useRef(newSession);
  const queuedSession = useRef<string | null>(null);
  function updateDialogs(next: DialogQueue) { queue.current = next; setDialogs(next); }
  function updateAttachments(next: ImageAttachment[]) { attachmentRef.current = next; setAttachments(next); }
  useEffect(() => {
    setHero(newSession);
    if (newSession && !previousNewSession.current && connection.current && snapshot.connected && !snapshot.projection.running && !snapshot.pending && snapshot.projection.messages.length > 0) {
      void connection.current.newSession().catch(() => {});
    }
    previousNewSession.current = newSession;
  }, [newSession]);
  useEffect(() => {
    queuedSession.current = null;
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
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: MouseEvent) => { if (!picker.current?.contains(event.target as Node)) setPickerOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [pickerOpen]);
  async function refreshSessions() {
    try { setSessions(await invoke<SessionSummary[]>("chat_sessions")); }
    catch { /* Session history is ancillary; chat remains usable. */ }
  }
  useEffect(() => { void refreshSessions(); }, [path, revision]);
  useEffect(() => {
    if (!snapshot.connected || snapshot.projection.messages.length === 0) return;
    const timer = setTimeout(() => { void refreshSessions(); }, 500);
    return () => clearTimeout(timer);
  }, [snapshot.connected, snapshot.projection.messages.length]);
  useEffect(() => { if (snapshot.connected) void refreshSessions(); }, [snapshot.connected, snapshot.sessionFile]);
  useEffect(() => { if (snapshot.connected) void connection.current?.loadStats(); }, [snapshot.connected, snapshot.sessionFile, snapshot.projection.messages.length, snapshot.projection.running]);
  useEffect(() => {
    // Reports belong to the session the UI is showing, not to the runtime's previous
    // session file. During a switch those are briefly different.
    const file = openedSession ?? snapshot.sessionFile;
    if (!file) { setDiskReports([]); setReportsSession(""); setTiming(undefined); return; }
    setDiskReports([]); setReportsSession(file);
    let disposed = false;
    void invoke<FlowReportRecord[]>("chat_flow_reports", { sessionPath: file })
      .then(reports => { if (!disposed) setDiskReports(Array.isArray(reports) ? reports : []); })
      .catch(() => { if (!disposed) setDiskReports([]); });
    void invoke<SessionTiming>("chat_session_timing", { sessionPath: file })
      .then(value => { if (!disposed && value && typeof value.modelMs === "number") setTiming(value); })
      .catch(() => { if (!disposed) setTiming(undefined); });
    return () => { disposed = true; };
  }, [openedSession, snapshot.sessionFile, snapshot.projection.messages.length]);
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
    const wasHero = hero;
    setWorkingStartedAt(Date.now());
    try {
      await client.sendOrSteer(value, submitted.map(item => item.image), running);
      if (connection.current !== client) return;
      setDraft(current => current === value ? "" : current);
      updateAttachments(removeSubmittedImages(attachmentRef.current, submitted));
      if (wasHero) { setHero(false); onStartSession?.(); }
    } catch { /* Keep the draft and images available after rejection. */ }
  }
  const working = switching || (snapshot.connected && (snapshot.pending || snapshot.projection.running));
  const name = lastSegment(path);
  async function startNewSession() {
    onNewSession?.();
    setHero(true);
    setOpenedSession(null);
  }
  async function openSession(sessionPath: string) {
    const client = connection.current;
    if (!client || sessionChange.current) return;
    const cached = historyCache.current.get(sessionPath);
    // A hovered/prefetched session can replace the transcript immediately, even if
    // the runtime is still finishing a New Session request.
    if (cached) {
      setHero(false); onStartSession?.();
      setSwitching(true);
      setOpenedSession(sessionPath);
      setDiskReports([]); setReportsSession(""); setTiming(undefined);
      setNotification("");
      client.previewSession(cached);
    }
    if (!snapshot.connected || snapshot.pending) {
      queuedSession.current = sessionPath;
      if (!cached) setNotification("The workspace is still warming up; the selected session will open when it is ready.");
      return;
    }
    sessionChange.current = true; setSwitching(true);
    setHero(false); onStartSession?.();
    setOpenedSession(sessionPath);
    setDiskReports([]); setReportsSession(""); setTiming(undefined);
    if (!cached) {
      client.previewSession([]);
      try {
        const preview = await invoke<unknown[]>("chat_session_messages", { sessionPath });
        historyCache.current.set(sessionPath, preview);
        if (connection.current === client) client.previewSession(preview);
      } catch { /* The runtime's authoritative history still loads below. */ }
    }
    try {
      await client.resumeSession(sessionPath);
      const session = sessions.find(item => normalizedPath(item.path) === normalizedPath(sessionPath));
      if (session) localStorage.setItem("jouzu.chat.workspace", session.workspace);
      void refreshSessions();
    } catch (error) { if (connection.current === client) setNotification(String(error).replace(/^Error:\s*/u, "")); }
    finally { sessionChange.current = false; setSwitching(false); }
  }
  function prefetchSession(sessionPath: string) {
    if (historyCache.current.has(sessionPath)) return;
    void invoke<unknown[]>("chat_session_messages", { sessionPath }).then(messages => {
      if (Array.isArray(messages)) historyCache.current.set(sessionPath, messages);
    }).catch(() => {});
  }
  useEffect(() => {
    if (!snapshot.connected || snapshot.pending || snapshot.projection.running || !queuedSession.current || sessionChange.current) return;
    const sessionPath = queuedSession.current;
    queuedSession.current = null;
    void openSession(sessionPath);
  }, [snapshot.connected, snapshot.pending, snapshot.projection.running]);
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
  async function switchWorkspace(next: string) {
    if (next === path) { setPickerOpen(false); return; }
    if (snapshot.projection.running && !await confirm("Stop the current run and switch workspace?", { title: "Switch workspace", kind: "warning" })) return;
    setPickerOpen(false); onSelect(next);
  }
  const groups = useMemo(() => {
    const map = new Map<string, { id: string; path: string; name: string; sessions: SessionSummary[] }>();
    for (const workspace of workspaces) map.set(normalizedPath(workspace.path), { id: workspace.id, path: workspace.path, name: lastSegment(workspace.path), sessions: [] });
    for (const session of sessions) {
      const key = normalizedPath(session.workspace);
      if (!map.has(key)) map.set(key, { id: key, path: session.workspace, name: lastSegment(session.workspace), sessions: [] });
      map.get(key)!.sessions.push(session);
    }
    let result = [...map.values()];
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      result = result.flatMap(group => {
        if (group.name.toLowerCase().includes(query) || group.path.toLowerCase().includes(query)) return [group];
        const matches = group.sessions.filter(session => session.title.toLowerCase().includes(query));
        return matches.length ? [{ ...group, sessions: matches }] : [];
      });
    }
    if (sort === "name") result.sort((left, right) => left.name.localeCompare(right.name));
    else result.sort((left, right) => (right.sessions[0]?.updated ?? 0) - (left.sessions[0]?.updated ?? 0));
    return result;
  }, [workspaces, sessions, search, sort]);
  const selectedSession = normalizedPath(snapshot.sessionFile ?? "");
  const flow = useMemo(() => deriveFlow(snapshot.projection.tools), [snapshot.projection.tools]);
  const workspacePicker = <div ref={picker} className="relative">
    <Button type="button" variant="outline" className="h-8 max-w-64 gap-2 px-2 text-xs" aria-label="Choose workspace" aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}>
      <FolderOpen className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{name}</span><ChevronDown className="size-3 shrink-0" aria-hidden="true" />
    </Button>
    {pickerOpen && <div role="menu" aria-label="Choose workspace" className="absolute left-0 top-full z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-2 shadow-xl">
      {workspaces.map(workspace => <button key={workspace.id} type="button" role="menuitemradio" aria-checked={workspace.path === path} onClick={() => void switchWorkspace(workspace.path)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
        <span className="min-w-0"><span className="block truncate">{lastSegment(workspace.path)}</span><span className="block truncate text-xs text-muted-foreground">{workspace.path}</span></span>
        {workspace.path === path && <span className="text-xs text-primary">Current</span>}
      </button>)}
      {!workspaces.length && <p className="px-2 py-2 text-sm text-muted-foreground">No workspaces yet.</p>}
      <div className="mt-1 border-t border-border pt-1"><Button type="button" variant="ghost" className="w-full justify-start" onClick={() => { setPickerOpen(false); onAddFolder(); }}><Plus className="size-4" />Add folder</Button></div>
    </div>}
  </div>;
  const connectionState = !snapshot.connected && <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
    <span>{snapshot.error ? "The workspace could not connect." : `Starting ${name}…`}</span>
    {snapshot.error && <><span className="min-w-0 truncate" title={snapshot.error}>{snapshot.error}</span><Button variant="outline" className="ml-auto h-7 px-2" onClick={onRetry}>Retry</Button></>}
  </div>;
  return <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
    {sidebar && <aside aria-label="Workspaces" className="absolute inset-y-0 left-0 z-20 flex w-72 max-w-[85%] flex-col border-r border-border bg-background shadow-xl md:static md:z-auto md:shadow-none">
      <div className="flex items-center gap-2 px-2 pb-2 pt-3"><Button className="min-w-0 flex-1 justify-start gap-2" onClick={() => void startNewSession()}><Plus className="size-4" />New session</Button><Button variant="ghost" className="size-8 p-0 md:hidden" aria-label="Hide workspaces" onClick={() => setSidebar(false)}><X className="size-4" /></Button></div>
      <div className="space-y-1 px-2 pb-2">
        <Button variant="ghost" className="w-full justify-start gap-2" onClick={onSettings}><Settings className="size-4" />Settings</Button>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workspaces</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="size-7 p-0" aria-label="Search workspaces" aria-pressed={searchOpen} onClick={() => { setSearchOpen(value => !value); if (searchOpen) setSearch(""); }}><Search className="size-3.5" /></Button>
          <Button variant="ghost" className="size-7 p-0" aria-label={sort === "recent" ? "Sort by name" : "Sort by recent"} onClick={() => setSort(value => value === "recent" ? "name" : "recent")}><ArrowUpDown className="size-3.5" /></Button>
          <Button variant="ghost" className="size-7 p-0" aria-label="Add folder" onClick={onAddFolder}><FolderPlus className="size-3.5" /></Button>
        </div>
      </div>
      {searchOpen && <div className="px-2 pb-2"><Input autoFocus aria-label="Search sessions" placeholder="Search sessions" value={search} onChange={event => setSearch(event.target.value)} /></div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {groups.map(group => {
          const open = !!search.trim() || !collapsed.has(group.id);
          return <section key={group.id} className="mb-1">
            <div className={`group flex items-center gap-1 rounded-lg ${normalizedPath(group.path) === normalizedPath(path) ? "bg-accent/70" : "hover:bg-muted/60"}`}>
              <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${group.name}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
                {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm">{group.name}</span>
              </button>
              <Button variant="ghost" className="mr-1 size-6 p-0 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${group.path}`} onClick={() => { const workspace = workspaces.find(item => normalizedPath(item.path) === normalizedPath(group.path)); if (workspace) onRemove(workspace.id); }}><X className="size-3" /></Button>
            </div>
            {open && <div className="ml-4 border-l border-border pl-1.5">
              {group.sessions.map(session => <button key={session.path} type="button" onClick={() => void openSession(session.path)} onPointerEnter={() => prefetchSession(session.path)} onFocus={() => prefetchSession(session.path)} title={session.path} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${selectedSession === normalizedPath(session.path) ? "bg-accent" : "hover:bg-muted/60"}`}>
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{session.title}</span><span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(session.updated)}</span>
              </button>)}
              {!group.sessions.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">No sessions yet</p>}
            </div>}
          </section>;
        })}
        {!groups.length && <p className="p-3 text-sm text-muted-foreground">{search ? "No matching sessions" : "No workspaces yet."}</p>}
      </div>
    </aside>}
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hero ? <div className="flex items-center px-2 py-1.5"><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={sidebar ? "Hide workspaces" : "Show workspaces"} title="Workspaces" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft className="size-4" /></Button></div> : <div className="flex items-center gap-1 border-b border-border px-2 py-2 sm:px-3">
        <Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={sidebar ? "Hide workspaces" : "Show workspaces"} title="Workspaces" aria-expanded={sidebar} onClick={() => setSidebar(value => !value)}><PanelLeft className="size-4" /></Button>
        <div className="min-w-0 flex-1 px-1"><h2 className="truncate text-sm font-semibold" title={path}>{name}</h2><p className="truncate text-xs text-muted-foreground" title={path}>{snapshot.model ?? path}</p></div>
        <span className="hidden h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground sm:inline-flex">Standard mode</span>
        <FlowMenu key={openedSession ?? snapshot.sessionFile ?? path} flow={flow} widgets={snapshot.widgets ?? {}} statuses={snapshot.statuses ?? {}} reports={reportsSession && normalizedPath(reportsSession) === normalizedPath(openedSession ?? snapshot.sessionFile ?? "") ? diskReports : []} />
        <Button variant="ghost" className="h-7 shrink-0 gap-1.5 px-2 text-xs" aria-label="Open in terminal" title="Open this session's workspace in a terminal" onClick={() => onTerminal(path)}><SquareTerminal className="size-3.5" /><span className="hidden sm:inline">Terminal</span></Button>
      </div>}
      {connectionState}
      {notification && <div role="status" className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs"><span className="min-w-0 truncate">{notification}</span><Button variant="ghost" className="h-7 px-2" onClick={() => setNotification("")}>Dismiss</Button></div>}
      {dialog && <section role="dialog" aria-modal="false" aria-label={dialog.title} className="m-3 rounded-xl border border-primary bg-card p-4"><h3 className="font-semibold">{dialog.title}</h3>{dialog.message && <p className="my-2 text-sm">{dialog.message}</p>}{["input", "editor"].includes(dialog.method) && <textarea aria-label="Response" disabled={dialog.responding} className="my-2 w-full rounded border border-border bg-background p-2" value={answer} onChange={event => setAnswer(event.target.value)} />}
        <fieldset disabled={dialog.responding || !snapshot.transportReady} className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void reply({ cancelled: true })}>Cancel</Button>{dialog.method === "confirm" ? <><Button variant="outline" onClick={() => void reply({ confirmed: false })}>No</Button><Button onClick={() => void reply({ confirmed: true })}>Yes</Button></> : dialog.method === "select" ? dialog.options.map(option => <Button key={option} onClick={() => void reply({ value: option })}>{option}</Button>) : <Button onClick={() => void reply({ value: answer })}>Submit</Button>}</fieldset></section>}
      {hero ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-8">
        <div className="w-full max-w-3xl">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card"><Sparkles className="size-6 text-primary" aria-hidden="true" /></span>
            <h1 className="text-2xl font-semibold tracking-tight">What would you like to build?</h1>
            <p className="max-w-md text-sm text-muted-foreground">Choose a workspace, then describe the task. Jouzu can explore code, explain it, or make a change.</p>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">{workspacePicker}<span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">Standard mode</span></div>
          <Composer hero connected={snapshot.connected} pending={snapshot.pending || switching} running={snapshot.projection.running} draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void connection.current?.abort()} onCompact={() => void compactConversation()} onExport={() => void exportConversation()} error={snapshot.error} compatibility={snapshot.projection.compatibility} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} models={snapshot.models ?? []} model={snapshot.model} onSelectModel={(provider, id) => void connection.current?.selectModel(provider, id)} onRefreshModels={() => void connection.current?.loadModels()} thinkingLevel={snapshot.thinkingLevel} thinkingLevels={snapshot.thinkingLevels ?? []} onThinkingLevel={level => void connection.current?.setThinkingLevel(level)} />
          <SessionStatsBar stats={snapshot.stats} timing={timing} />
        </div>
      </div> : <>
        <ChatConversation key={openedSession ?? snapshot.sessionFile ?? path} projection={snapshot.projection} pending={snapshot.pending} startedAt={workingStartedAt} opening={switching} />
        <Composer connected={snapshot.connected} pending={snapshot.pending || switching} running={snapshot.projection.running} draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void connection.current?.abort()} onCompact={() => void compactConversation()} onExport={() => void exportConversation()} error={snapshot.error} compatibility={snapshot.projection.compatibility} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} models={snapshot.models ?? []} model={snapshot.model} onSelectModel={(provider, id) => void connection.current?.selectModel(provider, id)} onRefreshModels={() => void connection.current?.loadModels()} thinkingLevel={snapshot.thinkingLevel} thinkingLevels={snapshot.thinkingLevels ?? []} onThinkingLevel={level => void connection.current?.setThinkingLevel(level)} />
        <SessionStatsBar stats={snapshot.stats} timing={timing} />
      </>}
    </section>
  </div>;
}
