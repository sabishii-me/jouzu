import type { WireObject } from "./chat-projection";

export const DIALOG_CAPACITY = 32;
const RECENT_ID_CAPACITY = 128;
export type DialogMethod = "select" | "confirm" | "input" | "editor";
export interface PresentationDialog {
  id: string;
  method: DialogMethod;
  title: string;
  message?: string;
  prefill: string;
  options: readonly string[];
  deadline: number | null;
  responding: boolean;
}
export interface DialogQueue { readonly items: readonly PresentationDialog[]; readonly recentIds: readonly string[] }
export type DialogAnswer = { cancelled: true } | { confirmed: boolean } | { value: string };
export const emptyDialogQueue = (): DialogQueue => ({ items: [], recentIds: [] });

// Presentation only: deadlines hide stale UI, never complete runtime requests.
export function expireDialogs(queue: DialogQueue, now: number): DialogQueue {
  const items = queue.items.filter(item => item.deadline === null || item.deadline > now);
  return items.length === queue.items.length ? queue : { ...queue, items };
}
export function removeDialog(queue: DialogQueue, id: string): DialogQueue {
  return { ...queue, items: queue.items.filter(item => item.id !== id) };
}
export function enqueueDialog(queue: DialogQueue, request: WireObject, receivedAt: number): { queue: DialogQueue; status: "accepted" | "duplicate" | "full" | "invalid" } {
  queue = expireDialogs(queue, receivedAt);
  if (typeof request.id !== "string" || !request.id || !["select", "confirm", "input", "editor"].includes(String(request.method))) return { queue, status: "invalid" };
  if (queue.recentIds.includes(request.id) || queue.items.some(item => item.id === request.id)) return { queue, status: "duplicate" };
  queue = { ...queue, recentIds: [...queue.recentIds, request.id].slice(-RECENT_ID_CAPACITY) };
  if (queue.items.length >= DIALOG_CAPACITY) return { queue, status: "full" };
  const deadline = typeof request.timeout === "number" && Number.isFinite(request.timeout) ? receivedAt + Math.max(0, request.timeout) : null;
  const item: PresentationDialog = {
    id: request.id, method: request.method as DialogMethod,
    title: typeof request.title === "string" ? request.title : "Jouzu request",
    message: typeof request.message === "string" ? request.message : undefined,
    prefill: typeof request.prefill === "string" ? request.prefill : "",
    options: Array.isArray(request.options) ? [...new Set(request.options.filter((option): option is string => typeof option === "string"))] : [],
    deadline, responding: false,
  };
  return { queue: expireDialogs({ ...queue, items: [...queue.items, item] }, receivedAt), status: "accepted" };
}
export function beginDialogResponse(queue: DialogQueue, id: string, answer: DialogAnswer, now: number): { queue: DialogQueue; response?: DialogAnswer } {
  queue = expireDialogs(queue, now);
  const item = queue.items[0];
  if (!item || item.id !== id || item.responding) return { queue };
  let response: DialogAnswer;
  if ("cancelled" in answer) response = { cancelled: true };
  else if (item.method === "confirm" && "confirmed" in answer) response = { confirmed: answer.confirmed };
  else if (item.method !== "confirm" && "value" in answer && (item.method !== "select" || item.options.includes(answer.value))) response = { value: answer.value };
  else return { queue };
  return { queue: { ...queue, items: queue.items.map(entry => entry.id === id ? { ...entry, responding: true } : entry) }, response };
}
export function nextDialogDeadline(queue: DialogQueue): number | null {
  const deadlines = queue.items.flatMap(item => item.deadline === null ? [] : [item.deadline]);
  return deadlines.length ? Math.min(...deadlines) : null;
}
