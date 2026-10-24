import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
	buildLanguageContract,
	buildResponseLanguageSection,
	createLanguageContractExtension,
	isLanguageContract,
	languageContractId,
	languagePromptDigest,
	parseStoredLanguageContractState,
} from "../dist/language-contract.js";
import { ARTIFACT_POLICY_FIELDS, resolveArtifactPolicy, resolveResponseLanguage } from "../dist/language-settings.js";

function contractFor(policy, response = "auto") {
	return buildLanguageContract({
		responseLanguage: resolveResponseLanguage({ config: response }),
		artifactPolicy: resolveArtifactPolicy({ config: policy }),
	});
}

test("each resolved artifact field changes the contract and prompt even with Automatic responses", () => {
	for (const field of ARTIFACT_POLICY_FIELDS) {
		const english = contractFor({ [field]: "en" });
		const japanese = contractFor({ [field]: "ja" });
		assert.deepEqual(english.artifactPolicy, resolveArtifactPolicy({ config: { [field]: "en" } }).effective);
		assert.notEqual(english.contractId, japanese.contractId, field);
		assert.equal(languageContractId(english), english.contractId);
		const before = buildResponseLanguageSection(english);
		const after = buildResponseLanguageSection(japanese);
		assert.match(before, new RegExp(`${field}: Use English \\(en\\)`));
		assert.match(after, new RegExp(`${field}: Use Japanese \\(ja\\)`));
		assert.notEqual(languagePromptDigest(before), languagePromptDigest(after), field);
		assert.doesNotMatch(after, /Response language:|Write user-facing explanations in/u);
		assert.match(after, /Preserve commands, identifiers, paths, code, quoted text, and source error text exactly/u);
	}
});

test("fixed response language and mixed artifact languages remain independent", () => {
	const policy = { comments: "preserve", documentation: "zh-Hant", commits: "en", reviews: "project" };
	const contract = contractFor(policy, "ja");
	const section = buildResponseLanguageSection(contract);
	assert.match(section, /Response language: Japanese \(ja\)/u);
	assert.match(section, /comments: Preserve the existing language/u);
	assert.match(section, /documentation: Use Traditional Chinese \(zh-Hant\)/u);
	assert.match(section, /commits: Use English \(en\)/u);
	assert.match(section, /reviews: Follow the project's existing language/u);
	assert.deepEqual(contract.artifactPolicy, policy);
	assert.equal(
		languageContractId({
			...contract,
			artifactPolicy: { reviews: "project", commits: "en", documentation: "zh-Hant", comments: "preserve" },
		}),
		contract.contractId,
		"the digest uses field order, not object insertion order",
	);
});

test("stored full policies reject missing, unknown, and unsupported fields while legacy contracts retain their digest", () => {
	const contract = contractFor({ commits: "ja" });
	assert.equal(isLanguageContract(contract), true);
	for (const artifactPolicy of [
		null,
		{},
		{ ...contract.artifactPolicy, commits: "fr" },
		{ ...contract.artifactPolicy, unknown: "en" },
	]) {
		assert.equal(isLanguageContract({ ...contract, artifactPolicy }), false);
	}
	const { artifactPolicy: _policy, ...legacy } = contract;
	legacy.contractId = createHash("sha256")
		.update(
			JSON.stringify([legacy.taskLanguage, legacy.artifactLanguage, legacy.returnLanguage, [...legacy.preserveExact]]),
		)
		.digest("hex");
	assert.equal(isLanguageContract(legacy), true);
	assert.equal(languageContractId(legacy), legacy.contractId);
	assert.equal(buildResponseLanguageSection(legacy), undefined);
});

test("an artifact-only change creates a new epoch at the next turn and survives resume", () => {
	const entries = [];
	let id = 0;
	const responseLanguage = resolveResponseLanguage({ config: "auto" });
	const initialPolicy = resolveArtifactPolicy({ config: { commits: "en" } });
	const nextPolicy = resolveArtifactPolicy({ session: { commits: "ja" } });
	const start = (artifactPolicy, reason) => {
		const handlers = new Map();
		const contract = createLanguageContractExtension({
			responseLanguage,
			artifactPolicy,
			now: () => new Date("2026-10-23T00:00:00Z"),
			newEpochId: () => `epoch-${++id}`,
		});
		contract.extension.factory({
			on: (event, handler) => handlers.set(event, handler),
			appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
		});
		handlers.get("session_start")({ reason }, { sessionManager: { getEntries: () => entries } });
		return { contract, handlers };
	};
	const first = start(initialPolicy, "startup");
	const before = first.contract.currentEpoch();
	first.contract.applyLanguage(responseLanguage, nextPolicy);
	assert.equal(first.contract.currentEpoch(), before);
	assert.match(first.contract.currentSection(), /commits: Use English/u);
	first.handlers.get("before_agent_start")();
	assert.notEqual(first.contract.currentEpoch().contractId, before.contractId);
	assert.notEqual(first.contract.currentEpoch().promptDigest, before.promptDigest);
	assert.match(first.contract.currentSection(), /commits: Use Japanese/u);
	const stored = parseStoredLanguageContractState(entries.at(-1).data);
	assert.equal(stored.contract.artifactPolicy.commits, "ja");
	const resumed = start(nextPolicy, "resume");
	assert.equal(resumed.contract.currentEpoch().contractId, stored.contract.contractId);
	assert.equal(resumed.contract.currentEpoch().promptDigest, stored.epoch.promptDigest);
	assert.doesNotMatch(resumed.contract.currentSection(), /Response language:/u);
});
