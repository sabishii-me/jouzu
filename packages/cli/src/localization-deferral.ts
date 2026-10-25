/**
 * The deferral policy for a language change.
 *
 * A language change is not only a settings write. Applying it re-renders the
 * interface, and a re-render in the middle of another interaction can lose work
 * or read as an answer the user did not give. This module decides whether a
 * change may proceed, names the reason it waits, and marks the one case where
 * the display language is fixed rather than deferred.
 *
 * ## The five conditions
 *
 * The policy reads one snapshot of session activity and reports every condition
 * that is active, in a fixed priority order:
 *
 * - `confirmation`: a destructive operation is being confirmed. This is both a
 *   deferral and a fixation: the language must not change while the user is
 *   answering, and a language change must never be taken as that answer.
 * - `ime`: a text composition has unconfirmed characters. Re-rendering would
 *   discard them.
 * - `streaming`: a reply is still streaming.
 * - `tool`: a tool is running.
 * - `update`: an update or rollback is running.
 *
 * The first active condition is the `primary`; it supplies the reason text a
 * caller shows. `deferralNotice` wraps it in a sentence. `reapprovalNotice`
 * names the confirmation keys for the one condition where a change could be
 * mistaken for approval.
 *
 * ## Wiring
 *
 * The module is pure: it reads a `LocalizationActivity` snapshot and never
 * inspects the session itself. A host builds the snapshot from the signals it
 * has. `createLocalizationActivityTracker` is the small mutable holder a host
 * updates from its own events and hands to a view as `() => tracker.snapshot()`.
 * A signal a host cannot observe is left absent and reads as inactive, so an
 * unobserved condition never blocks a change silently.
 *
 * ## Messages
 *
 * The reason and notice IDs live in `locales/<locale>/localization-deferral.ftl`
 * and are catalog-only: they are deliberately not added to the shared
 * `CatalogMessageId` table, so a parallel change does not conflict on that
 * file. `scripts/check-locales.mjs` requires the same ID set in `en` and `ja`.
 */

import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";

/** One reason a language change waits. */
export type LocalizationDeferralCondition = "confirmation" | "ime" | "streaming" | "tool" | "update";

/**
 * Every condition, most important first. The order decides which active
 * condition supplies the reason when more than one holds.
 */
export const LOCALIZATION_DEFERRAL_CONDITIONS: readonly LocalizationDeferralCondition[] = [
	"confirmation",
	"ime",
	"streaming",
	"tool",
	"update",
];

/**
 * A snapshot of the work that can be disturbed by a language change. An absent
 * field means the host did not observe that signal and it reads as inactive.
 */
export interface LocalizationActivity {
	/** A destructive confirmation is waiting for the user's answer. */
	readonly destructiveConfirmation?: boolean;
	/** A text composition has unconfirmed characters. */
	readonly imeComposing?: boolean;
	/** A reply is streaming. */
	readonly streaming?: boolean;
	/** A tool is running. */
	readonly runningTool?: boolean;
	/** An update or rollback is running. */
	readonly updating?: boolean;
}

/** The decision for one activity snapshot. */
export interface LocalizationDeferral {
	/** Every active condition, in priority order. */
	readonly conditions: readonly LocalizationDeferralCondition[];
	/** Whether the change must wait. */
	readonly deferred: boolean;
	/** The highest-priority active condition, or absent when none is active. */
	readonly primary?: LocalizationDeferralCondition;
	/** The catalog reason for `primary`, or absent when the change may proceed. */
	readonly reason?: string;
	/** Whether the display language is fixed rather than merely deferred. */
	readonly displayLanguageFixed: boolean;
}

/** The catalog ID that carries each condition's reason. */
const DEFERRAL_REASON_IDS: Readonly<Record<LocalizationDeferralCondition, string>> = {
	confirmation: "jouzu.cli.localization.deferral.confirmation",
	ime: "jouzu.cli.localization.deferral.ime",
	streaming: "jouzu.cli.localization.deferral.streaming",
	tool: "jouzu.cli.localization.deferral.tool",
	update: "jouzu.cli.localization.deferral.update",
};

/** The catalog ID for the deferred-change notice, which takes the reason as `$reason`. */
const DEFERRAL_NOTICE_ID = "jouzu.cli.localization.deferral.notice";
/** The catalog ID for the fixed-display-language notice. */
export const DEFERRAL_FIXED_ID = "jouzu.cli.localization.deferral.fixed";
/** The catalog ID for the re-approval notice, which takes `$confirm` and `$cancel`. */
const DEFERRAL_REAPPROVAL_ID = "jouzu.cli.localization.deferral.reapproval";
/** The catalog ID for the upstream switch condition. */
const DEFERRAL_UPSTREAM_ID = "jouzu.cli.localization.deferral.upstream";

/** Whether a snapshot raises one condition. */
function conditionActive(condition: LocalizationDeferralCondition, activity: LocalizationActivity): boolean {
	switch (condition) {
		case "confirmation":
			return activity.destructiveConfirmation === true;
		case "ime":
			return activity.imeComposing === true;
		case "streaming":
			return activity.streaming === true;
		case "tool":
			return activity.runningTool === true;
		case "update":
			return activity.updating === true;
	}
}

/** Every active condition, in priority order. */
export function activeDeferralConditions(
	activity: LocalizationActivity = {},
): readonly LocalizationDeferralCondition[] {
	return LOCALIZATION_DEFERRAL_CONDITIONS.filter((condition) => conditionActive(condition, activity));
}

/** The catalog reason for one condition. */
export function deferralReason(
	condition: LocalizationDeferralCondition,
	catalog: CatalogBundle = defaultCatalog(),
): string {
	return catalogText(catalog, DEFERRAL_REASON_IDS[condition]);
}

/**
 * Whether the display language is fixed for this snapshot.
 *
 * A destructive confirmation fixes the language: the prompt and its object must
 * read the same way from the moment it appears until the user answers it, so a
 * change cannot alter the text the user is approving.
 */
export function displayLanguageFixed(activity: LocalizationActivity = {}): boolean {
	return activity.destructiveConfirmation === true;
}

/** Decide whether a language change may proceed for one activity snapshot. */
export function detectLocalizationDeferral(
	activity: LocalizationActivity = {},
	catalog: CatalogBundle = defaultCatalog(),
): LocalizationDeferral {
	const conditions = activeDeferralConditions(activity);
	const primary = conditions[0];
	const fixed = displayLanguageFixed(activity);
	if (primary === undefined) return { conditions, deferred: false, displayLanguageFixed: fixed };
	return {
		conditions,
		deferred: true,
		primary,
		reason: deferralReason(primary, catalog),
		displayLanguageFixed: fixed,
	};
}

/** The deferred-change sentence, or absent when the change may proceed. */
export function deferralNotice(
	deferral: LocalizationDeferral,
	catalog: CatalogBundle = defaultCatalog(),
): string | undefined {
	if (!deferral.deferred || deferral.reason === undefined) return undefined;
	return catalogText(catalog, DEFERRAL_NOTICE_ID, { reason: deferral.reason });
}

/** The notice that the display language stays fixed while a confirmation is open. */
export function fixedLanguageNotice(catalog: CatalogBundle = defaultCatalog()): string {
	return catalogText(catalog, DEFERRAL_FIXED_ID);
}

/**
 * The notice that a language change does not approve the confirmation.
 *
 * `confirm` and `cancel` are the effective key labels, so a rebound key is
 * named correctly.
 */
export function reapprovalNotice(confirm: string, cancel: string, catalog: CatalogBundle = defaultCatalog()): string {
	return catalogText(catalog, DEFERRAL_REAPPROVAL_ID, { confirm, cancel });
}

/**
 * The switch condition for a screen Jouzu does not own.
 *
 * An upstream screen keeps the language it was opened with; it switches the
 * next time it opens, or after an explicit restart. A caller shows this beside
 * a language setting so the user is not surprised that the change is partial.
 */
export function upstreamSwitchNotice(catalog: CatalogBundle = defaultCatalog()): string {
	return catalogText(catalog, DEFERRAL_UPSTREAM_ID);
}

/** A mutable activity holder a host updates from its own events. */
export interface LocalizationActivityTracker {
	/** Set one condition on or off. */
	set(condition: LocalizationDeferralCondition, active: boolean): void;
	/** The current snapshot, safe to hand to `detectLocalizationDeferral`. */
	snapshot(): LocalizationActivity;
	/** Clear every condition, for a new session. */
	reset(): void;
}

/** Create a tracker whose snapshot starts with no condition active. */
export function createLocalizationActivityTracker(): LocalizationActivityTracker {
	let activity: LocalizationActivity = {};
	return {
		set(condition, active) {
			switch (condition) {
				case "confirmation":
					activity = { ...activity, destructiveConfirmation: active };
					return;
				case "ime":
					activity = { ...activity, imeComposing: active };
					return;
				case "streaming":
					activity = { ...activity, streaming: active };
					return;
				case "tool":
					activity = { ...activity, runningTool: active };
					return;
				case "update":
					activity = { ...activity, updating: active };
					return;
			}
		},
		snapshot() {
			return { ...activity };
		},
		reset() {
			activity = {};
		},
	};
}
