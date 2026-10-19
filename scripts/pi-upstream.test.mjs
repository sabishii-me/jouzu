import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const core = "@earendil-works/pi-agent-core",
	ai = "@earendil-works/pi-ai";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, data) => writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "jouzu-pi-pin-check-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	for (const path of [
		"scripts/pi-upstream.mjs",
		"package.json",
		"package-lock.json",
		"packages/cli/package.json",
		"packages/session-ui/package.json",
		"upstream/pi.lock.json",
	]) {
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		copyFileSync(join(root, path), join(directory, path));
	}
	const pin = readJson(join(directory, "upstream/pi.lock.json"));
	const version = pin.packages["@earendil-works/pi-coding-agent"].version;
	const manifest = readJson(join(directory, "package.json"));
	const cli = readJson(join(directory, "packages/cli/package.json"));
	const lock = readJson(join(directory, "package-lock.json"));
	for (const name of [core, ai]) {
		manifest.devDependencies[name] = version;
		cli.dependencies[name] = version;
		if (!cli.bundleDependencies.includes(name)) cli.bundleDependencies.push(name);
		lock.packages[`node_modules/${name}`] ??= { version };
	}
	lock.packages[""].devDependencies = { ...manifest.devDependencies };
	lock.packages["packages/cli"].dependencies = { ...cli.dependencies };
	writeJson(join(directory, "package.json"), manifest);
	writeJson(join(directory, "packages/cli/package.json"), cli);
	writeJson(join(directory, "package-lock.json"), lock);
	return { directory, manifest, cli, lock };
}
function check(directory) {
	return spawnSync(process.execPath, [join(directory, "scripts/pi-upstream.mjs"), "check"], {
		encoding: "utf8",
		timeout: 10000,
	});
}

for (const [range, version, accepted] of [
	["^1.1.0", "1.0.0", false],
	["^1.1.0", "1.1.0", true],
	["^1.1.0", "1.9.0", true],
	["^1.1.0", "2.0.0", false],
	["~1.3.5", "1.3.0", false],
	["~1.3.5", "1.3.5", true],
	["~1.3.5", "1.3.9", true],
	["~1.3.5", "1.4.0", false],
	["^0.2.0", "0.3.0", false],
	["^0.2.3", "0.2.2", false],
	["^0.2.3", "0.2.4", true],
	["^0.0.3", "0.0.3", true],
	["^0.0.3", "0.0.4", false],
	["1.3.0", "1.3.0", true],
	["1.3.0", "1.3.1", false],
	["^1.1.0", "1.2.0-beta.1", false],
	["^01.1.0", "1.1.0", false],
	[">=1.0.0", "1.3.0", false],
]) {
	test(`Pi dependency validation ${accepted ? "accepts" : "rejects"} ${version} for ${range}`, (t) => {
		const { directory, lock } = fixture(t);
		const chord = "@earendil-works/chord";
		lock.packages["node_modules/@earendil-works/pi-server"].dependencies[chord] = range;
		lock.packages[`node_modules/${chord}`].version = version;
		writeJson(join(directory, "package-lock.json"), lock);
		const result = check(directory);
		if (accepted) assert.equal(result.status, 0, result.stderr);
		else {
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /Pi server does not target the pinned @earendil-works\/chord/);
		}
	});
}

test("the Pi offline check accepts explicit aligned core and AI dependencies", (t) => {
	const { directory } = fixture(t);
	const result = check(directory);
	assert.equal(result.status, 0, result.stderr);
});
for (const name of [core, ai]) {
	test(`the Pi offline check rejects a mismatched development ${name} pin`, (t) => {
		const { directory, manifest } = fixture(t);
		manifest.devDependencies[name] = "0.0.0";
		writeJson(join(directory, "package.json"), manifest);
		const result = check(directory);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /development pin/);
	});
}
test("the Pi offline check requires a direct aligned core runtime dependency", (t) => {
	const { directory, cli, lock } = fixture(t);
	delete cli.dependencies[core];
	delete lock.packages["packages/cli"].dependencies[core];
	writeJson(join(directory, "packages/cli/package.json"), cli);
	writeJson(join(directory, "package-lock.json"), lock);
	const result = check(directory);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /runtime pin/);
});
test("the Pi offline check requires the directly imported core runtime to be bundled", (t) => {
	const { directory, cli } = fixture(t);
	cli.bundleDependencies = cli.bundleDependencies.filter((name) => name !== core);
	writeJson(join(directory, "packages/cli/package.json"), cli);
	const result = check(directory);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /must bundle/);
});
