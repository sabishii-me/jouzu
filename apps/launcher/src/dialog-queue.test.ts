import { describe, expect, it } from "vitest";
import { beginDialogResponse, DIALOG_CAPACITY, emptyDialogQueue, enqueueDialog, expireDialogs, nextDialogDeadline, removeDialog } from "./dialog-queue";

const request = (id: string, timeout?: number) => ({ id, method: "input", timeout });
describe("dialog presentation queue", () => {
  it("expires queued dialogs from receipt, not first display", () => {
    let queue = enqueueDialog(emptyDialogQueue(), request("first"), 100).queue;
    queue = enqueueDialog(queue, request("second", 20), 110).queue;
    expect(nextDialogDeadline(queue)).toBe(130);
    queue = expireDialogs(queue, 130);
    expect(queue.items.map(item => item.id)).toEqual(["first"]);
    expect(removeDialog(queue, "first").items).toEqual([]);
  });
  it("cannot remove the next dialog when an old reply settles after expiration", () => {
    let queue = enqueueDialog(emptyDialogQueue(), request("first", 10), 0).queue;
    queue = enqueueDialog(queue, request("second"), 0).queue;
    queue = beginDialogResponse(queue, "first", { value: "hello" }, 5).queue;
    queue = expireDialogs(queue, 10);
    expect(removeDialog(queue, "first").items.map(item => item.id)).toEqual(["second"]);
  });
  it("deduplicates both queued and recently removed ids", () => {
    let queue = enqueueDialog(emptyDialogQueue(), request("same", 10), 0).queue;
    expect(enqueueDialog(queue, request("same", 200), 5).status).toBe("duplicate");
    expect(queue.items[0].deadline).toBe(10);
    queue = removeDialog(queue, "same");
    expect(enqueueDialog(queue, request("same"), 20).status).toBe("duplicate");
  });
  it("bounds pending presentation and recent id retention without evicting the head", () => {
    let queue = emptyDialogQueue();
    for (let i = 0; i < 200; i++) queue = enqueueDialog(queue, request(String(i)), 0).queue;
    expect(queue.items).toHaveLength(DIALOG_CAPACITY);
    expect(queue.items[0].id).toBe("0");
    expect(queue.recentIds.length).toBeLessThanOrEqual(128);
    const overflow = enqueueDialog(queue, request("extra"), 0);
    expect(overflow.status).toBe("full");
    expect(enqueueDialog(overflow.queue, request("extra"), 0).status).toBe("duplicate");
    expect(enqueueDialog(queue, request("0"), 0).status).toBe("duplicate");
  });
  it("claims only the displayed live dialog once", () => {
    let queue = enqueueDialog(emptyDialogQueue(), request("first", 10), 0).queue;
    queue = enqueueDialog(queue, request("second"), 0).queue;
    expect(beginDialogResponse(queue, "second", { value: "x" }, 0).response).toBeUndefined();
    const claimed = beginDialogResponse(queue, "first", { value: "x" }, 0);
    expect(claimed.response).toEqual({ value: "x" });
    expect(beginDialogResponse(claimed.queue, "first", { cancelled: true }, 0).response).toBeUndefined();
    expect(beginDialogResponse(queue, "first", { value: "x" }, 10).response).toBeUndefined();
  });
  it.each(["confirm", "select", "input", "editor"])("cancels %s without fabricating an answer", method => {
    const queue = enqueueDialog(emptyDialogQueue(), { id: "a", method }, 0).queue;
    expect(beginDialogResponse(queue, "a", { cancelled: true }, 0).response).toEqual({ cancelled: true });
  });
  it("validates method-specific responses and string options", () => {
    const queue = enqueueDialog(emptyDialogQueue(), { id: "a", method: "select", options: ["one", 2, "one"] }, 0).queue;
    expect(queue.items[0].options).toEqual(["one"]);
    expect(beginDialogResponse(queue, "a", { value: "other" }, 0).response).toBeUndefined();
    expect(beginDialogResponse(queue, "a", { confirmed: true }, 0).response).toBeUndefined();
    expect(beginDialogResponse(queue, "a", { value: "one" }, 0).response).toEqual({ value: "one" });
  });
  it("rejects malformed requests and immediately hides zero/negative timeouts", () => {
    expect(enqueueDialog(emptyDialogQueue(), { method: "input" }, 0).status).toBe("invalid");
    expect(enqueueDialog(emptyDialogQueue(), { id: "x", method: "notify" }, 0).status).toBe("invalid");
    for (const timeout of [0, -1]) expect(enqueueDialog(emptyDialogQueue(), request("x", timeout), 0).queue.items).toEqual([]);
    for (const timeout of [NaN, Infinity]) expect(enqueueDialog(emptyDialogQueue(), request("x", timeout), 0).queue.items[0].deadline).toBeNull();
  });
});
