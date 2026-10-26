import { randomUUID } from "node:crypto";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ContentReview } from "./textguard-admission.js";
import type { TextGuardMode } from "./textguard-policy.js";
import type { TextGuardRuntime } from "./textguard-runtime.js";

const PREFIX = "JOUZU_TEXTGUARD ";
const TICKET_MS = 5 * 60_000;

type Ticket = { sessionId: string; reviewId: string; withheld: boolean; expires: number; used: boolean };

/** Desktop-only inspection and explicit, ticket-gated decisions. No dialogs are opened. */
export function createTextGuardDesktopExtension(
	runtime: TextGuardRuntime,
	options: { enabled: boolean },
): ExtensionFactory {
	const tickets = new Map<string, Ticket>();
	return (pi) => {
		if (!options.enabled) return;
		pi.registerCommand("textguard-desktop", {
			description: "Desktop TextGuard panel",
			handler: async (args, ctx) => {
				if (ctx.mode !== "rpc" || !ctx.hasUI) return;
				const policy = runtime.forSession(ctx.sessionManager.getSessionId());
				if (!policy) return reply(ctx, { ok: false, error: "TextGuard is unavailable for this session." });
				let request: { action?: unknown; id?: unknown; ticket?: unknown; mode?: unknown; persist?: unknown };
				try {
					request = JSON.parse(args.trim() || "{}") as typeof request;
				} catch {
					return reply(ctx, { ok: false, error: "Invalid TextGuard request." });
				}
				const sessionId = ctx.sessionManager.getSessionId();
				if (request.action === "inspect") {
					const pending = policy.reviews();
					const pendingIds = new Set(pending.map((item) => item.id));
					const reports = policy.scanReports().filter((item) => !pendingIds.has(item.id));
					const items = [
						...pending.map((review) => ({ review, withheld: true })),
						...reports.map((review) => ({ review, withheld: false })),
					].map(({ review, withheld }) => {
						const ticket = randomUUID();
						tickets.set(ticket, {
							sessionId,
							reviewId: review.id,
							withheld,
							expires: Date.now() + TICKET_MS,
							used: false,
						});
						return {
							id: review.id,
							withheld,
							ticket,
							source: review.displaySource,
							digest: review.contentDigest,
							severity: severity(review),
							review: details(review),
							snapshot: policy.contentSnapshot(review),
						};
					});
					return reply(ctx, { ok: true, action: "inspect", sessionId, mode: policy.currentMode(), items });
				}
				if (request.action === "mode") {
					const mode = request.mode === "on" ? "guarded" : request.mode;
					if (!["guarded", "strict", "off"].includes(String(mode)))
						return reply(ctx, { ok: false, error: "Invalid TextGuard mode." });
					if (!runtime.setMode(mode as TextGuardMode))
						return reply(ctx, { ok: true, action: "mode", changed: false, mode: policy.currentMode() });
					reply(ctx, { ok: true, action: "mode", changed: true, mode: mode as TextGuardMode });
					try {
						await ctx.reload();
					} catch {
						/* A failed reload is visible on the next inspect. */
					}
					return;
				}
				if (request.action !== "approve" && request.action !== "dismiss")
					return reply(ctx, { ok: false, error: "Unsupported TextGuard action." });
				if (typeof request.ticket !== "string" || typeof request.id !== "string")
					return reply(ctx, { ok: false, error: "Missing TextGuard ticket." });
				const ticket = tickets.get(request.ticket);
				if (
					!ticket ||
					ticket.used ||
					ticket.expires <= Date.now() ||
					ticket.sessionId !== sessionId ||
					ticket.reviewId !== request.id
				) {
					return reply(ctx, { ok: false, error: "This TextGuard review expired. Refresh the panel." });
				}
				ticket.used = true;
				if (request.action === "dismiss") {
					if (ticket.withheld) return reply(ctx, { ok: false, error: "Withheld content cannot be dismissed." });
					policy.dismissReport(request.id);
					return reply(ctx, { ok: true, action: "dismiss" });
				}
				if (!runtime.approve(policy, request.id, request.persist === true))
					return reply(ctx, { ok: false, error: "This TextGuard review expired." });
				reply(ctx, { ok: true, action: "approve", reloaded: true });
				try {
					await ctx.reload();
				} catch {
					/* The approval is durable; the next inspect reports the current state. */
				}
				return;
			},
		});
	};
}

function reply(ctx: ExtensionContext, payload: Record<string, unknown>) {
	ctx.ui.notify(`${PREFIX}${JSON.stringify(payload)}`, payload.ok === false ? "warning" : "info");
}
function severity(review: ContentReview) {
	if (review.evidence.status === "unavailable") return "incomplete check";
	const counts = review.evidence.severityCounts;
	return `${counts?.error ?? 0} error, ${counts?.warn ?? 0} warning, ${counts?.info ?? 0} info`;
}
function details(review: ContentReview) {
	return {
		source: review.displaySource,
		digest: review.contentDigest,
		scanner: review.scannerIdentity,
		status: review.evidence.status,
		severity: review.evidence.severityCounts,
		reason: review.evidence.reason,
		findings: review.evidence.findings,
	};
}
