import { describe, expect, it } from "vitest";
import { emptyProjection, historyProjection, projectEvent } from "./chat-projection";

describe("released runtime event projection", () => {
  it("resets populated start blocks before applying released wire deltas", () => {
    let state = projectEvent(emptyProjection(), { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "fast response" }], stopReason: "pending" } });
    state = projectEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
    state = projectEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "fast response" } });
    expect(state.messages[0].content[0].text).toBe("fast response");
  });
  it("waits for agent_settled rather than low-level agent_end", () => {
    let state = projectEvent(emptyProjection(), { type: "agent_start" });
    state = projectEvent(state, { type: "agent_end", willRetry: false });
    expect(state.running).toBe(true);
    expect(projectEvent(state, { type: "agent_settled" }).running).toBe(false);
  });
  it("reconstructs deltas and replaces them with authoritative final content", () => {
    let state = projectEvent(emptyProjection(), { type: "message_start", message: { role: "assistant", content: [] } });
    for (const update of [
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "draft" },
      { type: "text_end", contentIndex: 0, content: "final block" },
    ]) state = projectEvent(state, { type: "message_update", assistantMessageEvent: update });
    expect(state.messages[0].content[0].text).toBe("final block");
    state = projectEvent(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "authoritative" }] } });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content[0].text).toBe("authoritative");
  });
  it("does not duplicate user start/end or invent optimistic history", () => {
    let state = emptyProjection();
    const message = { role: "user", content: "hello" };
    state = projectEvent(state, { type: "message_start", message });
    state = projectEvent(state, { type: "message_end", message });
    expect(state.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
  });
  it("keeps displayed Jouzu flow reports as structured session activity", () => {
    const state = projectEvent(emptyProjection(), {
      type: "custom_message",
      customType: "jouzu-flow",
      display: true,
      timestamp: 123,
      content: [{ type: "text", text: JSON.stringify({ kind: "work", content: "Continue task #1" }) }],
    });
    expect(state.flowReports).toEqual([{ kind: "work", text: JSON.stringify({ kind: "work", content: "Continue task #1" }), timestamp: 123 }]);
    const appended = projectEvent(emptyProjection(), { type: "entry_appended", entry: { type: "custom_message", customType: "jouzu-flow", display: true, timestamp: 456, content: [{ type: "text", text: JSON.stringify({ kind: "alert", content: "Paused" }) }] } });
    expect(appended.flowReports).toEqual([{ kind: "alert", text: JSON.stringify({ kind: "alert", content: "Paused" }), timestamp: 456 }]);
    expect(projectEvent(state, { type: "custom_message", customType: "other", content: [] }).flowReports).toHaveLength(1);
  });
  it("reconstructs tool cards and task state from resumed history", () => {
    const state = historyProjection([
      { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "TaskCreateMany", arguments: { tasks: [{ subject: "A" }] } }] },
      { role: "toolResult", toolCallId: "t1", toolName: "TaskCreateMany", content: [{ type: "text", text: "Created 1 task:\n  #1 A" }], isError: false },
    ]);
    expect(state.tools.t1).toMatchObject({ name: "TaskCreateMany", phase: "complete", args: { tasks: [{ subject: "A" }] } });
    expect(state.tools.t1.result).toEqual({ content: [{ type: "text", text: "Created 1 task:\n  #1 A" }] });
  });
  it("correlates tool lifecycle without promoting partial output to completion", () => {    let state = projectEvent(emptyProjection(), { type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "file" } });
    state = projectEvent(state, { type: "tool_execution_update", toolCallId: "a", toolName: "read", partialResult: { content: [] } });
    expect(state.tools.a.phase).toBe("running");
    state = projectEvent(state, { type: "tool_execution_end", toolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "done" }] }, isError: true });
    expect(state.tools.a.phase).toBe("error");
    expect(state.tools.a.args).toEqual({ path: "file" });
  });
  it("retains unknown event names without inferring outcomes", () => {
    const state = projectEvent({ ...emptyProjection(), running: true }, { type: "future_event", text: "completed successfully" });
    expect(state.running).toBe(true);
    expect(state.compatibility).toEqual(["future_event"]);
  });
  it("rejects invalid history, orphan deltas and unbounded sparse indices", () => {
    expect(() => historyProjection({})).toThrow();
    expect(() => historyProjection([{ role: "assistant", content: 3 }])).toThrow();
    expect(() => projectEvent(emptyProjection(), { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "orphan" } })).toThrow();
    const state = projectEvent(emptyProjection(), { type: "message_start", message: { role: "assistant", content: [] } });
    expect(() => projectEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1000000 } })).toThrow();
  });
});
