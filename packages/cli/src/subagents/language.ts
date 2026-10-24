/**
 * The per-role language contract as it reaches a child and a background process.
 *
 * `roles.ts` holds the default `LanguageContract` for each role family. This
 * module snapshots such a contract at launch, composes the small role-facing
 * instruction section, and provides the limitation-report path a child uses when
 * it cannot return a reliable result in the requested language.
 *
 * The contract travels on the `WorkerLaunch` and is copied into a frozen
 * snapshot when the launch is queued and again when the child's resources are
 * built. A parent that changes its response language after launch cannot reach a
 * running child: the child keeps the contract it started with.
 *
 * A child preserves historical and quoted content rather than translating it to
 * satisfy a language preference. Coding assignments may still edit source files.
 * A child never routes its answer through another model to satisfy a language
 * request. When it cannot answer reliably in the requested language it reports a
 * limitation instead.
 */

import {
	artifactLanguageFor,
	isLanguageContract,
	LANGUAGE_CONTRACT_PRESERVE_EXACT,
	type LanguageContract,
	type LanguageContractArtifactLanguage,
	type LanguageContractPreserveExact,
	type LanguageContractReturnLanguage,
	languageContractId,
} from "../language-contract.js";
import { ARTIFACT_POLICY_FIELDS } from "../language-settings.js";
import type { AgentRole } from "./roles.js";
import { DEFAULT_ROLE_LANGUAGE_CONTRACTS, defaultLanguageContract } from "./roles.js";

/**
 * The compactor's contract. It preserves everything: a summary, a quote, a tool
 * result, and code are history, and history is never translated.
 */
export const COMPACTOR_LANGUAGE_CONTRACT: LanguageContract = DEFAULT_ROLE_LANGUAGE_CONTRACTS.compaction;

/**
 * The background monitor's contract. It reports execution state and never
 * rewrites the history or the output it observes.
 */
export const BACKGROUND_MONITOR_LANGUAGE_CONTRACT: LanguageContract = DEFAULT_ROLE_LANGUAGE_CONTRACTS.monitor;

/** The human name for each fixed language, used in the role section. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
	en: "English",
	ja: "Japanese",
	"zh-Hans": "Simplified Chinese",
	"zh-Hant": "Traditional Chinese",
};

/** The English phrase for a preserved value, used in the role section. */
const PRESERVE_EXACT_NAMES: Readonly<Record<LanguageContractPreserveExact, string>> = {
	commands: "commands",
	identifiers: "identifiers",
	paths: "paths",
	"source-errors": "source error text",
	"quoted-text": "quoted text",
};

function languageName(value: LanguageContractArtifactLanguage | LanguageContractReturnLanguage): string {
	return LANGUAGE_NAMES[value] ?? value;
}

/** The marker a child writes when it cannot answer in the requested language. */
export const LANGUAGE_LIMITATION_TAG = "jouzu-language-limitation";

/** A child's report that it could not return a reliable result in the requested language. */
export interface LanguageLimitation {
	readonly contractId: string;
	readonly requested: LanguageContractReturnLanguage;
	readonly detail: string;
}

/**
 * Deep-copy and freeze a contract so a later parent-side change cannot reach the
 * holder. The copy is validated: an unknown value is rejected rather than used.
 */
export function snapshotLanguageContract(contract: LanguageContract): LanguageContract {
	if (!isLanguageContract(contract)) throw new Error("The role language contract is invalid.");
	return Object.freeze({
		contractId: contract.contractId,
		taskLanguage: contract.taskLanguage,
		artifactLanguage: contract.artifactLanguage,
		...(contract.artifactPolicy ? { artifactPolicy: Object.freeze({ ...contract.artifactPolicy }) } : {}),
		returnLanguage: contract.returnLanguage,
		preserveExact: Object.freeze([...contract.preserveExact]),
	});
}

/** Whether a contract forbids rewriting history, summaries, quotes, tool results, and code. */
export function forbidsHistoryRewrite(contract: LanguageContract): boolean {
	return contract.artifactLanguage === "preserve" && !contract.artifactPolicy;
}

/**
 * The role-facing instruction section for a contract.
 *
 * It states the language terms the role actually has and always repeats the
 * preservation rule and the limitation path. A role with no fixed language and
 * no artifact language gets preservation guidance only; it is never told to
 * translate history or to write user-facing prose.
 */
export function buildRoleLanguageSection(contract: LanguageContract): string {
	const lines: string[] = [];
	if (contract.taskLanguage === "preserve") {
		lines.push("Work in the language of the task you were given. Do not translate existing text.");
	} else {
		const name = languageName(contract.taskLanguage);
		lines.push(`Write user-facing explanations in ${name} (${contract.taskLanguage}).`);
	}
	if (contract.artifactPolicy) {
		lines.push("Artifact language policy (independent of response language):");
		for (const field of ARTIFACT_POLICY_FIELDS) {
			const language = contract.artifactPolicy[field];
			const instruction =
				language === "preserve"
					? "Preserve the existing language."
					: language === "project"
						? "Follow the project's existing language."
						: `Use ${languageName(language)} (${language}).`;
			lines.push(`- ${field}: ${instruction}`);
		}
		lines.push("Apply these choices to requested work, not as a request to translate existing files or comments.");
	} else if (contract.artifactLanguage === "preserve") {
		lines.push("Do not translate or rewrite existing files, comments, documentation, or code.");
	} else if (contract.artifactLanguage === "project") {
		lines.push("Follow the project's existing language for comments, documentation, commits, and reviews.");
	} else {
		lines.push(`Write comments, documentation, commits, and reviews in ${languageName(contract.artifactLanguage)}.`);
	}
	if (contract.returnLanguage === "parent-response-language") {
		lines.push("Return your result in the parent's response language.");
	} else if (contract.returnLanguage !== "structured") {
		lines.push(`Return your result in ${languageName(contract.returnLanguage)}.`);
	}
	const preserved = LANGUAGE_CONTRACT_PRESERVE_EXACT.filter((value) => contract.preserveExact.includes(value)).map(
		(value) => PRESERVE_EXACT_NAMES[value],
	);
	if (preserved.length) lines.push(`Preserve ${preserved.join(", ")} exactly as written; never translate them.`);
	lines.push(
		forbidsHistoryRewrite(contract)
			? "Never translate or rewrite history, summaries, quotes, tool results, or code."
			: "Preserve history, summaries, quotations, and tool results, including quoted code. Do not translate task input or existing source solely to satisfy a language preference; edit source code when the assignment requires it.",
		`If you cannot return a reliable result in the requested language, report it as a limitation with the tag ${LANGUAGE_LIMITATION_TAG} instead of translating through another model.`,
	);
	return lines.join("\n");
}

/** Build the child result note for a limitation report. */
export function buildLanguageLimitationReport(limitation: LanguageLimitation): string {
	return `${LANGUAGE_LIMITATION_TAG}: contract ${limitation.contractId}; requested ${limitation.requested}; ${limitation.detail}`;
}

/**
 * Read a limitation report out of a child result, or `undefined` when the text
 * carries none. The marker must lead a line, so ordinary prose that mentions the
 * tag is not mistaken for a report.
 */
export function parseLanguageLimitation(text: string | undefined): LanguageLimitation | undefined {
	if (!text) return undefined;
	const line = text.split("\n").find((value) => value.startsWith(`${LANGUAGE_LIMITATION_TAG}:`));
	if (!line) return undefined;
	const detail = line.slice(`${LANGUAGE_LIMITATION_TAG}:`.length).trim();
	const match = detail.match(/^contract (\S+); requested (\S+);\s*([\s\S]*)$/);
	if (!match) return undefined;
	return {
		contractId: match[1],
		requested: match[2] as LanguageContractReturnLanguage,
		detail: match[3].trim(),
	};
}

/** Whether a result text carries a limitation report. */
export function hasLanguageLimitation(text: string | undefined): boolean {
	return parseLanguageLimitation(text) !== undefined;
}

/** Resolve caller preferences without widening the role's artifact or structured-output contract. */
export function roleLanguageContract(
	role: Pick<AgentRole, "id" | "judging">,
	parent?: LanguageContract,
	profile?: "core" | "ja",
): LanguageContract {
	const contract = defaultLanguageContract(role);
	if (contract.returnLanguage !== "parent-response-language") return snapshotLanguageContract(contract);
	const language =
		parent && parent.taskLanguage !== "preserve"
			? parent.taskLanguage
			: parent && parent.returnLanguage !== "structured" && parent.returnLanguage !== "parent-response-language"
				? parent.returnLanguage
				: profile === "ja"
					? "ja"
					: undefined;
	const artifactPolicy = contract.artifactLanguage !== "preserve" ? parent?.artifactPolicy : undefined;
	const content = {
		...contract,
		...(language ? { taskLanguage: language, returnLanguage: language } : {}),
		...(artifactPolicy ? { artifactPolicy, artifactLanguage: artifactLanguageFor(artifactPolicy) } : {}),
	};
	return snapshotLanguageContract({ ...content, contractId: languageContractId(content) });
}
