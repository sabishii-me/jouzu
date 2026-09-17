import type { FlowAttempt, FlowMember } from "./receipt-ledger.js";

/** Facts from completed requests. Member indexes refer to the attempt's immutable membership. */
export interface FlowRequestSummary {
	count: number;
	containsUserInput: boolean;
	included: number[];
	succeeded: number[];
}

export const RECENT_FLOW_REQUESTS = 4;

export function hasFlowHandoff(attempt: FlowAttempt): boolean {
	return !!attempt.requestSummary?.count || attempt.requests.some((request) => request.handedOff);
}

export function hasFlowUserInput(attempt: FlowAttempt): boolean {
	return !!attempt.requestSummary?.containsUserInput || attempt.requests.some((request) => request.containsUserInput);
}

/** Successful inclusion is distinct from preparation, handoff, and overall attempt settlement. */
export function flowMemberIncluded(
	attempt: FlowAttempt,
	member: Pick<FlowMember, "id" | "revision">,
	successful = true,
): boolean {
	const index = attempt.members.findIndex((item) => item.id === member.id && item.revision === member.revision);
	if (index < 0) return false;
	if (attempt.requestSummary?.[successful ? "succeeded" : "included"].includes(index)) return true;
	return attempt.requests.some(
		(request) =>
			(!successful || (request.handedOff && request.outcome === "success")) &&
			request.inclusion.some(
				(item) =>
					item.id === member.id &&
					item.revision === member.revision &&
					item.disposition === "included" &&
					item.contentHash === attempt.members[index].contentHash,
			),
	);
}

/** Fold only known outcomes; leave unknown handoffs and the recent lifecycle records addressable. */
export function consolidateFlowRequests(attempt: FlowAttempt): void {
	const cutoff = attempt.requests.length - RECENT_FLOW_REQUESTS;
	if (cutoff <= 0) return;
	const retiring = attempt.requests
		.slice(0, cutoff)
		.filter((request) => request.handedOff && request.outcome !== undefined);
	if (!retiring.length) return;
	const summary = attempt.requestSummary ?? { count: 0, containsUserInput: false, included: [], succeeded: [] };
	const included = new Set(summary.included);
	const succeeded = new Set(summary.succeeded);
	const indexes = new Map(
		attempt.members.map((member, index) => [JSON.stringify([member.id, member.revision]), index]),
	);
	for (const request of retiring) {
		summary.count++;
		summary.containsUserInput ||= request.containsUserInput;
		for (const item of request.inclusion) {
			if (item.disposition !== "included") continue;
			const index = indexes.get(JSON.stringify([item.id, item.revision]));
			if (index === undefined) throw new Error("Unknown summarized flow member.");
			included.add(index);
			if (request.outcome === "success") succeeded.add(index);
		}
	}
	summary.included = [...included].sort((a, b) => a - b);
	summary.succeeded = [...succeeded].sort((a, b) => a - b);
	attempt.requestSummary = summary;
	const removed = new Set(retiring);
	attempt.requests = attempt.requests.filter((request) => !removed.has(request));
}

export function validateFlowRequestSummary(attempt: FlowAttempt): void {
	const summary = attempt.requestSummary;
	if (summary === undefined) return;
	const indexes = (items: number[]) =>
		Array.isArray(items) &&
		new Set(items).size === items.length &&
		items.every((index) => Number.isSafeInteger(index) && index >= 0 && index < attempt.members.length);
	if (
		!summary ||
		!Number.isSafeInteger(summary.count) ||
		summary.count < 1 ||
		typeof summary.containsUserInput !== "boolean" ||
		!indexes(summary.included) ||
		!indexes(summary.succeeded) ||
		summary.succeeded.some((index) => !summary.included.includes(index))
	)
		throw new Error("Invalid completed flow request summary.");
}
