import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPickerRows } from "../dist/model-picker-ranking.js";
import { emptyModelPickerState } from "../dist/model-picker-state.js";

const projectKey = "a".repeat(64);
const models = [
	{
		provider: "anthropic",
		modelId: "claude-sonnet-test",
		name: "Claude Sonnet Test",
		contextWindow: 200_000,
		maxTokens: 16_000,
		available: true,
	},
	{
		provider: "openai",
		modelId: "gpt-test",
		name: "GPT Test",
		contextWindow: 32_000,
		maxTokens: 8_000,
		available: true,
	},
	{
		provider: "openrouter",
		modelId: "anthropic/claude-sonnet-test",
		name: "Claude Sonnet Test via OpenRouter",
		contextWindow: 200_000,
		maxTokens: 16_000,
		available: true,
	},
];

function state() {
	const value = emptyModelPickerState();
	value.favorites = [
		{
			provider: "missing-provider",
			modelId: "retired-model",
			addedAt: "2026-08-23T00:00:00.000Z",
		},
		{
			provider: "openai",
			modelId: "gpt-test",
			addedAt: "2026-08-23T00:00:01.000Z",
		},
	];
	value.recents.projects[projectKey] = [
		{
			provider: "openrouter",
			modelId: "anthropic/claude-sonnet-test",
			lastUsedAt: "2026-08-23T00:01:00.000Z",
			useCount: 1,
		},
	];
	value.recents.global = [
		{ provider: "anthropic", modelId: "claude-sonnet-test", lastUsedAt: "2026-08-23T00:02:00.000Z", useCount: 2 },
	];
	return value;
}

test("search indexes sanitized provider display names independently of provider IDs", () => {
	const inventory = [
		{
			provider: "vendor-17",
			providerName: "\u001b[31mAcme Labs\u001b[0m",
			modelId: "r1",
			name: "Reasoner",
			available: true,
		},
	];
	for (const query of ["Acme Labs", "acme", "vendor-17", "reasoner"]) {
		const matches = buildPickerRows({ models: inventory, state: emptyModelPickerState(), projectKey, query });
		assert.equal(matches.length, 1, query);
		assert.equal(matches[0].model.display.providerName, "Acme Labs");
	}
});

test("empty query lists current, previous, favorites, recents, then the rest alphabetically", () => {
	const inventory = [
		...models,
		{ provider: "zeta", modelId: "alpha-model", name: "Alpha Model", available: true },
		{ provider: "beta", modelId: "omega-model", name: "Omega Model", available: true },
	];
	const rows = buildPickerRows({
		models: inventory,
		state: state(),
		projectKey,
		current: { provider: "anthropic", modelId: "claude-sonnet-test" },
		previous: [{ provider: "openrouter", modelId: "anthropic/claude-sonnet-test" }],
		activeContextTokens: 30_000,
	});

	assert.deepEqual(
		rows.map((row) => [row.section, row.model.provider, row.model.modelId]),
		[
			["current", "anthropic", "claude-sonnet-test"],
			["previous", "openrouter", "anthropic/claude-sonnet-test"],
			["favorite", "missing-provider", "retired-model"],
			["favorite", "openai", "gpt-test"],
			["other", "zeta", "alpha-model"],
			["other", "beta", "omega-model"],
		],
	);
	assert.equal(rows[2].model.available, false, "an unresolved favorite stays visible as unavailable");
	assert.equal(rows[3].contextFit, "too-small");
	assert.equal(rows[3].favorite, true);
});

test("favoritesOnly returns saved favorites in order for favorite cycling", () => {
	const favorites = buildPickerRows({ models, state: state(), projectKey, favoritesOnly: true });
	assert.deepEqual(
		favorites.map((row) => [row.section, row.model.provider, row.model.modelId]),
		[
			["favorite", "missing-provider", "retired-model"],
			["favorite", "openai", "gpt-test"],
		],
	);
});

test("recents follow favorites with project history before global history", () => {
	const recentState = state();
	recentState.favorites = [];
	const rows = buildPickerRows({ models, state: recentState, projectKey });
	assert.deepEqual(
		rows.map((row) => [row.section, row.recentScope, row.model.provider]),
		[
			["recent", "project", "openrouter"],
			["recent", "global", "anthropic"],
			["other", undefined, "openai"],
		],
	);
});

test("rows display the catalog provider name and fall back to the provider and model IDs", () => {
	const rows = buildPickerRows({
		models: [
			{
				provider: "shisa",
				providerName: "Shisa AI",
				modelId: "shisa-v2.1-70b",
				name: "Shisa V2.1 70B",
				available: true,
			},
			{ provider: "local", modelId: "unnamed", name: "", available: true },
		],
		state: emptyModelPickerState(),
		projectKey,
	});
	assert.deepEqual(
		rows.map((row) => [row.model.display.name, row.model.display.providerName]),
		[
			["Shisa V2.1 70B", "Shisa AI"],
			["unnamed", "local"],
		],
	);
});
test("context fit reserves Pi's safety margin instead of the model output cap", () => {
	const limits = [
		{ provider: "local", modelId: "equal-cap", name: "Equal Cap", contextWindow: 8_000, maxTokens: 8_000 },
		{ provider: "hosted", modelId: "large-output", name: "Large Output", contextWindow: 200_000, maxTokens: 64_000 },
	].map((model) => ({ ...model, available: true }));
	const pickerState = emptyModelPickerState();

	const lightlyUsed = buildPickerRows({
		models: limits,
		state: pickerState,
		projectKey,
		activeContextTokens: 1_000,
	});
	assert.deepEqual(
		lightlyUsed.map((row) => row.contextFit),
		["fits", "fits"],
		"a model whose output cap equals its window must still accept a small active context",
	);

	const boundary = (activeContextTokens) =>
		buildPickerRows({
			models: [
				{
					provider: "p",
					modelId: "boundary",
					name: "Boundary",
					contextWindow: 128_000,
					maxTokens: 16_000,
					available: true,
				},
			],
			state: pickerState,
			projectKey,
			activeContextTokens,
		})[0].contextFit;
	assert.equal(boundary(120_000), "fits");
	assert.equal(boundary(123_904), "fits");
	assert.equal(boundary(123_905), "too-small");
});

test("catalog-qualified identities prevent cross-catalog collisions while legacy pairs still resolve", () => {
	const catalogModels = [
		{
			catalogId: "ai.example.one",
			offeringId: "offering-1",
			provider: "shared",
			modelId: "same-model",
			name: "One",
			available: true,
		},
		{
			catalogId: "ai.example.two",
			offeringId: "offering-2",
			provider: "shared",
			modelId: "same-model",
			name: "Two",
			available: true,
		},
	];
	const catalogState = emptyModelPickerState();
	catalogState.favorites = catalogModels.map((model, index) => ({
		catalogId: model.catalogId,
		offeringId: model.offeringId,
		provider: model.provider,
		modelId: model.modelId,
		addedAt: `2026-08-23T00:00:0${index}.000Z`,
	}));
	const favorites = buildPickerRows({ models: catalogModels, state: catalogState, projectKey, favoritesOnly: true });
	assert.deepEqual(
		favorites.map((row) => [row.model.catalogId, row.model.offeringId, row.model.available]),
		[
			["ai.example.one", "offering-1", true],
			["ai.example.two", "offering-2", true],
		],
	);

	catalogState.recents.global = [
		{
			provider: "shared",
			modelId: "same-model",
			lastUsedAt: "2026-08-23T00:01:00.000Z",
			useCount: 1,
		},
	];
	const legacy = buildPickerRows({ models: catalogModels, state: catalogState, projectKey });
	assert.equal(legacy[0].model.catalogId, "ai.example.one");
});

test("typed query ranks exact provider identity before proxy-provider IDs and recency", () => {
	const rows = buildPickerRows({
		models,
		state: state(),
		projectKey,
		query: "anthropic/claude-sonnet-test",
	});
	assert.deepEqual(
		rows.slice(0, 2).map((row) => `${row.model.provider}/${row.model.modelId}`),
		["anthropic/claude-sonnet-test", "openrouter/anthropic/claude-sonnet-test"],
	);
});

test("typed search normalizes Unicode while display text strips terminal controls", () => {
	const dirtyModels = [
		...models,
		{
			provider: "local\u001b[31m\u009bunsafe",
			modelId: "Ｑｗｅｎ-test",
			name: "Qwen\u0007\u009d Test",
			available: true,
		},
	];
	const first = buildPickerRows({ models: dirtyModels, state: state(), projectKey, query: "qwen" });
	const second = buildPickerRows({ models: dirtyModels, state: state(), projectKey, query: "ｑｗｅｎ" });
	assert.equal(first[0].model.modelId, "Ｑｗｅｎ-test");
	assert.equal(first[0].model.provider.includes("\u001b[31m\u009b"), true, "semantic identity must remain byte-exact");
	assert.equal(first[0].model.name.includes("\u0007\u009d"), true, "the source label must remain available");
	assert.equal(first[0].model.display.provider.includes("\u001b"), false);
	assert.equal(first[0].model.display.provider.includes("\u009b"), false);
	assert.equal(first[0].model.display.name.includes("\u0007"), false);
	assert.equal(first[0].model.display.name.includes("\u009d"), false);
	assert.deepEqual(first, second);
});

test("query ties among other models are stable regardless of inventory order", () => {
	const candidates = [
		{ provider: "b", modelId: "x1", name: "Same", available: true },
		{ provider: "a", modelId: "x2", name: "Same", available: true },
	];
	const rank = (inventory) =>
		buildPickerRows({ models: inventory, state: state(), projectKey, query: "x" }).map(
			(row) => `${row.model.provider}/${row.model.modelId}`,
		);
	assert.deepEqual(rank(candidates), ["a/x2", "b/x1"]);
	assert.deepEqual(rank([...candidates].reverse()), ["a/x2", "b/x1"]);
});

test("typed search reaches inventory models that are not current, favorite, or recent", () => {
	const inventory = [
		...models,
		{
			provider: "kimi-coding",
			modelId: "k3",
			name: "Kimi K3",
			contextWindow: 1_048_576,
			maxTokens: 131_072,
			available: true,
		},
		{
			provider: "kimi-coding",
			modelId: "k3-256k",
			name: "Kimi K3-256K",
			contextWindow: 262_144,
			maxTokens: 131_072,
			available: true,
		},
	];
	const rows = buildPickerRows({ models: inventory, state: state(), projectKey, query: "k3" });
	assert.deepEqual(
		rows.map((row) => [row.section, row.model.provider, row.model.modelId]),
		[
			["other", "kimi-coding", "k3"],
			["other", "kimi-coding", "k3-256k"],
		],
	);
});
test("search ranks an exact identity above a favorite prefix match", () => {
	const inventory = [
		{
			provider: "kimi-coding",
			modelId: "k3",
			name: "Kimi K3",
			contextWindow: 1_048_576,
			maxTokens: 131_072,
			available: true,
		},
		{
			provider: "kimi-coding",
			modelId: "k3-256k",
			name: "Kimi K3-256K",
			contextWindow: 262_144,
			maxTokens: 131_072,
			available: true,
		},
	];
	const favoriteState = emptyModelPickerState();
	favoriteState.favorites = [{ provider: "kimi-coding", modelId: "k3-256k", addedAt: "2026-09-02T05:41:46.759Z" }];
	const rows = buildPickerRows({ models: inventory, state: favoriteState, projectKey, query: "k3" });
	assert.deepEqual(
		rows.map((row) => [row.section, row.model.modelId, row.favorite]),
		[
			["other", "k3", false],
			["favorite", "k3-256k", true],
		],
	);
});
test("search breaks equal text scores with the empty-query order", () => {
	const inventory = [
		{ provider: "a", modelId: "sol", name: "Sol", available: true },
		{ provider: "b", modelId: "sol", name: "Sol", available: true },
	];
	const recentState = emptyModelPickerState();
	recentState.recents.projects[projectKey] = [
		{ provider: "b", modelId: "sol", lastUsedAt: "2026-09-01T00:00:00.000Z", useCount: 1 },
	];
	const rows = buildPickerRows({ models: inventory, state: recentState, projectKey, query: "sol" });
	assert.deepEqual(
		rows.map((row) => [row.section, row.model.provider]),
		[
			["recent", "b"],
			["other", "a"],
		],
	);
});
