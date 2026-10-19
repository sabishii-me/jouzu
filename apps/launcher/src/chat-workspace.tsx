import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FolderOpen, Plus, SquareTerminal } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "./components/ui/button";
import { ChatConversation } from "./chat-conversation";
import { ChatConnection, type ChatSnapshot } from "./chat-connection";
import { readImageAttachment, removeSubmittedImages, validateImageSelection, type ImageAttachment } from "./chat-attachments";
import { emptyProjection } from "./chat-projection";
import { beginDialogResponse, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog, type DialogAnswer, type DialogQueue } from "./dialog-queue";

export function ChatWorkspace({ path, onBack, onTerminal }: { path: string; onBack: () => void; onTerminal: () => void }) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>({ projection: emptyProjection(), connected: false, pending: false, error: null });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const attachmentRef = useRef(attachments);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [readingImages, setReadingImages] = useState(false);
  const readingRef = useRef(false);
  function updateAttachments(next: ImageAttachment[]) { attachmentRef.current = next; setAttachments(next); }
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
    try {
      await client.send(value, submitted.map(item => item.image));
      if (connection.current !== client) return;
      setDraft(current => current === value ? "" : current);
      updateAttachments(removeSubmittedImages(attachmentRef.current, submitted));
    } catch { /* Keep the draft and images available after rejection. */ }
  }
  const [choosingSession, setChoosingSession] = useState(false);
  const sessionChange = useRef(false);
  const [dialogs, setDialogs] = useState(emptyDialogQueue);
  const queue = useRef(dialogs);
  const dialog = dialogs.items[0] ?? null;
  const [answer, setAnswer] = useState("");
  const [notification, setNotification] = useState("");
  const connection = useRef<ChatConnection | null>(null);
  function updateDialogs(next: DialogQueue) { queue.current = next; setDialogs(next); }
  useEffect(() => {
    updateDialogs(emptyDialogQueue());
    setSnapshot({ projection: emptyProjection(), connected: false, pending: false, error: null });
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
  }, [path]);
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
    finally {
      // A send failure is uncertain: do not offer an automatic duplicate reply.
      if (connection.current === client) updateDialogs(removeDialog(queue.current, id));
    }
  }
  const working = choosingSession || (snapshot.connected && (snapshot.pending || snapshot.projection.running));
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
    } catch (error) {
      if (connection.current === client) setNotification(String(error));
    } finally {
      sessionChange.current = false;
      setChoosingSession(false);
    }
  }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center gap-3 border-b border-border py-3"><Button variant="ghost" aria-label="Back to workspaces" disabled={working} onClick={onBack}><ArrowLeft /></Button><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)}</h2><p className="truncate text-xs text-muted-foreground" title={path}>{snapshot.model ?? path}</p></div><Button variant="ghost" disabled={working || !snapshot.connected || !!dialog} onClick={() => void changeSession(false)}><Plus />New chat</Button><Button variant="ghost" disabled={working || !snapshot.connected || !!dialog} onClick={() => void changeSession(true)}><FolderOpen />Resume</Button><Button variant="ghost" title="Open in terminal" aria-label="Open in terminal" onClick={onTerminal}><SquareTerminal /></Button></div>
    {notification && <div role="status" className="flex items-center justify-between border-b border-border p-2 text-xs"><span>{notification}</span><Button variant="ghost" onClick={() => setNotification("")}>Dismiss</Button></div>}
    {dialog && <section role="dialog" aria-modal="false" aria-label={dialog.title} className="m-3 rounded-xl border border-primary bg-card p-4"><h3 className="font-semibold">{dialog.title}</h3>{dialog.message && <p className="my-2 text-sm">{dialog.message}</p>}{["input", "editor"].includes(dialog.method) && <textarea aria-label="Response" disabled={dialog.responding} className="my-2 w-full rounded border border-border bg-background p-2" value={answer} onChange={event => setAnswer(event.target.value)} />}
      <fieldset disabled={dialog.responding || !snapshot.transportReady} className="mt-3 flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void reply({ cancelled: true })}>Cancel</Button>{dialog.method === "confirm" ? <><Button variant="outline" onClick={() => void reply({ confirmed: false })}>No</Button><Button onClick={() => void reply({ confirmed: true })}>Yes</Button></> : dialog.method === "select" ? dialog.options.map(option => <Button key={option} onClick={() => void reply({ value: option })}>{option}</Button>) : <Button onClick={() => void reply({ value: answer })}>Submit</Button>}</fieldset></section>}
    <ChatConversation projection={snapshot.projection} draft={draft} onDraft={setDraft} connected={snapshot.connected} pending={snapshot.pending || choosingSession} error={snapshot.error} onStop={() => void connection.current?.abort()} onSend={() => void send()} attachments={attachments} onAddImages={files => void addImages(files)} onRemoveImage={id => updateAttachments(attachmentRef.current.filter(item => item.id !== id))} readingImages={readingImages} attachmentError={attachmentError} />
  </div>;
}
