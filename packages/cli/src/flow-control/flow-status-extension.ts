import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type FlowUnaccountableWork, formatFlowStatus, projectFlowStatus } from "./flow-status.js";
import type { PiSessionFlowIngress } from "./pi-session-ingress.js";
import { FlowLedgerError } from "./receipt-ledger.js";

export interface FlowStatusOptions {
	ingress(): PiSessionFlowIngress;
	/** Work a loaded producer still names that this session holds no authority for. */
	unaccountable?(): FlowUnaccountableWork[];
	now?(): number;
}

const USAGE = [
	"/flow shows what session flow control is holding.",
	"/flow retry <request> authorizes one withheld request.",
	"/flow cancel <token> removes a wait's dependency gate without stopping its job.",
	"/flow pause holds every automated turn in this session; /flow resume releases it.",
	"/flow pause <work> holds one campaign's automated turns; /flow resume <work> releases it.",
	"/flow stop <work> retires a campaign and ends its waits. None of these stop a running job.",
	"/flow resolve <attempt> retry|discard decides an interrupted turn whose outcome is unknown.",
	"/flow reset (or /flow clear) releases a stuck reservation without stopping jobs or deleting receipts.",
].join("\n");

const truncate = (text: string, max: number): string => {
	const first = text.split("\n")[0] ?? text;
	return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};
const shortRef = (reference: unknown): string =>
	typeof reference === "string" ? reference.replace(/^flow-results:/, "").slice(0, 12) : "?";

interface FlowTheme {
	fg(color: string, text: string): string;
}

interface FlowPart {
	flowInput?: unknown[];
	kind?: string;
	content?: unknown;
}

/** One transcript line group per composed member; expansion shows the exact envelope. */
function renderFlowPart(parsed: FlowPart, lines: string[], theme: FlowTheme): void {
	let content = parsed.content;
	if (typeof content === "string") {
		// Pre-single-serialization sessions stored a stringified envelope here.
		try {
			const inner: unknown = JSON.parse(content);
			if (inner && typeof inner === "object" && !Array.isArray(inner)) content = inner;
		} catch {
			/* Prose stays prose. */
		}
	}
	if (parsed.kind === "wait" && content && typeof content === "object" && "wait" in content) {
		const wait = (content as { wait: Record<string, unknown> }).wait;
		const state = String(wait.state ?? "unknown");
		const observations = Array.isArray(wait.observations) ? wait.observations : [];
		const satisfied = observations.filter((item) => (item as { state?: string })?.state === "satisfied").length;
		const mark =
			state === "resolved"
				? theme.fg("success", "✓ wait resolved")
				: state === "expired"
					? theme.fg("warning", "⏱ wait expired")
					: theme.fg("warning", `⏳ wait ${state}`);
		lines.push(
			observations.length
				? `${mark}${theme.fg("muted", ` — ${satisfied}/${observations.length} dependencies satisfied`)}`
				: mark,
		);
		if (typeof wait.reason === "string" && wait.reason) lines.push(theme.fg("dim", truncate(wait.reason, 120)));
		for (const item of observations) {
			const observation = item as {
				handle?: string;
				producer?: string;
				until?: string;
				health?: string;
				state?: string;
			};
			lines.push(
				theme.fg(
					"dim",
					`  · ${observation.handle ?? "?"} (${observation.producer ?? "?"}/${observation.until ?? "?"})${observation.health ? ` · ${observation.health}` : ""}${observation.state ? ` · ${observation.state}` : ""}`,
				),
			);
		}
		return;
	}
	if (parsed.kind === "result" && content && typeof content === "object") {
		const envelope = content as {
			total?: number;
			counts?: { success?: number; failure?: number; cancelled?: number };
			manifest?: string;
			sample?: { status?: string; title?: string; id?: string }[];
			omitted?: number;
			noReply?: unknown;
		};
		const counts = envelope.counts ?? {};
		const head = [
			theme.fg("accent", `◆ ${envelope.total ?? "?"} result${envelope.total === 1 ? "" : "s"}`),
			theme.fg("success", `✓${counts.success ?? 0}`),
			counts.failure ? theme.fg("error", `✗${counts.failure}`) : undefined,
			counts.cancelled ? theme.fg("warning", `⊘${counts.cancelled}`) : undefined,
		].filter((item): item is string => Boolean(item));
		lines.push(head.join(theme.fg("dim", " · ")));
		for (const sample of (envelope.sample ?? []).slice(0, 4)) {
			const ok = sample.status === "success";
			lines.push(
				`  ${theme.fg(ok ? "success" : "error", ok ? "✓" : "✗")} ${truncate(String(sample.title ?? sample.id ?? "?"), 100)}`,
			);
		}
		if (envelope.omitted)
			lines.push(theme.fg("dim", `  +${envelope.omitted} omitted · manifest ${shortRef(envelope.manifest)}`));
		else if (envelope.manifest) lines.push(theme.fg("dim", `  manifest ${shortRef(envelope.manifest)}`));
		if (envelope.noReply) lines.push(theme.fg("dim", "  notification only — no reply owed"));
		return;
	}
	if (parsed.kind === "work" && typeof content === "string") {
		const [first, ...rest] = content.split("\n");
		lines.push(`${theme.fg("accent", "▶ work")} ${truncate(first, 120)}`);
		if (rest.length) lines.push(theme.fg("dim", truncate(rest.join("\n"), 200)));
		return;
	}
	if (parsed.kind === "alert" && typeof content === "string") {
		lines.push(`${theme.fg("warning", "⚠ alert")} ${truncate(content, 160)}`);
		return;
	}
	lines.push(typeof content === "string" ? content : JSON.stringify(content));
}

/**
 * The user's view of and controls over held work. Every reply goes to the terminal through
 * `ctx.ui.notify`, so reading status or repairing a hold adds nothing to the model's context.
 */
export function createFlowStatusExtension(options: FlowStatusOptions): InlineExtension & {
	announcePause(): Promise<void>;
} {
	const now = () => options.now?.() ?? Date.now();
	let announce: ((text: string) => void) | undefined;
	return {
		name: "jouzu-flow-status",
		/**
		 * Report an interrupt's hold once, and only when it is actually holding something. Saying
		 * nothing when the queue is empty keeps the ordinary interrupt silent, which is almost all of
		 * them; the message only appears when it explains automated work that has stopped.
		 */
		async announcePause() {
			const reason = options.ingress().automatedPause();
			if (!reason || !announce) return;
			const inspected = await options.ingress().inspect();
			const holding = inspected.submissions.some((submission) => submission.admission === "held");
			if (!holding) return;
			announce(
				"Flow control paused after an interrupt. Automated work resumes on your next message. Run /flow for details.",
			);
		},
		factory(pi) {
			pi.registerMessageRenderer("jouzu-flow", (message, { expanded, outputPad }, theme) => {
				const lines: string[] = [];
				const parts = Array.isArray(message.content)
					? message.content
					: [{ type: "text" as const, text: String(message.content ?? "") }];
				for (const part of parts) {
					if (part.type !== "text") continue;
					let parsed: FlowPart;
					try {
						parsed = JSON.parse(part.text) as FlowPart;
					} catch {
						lines.push(part.text);
						continue;
					}
					if (!parsed || parsed.flowInput?.[0] !== "jouzu-flow") {
						lines.push(part.text);
						continue;
					}
					renderFlowPart(parsed, lines, theme);
					if (expanded) lines.push(theme.fg("dim", part.text));
				}
				return new Text(lines.join("\n"), outputPad, 0);
			});
			pi.on("agent_end", async (_event, ctx) => {
				// Kept fresh here rather than captured at load: the context is replaced with the session.
				if (ctx) announce = (text) => ctx.ui.notify(text, "info");
			});
			pi.registerCommand("flow", {
				description: "Show held, withheld, and waiting flow-control work, and repair a hold",
				handler: async (args, ctx) => {
					const [verb, target, choice, ...rest] = args.trim().split(/\s+/).filter(Boolean);
					const notify = (text: string, level: "info" | "error" = "info") => ctx.ui.notify(text, level);
					try {
						const ingress = options.ingress();
						if (verb === undefined) {
							const inspected = await ingress.inspect();
							const branch = ingress.branch();
							const [waits, authority] = await Promise.all([
								branch.attachment.waits.snapshot(),
								branch.attachment.waits.authoritySnapshot(),
							]);
							notify(
								formatFlowStatus(
									projectFlowStatus(
										inspected.scope,
										inspected.submissions,
										waits,
										authority.work,
										options.unaccountable?.() ?? [],
										inspected.uncertain,
										ingress.automatedPause(),
									),
									now(),
								),
							);
							return;
						}
						if (verb === "resolve") {
							if (rest.length || !target || (choice !== "retry" && choice !== "discard")) {
								notify(USAGE, "error");
								return;
							}
							try {
								await ingress.resolveUncertainAttempt(target, choice);
							} catch (error) {
								if (!(error instanceof FlowLedgerError) || error.code !== "identity") throw error;
								notify(`No interrupted turn ${target} is waiting for a decision. Run /flow to list them.`, "error");
								return;
							}
							notify(
								choice === "retry"
									? `Resolved ${target} as undelivered. Its work is eligible again and may repeat a turn the provider already answered.`
									: `Resolved ${target} as spent. Its work will not run again for this attempt.`,
							);
							return;
						}
						if (verb === "reset" || verb === "clear") {
							if (rest.length || choice || target) {
								notify(USAGE, "error");
								return;
							}
							let result: Awaited<ReturnType<PiSessionFlowIngress["resetFlow"]>>;
							try {
								result = await ingress.resetFlow();
							} catch (error) {
								if (error instanceof FlowLedgerError && error.code === "busy") {
									notify(
										"Flow reset needs an idle session. Interrupt the running turn, then run /flow reset again.",
										"error",
									);
									return;
								}
								throw error;
							}
							if (result.kind === "inactive") {
								notify("Flow reset completed. No active reservation was found; continue with a new message.");
							} else {
								notify(
									`Cleared flow reservation ${result.attemptId}. Jobs, waits, and receipt history were left unchanged.`,
								);
							}
							return;
						}
						if (rest.length || choice || !target) {
							notify(USAGE, "error");
							return;
						}
						if (verb === "retry") {
							const inspected = await ingress.inspect();
							const status = projectFlowStatus(inspected.scope, inspected.submissions, [], []);
							const request = status.retryable.find((item) => item.requestId === target);
							if (!request) {
								notify(`No withheld request ${target} is waiting for a retry. Run /flow to list them.`, "error");
								return;
							}
							// The hash is the evidence the store requires, so a retry cannot land on changed input.
							await ingress.retryNativeRequest(request.requestId, request.hash);
							notify(`Authorized a retry of ${request.requestId}. Its input is admitted again before it is sent.`);
							return;
						}
						if (verb === "cancel") {
							await ingress.cancelWait(target, "Cancelled from /flow.");
							notify(`Cancelled wait ${target}. Its job keeps running and its work stays open.`);
							return;
						}
						// Lifecycle controls name the work, not its owner: the producer that owns a campaign
						// is looked up, so a user cannot act on work by guessing whose it is.
						if ((verb === "pause" || verb === "resume") && !target) {
							if (verb === "pause") {
								notify(
									ingress.pauseAutomated("held from /flow")
										? "Paused every automated turn in this session. Release it with /flow resume."
										: `Already paused: ${ingress.automatedPause()}. Release it with /flow resume.`,
								);
								return;
							}
							if (!ingress.resumeAutomated()) {
								notify("Automated turns are not paused for this session.");
								return;
							}
							// Releasing only lifts the gate; the ordinary boundary decides when work runs.
							await ingress.releaseReady();
							notify("Resumed automated turns. They run from the next idle boundary.");
							return;
						}
						const lifecycle = { pause: "paused", resume: "active", stop: "stopped" } as const;
						if (verb in lifecycle) {
							const status = lifecycle[verb as keyof typeof lifecycle];
							try {
								await ingress.changeWorkStatus(target, status, `Set ${status} from /flow.`);
							} catch (error) {
								// An unknown identity is a discovery problem, so answer it with where the ids are.
								if (!(error instanceof FlowLedgerError) || error.code !== "identity") throw error;
								notify(`No registered work ${target}. Run /flow to list active work.`, "error");
								return;
							}
							notify(
								status === "stopped"
									? `Stopped ${target}. Its waits are cancelled and no further automated turn runs for it. Any job it started keeps running.`
									: status === "paused"
										? `Paused ${target}. Its automated turns are held until /flow resume ${target}.`
										: `Resumed ${target}. Its automated turns can run again.`,
							);
							return;
						}
						notify(USAGE, "error");
					} catch (error) {
						notify(`Flow control: ${error instanceof Error ? error.message : String(error)}`, "error");
					}
				},
			});
		},
	};
}
