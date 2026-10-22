import { resolve } from "node:path";
import type { MainOptions } from "@earendil-works/pi-coding-agent";
import { TextGuardApprovalStore } from "./textguard-approvals.js";
import { CachedTextGuard } from "./textguard-cache.js";
import { NativeTextGuard } from "./textguard-native.js";
import { NativeContentPolicy, type TextGuardAlert, type TextGuardMode } from "./textguard-policy.js";

type Scanner = ConstructorParameters<typeof CachedTextGuard>[0];
interface SessionIdentity {
	sessionId: string;
	cwd: string;
}

/** Share verdicts, persistent approvals, and the helper process, never session approvals, across replacement sessions. */
export class TextGuardRuntime {
	private scanner: CachedTextGuard;
	private approvals?: TextGuardApprovalStore;
	private sessions = new Map<string, { cwd: string; policy: NativeContentPolicy }>();
	private active?: SessionIdentity & { policy: NativeContentPolicy };
	private closing?: Promise<void>;
	private closed = false;
	private mode: TextGuardMode;
	private alertListener?: (alert: TextGuardAlert) => void;
	private static readonly MAX_SESSIONS = 32;
	constructor(
		private options: {
			cachePath?: string;
			approvalPath?: string;
			files?: boolean;
			mode?: TextGuardMode;
			scanner?: Scanner;
		} = {},
	) {
		this.scanner = new CachedTextGuard(options.scanner ?? new NativeTextGuard(), options.cachePath);
		if (options.approvalPath) this.approvals = new TextGuardApprovalStore(options.approvalPath);
		this.mode = options.mode ?? "guarded";
	}
	/** The mode outlives session replacement, so a reload after /textguard keeps the user's choice. */
	currentMode(): TextGuardMode {
		return this.mode;
	}
	/** The session extension shows alerts as they are raised; without a listener they queue for /textguard. */
	setAlertListener(listener: ((alert: TextGuardAlert) => void) | undefined): void {
		this.alertListener = listener;
	}
	setMode(mode: TextGuardMode): boolean {
		if (this.closed || this.mode === mode) return false;
		this.mode = mode;
		for (const { policy } of this.sessions.values()) policy.setMode(mode);
		return true;
	}
	readonly createPolicy: NonNullable<MainOptions["contentPolicyFactory"]> = (context) => {
		if (this.closed) throw new Error("TextGuard is closed; content cannot be admitted.");
		const cwd = resolve(context.cwd);
		const existing = this.sessions.get(context.sessionId);
		if (existing?.cwd === cwd) {
			this.active = { sessionId: context.sessionId, cwd, policy: existing.policy };
			// Refresh insertion order so the bounded map evicts the least recently used session.
			this.sessions.delete(context.sessionId);
			this.sessions.set(context.sessionId, existing);
			return existing.policy;
		}
		// A changed working directory is a different admission context; the old policy is
		// not reusable even when the session identifier is unchanged.
		existing?.policy.clear();
		const policy = new NativeContentPolicy({
			cwd,
			scanner: this.scanner,
			files: this.options.files,
			mode: this.mode,
			notify: (alert) => {
				if (!this.alertListener) return false;
				this.alertListener(alert);
				return true;
			},
			...(this.approvals ? { approvals: this.approvals } : {}),
		});
		this.sessions.set(context.sessionId, { cwd, policy });
		this.active = { sessionId: context.sessionId, cwd, policy };
		while (this.sessions.size > TextGuardRuntime.MAX_SESSIONS) {
			const oldest = this.sessions.keys().next().value as string | undefined;
			if (!oldest || oldest === context.sessionId) break;
			this.sessions.get(oldest)?.policy.clear();
			this.sessions.delete(oldest);
		}
		return policy;
	};
	forSession(sessionId: string): NativeContentPolicy | undefined {
		return !this.closed ? this.sessions.get(sessionId)?.policy : undefined;
	}
	/** Call only after user confirmation. A session change while its dialog was open invalidates the action. */
	approve(policy: NativeContentPolicy, reviewId: string, persist = false): boolean {
		const known = this.active?.policy === policy || [...this.sessions.values()].some(entry => entry.policy === policy);
		return !this.closed && known && policy.admission.approve(reviewId, persist);
	}
	close(): Promise<void> {
		this.closed = true;
		for (const { policy } of this.sessions.values()) policy.clear();
		this.sessions.clear();
		this.active = undefined;
		this.closing ??= Promise.resolve()
			.then(() => this.scanner.close())
			.then(() => this.approvals?.close());
		return this.closing;
	}
}
