/**
 * The language contract and prompt epoch.
 *
 * The tests read the compiled `dist` modules, so `npm run build` must run first.
 * They cover the contract and epoch types and their builders, the
 * response-language section (`auto` adds none, a fixed language adds exactly
 * one), its composition with the existing guidance, the epoch's persistence in
 * session metadata and its reproduction on resume, the next-turn application of
 * a change, the explicit new epoch on compaction/branching/resume, and the
 * promise that summaries, quotes, tool results, and code are never rewritten.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	artifactLanguageFor,
	buildLanguageContract,
	buildResponseLanguageSection,
	createLanguageContractExtension,
	createPromptEpoch,
	isLanguageContract,
	isPromptEpoch,
	LANGUAGE_CONTRACT_ENTRY_TYPE,
	LANGUAGE_CONTRACT_PRESERVE_EXACT,
	LANGUAGE_CONTRACT_STATE_VERSION,
	languageContractId,
	languagePromptDigest,
	parseStoredLanguageContractState,
} from "../dist/language-contract.js";
import { resolveArtifactPolicy, resolveResponseLanguage } from "../dist/language-settings.js";
import {
	brandDefaultSystemPrompt,
	buildCapabilityRoutingGuidance,
	createJouzuPresentationExtension,
	JOUZU_DEFAULT_GUIDANCE,
} from "../dist/presentation.js";

const resolvedJa = () => resolveResponseLanguage({ cli: "ja" });
const resolvedEn = () => resolveResponseLanguage({ cli: "en" });
const resolvedAuto = () => resolveResponseLanguage({});
const defaultPolicy = () => resolveArtifactPolicy({});
const contractJa = () => buildLanguageContract({ responseLanguage: resolvedJa(), artifactPolicy: defaultPolicy() });

const UPSTREAM_PROMPT =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\n\nAvailable tools:\n- read: Read file contents\n\nGuidelines:\n- Be concise in your responses";

const presentationMetadata = {
	jouzuVersion: "0.1.0",
	displayVersion: "0.1.0",
	build: undefined,
	piVersion: "0.84.2",
	profileSchemaVersion: 1,
	lock: { tag: "v0.84.2", tagCommit: "commit", commit: "commit", compatibilityStatus: "qualified", deviations: [] },
};
const presentationProfile = { id: "core", source: "default" };

// --- T07: the LanguageContract and PromptEpoch types ------------------------

test("builds a language contract whose id covers its content", () => {
	const contract = contractJa();
	assert.equal(contract.taskLanguage, "ja");
	assert.equal(contract.artifactLanguage, "project");
	assert.equal(contract.returnLanguage, "ja");
	assert.deepEqual([...contract.preserveExact], [...LANGUAGE_CONTRACT_PRESERVE_EXACT]);
	assert.equal(contract.contractId, languageContractId(contract));
	assert.equal(isLanguageContract(contract), true);

	// `auto` maps to preserve, with no fixed return language.
	const auto = buildLanguageContract({ responseLanguage: resolvedAuto(), artifactPolicy: defaultPolicy() });
	assert.equal(auto.taskLanguage, "preserve");
	assert.equal(auto.returnLanguage, "structured");
	assert.notEqual(auto.contractId, contract.contractId);

	// A changed term changes the id, and an equal contract keeps it.
	assert.equal(languageContractId(auto), auto.contractId);
	assert.equal(
		languageContractId({ ...contract, artifactLanguage: "en" }),
		languageContractId({ ...contract, artifactLanguage: "en" }),
	);
	assert.notEqual(languageContractId({ ...contract, artifactLanguage: "en" }), contract.contractId);
});

test("an artifact policy whose fields agree collapses to that language; a mixed policy follows the project", () => {
	assert.equal(artifactLanguageFor({ comments: "ja", documentation: "ja", commits: "ja", reviews: "ja" }), "ja");
	assert.equal(
		artifactLanguageFor({ comments: "preserve", documentation: "preserve", commits: "preserve", reviews: "preserve" }),
		"preserve",
	);
	assert.equal(artifactLanguageFor(resolveArtifactPolicy({}).effective), "project");
});

test("a prompt epoch records the contract id, the source, the time, and the prompt digest", () => {
	const contract = contractJa();
	const section = buildResponseLanguageSection(contract);
	const epoch = createPromptEpoch({
		contract,
		section,
		source: "config",
		appliedAt: new Date("2026-10-10T12:34:56.000Z"),
		id: "epoch-1",
	});
	assert.deepEqual(epoch, {
		id: "epoch-1",
		contractId: contract.contractId,
		appliedAt: "2026-10-10T12:34:56.000Z",
		source: "config",
		promptDigest: languagePromptDigest(section),
	});
	assert.equal(isPromptEpoch(epoch), true);
	assert.notEqual(languagePromptDigest(section), languagePromptDigest(undefined));
	assert.equal(languagePromptDigest(undefined), languagePromptDigest(""));
});

test("a stored payload round-trips and an unknown shape is rejected", () => {
	const contract = contractJa();
	const epoch = createPromptEpoch({
		contract,
		section: buildResponseLanguageSection(contract),
		source: "cli",
		appliedAt: new Date("2026-10-10T00:00:00.000Z"),
		id: "epoch-1",
	});
	const payload = { version: LANGUAGE_CONTRACT_STATE_VERSION, contract, epoch };
	assert.deepEqual(parseStoredLanguageContractState(payload), payload);
	for (const bad of [
		undefined,
		{},
		{ version: 2, contract, epoch },
		{ version: LANGUAGE_CONTRACT_STATE_VERSION, contract: { ...contract, taskLanguage: "fr" }, epoch },
		{ version: LANGUAGE_CONTRACT_STATE_VERSION, contract, epoch: { ...epoch, source: "os" } },
	])
		assert.equal(parseStoredLanguageContractState(bad), undefined, JSON.stringify(bad));
});

// --- T08: the response-language section -------------------------------------

test("auto adds no section and a fixed language adds exactly one small section", () => {
	const auto = buildLanguageContract({ responseLanguage: resolvedAuto(), artifactPolicy: defaultPolicy() });
	assert.equal(buildResponseLanguageSection(auto), undefined);

	const section = buildResponseLanguageSection(contractJa());
	assert.equal(typeof section, "string");
	assert.match(section, /^Response language: Japanese \(ja\)\./u);
	// The five points of the design.
	assert.match(section, /Write user-facing explanations in Japanese/u);
	assert.match(section, /Preserve commands, identifiers, paths, code, quoted text, and source error text/u);
	assert.match(section, /Follow the declared artifact policy and terminology/u);
	assert.match(section, /Do not translate files or comments unless asked/u);
	assert.match(section, /report the uncertainty instead of inventing one/u);
	// One heading and four bullets: exactly one small section.
	assert.equal(section.split("\n").length, 5);
});

test("each fixed language names itself in its own section", () => {
	for (const [tag, name] of [
		["en", "English"],
		["ja", "Japanese"],
		["zh-Hans", "Simplified Chinese"],
		["zh-Hant", "Traditional Chinese"],
	]) {
		const contract = buildLanguageContract({
			responseLanguage: resolveResponseLanguage({ cli: tag }),
			artifactPolicy: defaultPolicy(),
		});
		const section = buildResponseLanguageSection(contract);
		assert.match(section, new RegExp(`^Response language: ${name} \\(${tag}\\)\\.`, "u"), tag);
		assert.match(section, new RegExp(`Write user-facing explanations in ${name}`, "u"), tag);
	}
});

// --- T09: composition with the existing guidance ----------------------------

test("the section composes after the existing guidance without changing it", () => {
	const routingOptions = { customPrompt: undefined, selectedTools: ["read", "bg_task", "web_fetch"], skills: [] };
	const routing = buildCapabilityRoutingGuidance(routingOptions);
	const before = brandDefaultSystemPrompt(UPSTREAM_PROMPT, undefined, routing);
	// Omitting the section keeps the exact pre-language-contract output.
	assert.equal(brandDefaultSystemPrompt(UPSTREAM_PROMPT, undefined, routing, undefined), before);
	assert.equal(
		brandDefaultSystemPrompt(UPSTREAM_PROMPT, undefined, undefined),
		brandDefaultSystemPrompt(UPSTREAM_PROMPT),
	);

	const section = buildResponseLanguageSection(contractJa());
	const after = brandDefaultSystemPrompt(UPSTREAM_PROMPT, undefined, routing, section);
	// The existing prompt is byte-identical, with the section inserted after the
	// capability routing and before Pi's remaining prompt.
	assert.equal(after, before.replace("\n\nAvailable tools:", `\n\n${section}\n\nAvailable tools:`));
	const order = [JOUZU_DEFAULT_GUIDANCE, routing, section].map((part) => after.indexOf(part));
	assert.deepEqual(
		order,
		[...order].sort((a, b) => a - b),
	);
	assert.ok(order.every((index) => index >= 0));
	// A user-owned prompt is untouched, so the section never overrides it.
	assert.equal(brandDefaultSystemPrompt(UPSTREAM_PROMPT, "user-owned", routing, section), UPSTREAM_PROMPT);
});

test("the presentation extension composes the section for the active contract", () => {
	const section = buildResponseLanguageSection(contractJa());
	const handlers = new Map();
	const pi = {
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: () => {},
		registerTool: () => {},
		sendMessage: async () => {},
		events: { emit: () => {} },
	};
	createJouzuPresentationExtension(presentationMetadata, presentationProfile, {
		colorMode: "none",
		responseLanguageSection: () => section,
	}).factory(pi);
	const options = { customPrompt: undefined, selectedTools: ["read"], skills: [] };
	const result = handlers.get("before_agent_start")({ systemPrompt: UPSTREAM_PROMPT, systemPromptOptions: options });
	assert.equal(
		result.systemPrompt,
		brandDefaultSystemPrompt(UPSTREAM_PROMPT, undefined, buildCapabilityRoutingGuidance(options), section),
	);
	assert.match(result.systemPrompt, /Response language: Japanese \(ja\)/u);
});

// --- T10: epoch persistence and resume --------------------------------------

function epochFixture({
	entries = [],
	responseLanguage = resolvedJa(),
	artifactPolicy = defaultPolicy(),
	idPrefix = "epoch",
} = {}) {
	const handlers = new Map();
	let idCounter = 0;
	const languageContract = createLanguageContractExtension({
		responseLanguage,
		artifactPolicy,
		now: () => new Date("2026-10-10T00:00:00.000Z"),
		newEpochId: () => `${idPrefix}-${++idCounter}`,
	});
	const pi = {
		on: (event, handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
	};
	languageContract.extension.factory(pi);
	const ctx = { sessionManager: { getEntries: () => entries } };
	const emit = (event, data = {}) => {
		for (const handler of handlers.get(event) ?? []) handler(data, ctx);
	};
	const epochs = () => entries.filter((entry) => entry.customType === LANGUAGE_CONTRACT_ENTRY_TYPE);
	return { languageContract, entries, epochs, emit, ctx };
}

test("the epoch is saved to session metadata and reproduced on resume", () => {
	const first = epochFixture();
	first.emit("session_start", { type: "session_start", reason: "startup" });
	const stored = first.epochs();
	assert.equal(stored.length, 1);
	const epoch = stored[0].data.epoch;
	assert.equal(epoch.contractId, first.languageContract.currentContract().contractId);
	assert.equal(epoch.promptDigest, languagePromptDigest(first.languageContract.currentSection()));
	assert.equal(epoch.source, "cli");
	assert.equal(epoch.appliedAt, "2026-10-10T00:00:00.000Z");
	// The entry is Jouzu-owned and carries the contract alongside the epoch.
	assert.equal(stored[0].type, "custom");
	assert.equal(stored[0].customType, "jouzu-language-contract-v1");
	assert.equal(parseStoredLanguageContractState(stored[0].data).contract.contractId, epoch.contractId);

	// Resume reads the saved entry, reports it as the previous epoch, and records
	// a new epoch with the same contract and prompt digest.
	const resumed = epochFixture({ entries: structuredClone(first.entries), idPrefix: "resumed" });
	resumed.emit("session_start", { type: "session_start", reason: "resume" });
	assert.equal(resumed.languageContract.previousEpoch().id, epoch.id);
	const reproduced = resumed.languageContract.currentEpoch();
	assert.notEqual(reproduced.id, epoch.id);
	assert.equal(reproduced.contractId, epoch.contractId);
	assert.equal(reproduced.promptDigest, epoch.promptDigest);
	assert.equal(resumed.epochs().length, 2);
});

test("a resume keeps the saved section and stages a changed setting for the next turn", () => {
	const first = epochFixture();
	first.emit("session_start", { type: "session_start", reason: "startup" });
	const resumed = epochFixture({
		entries: structuredClone(first.entries),
		responseLanguage: resolvedEn(),
		idPrefix: "resumed",
	});
	resumed.emit("session_start", { type: "session_start", reason: "resume" });
	// The interrupted segment's contract is still active, so its section is
	// unchanged until the next user turn.
	assert.equal(resumed.languageContract.currentContract().taskLanguage, "ja");
	assert.match(resumed.languageContract.currentSection(), /Japanese/u);
	// The changed setting applies from the next turn.
	resumed.emit("input", { type: "input", text: "next", source: "interactive" });
	assert.equal(resumed.languageContract.currentContract().taskLanguage, "en");
	assert.match(resumed.languageContract.currentSection(), /English/u);
});

// --- T11: the change applies from the next turn -----------------------------

test("a language change applies from the next turn and leaves emitted text unchanged", () => {
	const f = epochFixture();
	f.emit("session_start", { type: "session_start", reason: "startup" });
	const beforeSection = f.languageContract.currentSection();
	const beforeEpoch = f.languageContract.currentEpoch();
	const emitted = { type: "message", id: "m1", message: { role: "assistant", content: "すでに出た文" } };
	f.entries.push(structuredClone(emitted));

	f.languageContract.applyLanguage(resolvedEn());
	// The running turn keeps its old section and epoch.
	assert.equal(f.languageContract.currentSection(), beforeSection);
	assert.equal(f.languageContract.currentEpoch().id, beforeEpoch.id);

	f.emit("input", { type: "input", text: "next", source: "interactive" });
	assert.notEqual(f.languageContract.currentSection(), beforeSection);
	assert.notEqual(f.languageContract.currentEpoch().id, beforeEpoch.id);
	// The already-emitted text is byte-identical.
	assert.deepEqual(
		f.entries.find((entry) => entry.id === "m1"),
		emitted,
	);
});

// --- T12: a new epoch on compaction, branching, and resume ------------------

test("compaction, branching, and resume each record a new epoch explicitly", () => {
	const f = epochFixture();
	f.emit("session_start", { type: "session_start", reason: "startup" });
	const start = f.languageContract.currentEpoch().id;
	f.emit("session_compact", { type: "session_compact", reason: "manual" });
	const compacted = f.languageContract.currentEpoch().id;
	assert.notEqual(compacted, start);
	f.emit("session_tree", { type: "session_tree" });
	const branched = f.languageContract.currentEpoch().id;
	assert.notEqual(branched, compacted);
	assert.deepEqual(
		f.epochs().map((entry) => entry.data.epoch.id),
		[start, compacted, branched],
	);

	// Resume is a fourth explicit boundary.
	const resumed = epochFixture({ entries: structuredClone(f.entries), idPrefix: "resumed" });
	resumed.emit("session_start", { type: "session_start", reason: "resume" });
	assert.equal(resumed.epochs().length, 4);
	assert.notEqual(resumed.languageContract.currentEpoch().id, branched);
});

// --- T13: no rewriting of summaries, quotes, tool results, or code ----------

test("summaries, quotes, tool results, and code entries are never rewritten", () => {
	const preserved = [
		{ type: "compaction", id: "c1", summary: "要約テキスト" },
		{ type: "branch_summary", id: "b1", summary: "branch の要約" },
		{ type: "message", id: "q1", message: { role: "user", content: "> quoted text\n> 引用" } },
		{ type: "message", id: "t1", message: { role: "toolResult", content: "tool output 出力" } },
		{ type: "message", id: "code1", message: { role: "assistant", content: "```js\nconst x = 1;\n```" } },
	];
	const f = epochFixture();
	f.entries.push(...structuredClone(preserved));
	const snapshot = structuredClone(f.entries);
	f.emit("session_start", { type: "session_start", reason: "startup" });
	f.emit("session_compact", { type: "session_compact" });
	f.emit("session_tree", { type: "session_tree" });
	f.languageContract.applyLanguage(resolvedEn());
	f.emit("before_agent_start", { type: "before_agent_start" });
	// Every pre-existing entry is byte-identical, and only custom entries were
	// appended after it.
	assert.deepEqual(f.entries.slice(0, snapshot.length), snapshot);
	assert.ok(f.entries.slice(snapshot.length).every((entry) => entry.type === "custom"));
	assert.ok(f.entries.slice(snapshot.length).every((entry) => entry.customType === LANGUAGE_CONTRACT_ENTRY_TYPE));
});
