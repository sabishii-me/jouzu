import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inventory, stageApplication } from "./stage-application.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-stage-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const source = join(root, "prepared");
	const cli = join(source, "node_modules", "jouzu");
	mkdirSync(join(cli, "dist"), { recursive: true });
	writeFileSync(join(cli, "package.json"), JSON.stringify({ name: "jouzu", version: "0.1.18" }));
	writeFileSync(join(cli, "dist", "cli.js"), "// fixture only\n");
	writeFileSync(join(source, "package.json"), JSON.stringify({ dependencies: { jouzu: "file:C:/build/private.tgz" } }));
	writeFileSync(join(source, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/jouzu": { resolved: "file:C:/build/private.tgz" } } }));
	return { source, output: join(root, "output"), target: "windows-x64", sourceCommit: "a".repeat(40) };
}

test("stages only prepared application and preserves source", t => {
	const options = fixture(t);
	const report = stageApplication(options);
	assert.equal(report.version, "0.1.18");
	assert.equal(report.fileCount, 4);
	assert.ok(existsSync(join(options.output, report.entrypoint)));
	for (const name of ["node", "git", "terminal"]) assert.equal(existsSync(join(options.output, name)), false);
	assert.match(readFileSync(join(options.source, "package.json"), "utf8"), /private.tgz/);
	assert.doesNotMatch(readFileSync(join(options.output, "app", "package.json"), "utf8"), /private.tgz/);
	assert.deepEqual(JSON.parse(readFileSync(join(options.output, "inventory.json"), "utf8")), report);
});

test("inventory reports duplicate bytes and package trees", t => {
	const options = fixture(t);
	writeFileSync(join(options.source, "node_modules", "jouzu", "copy.js"), "// fixture only\n");
	const report = inventory(options.source);
	assert.equal(report.duplicates.length, 1);
	assert.equal(report.duplicates[0].redundantBytes, Buffer.byteLength("// fixture only\n"));
	assert.equal(report.largestPackageTrees[0].path, "node_modules/jouzu");
});

test("rejects monolithic runtime payloads", t => {
	const options = fixture(t);
	mkdirSync(join(options.source, "node"));
	assert.throws(() => stageApplication(options), /Unexpected application-prefix entry/);
	assert.equal(existsSync(options.output), false);
});

test("does not overwrite previous output", t => {
	const options = fixture(t);
	stageApplication(options);
	assert.throws(() => stageApplication(options), /Output must not exist/);
});

test("rejects output nested within source", t => {
	const options = fixture(t);
	assert.throws(() => stageApplication({ ...options, output: join(options.source, "output") }), /outside source/);
});

test("rejects bad provenance or target", t => {
	const options = fixture(t);
	assert.throws(() => stageApplication({ ...options, sourceCommit: "short" }), /source commit/);
	assert.throws(() => stageApplication({ ...options, target: "unknown" }), /Unsupported target/);
});

test("missing CLI or lockfile cannot produce a staged application", t => {
	const options = fixture(t);
	rmSync(join(options.source, "node_modules", "jouzu", "dist", "cli.js"));
	assert.throws(() => stageApplication(options), /Missing Jouzu/);
	writeFileSync(join(options.source, "node_modules", "jouzu", "dist", "cli.js"), "fixture");
	rmSync(join(options.source, "package-lock.json"));
	assert.throws(() => stageApplication(options), /lockfile is required/);
});

test("rejects linked directories without following them", t => {
    const options = fixture(t);
    symlinkSync(join(options.source, "node_modules", "jouzu"), join(options.source, "node_modules", "linked"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => stageApplication(options), /Linked entries/);
    assert.equal(existsSync(options.output), false);
});
