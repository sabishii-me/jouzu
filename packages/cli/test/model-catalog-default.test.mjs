import assert from "node:assert/strict";
import test from "node:test";
import { catalogDefaultCandidates } from "../dist/model-catalog-default.js";

function catalog(offerings, catalogId = "example") {
	return {
		document: {
			catalogId,
			modelOfferings: offerings.map((offering) => ({
				providerId: "gateway",
				modelId: offering.id,
				...offering,
			})),
		},
	};
}

const ids = (catalogs) => catalogDefaultCandidates(catalogs).map((reference) => reference.modelId);

test("catalog defaults rank higher integer priorities first, independently of inventory order", () => {
	const offerings = [
		{ id: "flash", metadata: { default: 50 } },
		{ id: "other" },
		{ id: "flash-next", metadata: { default: 100 } },
	];
	assert.deepEqual(ids([catalog(offerings)]), ["flash-next", "flash"]);
	assert.deepEqual(ids([catalog([...offerings].reverse())]), ["flash-next", "flash"]);
});

test("missing, malformed, and unsafe priorities are ignored without coercion", () => {
	const invalid = [undefined, null, "100", true, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
	const offerings = invalid.map((value, index) => ({ id: `invalid-${index}`, metadata: { default: value } }));
	offerings.push({ id: "array", metadata: [] }, { id: "string", metadata: "100" });
	assert.deepEqual(ids([catalog(offerings)]), []);
});

test("zero and negative integer priorities are valid explicit hints; absence is not zero", () => {
	assert.deepEqual(
		ids([
			catalog([
				{ id: "negative", metadata: { default: -1 } },
				{ id: "absent" },
				{ id: "zero", metadata: { default: 0 } },
			]),
		]),
		["zero", "negative"],
	);
});

test("unavailable offerings are skipped and ties use stable catalog-qualified identity", () => {
	const first = catalog([
		{ id: "z", metadata: { default: 50 } },
		{ id: "unavailable", metadata: { default: 100 }, availability: { status: "unavailable" } },
		{ id: "a", metadata: { default: 50 } },
	]);
	const second = catalog([{ id: "z", metadata: { default: 50 } }], "another");
	assert.deepEqual(catalogDefaultCandidates([first, second]), catalogDefaultCandidates([second, first]));
	assert.deepEqual(ids([first]), ["a", "z"]);
	assert.deepEqual(catalogDefaultCandidates([first, first]), catalogDefaultCandidates([first]));
	assert.deepEqual(catalogDefaultCandidates([first])[0], {
		catalogId: "example",
		offeringId: "a",
		provider: "gateway",
		modelId: "a",
	});
});
