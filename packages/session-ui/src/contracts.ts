import type { WorkAttentionType, WorkKind } from "./work-dashboard.js";

export type SessionUiSemanticRole = "text" | "muted" | "accent" | "success" | "warning" | "error";

export interface SessionUiHint {
	id: string;
	text: string;
	priority: number;
	role: SessionUiSemanticRole;
}

export interface SessionUiHintSource {
	getHint(): SessionUiHint | undefined;
}

/** Status text other extensions published through `ctx.ui.setStatus`, keyed by extension. */
export interface SessionUiActivityContext {
	extensionStatuses: ReadonlyMap<string, string>;
}

/**
 * Work the Session Line reports instead of the shortcut hint: a running loop, active child
 * agents, or loop state that outlives the turn. `active` animates the marker while work moves.
 */
export interface SessionUiActivity {
	text: string;
	active: boolean;
	/** Distinct unresolved units; retained even when detail or model identity cannot fit. */
	attentionCount?: number;
}

export interface SessionUiClock {
	now(): number;
}

export const SYSTEM_SESSION_UI_CLOCK: SessionUiClock = Object.freeze({
	now: () => Date.now(),
});

/** The stable catalog IDs for the Session UI's own display text. */
export const SESSION_UI_MESSAGE_IDS = Object.freeze({
	lineFast: "jouzu.cli.session.line.fast",
	lineNoModel: "jouzu.cli.session.line.noModel",
	lineAttention: "jouzu.cli.session.line.attention",
	statusHealth: "jouzu.cli.session.status.health",
	statusContextUnknown: "jouzu.cli.session.status.contextUnknown",
	statusDetached: "jouzu.cli.session.status.detached",
	hintPaletteShortcuts: "jouzu.cli.session.hint.paletteShortcuts",
	dashboardSectionAgent: "jouzu.cli.session.dashboard.section.agent",
	dashboardSectionJob: "jouzu.cli.session.dashboard.section.job",
	dashboardSectionTask: "jouzu.cli.session.dashboard.section.task",
	dashboardSectionLoop: "jouzu.cli.session.dashboard.section.loop",
	dashboardSectionGoal: "jouzu.cli.session.dashboard.section.goal",
	dashboardSectionPrompt: "jouzu.cli.session.dashboard.section.prompt",
	dashboardSectionFlow: "jouzu.cli.session.dashboard.section.flow",
	dashboardAttentionResult: "jouzu.cli.session.dashboard.attention.result",
	dashboardAttentionInput: "jouzu.cli.session.dashboard.attention.input",
	dashboardAttentionRecovery: "jouzu.cli.session.dashboard.attention.recovery",
	dashboardAttentionAuthority: "jouzu.cli.session.dashboard.attention.authority",
	dashboardStale: "jouzu.cli.session.dashboard.stale",
	dashboardElapsedSeconds: "jouzu.cli.session.dashboard.elapsed.seconds",
	dashboardElapsedMinutes: "jouzu.cli.session.dashboard.elapsed.minutes",
	dashboardElapsedHours: "jouzu.cli.session.dashboard.elapsed.hours",
	dashboardElapsedHoursMinutes: "jouzu.cli.session.dashboard.elapsed.hoursMinutes",
});

export type SessionUiMessageId = (typeof SESSION_UI_MESSAGE_IDS)[keyof typeof SESSION_UI_MESSAGE_IDS];

/**
 * The resolved locale catalog the Session UI reads its text from.
 *
 * It is the structural subset of the CLI's `CatalogBundle` that the renderer
 * needs, so this package stays independent of the CLI while the startup path
 * passes the one catalog it already resolved. The catalog reaches a renderer
 * once, when the renderer is created, and never as a locale string.
 */
export interface SessionUiCatalog {
	format(id: string, args?: Readonly<Record<string, string | number>>): string;
}

/**
 * The work dashboard's own display text, resolved once for the active catalog.
 *
 * The section titles and attention phrases are keyed by the internal work kind
 * and attention type, which stay the identity values for ordering and
 * comparison; only the resolved words are catalog text. The two composed
 * strings are catalog patterns rather than concatenation: `markStale` wraps a
 * row's status, and `formatElapsed` fills a duration pattern.
 */
export interface SessionUiWorkDashboardText {
	/** Section titles keyed by the internal work kind. */
	readonly sections: Readonly<Record<WorkKind, string>>;
	/** Attention phrases keyed by the internal attention type. */
	readonly attention: Readonly<Record<WorkAttentionType, string>>;
	/** Wrap a row's status text with the marker that its producer's data is stale. */
	readonly markStale: (status: string) => string;
	/** Compact elapsed time: 45s, 12m, 1h, or 1h 5m. */
	readonly formatElapsed: (ms: number) => string;
}

/**
 * The Session UI's own display text, resolved once for the active catalog.
 *
 * A render function takes this record instead of resolving a locale itself, so
 * a locale change never reaches the render path. Protected values (provider
 * names, model IDs, paths, URLs) are data and are not part of this record.
 */
export interface SessionUiText {
	/** Paid priority processing is active for this session's model. */
	readonly fast: string;
	/** Shown in place of a model identity the session has not reported. */
	readonly noModel: string;
	/** The Session Line's label for unresolved work when no activity detail fits. */
	readonly attention: string;
	/** The status bar's marker when a status source failed. */
	readonly statusHealth: string;
	/** The status bar's context placeholder when the usage percentage is unknown. */
	readonly statusContextUnknown: string;
	/** The status bar's branch placeholder when the repository has no branch. */
	readonly statusDetached: string;
	/** The work dashboard's section titles, attention phrases, and composed patterns. */
	readonly dashboard: SessionUiWorkDashboardText;
}

/** Resolve the Session UI display text from a catalog. */
export function sessionUiText(catalog: SessionUiCatalog): SessionUiText {
	const ids = SESSION_UI_MESSAGE_IDS;
	return {
		fast: catalog.format(ids.lineFast),
		noModel: catalog.format(ids.lineNoModel),
		attention: catalog.format(ids.lineAttention),
		statusHealth: catalog.format(ids.statusHealth),
		statusContextUnknown: catalog.format(ids.statusContextUnknown),
		statusDetached: catalog.format(ids.statusDetached),
		dashboard: {
			sections: {
				agent: catalog.format(ids.dashboardSectionAgent),
				job: catalog.format(ids.dashboardSectionJob),
				task: catalog.format(ids.dashboardSectionTask),
				loop: catalog.format(ids.dashboardSectionLoop),
				goal: catalog.format(ids.dashboardSectionGoal),
				prompt: catalog.format(ids.dashboardSectionPrompt),
				flow: catalog.format(ids.dashboardSectionFlow),
			},
			attention: {
				result: catalog.format(ids.dashboardAttentionResult),
				input: catalog.format(ids.dashboardAttentionInput),
				recovery: catalog.format(ids.dashboardAttentionRecovery),
				authority: catalog.format(ids.dashboardAttentionAuthority),
			},
			markStale: (status) => catalog.format(ids.dashboardStale, { status }),
			formatElapsed: (ms) => {
				const seconds = Math.max(0, Math.floor(ms / 1000));
				if (seconds < 60) return catalog.format(ids.dashboardElapsedSeconds, { count: seconds });
				const minutes = Math.floor(seconds / 60);
				if (minutes < 60) return catalog.format(ids.dashboardElapsedMinutes, { count: minutes });
				const hours = Math.floor(minutes / 60);
				return minutes % 60
					? catalog.format(ids.dashboardElapsedHoursMinutes, { hours, minutes: minutes % 60 })
					: catalog.format(ids.dashboardElapsedHours, { count: hours });
			},
		},
	};
}
