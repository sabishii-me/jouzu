/**
 * The language contract and the prompt epoch.
 *
 * `language-settings.ts` resolves the response language and the artifact policy
 * from the settings file, the session, the CLI, and the built-in defaults. This
 * module turns a resolution into a `LanguageContract` (the content digest plus
 * the task, artifact, return, and preserve-exact terms), composes the small
 * response-language section for a fixed language, and records a `PromptEpoch`
 * when the contract is applied.
 *
 * The response-language section is composed at runtime and is not a profile
 * asset. It is added only for a fixed language: `auto` produces no section, so
 * a session that never chose a language keeps the prompt it had. The section is
 * model-facing prompt text, so it stays English on purpose and names the target
 * language.
 *
 * ## The prompt epoch
 *
 * A `PromptEpoch` records the contract id, when it was applied, which source
 * supplied the language, and the digest of the language prompt asset (the
 * response-language section, or the empty string for `auto`). The epoch is
 * stored in the session as a Jouzu-owned custom entry, the same mechanism the
 * session-labels extension already uses (`pi.appendEntry` with a custom type).
 * Pi owns the message, compaction, and session-info entries; this module only
 * appends its own entry and never rewrites another entry.
 *
 * A language change applies from the next user turn. The running stream keeps
 * the section its turn started with. Compaction, branching, and resume record a
 * new epoch explicitly, so a reader can see where each segment began; the
 * summary, quoted text, tool results, and code entries are not touched.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import {
	ARTIFACT_POLICY_FIELDS,
	type ArtifactPolicy,
	type ResolvedArtifactPolicy,
	type ResolvedResponseLanguage,
} from "./language-settings.js";

/** The task-language values of a language contract. */
export const LANGUAGE_CONTRACT_TASK_LANGUAGES = ["preserve", "en", "ja", "zh-Hans", "zh-Hant"] as const;
export type LanguageContractTaskLanguage = (typeof LANGUAGE_CONTRACT_TASK_LANGUAGES)[number];

/** The artifact-language values of a language contract. */
export const LANGUAGE_CONTRACT_ARTIFACT_LANGUAGES = ["preserve", "project", "en", "ja", "zh-Hans", "zh-Hant"] as const;
export type LanguageContractArtifactLanguage = (typeof LANGUAGE_CONTRACT_ARTIFACT_LANGUAGES)[number];

/** The return-language values of a language contract. */
export const LANGUAGE_CONTRACT_RETURN_LANGUAGES = [
	"structured",
	"parent-response-language",
	"en",
	"ja",
	"zh-Hans",
	"zh-Hant",
] as const;
export type LanguageContractReturnLanguage = (typeof LANGUAGE_CONTRACT_RETURN_LANGUAGES)[number];

/** The exact values a contract can require to be preserved verbatim. */
export const LANGUAGE_CONTRACT_PRESERVE_EXACT = [
	"commands",
	"identifiers",
	"paths",
	"source-errors",
	"quoted-text",
] as const;
export type LanguageContractPreserveExact = (typeof LANGUAGE_CONTRACT_PRESERVE_EXACT)[number];

/**
 * The language contract for one role or agent.
 *
 * `contractId` is a digest of the other fields, so two contracts with the same
 * terms share an id and a changed term changes the id. `taskLanguage` is the
 * language the task work is written in; `artifactLanguage` the language for
 * files, commits, and reviews; `returnLanguage` the language a child returns to
 * its parent in; `preserveExact` lists the values that never translate.
 */
export interface LanguageContract {
	readonly contractId: string;
	readonly taskLanguage: LanguageContractTaskLanguage;
	readonly artifactLanguage: LanguageContractArtifactLanguage;
	readonly returnLanguage: LanguageContractReturnLanguage;
	readonly preserveExact: readonly LanguageContractPreserveExact[];
}

/** The epoch sources, matching the response-language resolution order. */
export const PROMPT_EPOCH_SOURCES = ["cli", "session", "config", "builtin"] as const;
export type PromptEpochSource = (typeof PROMPT_EPOCH_SOURCES)[number];

/**
 * The record of one applied language contract.
 *
 * `appliedAt` is an ISO timestamp. `promptDigest` is the digest of the
 * response-language section that was applied (`""` for `auto`, which adds no
 * section), so a reader can tell which prompt asset the segment used.
 */
export interface PromptEpoch {
	readonly id: string;
	readonly contractId: string;
	readonly appliedAt: string;
	readonly source: PromptEpochSource;
	readonly promptDigest: string;
}

/** The custom-entry type the epoch is stored under. It is Jouzu-owned. */
export const LANGUAGE_CONTRACT_ENTRY_TYPE = "jouzu-language-contract-v1";

/** The version of the stored epoch payload. */
export const LANGUAGE_CONTRACT_STATE_VERSION = 1;

/** The stored session payload: the contract and its latest epoch. */
export interface StoredLanguageContractState {
	readonly version: typeof LANGUAGE_CONTRACT_STATE_VERSION;
	readonly contract: LanguageContract;
	readonly epoch: PromptEpoch;
}

/** The human name for each fixed response language, used in the section. */
const RESPONSE_LANGUAGE_NAMES: Readonly<Record<LanguageContractTaskLanguage, string>> = {
	preserve: "the task's language",
	en: "English",
	ja: "Japanese",
	"zh-Hans": "Simplified Chinese",
	"zh-Hant": "Traditional Chinese",
};

/**
 * Digest a contract's content, excluding the id itself, so the id is stable for
 * equal terms and changes when a term changes.
 */
export function languageContractId(content: Omit<LanguageContract, "contractId">): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				content.taskLanguage,
				content.artifactLanguage,
				content.returnLanguage,
				[...content.preserveExact],
			]),
		)
		.digest("hex");
}

/**
 * Reduce a per-field artifact policy to the contract's single artifact
 * language. A policy whose fields all agree uses that value; a mixed policy
 * follows the project (`"project"`), which is the built-in default's intent.
 */
export function artifactLanguageFor(policy: ArtifactPolicy): LanguageContractArtifactLanguage {
	const values = ARTIFACT_POLICY_FIELDS.map((field) => policy[field]);
	const first = values[0];
	return values.every((value) => value === first) ? first : "project";
}

/** The inputs a main-agent contract is derived from. */
export interface LanguageContractInput {
	readonly responseLanguage: ResolvedResponseLanguage;
	readonly artifactPolicy: ResolvedArtifactPolicy;
}

/**
 * Build the main agent's language contract from the resolved language and
 * artifact policy.
 *
 * `auto` maps to `taskLanguage: "preserve"` (no fixed instruction) and
 * `returnLanguage: "structured"`, because there is no fixed language for the
 * main agent to return in. A fixed response language is used for both the task
 * and the return term. `preserveExact` lists every exact value, matching the
 * response-language section's preservation point.
 */
export function buildLanguageContract(input: LanguageContractInput): LanguageContract {
	const effective = input.responseLanguage.effective;
	const taskLanguage: LanguageContractTaskLanguage = effective === "auto" ? "preserve" : effective;
	const returnLanguage: LanguageContractReturnLanguage = taskLanguage === "preserve" ? "structured" : taskLanguage;
	const content = {
		taskLanguage,
		artifactLanguage: artifactLanguageFor(input.artifactPolicy.effective),
		returnLanguage,
		preserveExact: [...LANGUAGE_CONTRACT_PRESERVE_EXACT] as LanguageContractPreserveExact[],
	};
	return { contractId: languageContractId(content), ...content };
}

/**
 * The small response-language section for a fixed language, or `undefined` for
 * `auto`.
 *
 * It carries five points of the response-language contract: write user-facing explanations
 * in the chosen language; preserve commands, identifiers, paths, code, quoted
 * text, and source error text; follow the declared artifact policy and
 * terminology; do not translate files or comments unless asked; report
 * uncertainty instead of inventing a translation.
 */
export function buildResponseLanguageSection(contract: LanguageContract): string | undefined {
	if (contract.taskLanguage === "preserve") return undefined;
	const name = RESPONSE_LANGUAGE_NAMES[contract.taskLanguage];
	return [
		`Response language: ${name} (${contract.taskLanguage}). Write user-facing explanations in ${name}.`,
		"- Preserve commands, identifiers, paths, code, quoted text, and source error text exactly as written.",
		"- Follow the declared artifact policy and terminology.",
		"- Do not translate files or comments unless asked.",
		"- If you are unsure of a translation, report the uncertainty instead of inventing one.",
	].join("\n");
}

/** Digest the language prompt asset (the section, or `""` when none applies). */
export function languagePromptDigest(section: string | undefined): string {
	return createHash("sha256")
		.update(section ?? "")
		.digest("hex");
}

/** The inputs to a new epoch. */
export interface PromptEpochInput {
	readonly contract: LanguageContract;
	readonly section: string | undefined;
	readonly source: PromptEpochSource;
	readonly appliedAt: Date;
	readonly id: string;
}

/** Build a prompt epoch for one applied contract. */
export function createPromptEpoch(input: PromptEpochInput): PromptEpoch {
	return {
		id: input.id,
		contractId: input.contract.contractId,
		appliedAt: input.appliedAt.toISOString(),
		source: input.source,
		promptDigest: languagePromptDigest(input.section),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContractTaskLanguage(value: unknown): value is LanguageContractTaskLanguage {
	return (LANGUAGE_CONTRACT_TASK_LANGUAGES as readonly unknown[]).includes(value);
}

function isContractArtifactLanguage(value: unknown): value is LanguageContractArtifactLanguage {
	return (LANGUAGE_CONTRACT_ARTIFACT_LANGUAGES as readonly unknown[]).includes(value);
}

function isContractReturnLanguage(value: unknown): value is LanguageContractReturnLanguage {
	return (LANGUAGE_CONTRACT_RETURN_LANGUAGES as readonly unknown[]).includes(value);
}

function isContractPreserveExact(value: unknown): value is LanguageContractPreserveExact {
	return (LANGUAGE_CONTRACT_PRESERVE_EXACT as readonly unknown[]).includes(value);
}

/** Validate a stored contract. An unknown value is never trusted. */
export function isLanguageContract(value: unknown): value is LanguageContract {
	if (!isPlainObject(value)) return false;
	return (
		typeof value.contractId === "string" &&
		isContractTaskLanguage(value.taskLanguage) &&
		isContractArtifactLanguage(value.artifactLanguage) &&
		isContractReturnLanguage(value.returnLanguage) &&
		Array.isArray(value.preserveExact) &&
		value.preserveExact.every(isContractPreserveExact)
	);
}

/** Validate a stored epoch. An unknown value is never trusted. */
export function isPromptEpoch(value: unknown): value is PromptEpoch {
	if (!isPlainObject(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.contractId === "string" &&
		typeof value.appliedAt === "string" &&
		(PROMPT_EPOCH_SOURCES as readonly unknown[]).includes(value.source) &&
		typeof value.promptDigest === "string"
	);
}

/** Validate a stored session payload. */
export function parseStoredLanguageContractState(value: unknown): StoredLanguageContractState | undefined {
	if (!isPlainObject(value)) return undefined;
	if (value.version !== LANGUAGE_CONTRACT_STATE_VERSION) return undefined;
	if (!isLanguageContract(value.contract) || !isPromptEpoch(value.epoch)) return undefined;
	return { version: LANGUAGE_CONTRACT_STATE_VERSION, contract: value.contract, epoch: value.epoch };
}

/** Read the last stored state from a session's custom entries. */
export function readStoredLanguageContractState(
	context: Pick<ExtensionContext, "sessionManager">,
): StoredLanguageContractState | undefined {
	const saved = context.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === LANGUAGE_CONTRACT_ENTRY_TYPE)
		.at(-1);
	if (saved?.type !== "custom") return undefined;
	return parseStoredLanguageContractState(saved.data);
}

/** The mutable per-session state the extension keeps in memory. */
interface ActiveLanguageContract {
	contract: LanguageContract;
	source: PromptEpochSource;
	section: string | undefined;
	epoch?: PromptEpoch;
}

/** The options for the language-contract extension. */
export interface LanguageContractExtensionOptions {
	readonly responseLanguage: ResolvedResponseLanguage;
	readonly artifactPolicy: ResolvedArtifactPolicy;
	/** The clock, injectable for a deterministic test. */
	readonly now?: () => Date;
	/** The epoch id factory, injectable for a deterministic test. */
	readonly newEpochId?: () => string;
}

/**
 * The language-contract extension and its read surface.
 *
 * `currentSection()` is what the presentation extension composes into the
 * system prompt. `applyLanguage()` stages a change; it takes effect at the next
 * user turn, so a running stream keeps its old section.
 */
export interface LanguageContractExtension {
	readonly extension: InlineExtension;
	currentContract(): LanguageContract;
	currentSection(): string | undefined;
	currentEpoch(): PromptEpoch | undefined;
	/** The epoch read from the session on the last start, when one existed. */
	previousEpoch(): PromptEpoch | undefined;
	/** Stage a language change for the next user turn. */
	applyLanguage(responseLanguage: ResolvedResponseLanguage, artifactPolicy?: ResolvedArtifactPolicy): void;
}

function resolvedState(
	responseLanguage: ResolvedResponseLanguage,
	artifactPolicy: ResolvedArtifactPolicy,
): ActiveLanguageContract {
	const contract = buildLanguageContract({ responseLanguage, artifactPolicy });
	return { contract, source: responseLanguage.source, section: buildResponseLanguageSection(contract) };
}

/**
 * Create the language-contract extension.
 *
 * On session start the extension records an epoch. A resume keeps the saved
 * contract as the active one (so the section matches the segment that was
 * interrupted) and records a new epoch; a contract resolved from changed
 * settings is staged for the next turn. Compaction and tree navigation each
 * record a new epoch for the same contract. Only custom entries are appended:
 * the extension never rewrites a message, summary, quote, tool result, or code
 * entry.
 */
export function createLanguageContractExtension(options: LanguageContractExtensionOptions): LanguageContractExtension {
	const now = options.now ?? (() => new Date());
	const newEpochId = options.newEpochId ?? (() => randomUUID());
	let pi: ExtensionAPI | undefined;
	let active: ActiveLanguageContract | undefined;
	let staged: ActiveLanguageContract | undefined;
	let previous: PromptEpoch | undefined;

	const save = (state: ActiveLanguageContract): PromptEpoch => {
		const epoch = createPromptEpoch({
			contract: state.contract,
			section: state.section,
			source: state.source,
			appliedAt: now(),
			id: newEpochId(),
		});
		state.epoch = epoch;
		const payload: StoredLanguageContractState = {
			version: LANGUAGE_CONTRACT_STATE_VERSION,
			contract: state.contract,
			epoch,
		};
		pi?.appendEntry(LANGUAGE_CONTRACT_ENTRY_TYPE, payload);
		return epoch;
	};

	const commitStaged = (): void => {
		if (!staged) return;
		active = staged;
		staged = undefined;
		save(active);
	};

	const extension: InlineExtension = {
		name: "jouzu-language-contract",
		factory(api) {
			pi = api;
			api.on("session_start", (event, context) => {
				staged = undefined;
				const saved = readStoredLanguageContractState(context);
				previous = saved?.epoch;
				if (event.reason === "resume" && saved) {
					// Keep the interrupted segment's contract active, so the section
					// it used is still in effect. A contract from changed settings is
					// staged for the next user turn, not applied mid-session.
					const state: ActiveLanguageContract = {
						contract: saved.contract,
						source: saved.epoch.source,
						section: buildResponseLanguageSection(saved.contract),
					};
					active = state;
					const resolved = resolvedState(options.responseLanguage, options.artifactPolicy);
					if (resolved.contract.contractId !== saved.contract.contractId) staged = resolved;
					save(state);
					return;
				}
				active = resolvedState(options.responseLanguage, options.artifactPolicy);
				save(active);
			});
			// A user turn applies a staged change before the prompt is built.
			api.on("input", () => commitStaged());
			api.on("before_agent_start", () => commitStaged());
			api.on("session_compact", () => {
				if (active) save(active);
			});
			api.on("session_tree", () => {
				if (active) save(active);
			});
		},
	};

	return {
		extension,
		currentContract() {
			if (!active) throw new Error("the language contract extension has not started a session");
			return active.contract;
		},
		currentSection() {
			return active?.section;
		},
		currentEpoch() {
			return active?.epoch;
		},
		previousEpoch() {
			return previous;
		},
		applyLanguage(responseLanguage, artifactPolicy = options.artifactPolicy) {
			staged = resolvedState(responseLanguage, artifactPolicy);
		},
	};
}
