import { invoke } from "@tauri-apps/api/core";
import { emptyProjection, historyProjection, object, projectEvent, type ChatProjection, type WireObject } from "./chat-projection";

export interface ChatImage { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }
export interface ChatModel { provider: string; id: string; name: string }
const MODEL_PREFERENCE_KEY = "jouzu.chat.model";
function readModelPreference(): { provider: string; id: string } | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(MODEL_PREFERENCE_KEY) ?? "null");
    return value && typeof value.provider === "string" && typeof value.id === "string" ? value : undefined;
  } catch { return undefined; }
}
function writeModelPreference(value: { provider: string; id: string } | undefined) {
  try {
    if (value) localStorage.setItem(MODEL_PREFERENCE_KEY, JSON.stringify(value));
    else localStorage.removeItem(MODEL_PREFERENCE_KEY);
  } catch { /* A webview without storage keeps the selection for this session only. */ }
}
export interface ChatSnapshot {
  projection: ChatProjection;
  connected: boolean;
  transportReady?: boolean;
  pending: boolean;
  error: string | null;
  sessionId?: string;
  sessionFile?: string;
  model?: string;
  modelProvider?: string;
  modelId?: string;
  models?: ChatModel[];
  modelsLoaded?: boolean;
  widgets?: Record<string, string[]>;
  statuses?: Record<string, string>;
  thinkingLevel?: string;
  thinkingLevels?: string[];
}
interface Poll { records: WireObject[]; closed: boolean; error?: string }
// A response watchdog, not a request deadline: the released runtime owns how long a command
// takes, and a lost answer is only distinguishable from a slow one by waiting a long time.
const RESPONSE_WATCHDOG = 5 * 60_000;
// A desktop connection, not an agent loop: never retries a prompt or writes history.
export class ChatConnection {
  private handle?: string;
  private disposed = false;
  private failed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private nextId = 0;
  private dialogs = new Map<string, number | null>();
  private lastPoll = Date.now();
  private preferredModel = readModelPreference();
  private requests = new Map<string, { command: string; resolve: (value: unknown) => void; reject: (error: Error) => void; deadline: number }>();
  snapshot: ChatSnapshot = { projection: emptyProjection(), connected: false, pending: false, error: null, models: [], thinkingLevels: [] };
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
      await this.applyPreferredModel();
      void this.loadModels();
      void this.loadThinkingLevels();
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
          if (record.method === "setWidget" && typeof record.widgetKey === "string") {
            const widgets = { ...(this.snapshot.widgets ?? {}) };
            const lines = Array.isArray(record.widgetLines) ? record.widgetLines.filter((line): line is string => typeof line === "string") : undefined;
            if (lines?.length) widgets[record.widgetKey] = lines;
            else delete widgets[record.widgetKey];
            this.update({ widgets });
          } else if (record.method === "setStatus" && typeof record.statusKey === "string") {
            const statuses = { ...(this.snapshot.statuses ?? {}) };
            if (typeof record.statusText === "string" && record.statusText) statuses[record.statusKey] = record.statusText;
            else delete statuses[record.statusKey];
            this.update({ statuses });
          } else {
            if (typeof record.id === "string" && ["select", "confirm", "input", "editor"].includes(String(record.method))) {
              if (!this.dialogs.has(record.id)) {
                if (this.dialogs.size >= 64) throw new Error("Runtime exceeded the pending interaction limit.");
                this.dialogs.set(record.id, typeof record.timeout === "number" && Number.isFinite(record.timeout) ? Date.now() + Math.max(0, record.timeout) : null);
              }
            }
            this.dialog(record);
          }
        }
        else if (record.type === "extension_error") this.update({ error: typeof record.error === "string" ? record.error : "A runtime extension failed." });
        else this.update({ projection: projectEvent(this.snapshot.projection, record) });
      }
      if (batch.closed) throw new Error(batch.error || "Runtime disconnected. The outcome may be incomplete; no work was replayed.");
      const now = Date.now();
      const waitingForUser = this.dialogs.size > 0;
      for (const [id, deadline] of this.dialogs) if (deadline !== null && deadline <= now) this.dialogs.delete(id);
      // A person deciding a dialog is not a slow runtime; do not charge that time to the watchdog.
      if (waitingForUser) for (const pending of this.requests.values()) pending.deadline += now - this.lastPoll;
      this.lastPoll = now;
      for (const pending of this.requests.values()) if (now > pending.deadline) throw new Error("Jouzu did not answer for five minutes. The outcome is uncertain; no work was replayed.");
      this.timer = setTimeout(this.poll, 30);
    } catch (error) { this.fail(error); }
  };
  request(command: string, fields: WireObject = {}): Promise<unknown> {
    if (!this.handle || this.disposed || this.failed) return Promise.reject(new Error("Chat is not connected."));
    const id = `desktop-${++this.nextId}`;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { command, resolve, reject, deadline: Date.now() + RESPONSE_WATCHDOG });
      void invoke("chat_send", { handle: this.handle, request: { ...fields, type: command, id } }).catch(error => { this.requests.delete(id); reject(new Error(String(error))); });
    });
  }
  async refreshHistory() {
    const state = await this.request("get_state");
    if (!object(state) || typeof state.sessionId !== "string" || typeof state.isStreaming !== "boolean") throw new Error("Runtime returned incompatible session state.");
    const history = await this.request("get_messages");
    if (!object(history) || !Array.isArray(history.messages)) throw new Error("Runtime returned incompatible history.");
    const projection = historyProjection(history.messages);
    projection.running = state.isStreaming;
    const detail = object(state.model) ? state.model : undefined;
    const model = detail && typeof detail.name === "string" && detail.name !== "unknown" ? detail.name : undefined;
    const modelProvider = detail && typeof detail.provider === "string" && detail.provider !== "unknown" ? detail.provider : undefined;
    const modelId = detail && typeof detail.id === "string" && detail.id !== "unknown" ? detail.id : undefined;
    this.update({
      projection,
      sessionId: state.sessionId,
      sessionFile: typeof state.sessionFile === "string" ? state.sessionFile : undefined,
      model,
      modelProvider,
      modelId,
      thinkingLevel: typeof state.thinkingLevel === "string" ? state.thinkingLevel : undefined,
    });
  }
  private async applyPreferredModel() {
    const preferred = this.preferredModel;
    if (!preferred) return;
    if (this.snapshot.modelProvider === preferred.provider && this.snapshot.modelId === preferred.id) return;
    try { await this.selectModel(preferred.provider, preferred.id); }
    catch {
      // A saved model may disappear from the catalog; fall back to the runtime default.
      this.preferredModel = undefined;
      writeModelPreference(undefined);
    }
  }
  private async changeSession(command: "new_session" | "switch_session", fields: WireObject = {}) {
    if (!this.snapshot.connected || this.snapshot.pending || this.snapshot.projection.running) throw new Error("Wait for the current conversation to settle.");
    this.update({ pending: true, error: null });
    try {
      const result = await this.request(command, fields);
      if (object(result) && result.cancelled === true) throw new Error("The runtime cancelled the conversation change.");
      // A resumed session owns its model for this view, but it must not overwrite the
      // user's saved preference for future new sessions.
      await this.refreshHistory();
      if (command === "new_session") await this.applyPreferredModel();
    } catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ pending: false }); }
  }
  newSession() { return this.changeSession("new_session"); }
  resumeSession(sessionPath: string) { return this.changeSession("switch_session", { sessionPath }); }
  async sendOrSteer(message: string, images: readonly ChatImage[], running: boolean) {
    if (this.snapshot.pending) throw new Error("Wait for the current request to be accepted.");
    this.update({ pending: true, error: null });
    try {
      await this.request(running ? "steer" : "prompt", { message, ...(images.length ? { images } : {}) });
    } catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ pending: false }); }
  }
  async abort() {
    try { await this.request("clear_queue"); } catch { /* The queue may already be empty; abort still applies. */ }
    try { await this.request("abort"); } catch (error) { this.update({ error: String(error) }); }
  }
  async compact() {
    if (!this.snapshot.connected || this.snapshot.pending || this.snapshot.projection.running) throw new Error("Wait for the current conversation to settle before compacting.");
    this.update({ pending: true, error: null });
    try {
      await this.request("compact");
      await this.refreshHistory();
    } catch (error) { throw error; }
    finally { this.update({ pending: false }); }
  }
  async exportHtml(outputPath: string) {
    if (!this.snapshot.connected) throw new Error("Chat is not connected.");
    await this.request("export_html", { outputPath });
  }
  async loadModels() {
    try {
      const data = await this.request("get_available_models");
      const models = object(data) && Array.isArray(data.models)
        ? data.models.flatMap(entry => object(entry) && typeof entry.provider === "string" && typeof entry.id === "string"
          ? [{ provider: entry.provider, id: entry.id, name: typeof entry.name === "string" ? entry.name : entry.id }]
          : [])
        : [];
      this.update({ models });
    } catch (error) { this.update({ error: `Could not read the model list. ${String(error)}` }); }
    finally { this.update({ modelsLoaded: true }); }
  }
  async selectModel(provider: string, id: string) {
    this.update({ error: null });
    try {
      const data = await this.request("set_model", { provider, modelId: id });
      const name = object(data) && typeof data.name === "string" ? data.name : this.snapshot.models?.find(model => model.provider === provider && model.id === id)?.name ?? id;
      this.preferredModel = { provider, id };
      writeModelPreference(this.preferredModel);
      this.update({ model: name, modelProvider: provider, modelId: id });
    } catch (error) { this.update({ error: String(error) }); throw error; }
  }
  private async loadThinkingLevels() {
    try {
      const data = await this.request("get_available_thinking_levels");
      const levels = object(data) && Array.isArray(data.levels) ? data.levels.filter((level): level is string => typeof level === "string") : [];
      this.update({ thinkingLevels: levels });
    } catch { /* Thinking levels are optional in the released runtime. */ }
  }
  async setThinkingLevel(level: string) {
    try { await this.request("set_thinking_level", { level }); this.update({ thinkingLevel: level }); }
    catch (error) { this.update({ error: String(error) }); }
  }
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
