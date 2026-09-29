import { randomUUID } from "node:crypto";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { COMPACTION_CONTINUE_TEXT, COMPACTION_FLOW_EVENT, type CompactionFlowRequest } from "../compaction-request.js";
import type { FlowIntent } from "./admission.js";
import { retainAutomaticWork } from "./automatic-work.js";
import type { PiSessionFlowIngress } from "./pi-session-ingress.js";
import { FlowLedgerError } from "./receipt-ledger.js";

/** Give a requested compaction's continuation host work without trusting custom-message labels. */
export function createCompactionControllerExtension(options: {
	ingress(): PiSessionFlowIngress;
	enabled(): boolean;
	onError(error: unknown): void;
}): InlineExtension {
	let close: (() => void) | undefined;
	let unsubscribe: (() => void) | undefined;
	return {
		name: "jouzu-compaction-controller",
		factory(pi) {
			unsubscribe?.();
			unsubscribe = pi.events.on(COMPACTION_FLOW_EVENT, (data) => {
				if (!options.enabled()) return;
				const request = data as CompactionFlowRequest;
				const ingress = options.ingress();
				const branch = ingress.branch();
				if (!branch.workContext.current())
					throw new FlowLedgerError("identity", "Compaction continuation requires current owning work.");
				// Only the model-callable request asks for this callback, while its tool authority is live.
				// The callback is released after compaction; it never adopts a user or campaign identity.
				request.resume = async () => {
					if (options.ingress() !== ingress || ingress.branch() !== branch)
						throw new FlowLedgerError("stale", "Compaction continuation belongs to another session branch.");
					if (!options.enabled()) return false;
					const work = await retainAutomaticWork(branch.attachment);
					if (options.ingress() !== ingress || ingress.branch() !== branch)
						throw new FlowLedgerError("stale", "Compaction continuation branch changed during preparation.");
					close?.();
					const id = `compaction:${randomUUID()}`;
					const intent: FlowIntent = {
						id,
						revision: "1",
						producer: "host-automatic",
						sequence: 0,
						rank: 4,
						workId: work.id,
						workRevision: `${work.revision}:${id}`,
						independent: false,
						runnable: true,
					};
					const registration = branch.controller.register(
						{
							version: 1,
							namespace: intent.producer,
							async snapshot() {
								return [{ ...intent }];
							},
							async build() {
								return { id: intent.id, revision: intent.revision, kind: "work", text: COMPACTION_CONTINUE_TEXT };
							},
						},
						async () => ingress.requestRelease(),
					);
					close = () => registration.dispose();
					void registration.changed().catch(options.onError);
					return true;
				};
			});
			pi.on("session_shutdown", async () => {
				close?.();
				close = undefined;
			});
		},
	};
}
