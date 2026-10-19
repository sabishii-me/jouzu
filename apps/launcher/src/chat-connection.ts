import { invoke } from "@tauri-apps/api/core";
import { emptyProjection, historyProjection, object, projectEvent, type ChatProjection, type WireObject } from "./chat-projection";

export interface ChatImage { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }
const REQUEST_TIMEOUT = 30_000;
const STARTUP_TIMEOUT = 120_000;
export interface ChatSnapshot { projection: ChatProjection; connected: boolean; transportReady?: boolean; pending: boolean; error: string | null; sessionId?: string; sessionFile?: string; model?: string }
interface Poll { records: WireObject[]; closed: boolean; error?: string }
// A desktop connection, not an agent loop: never retries a prompt or writes history.
export class ChatConnection {
  private handle?: string;
  private disposed = false;
  private failed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private dialogs = new Map<string, number | null>();
  private lastPoll = Date.now();
  private requests = new Map<string, { command: string; resolve: (value: unknown) => void; reject: (error: Error) => void; deadline: number }>();
  snapshot: ChatSnapshot = { projection: emptyProjection(), connected: false, pending: false, error: null };
  constructor(private publish: (state: ChatSnapshot) => void, private dialog: (request: WireObject) => void) {}
  private update(change: Partial<ChatSnapshot>) { this.snapshot = { ...this.snapshot, ...change }; if (!this.disposed) this.publish(this.snapshot); }
  async start(path: string) {
    try {
      const handle = await invoke<string>("chat_start", { path });
      if (this.disposed) { await invoke("chat_stop", { handle }); return; }
      this.handle = handle;
      this.update({ transportReady: true });
      this.poll();
      await this.refreshHistory();
      this.update({ connected: true });
    } catch (error) { this.fail(error); }
  }
  private poll = async () => {
    if (this.disposed || this.failed || !this.handle) return;
    try {
      const batch = await invoke<Poll>("chat_poll", { handle: this.handle });
      if (this.disposed || this.failed) return;
      for (const record of batch.records) {
        if (record.type === "response") {
          const pending = typeof record.id === "string" ? this.requests.get(record.id) : undefined;
          if (!pending || record.command !== pending.command || typeof record.success !== "boolean") throw new Error("Uncorrelated runtime response.");
          this.requests.delete(record.id as string);
          if (record.success) pending.resolve(record.data); else pending.reject(new Error(typeof record.error === "string" ? record.error : "Runtime request failed."));
        } else if (record.type === "extension_ui_request") {
          if (typeof record.id === "string" && ["select", "confirm", "input", "editor"].includes(String(record.method))) {
            if (!this.dialogs.has(record.id)) {
              if (this.dialogs.size >= 64) throw new Error("Runtime exceeded the pending interaction limit.");
              this.dialogs.set(record.id, typeof record.timeout === "number" && Number.isFinite(record.timeout) ? Date.now() + Math.max(0, record.timeout) : null);
            }
          }
          this.dialog(record);
        }
        else if (record.type === "extension_error") this.update({ error: typeof record.error === "string" ? record.error : "A runtime extension failed." });
        else this.update({ projection: projectEvent(this.snapshot.projection, record) });
      }
      if (batch.closed) throw new Error(batch.error || "Runtime disconnected. The outcome may be incomplete; no work was replayed.");
      const now = Date.now();
      const waitingForUser = this.dialogs.size > 0;
      for (const [id, deadline] of this.dialogs) if (deadline !== null && deadline <= now) this.dialogs.delete(id);
      if (waitingForUser) for (const pending of this.requests.values()) pending.deadline += now - this.lastPoll;
      this.lastPoll = now;
      for (const pending of this.requests.values()) if (now > pending.deadline) throw new Error("Runtime response timed out. The outcome is uncertain; no work was replayed.");
      this.timer = setTimeout(this.poll, 30);
    } catch (error) { this.fail(error); }
  };
  request(command: string, fields: WireObject = {}, timeoutMs = REQUEST_TIMEOUT): Promise<unknown> {
    if (!this.handle || this.disposed || this.failed) return Promise.reject(new Error("Chat is not connected."));
    const id = `desktop-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { command, resolve, reject, deadline: Date.now() + timeoutMs });
      void invoke("chat_send", { handle: this.handle, request: { ...fields, type: command, id } }).catch(error => { this.requests.delete(id); reject(new Error(String(error))); });
    });
  }
  async refreshHistory() {
    // The released runtime loads extensions and sessions before it answers its first request.
    // That cold start is outside this desktop's control and has been measured near 30 seconds,
    // so the initial handshake gets its own budget instead of the command deadline.
    const state = await this.request("get_state", {}, STARTUP_TIMEOUT);
    if (!object(state) || typeof state.sessionId !== "string" || typeof state.isStreaming !== "boolean") throw new Error("Runtime returned incompatible session state.");
    const history = await this.request("get_messages");
    if (!object(history)) throw new Error("Runtime returned incompatible history.");
    const projection = historyProjection(history.messages);
    projection.running = state.isStreaming;
    this.update({ projection, sessionId: state.sessionId, sessionFile: typeof state.sessionFile === "string" ? state.sessionFile : undefined, model: object(state.model) && typeof state.model.name === "string" ? state.model.name : undefined });
  }
  private async changeSession(command: "new_session" | "switch_session", fields: WireObject = {}) {
    if (!this.snapshot.connected || this.snapshot.pending || this.snapshot.projection.running) throw new Error("Wait for the current conversation to settle.");
    this.update({ pending: true, error: null });
    try {
      const result = await this.request(command, fields);
      if (!object(result) || typeof result.cancelled !== "boolean") throw new Error("Runtime returned incompatible session outcome.");
      if (result.cancelled) throw new Error("The runtime cancelled the conversation change.");
      await this.refreshHistory();
    } catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ pending: false }); }
  }
  newSession() { return this.changeSession("new_session"); }
  resumeSession(sessionPath: string) { return this.changeSession("switch_session", { sessionPath }); }
  async send(message: string, images: readonly ChatImage[] = []) {
    if (this.snapshot.pending || this.snapshot.projection.running) throw new Error("Wait for the current run to settle.");
    this.update({ pending: true, error: null });
    try {
      const data = await this.request("prompt", { message, ...(images.length ? { images } : {}) });
      if (!object(data) || !["started", "queued", "handled"].includes(String(data.disposition))) throw new Error("Runtime returned an unsupported prompt disposition.");
    } catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ pending: false }); }
  }
  async abort() { try { await this.request("clear_queue"); await this.request("abort"); } catch (error) { this.update({ error: String(error) }); } }
  async reply(id: string, fields: WireObject) {
    if (!this.handle || this.disposed || this.failed) throw new Error("Chat is not connected.");
    await invoke("chat_send", { handle: this.handle, request: { type: "extension_ui_response", id, ...fields } });
    this.dialogs.delete(id);
  }
  private fail(error: unknown) {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.update({ connected: false, transportReady: false, pending: false, error: String(error) });
    this.dialogs.clear();
    for (const request of this.requests.values()) request.reject(new Error(String(error)));
    this.requests.clear();
    if (this.timer) clearTimeout(this.timer);
    if (this.handle) void invoke("chat_stop", { handle: this.handle }).catch(() => {});
  }
  async close() {
    this.disposed = true;
    this.dialogs.clear();
    this.snapshot = { ...this.snapshot, transportReady: false, connected: false };
    if (this.timer) clearTimeout(this.timer);
    for (const request of this.requests.values()) request.reject(new Error("Conversation closed."));
    this.requests.clear();
    if (this.handle) await invoke("chat_stop", { handle: this.handle });
  }
}
