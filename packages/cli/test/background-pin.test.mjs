import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const commit = "1ab9fef053de921ea9d1741bf547cfed47808147";
const name = "@vanillagreen/pi-background-tasks";
const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("reviewed background batching is pinned and installed with recovery modules", () => {
	const manifest = readJson("../package.json");
	const release = readJson("../release-extensions.json").packages.find((entry) => entry.name === name);
	assert.equal(manifest.dependencies[name], `git+https://github.com/shisa-ai/kendex.git#${commit}`);
	assert.equal(release.commit, commit);
	for (const lockPath of ["../package-lock.json", "../../../package-lock.json"]) {
		const lock = readJson(lockPath);
		const entry = lock.packages[`node_modules/${name}`] ?? lock.packages[`packages/cli/node_modules/${name}`];
		assert.ok(entry?.resolved?.endsWith(`#${commit}`));
	}
	for (const module of ["completion-delivery.ts", "completion-recovery.ts", "completion-message.ts"]) {
		assert.ok(existsSync(new URL(`../node_modules/${name}/extensions/${module}`, import.meta.url)), module);
	}
});
