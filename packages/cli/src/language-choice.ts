/**
 * The first-run language choice.
 *
 * The screen offers the four language self-names (`English`, `日本語`,
 * `简体中文`, `繁體中文`) so a user who picked the wrong language can find the
 * way back: a self-name is written the same way in every catalog. Each
 * candidate also records whether this build ships an interface catalog for it;
 * a language whose interface is not shipped is shown so the four names stay
 * visible, but it cannot be selected, so an unshipped locale is never offered.
 *
 * An operating-system-derived candidate is a suggestion only: it marks the
 * matching row and is never written. The interface language is chosen first,
 * then the response language is confirmed separately. Empty input, a closed
 * input stream, or a non-interactive run chooses nothing and writes nothing, so
 * the saved settings file stays byte-identical.
 *
 * The chosen interface language and response language are recorded in one
 * atomic `localization.json` write through `saveLocalizationConfig`, which is
 * the same revision-checked, lock-protected path a UI-locale save uses. This
 * module does not implement the plan/apply/reset operations; those belong to a
 * later issue.
 */

import { createInterface } from "node:readline/promises";
import { CatalogMessageId, catalogText, defaultCatalog } from "./cli-messages.js";
import { RESPONSE_LANGUAGES, type ResponseLanguage, type ResponseLanguagePreference } from "./language-settings.js";
import { CATALOG_LOCALES, type CatalogBundle } from "./locale-catalog.js";
import type { JouzuPaths } from "./paths.js";
import {
	isSupportedUiLocale,
	normalizeUiLocale,
	osLocaleCandidates,
	readLocalizationConfigSnapshot,
	saveLocalizationConfig,
	type UiLocale,
} from "./ui-locale.js";

/** The catalog ID that carries each language's self-name. */
const SELF_NAME_IDS: Readonly<Record<ResponseLanguage, CatalogMessageId>> = {
	en: CatalogMessageId.languageSelfEn,
	ja: CatalogMessageId.languageSelfJa,
	"zh-Hans": CatalogMessageId.languageSelfZhHans,
	"zh-Hant": CatalogMessageId.languageSelfZhHant,
};

/** The interface catalogs this build ships. A locale outside this set is not offered. */
const SHIPPED_UI_LOCALES: ReadonlySet<string> = new Set(CATALOG_LOCALES);

/** One first-run candidate: a language, its self-name, and whether its interface ships. */
export interface LanguageCandidate {
	/** The BCP-47 tag, shared by the interface and response language sets. */
	readonly tag: ResponseLanguage;
	/** Whether this build ships an interface catalog for the language. */
	readonly shipped: boolean;
}

/** The four candidates, in the language set's order. */
export const LANGUAGE_CANDIDATES: readonly LanguageCandidate[] = RESPONSE_LANGUAGES.map((tag) => ({
	tag,
	shipped: SHIPPED_UI_LOCALES.has(tag),
}));

/** The self-name of a language, from the resolved catalog. It is never translated. */
export function languageSelfName(tag: ResponseLanguage, catalog: CatalogBundle = defaultCatalog()): string {
	return catalogText(catalog, SELF_NAME_IDS[tag]);
}

/** Whether this build ships an interface catalog for a locale. */
export function isShippedUiLocale(tag: string): tag is UiLocale {
	return SHIPPED_UI_LOCALES.has(tag);
}

/**
 * The operating-system-derived interface-language suggestion, or `undefined`.
 *
 * It follows the UI-locale `auto` step: the first non-empty POSIX candidate
 * decides, and a candidate that is not a supported locale yields no suggestion.
 * The caller marks the matching row; the suggestion is never written.
 */
export function suggestedUiLocale(env: NodeJS.ProcessEnv = process.env): UiLocale | undefined {
	for (const candidate of osLocaleCandidates(env)) {
		if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
		return normalizeUiLocale(candidate);
	}
	return undefined;
}

/**
 * Parse an answer as a candidate: a one-based number, a BCP-47 tag, or a
 * self-name. An empty answer yields `undefined` so the caller can apply its own
 * skip or default rule.
 */
export function parseLanguageCandidateAnswer(
	answer: string,
	candidates: readonly LanguageCandidate[] = LANGUAGE_CANDIDATES,
	catalog: CatalogBundle = defaultCatalog(),
): LanguageCandidate | undefined {
	const trimmed = answer.trim();
	if (trimmed.length === 0) return undefined;
	if (/^\d+$/u.test(trimmed)) {
		const index = Number.parseInt(trimmed, 10);
		if (index >= 1 && index <= candidates.length) return candidates[index - 1];
		return undefined;
	}
	const lower = trimmed.toLowerCase();
	const byTag = candidates.find((candidate) => candidate.tag.toLowerCase() === lower);
	if (byTag) return byTag;
	return candidates.find((candidate) => languageSelfName(candidate.tag, catalog).toLowerCase() === lower);
}

/** The chosen interface language and response language. */
export interface LanguageChoice {
	/** The chosen interface language. Always one whose catalog this build ships. */
	readonly uiLocale: UiLocale;
	/** The confirmed response language, or `auto` for no fixed instruction. */
	readonly responseLanguage: ResponseLanguagePreference;
}

export interface PromptForLanguageChoiceOptions {
	/** The resolved catalog the screen renders from; English when omitted. */
	readonly catalog?: CatalogBundle;
	/** The environment the OS suggestion reads; `process.env` when omitted. */
	readonly env?: NodeJS.ProcessEnv;
	/** When false, the screen is not shown and nothing is read or written. */
	readonly interactive?: boolean;
}

const MAX_ATTEMPTS = 3;

/** Ask one question, returning `undefined` when the input stream closes. */
async function ask(readline: ReturnType<typeof createInterface>, prompt: string): Promise<string | undefined> {
	try {
		return await readline.question(`${prompt} `);
	} catch {
		return undefined;
	}
}

/**
 * Show the first-run language choice and read the answers.
 *
 * Returns `undefined` for a skip (empty answer or a closed stream), an invalid
 * answer after the attempt budget, or a non-interactive run. The caller writes
 * the settings only when a choice is returned.
 */
export async function promptForLanguageChoice(
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
	options: PromptForLanguageChoiceOptions = {},
): Promise<LanguageChoice | undefined> {
	if (options.interactive === false) return undefined;
	const catalog = options.catalog ?? defaultCatalog();
	const env = options.env ?? process.env;
	const suggested = suggestedUiLocale(env);
	const line = (value: string) => output.write(`${value}\n`);

	line(catalogText(catalog, CatalogMessageId.languageChoiceIntro));
	for (const [index, candidate] of LANGUAGE_CANDIDATES.entries()) {
		const markers: string[] = [];
		if (candidate.tag === suggested) markers.push(catalogText(catalog, CatalogMessageId.languageChoiceSuggested));
		if (!candidate.shipped) markers.push(catalogText(catalog, CatalogMessageId.languageChoiceUnavailable));
		const suffix = markers.length > 0 ? ` (${markers.join(", ")})` : "";
		line(`  ${index + 1}) ${languageSelfName(candidate.tag, catalog)}${suffix}`);
	}

	const readline = createInterface({ input, output });
	try {
		// 1. The interface language. Empty skips the whole choice.
		let picked: LanguageCandidate | undefined;
		for (let attempt = 0; attempt < MAX_ATTEMPTS && !picked; attempt += 1) {
			const answer = await ask(readline, catalogText(catalog, CatalogMessageId.languageChoiceQuestion));
			if (answer === undefined || answer.trim().length === 0) {
				line(catalogText(catalog, CatalogMessageId.languageChoiceSkipped));
				return undefined;
			}
			const candidate = parseLanguageCandidateAnswer(answer, LANGUAGE_CANDIDATES, catalog);
			if (!candidate) {
				line(catalogText(catalog, CatalogMessageId.languageChoiceInvalid, { value: answer.trim() }));
				continue;
			}
			if (!candidate.shipped) {
				line(
					catalogText(catalog, CatalogMessageId.languageChoiceNotShipped, {
						language: languageSelfName(candidate.tag, catalog),
					}),
				);
				continue;
			}
			picked = candidate;
		}
		if (!picked) {
			line(catalogText(catalog, CatalogMessageId.languageChoiceSkipped));
			return undefined;
		}

		// 2. The response language, confirmed separately. The interface language is
		// the suggestion; empty accepts it, and `auto` means no fixed instruction.
		line(catalogText(catalog, CatalogMessageId.languageChoiceResponseIntro));
		for (const [index, candidate] of LANGUAGE_CANDIDATES.entries()) {
			const marker =
				candidate.tag === picked.tag ? ` (${catalogText(catalog, CatalogMessageId.languageChoiceSuggested)})` : "";
			line(`  ${index + 1}) ${languageSelfName(candidate.tag, catalog)}${marker}`);
		}
		let responseLanguage: ResponseLanguagePreference = picked.tag;
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
			const answer = await ask(readline, catalogText(catalog, CatalogMessageId.languageChoiceResponseQuestion));
			if (answer === undefined || answer.trim().length === 0) break;
			const trimmed = answer.trim();
			if (trimmed.toLowerCase() === "auto") {
				responseLanguage = "auto";
				break;
			}
			const candidate = parseLanguageCandidateAnswer(answer, LANGUAGE_CANDIDATES, catalog);
			if (!candidate) {
				line(catalogText(catalog, CatalogMessageId.languageChoiceInvalid, { value: trimmed }));
				continue;
			}
			responseLanguage = candidate.tag;
			break;
		}
		return { uiLocale: picked.tag, responseLanguage };
	} finally {
		readline.close();
	}
}

/**
 * Write the chosen interface and response languages to `localization.json`.
 *
 * The write is atomic and revision-checked, and it preserves any artifact
 * policy the file already carries. A caller that skipped the choice calls
 * nothing, so the file is untouched.
 */
export function saveLanguageChoice(
	paths: JouzuPaths,
	choice: LanguageChoice,
	catalog: CatalogBundle = defaultCatalog(),
): void {
	if (!isSupportedUiLocale(choice.uiLocale)) {
		throw new Error(`unsupported interface language: ${choice.uiLocale}`);
	}
	const snapshot = readLocalizationConfigSnapshot(paths.configDir, catalog);
	saveLocalizationConfig({ configDir: paths.configDir, stateDir: paths.stateDir }, choice.uiLocale, snapshot, catalog, {
		responseLanguage: choice.responseLanguage,
	});
}
