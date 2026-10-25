import assert from "node:assert/strict";
import { test } from "node:test";

import { packedTarballEntry } from "./pack-output.mjs";

const entry = { filename: "jouzu-0.1.19.tgz", integrity: "sha512-probe", files: [] };

test("reads the array shape printed by npm 11 and earlier", () => {
	assert.deepEqual(packedTarballEntry(JSON.stringify([entry])), entry);
});

test("reads the object shape printed by npm 12", () => {
	assert.deepEqual(packedTarballEntry(JSON.stringify({ jouzu: entry })), entry);
});

test("returns the first entry of an array", () => {
	const second = { ...entry, filename: "second.tgz" };
	assert.equal(packedTarballEntry(JSON.stringify([entry, second])).filename, entry.filename);
});

test("rejects output that is not JSON", () => {
	assert.throws(() => packedTarballEntry("npm error code ETARGET\nnpm error notarget"), /did not print JSON/u);
});

test("rejects a parsed value that carries no tarball entry", () => {
	assert.throws(() => packedTarballEntry(JSON.stringify({})), /printed no tarball entry/u);
	assert.throws(
		() => packedTarballEntry(JSON.stringify({ jouzu: { id: "jouzu@0.1.19" } })),
		/printed no tarball entry/u,
	);
	assert.throws(() => packedTarballEntry(JSON.stringify("jouzu-0.1.19.tgz")), /printed no tarball entry/u);
	assert.throws(() => packedTarballEntry("null"), /printed no tarball entry/u);
});

test("keeps the reported output short enough to read in a failure", () => {
	let failure;
	assert.throws(
		() => packedTarballEntry("x".repeat(5000)),
		(error) => {
			failure = error;
			return true;
		},
	);
	assert.ok(failure.message.length < 300, `message was ${failure.message.length} characters`);
	assert.match(failure.message, /…$/u);
});
