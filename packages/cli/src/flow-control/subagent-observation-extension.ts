import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { notificationHash } from "../notifications/inbox.js";
import { nativeProjectionDelivered } from "./native-inclusion.js";
import { flowObservationOf } from "./observation.js";
import type { PiSessionFlowIngress } from "./pi-session-ingress.js";
import { FlowLedgerError } from "./receipt-ledger.js";

export const SUBAGENT_READ_RECEIPTS = "jouzu:subagent-read-receipts";
export const SUBAGENT_READ_RECEIPT = "jouzu-subagent-read-receipt";
export interface SubagentReadReceipt {
	toolCallId: string;
	contentHash: string;
	markerHash: string;
}
export const subagentReadReceiptKey = (receipt: SubagentReadReceipt): string =>
	JSON.stringify([receipt?.toolCallId, receipt?.contentHash, receipt?.markerHash]);
export interface SubagentReadReceiptRequest {
	sessionId: string;
	accept(receipts: Promise<SubagentReadReceipt[]>, assertActive: () => void): void;
}

/** Capture read projections without granting child execution or work authority. */
export function createSubagentObservationExtension(options: { ingress(): PiSessionFlowIngress }): InlineExtension {
	return {
		name: "jouzu-subagent-observation",
		factory(pi) {
			let close: (() => void) | undefined;
			const attach = (_event: unknown, active: ExtensionContext) => {
				close?.();
				const branch = options.ingress().branch();
				const registration = branch.controller.register({
					version: 1,
					namespace: "subagent-reads",
					async snapshot() {
						return [];
					},
					async build() {
						throw new FlowLedgerError("identity", "Read observations cannot schedule work.");
					},
					observationProjections(observations) {
						const entries = active.sessionManager.getBranch();
						const saved = new Set(
							entries.flatMap((entry) =>
								entry.type === "custom" && entry.customType === SUBAGENT_READ_RECEIPT
									? [subagentReadReceiptKey(entry.data as SubagentReadReceipt)]
									: [],
							),
						);
						const pending = new Set(
							entries.flatMap((entry) => {
								if (
									entry.type !== "message" ||
									entry.message.role !== "toolResult" ||
									entry.message.toolName !== "subagent" ||
									entry.message.isError
								)
									return [];
								const marker = (entry.message.details as { terminalRead?: { contentHash?: string } })?.terminalRead;
								if (!marker || marker.contentHash !== notificationHash(entry.message.content)) return [];
								const receipt = {
									toolCallId: entry.message.toolCallId,
									contentHash: marker.contentHash,
									markerHash: notificationHash(marker),
								};
								return saved.has(subagentReadReceiptKey(receipt))
									? []
									: [JSON.stringify([receipt.toolCallId, receipt.contentHash])];
							}),
						);
						return observations
							.filter(
								(value) =>
									value.kind === "toolResult" &&
									value.toolName === "subagent" &&
									!value.failed &&
									pending.has(JSON.stringify([value.toolCallId, value.contentHash])),
							)
							.map((value) => value.index);
					},
				});
				close = registration.dispose;
			};
			const unsubscribe = pi.events.on(SUBAGENT_READ_RECEIPTS, (data) => {
				const request = data as SubagentReadReceiptRequest;
				if (typeof request?.accept !== "function") return;
				const ingress = options.ingress();
				const branch = ingress.branch();
				const assertActive = () => {
					if (ingress.branch() !== branch) throw new FlowLedgerError("stale", "Child read observation branch changed.");
				};
				request.accept(
					(async () => {
						if (request.sessionId !== branch.scope.sessionId)
							throw new FlowLedgerError("scope", "Child read observations belong to another session.");
						const requests = await branch.attachment.nativeRequests.snapshot();
						assertActive();
						const receipts: SubagentReadReceipt[] = [];
						for (const native of requests) {
							if (native.outcome !== "success") continue;
							for (const projection of native.projectionCapture?.members ?? []) {
								const message = projection.message;
								if (
									message.role !== "toolResult" ||
									message.toolName !== "subagent" ||
									message.isError ||
									!nativeProjectionDelivered(native, projection.index)
								)
									continue;
								const marker = (message as unknown as { details?: { terminalRead?: unknown } }).details?.terminalRead;
								if (!marker) continue;
								receipts.push({
									toolCallId: message.toolCallId,
									contentHash: flowObservationOf(message).contentHash,
									markerHash: notificationHash(marker),
								});
							}
						}
						return receipts;
					})(),
					assertActive,
				);
			});
			pi.on("session_start", attach);
			pi.on("session_tree", attach);
			pi.on("session_shutdown", () => {
				close?.();
				close = undefined;
				unsubscribe();
			});
		},
	};
}
