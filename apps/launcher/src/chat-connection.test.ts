import { describe, expect, it, vi, afterEach } from "vitest";
import { ChatConnection } from "./chat-connection";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
describe("desktop RPC connection", () => {
  it("forwards image content once and preserves caller data on rejection", async () => {
    const client = new ChatConnection(() => {}, () => {});
    const image = { type: "image" as const, mimeType: "image/png" as const, data: "aGVsbG8=" };
    const images = Object.freeze([Object.freeze(image)]);
    const request = vi.spyOn(client, "request").mockRejectedValue(new Error("rejected"));
    await expect(client.send("Inspect", images)).rejects.toThrow("rejected");
    expect(request).toHaveBeenCalledExactlyOnceWith("prompt", { message: "Inspect", images });
    expect(images[0]).toEqual(image);
    expect(client.snapshot.pending).toBe(false);
  });
  it("waits out a cold released-runtime startup beyond the command deadline", async () => {
    vi.useFakeTimers();
    const requests: Record<string, unknown>[] = [];
    const replied = new Set<unknown>();
    const startedAt = Date.now();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "chat_start") return "cold" as never;
      if (command === "chat_send") { requests.push((args as { request: Record<string, unknown> }).request); return undefined as never; }
      if (command === "chat_poll") {
        // The released runtime answers its first request only after a long cold start.
        if (Date.now() - startedAt < 60_000) return { records: [], closed: false } as never;
        const request = requests.find(request => ["get_state", "get_messages"].includes(String(request.type)) && !replied.has(request.id));
        if (request) { replied.add(request.id); return { records: [{ type: "response", id: request.id, command: request.type, success: true, data: request.type === "get_state" ? { sessionId: "cold-id", isStreaming: false } : { messages: [] } }], closed: false } as never; }
        return { records: [], closed: false } as never;
      }
      return undefined as never;
    });
    const client = new ChatConnection(() => {}, () => {});
    const starting = client.start("folder");
    await vi.advanceTimersByTimeAsync(61_000);
    await starting;
    expect(client.snapshot.connected).toBe(true);
    expect(client.snapshot.error).toBeNull();
    await client.close();
  });
  it("registers polling before state handshake and never replays after timeout", async () => {
    vi.useFakeTimers();
    const requests: Record<string, unknown>[] = [];
    const replied = new Set<unknown>();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "chat_start") return "h" as never;
      if (command === "chat_send") { requests.push((args as { request: Record<string, unknown> }).request); return undefined as never; }
      if (command === "chat_poll") {
        const request = requests.find(request => ["get_state", "get_messages"].includes(String(request.type)) && !replied.has(request.id));
        if (request) { replied.add(request.id); return { records: [{ type: "response", id: request.id, command: request.type, success: true, data: request.type === "get_state" ? { sessionId: "runtime-id", isStreaming: false } : { messages: [] } }], closed: false } as never; }
        return { records: [], closed: false } as never;
      }
      return undefined as never;
    });
    const client = new ChatConnection(() => {}, () => {});
    const starting = client.start("folder");
    await vi.advanceTimersByTimeAsync(100);
    await starting;
    expect(client.snapshot.connected).toBe(true);
    const sending = client.send("one prompt").catch(error => error);
    await vi.advanceTimersByTimeAsync(31000);
    expect(await sending).toBeInstanceOf(Error);
    expect(client.snapshot.connected).toBe(false);
    expect(requests.filter(request => request.type === "prompt")).toHaveLength(1);
    await client.close();
  });
  it("keeps startup dialogs answerable without timing out human interaction", async () => {
    vi.useFakeTimers();
    const requests: Record<string, unknown>[] = [];
    let emitted = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "chat_start") return "startup" as never;
      if (command === "chat_send") { requests.push((args as { request: Record<string, unknown> }).request); return undefined as never; }
      if (command === "chat_poll") {
        if (!emitted) { emitted = true; return { records: [{ type: "extension_ui_request", id: "confirm-start", method: "confirm", title: "Continue?" }], closed: false } as never; }
        return { records: [], closed: false } as never;
      }
      return undefined as never;
    });
    const client = new ChatConnection(() => {}, () => {});
    const starting = client.start("folder");
    await vi.advanceTimersByTimeAsync(45000);
    expect(client.snapshot.transportReady).toBe(true);
    expect(client.snapshot.connected).toBe(false);
    expect(client.snapshot.error).toBeNull();
    await client.reply("confirm-start", { confirmed: false });
    expect(requests.some(request => request.type === "extension_ui_response")).toBe(true);
    await client.close();
    await starting;
  });
  it("keeps history when session switching is cancelled and refreshes after success", async () => {
    const client = new ChatConnection(() => {}, () => {});
    client.snapshot = { ...client.snapshot, connected: true };
    const request = vi.spyOn(client, "request");
    request.mockResolvedValueOnce({ cancelled: true });
    await expect(client.resumeSession("C:\\sessions\\saved.jsonl")).rejects.toThrow("cancelled");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ cancelled: false }).mockResolvedValueOnce({ sessionId: "saved", sessionFile: "saved.jsonl", isStreaming: false }).mockResolvedValueOnce({ messages: [{ role: "user", content: "saved prompt" }] });
    await client.newSession();
    expect(client.snapshot.sessionId).toBe("saved");
    expect(client.snapshot.projection.messages[0].content[0].text).toBe("saved prompt");
    expect(client.snapshot.pending).toBe(false);
  });
  it("rejects replies after disposal", async () => {
    const client = new ChatConnection(() => {}, () => {});
    await client.close();
    await expect(client.reply("dialog", { confirmed: true })).rejects.toThrow("not connected");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("closes a late startup after view disposal", async () => {
    let finish!: (value: string) => void;
    vi.mocked(invoke).mockImplementation(command => command === "chat_start" ? new Promise(resolve => { finish = resolve as (value: string) => void; }) : Promise.resolve(undefined as never));
    const client = new ChatConnection(() => {}, () => {});
    const starting = client.start("folder");
    await client.close(); finish("late"); await starting;
    expect(invoke).toHaveBeenCalledWith("chat_stop", { handle: "late" });
    expect(invoke).not.toHaveBeenCalledWith("chat_poll", expect.anything());
  });
});
