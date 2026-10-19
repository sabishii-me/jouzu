// Presentation-only projection of the released JSONL event contract.
// Agent history and completion remain authoritative in the runtime.
export type WireObject = Record<string, unknown>;
export interface ChatBlock { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown; data?: string; mimeType?: string }
export interface ChatMessage { role: string; content: ChatBlock[]; timestamp?: number; stopReason?: string; errorMessage?: string; toolCallId?: string; toolName?: string; isError?: boolean }
export interface ToolView { id: string; name: string; args: unknown; phase: "running" | "complete" | "error"; result?: unknown }
export interface FlowReportRecord { kind: string; text: string; timestamp?: number }
export interface ChatProjection {
  messages: ChatMessage[];
  activeMessage: number | null;
  tools: Record<string, ToolView>;
  flowReports: FlowReportRecord[];
  running: boolean;
  compatibility: string[];
}
export function emptyProjection(): ChatProjection { return { messages: [], activeMessage: null, tools: {}, flowReports: [], running: false, compatibility: [] }; }
export function object(value: unknown): value is WireObject { return !!value && typeof value === "object" && !Array.isArray(value); }
export function parseMessage(value: unknown): ChatMessage {
  if (!object(value) || typeof value.role !== "string") throw new Error("Invalid runtime message");
  const content = typeof value.content === "string" ? [{ type: "text", text: value.content }] : value.content;
  if (!Array.isArray(content) || !content.every(block => object(block) && typeof block.type === "string")) throw new Error("Invalid runtime message content");
  return { ...value, role: value.role, content: content as ChatBlock[] };
}
export function historyProjection(messages: unknown): ChatProjection {
  if (!Array.isArray(messages)) throw new Error("Invalid runtime history");
  const parsed = messages.map(parseMessage);
  const tools: Record<string, ToolView> = {};
  for (const message of parsed) {
    for (const block of message.content) {
      if (block.type === "toolCall" && typeof block.id === "string") {
        tools[block.id] = { id: block.id, name: block.name ?? "tool", args: block.arguments, phase: tools[block.id]?.phase ?? "running", result: tools[block.id]?.result };
      }
    }
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const id = message.toolCallId;
      tools[id] = { id, name: message.toolName ?? tools[id]?.name ?? "tool", args: tools[id]?.args, phase: message.isError === true ? "error" : "complete", result: { content: message.content } };
    }
  }
  return { ...emptyProjection(), messages: parsed, tools };
}
function compatibility(state: ChatProjection, type: string): ChatProjection {
  return { ...state, compatibility: [...new Set([...state.compatibility, type])].slice(-32) };
}
const passiveEvents = new Set(["turn_start", "turn_end", "agent_end", "queue_update", "entry_appended", "session_info_changed", "thinking_level_changed", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end", "summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished"]);
export function projectEvent(state: ChatProjection, event: WireObject): ChatProjection {
  const type = event.type;
  if (typeof type !== "string") throw new Error("Runtime event has no type");
  if (type === "agent_start") return { ...state, running: true };
  if (type === "agent_settled") return { ...state, running: false };
  if (type === "message_start") {
    const message = parseMessage(event.message);
    return { ...state, messages: [...state.messages, message], activeMessage: state.messages.length };
  }
  if (type === "message_end") {
    const message = parseMessage(event.message);
    if (state.activeMessage === null) throw new Error("Runtime ended a message without starting it");
    return { ...state, messages: state.messages.map((item, index) => index === state.activeMessage ? message : item), activeMessage: null };
  }
  if (type === "message_update") {
    if (state.activeMessage === null || !object(event.assistantMessageEvent)) throw new Error("Runtime message update has no active message");
    const update = event.assistantMessageEvent;
    const index = update.contentIndex;
    if (typeof update.type !== "string") throw new Error("Invalid runtime content event");
    if (update.type === "start") return state;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 4095) throw new Error("Invalid runtime content index");
    const message = state.messages[state.activeMessage];
    const content = [...message.content];
    const blockIndex = index as number;
    const previous = content[blockIndex];
    switch (update.type) {
      case "text_start": content[blockIndex] = { type: "text", text: "" }; break;
      case "thinking_start": content[blockIndex] = { type: "thinking", thinking: "" }; break;
      case "text_delta":
      case "thinking_delta": {
        if (typeof update.delta !== "string") throw new Error("Invalid runtime text delta");
        const thinking = update.type === "thinking_delta";
        if (previous?.type !== (thinking ? "thinking" : "text")) throw new Error("Runtime delta has no matching content block");
        content[blockIndex] = thinking ? { ...previous, thinking: (previous.thinking ?? "") + update.delta } : { ...previous, text: (previous.text ?? "") + update.delta };
        break;
      }
      case "text_end":
      case "thinking_end": {
        if (typeof update.content !== "string") throw new Error("Invalid completed runtime text");
        content[blockIndex] = update.type === "text_end" ? { type: "text", text: update.content } : { type: "thinking", thinking: update.content };
        break;
      }
      case "toolcall_start":
        if (typeof update.id !== "string" || typeof update.toolName !== "string") throw new Error("Invalid runtime tool call");
        content[blockIndex] = { type: "toolCall", id: update.id, name: update.toolName }; break;
      case "toolcall_delta": return state; // Partial JSON arguments are not executable or authoritative.
      case "toolcall_end":
        if (!object(update.toolCall) || update.toolCall.type !== "toolCall") throw new Error("Invalid completed runtime tool call");
        content[blockIndex] = update.toolCall as unknown as ChatBlock; break;
      default: return compatibility(state, `message_update:${update.type}`);
    }
    return { ...state, messages: state.messages.map((item, position) => position === state.activeMessage ? { ...message, content } : item) };
  }
  if (type === "custom_message" || type === "entry_appended") {
    const entry = type === "entry_appended" ? (object(event.entry) ? event.entry : undefined) : event;
    if (entry && typeof entry.customType === "string" && entry.customType.startsWith("jouzu-flow") && entry.display !== false) {
      const text = (Array.isArray(entry.content) ? entry.content : [])
        .map(block => object(block) && block.type === "text" && typeof block.text === "string" ? block.text : "")
        .filter(Boolean)
        .join("\n");
      let kind: string | undefined;
      try { const parsed = JSON.parse(text); kind = object(parsed) && typeof parsed.kind === "string" ? parsed.kind : undefined; } catch { /* keep the raw text */ }
      if (text && kind) {
        const report = { kind, text, ...(typeof entry.timestamp === "number" ? { timestamp: entry.timestamp } : {}) };
        return { ...state, flowReports: [...state.flowReports, report].slice(-30) };
      }
    }
    if (type === "entry_appended") return state;
  }
  if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {    if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") throw new Error("Invalid runtime tool event");
    const prior = state.tools[event.toolCallId];
    if (type !== "tool_execution_start" && !prior) throw new Error("Runtime tool update has no matching start");
    const tool: ToolView = { id: event.toolCallId, name: event.toolName, args: event.args ?? prior?.args, phase: type === "tool_execution_end" ? event.isError === true ? "error" : "complete" : "running", result: type === "tool_execution_end" ? event.result : type === "tool_execution_update" ? event.partialResult : undefined };
    return { ...state, tools: { ...state.tools, [tool.id]: tool } };
  }
  if (passiveEvents.has(type)) return state;
  return compatibility(state, type);
}
