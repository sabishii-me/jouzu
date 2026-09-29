import { isDeepStrictEqual } from "node:util";
import type { FlowIntent } from "./admission.js";
import type { PiFlowAttachment } from "./pi-attachment.js";
import { FlowLedgerError } from "./receipt-ledger.js";
import { waitDecisionIntent } from "./wait-decisions.js";

export interface WorkIdentity {
	id: string;
	actor: string;
	revision: number;
}

/**
 * Attribution for the tools a turn reaches. It records which user, task, or goal a turn is working
 * on so waits, background jobs, and derived work name a sensible origin. Attribution is not a
 * permission: any registered identity is usable, a missing or stale one never blocks a tool, and a
 * branch always falls back to the host identity registered when the branch attached.
 */
export class FlowWorkContext {
	private branch?: WorkIdentity;
	private selected?: WorkIdentity;
	private running = false;
	private readonly returnWork: WorkIdentity[] = [];

	constructor(
		private readonly attachment: () => PiFlowAttachment,
		/** Branch-level host attribution, registered once at attachment. */
		private readonly hostWork?: () => Promise<WorkIdentity>,
	) {}

	get busy(): boolean {
		return this.running;
	}

	/** Register the branch-level host identity. Idempotent: the identity is keyed by branch scope. */
	async attach(): Promise<void> {
		if (!this.hostWork) return;
		this.branch = { ...(await this.hostWork()) };
	}

	/** The effective attribution: the selected work, otherwise the branch host identity. */
	private get attribution(): WorkIdentity | undefined {
		return this.selected ?? this.branch;
	}

	async run<T>(work: WorkIdentity | undefined, invoke: () => Promise<T>): Promise<T> {
		if (this.running) throw new FlowLedgerError("busy", "Work invocation is already active.");
		const previous = this.selected;
		// A task chain belongs to one turn; it must not leak into a later invocation.
		this.returnWork.length = 0;
		this.selected = work ? { ...work } : undefined;
		this.running = true;
		try {
			return await invoke();
		} finally {
			this.running = false;
			this.selected = previous;
			this.returnWork.length = 0;
		}
	}

	/** Native execution outside controller work shares the branch attribution without a selection. */
	withOperation<T>(invoke: () => Promise<T>): Promise<T> {
		if (this.running) return invoke();
		return this.run(undefined, invoke);
	}

	/** Bind a live controller attempt to the work its admission names, without granting permission. */
	async runSelected(attemptId: string, invoke: () => Promise<void>): Promise<void> {
		if (this.running) throw new FlowLedgerError("busy", "Work invocation is already active.");
		const attachment = this.attachment();
		const state = await attachment.ledger.snapshot();
		if (this.attachment() !== attachment) throw new FlowLedgerError("stale", "Selected attempt branch changed.");
		const attempt = state.attempts.find((item) => item.id === attemptId);
		if (state.activeAttemptId !== attemptId || !attempt || attempt.phase !== "queued")
			throw new FlowLedgerError("stale", "Work invocation requires the active queued attempt.");
		const work = await this.selectAttemptWork(attachment, attempt.admission?.choice.intent);
		if (this.attachment() !== attachment) throw new FlowLedgerError("stale", "Selected work branch changed.");
		return this.run(work, invoke);
	}

	/**
	 * Resolve the attribution an admission names. A delivered result or wait decision that no live
	 * work owns still runs, on branch host attribution; only an explicitly paused or stopped
	 * producer-bound attempt is refused, because the scheduler must not restart that work.
	 */
	private async selectAttemptWork(
		attachment: PiFlowAttachment,
		intent: FlowIntent | undefined,
	): Promise<WorkIdentity | undefined> {
		if (!intent) return undefined;
		const active = (state: string | undefined) => (state ?? "active") === "active";
		if (intent.rank === 3 && intent.producer === "jouzu-wait-decisions") {
			const waits = await attachment.waits.snapshot();
			const wait = waits.find((item) => isDeepStrictEqual(waitDecisionIntent(item), intent));
			if (!wait) throw new FlowLedgerError("stale", "Selected wait decision no longer matches retained state.");
			const work = (await attachment.waits.authoritySnapshot()).work.find((item) => item.id === wait.workId);
			if (!work || !active(work.lifecycle?.state)) return undefined;
			return { id: work.id, actor: work.owner, revision: work.revision };
		}
		if (intent.rank === 6) {
			if (!intent.workId) return undefined;
			const work = (await attachment.waits.authoritySnapshot()).work.find((item) => item.id === intent.workId);
			if (!work || !active(work.lifecycle?.state)) return undefined;
			return { id: work.id, actor: work.owner, revision: work.revision };
		}
		if (![4, 5].includes(intent.rank) || !intent.workId) return undefined;
		const work = (await attachment.waits.authoritySnapshot()).work.find((item) => item.id === intent.workId);
		if (!work) return undefined;
		if (!active(work.lifecycle?.state))
			throw new FlowLedgerError("transition", "Inactive work cannot start another invocation.");
		return { id: work.id, actor: intent.producer, revision: work.revision };
	}

	/** Select attribution for following tools after a task operation. */
	async selectToolWork(work: WorkIdentity, retainParent = false): Promise<boolean> {
		const previous = this.selected ?? this.branch;
		if (retainParent && previous && previous.id !== work.id) this.returnWork.push({ ...previous });
		else if (!retainParent) this.returnWork.length = 0;
		this.selected = { ...work };
		return true;
	}

	/** Return to the attribution retained when this run selected a child task. */
	async returnFromToolWork(): Promise<boolean> {
		const selected = this.selected;
		if (!selected) return false;
		const attachment = this.attachment();
		const authority = await attachment.waits.authoritySnapshot();
		if (this.attachment() !== attachment)
			throw new FlowLedgerError("stale", "Task selection changed before returning from completed work.");
		const completed = authority.work.find((item) => item.id === selected.id);
		if (completed?.lifecycle?.state !== "completed") return false;
		const parent = this.returnWork.pop();
		this.selected = parent ? { ...parent } : undefined;
		return true;
	}

	/** A newly consumed input ends this work's selection without ending Pi's run. */
	revoke(): void {
		this.selected = undefined;
		this.returnWork.length = 0;
	}

	current(): { id: string; revision: number } | undefined {
		const work = this.attribution;
		return work ? { id: work.id, revision: work.revision } : undefined;
	}
}
