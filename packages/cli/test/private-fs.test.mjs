import assert from "node:assert/strict";
import fs, {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

import {
	copyPrivateFile,
	ensurePrivateDirectory,
	PrivatePathError,
	writeFilePrivateAtomic,
	writeFilePrivateExclusive,
} from "../dist/private-fs.js";

function modeOf(path) {
	return statSync(path).mode & 0o777;
}

test("private roots, cache descendants, backups, and files use deterministic modes", {
	skip: process.platform === "win32" ? "POSIX permission assertion" : false,
}, () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-private-fs-"));
	try {
		const callerRoot = join(temporary, "caller-home");
		mkdirSync(callerRoot, { mode: 0o755 });
		const stateRoot = join(callerRoot, "state");
		mkdirSync(stateRoot, { mode: 0o755 });
		ensurePrivateDirectory(stateRoot);
		assert.equal(modeOf(callerRoot), 0o755, "caller-owned parent mode changed");
		assert.equal(modeOf(stateRoot), 0o700, "existing Jouzu root was not repaired");

		const cacheRoot = join(callerRoot, "cache");
		const download = join(cacheRoot, "self-update-test");
		ensurePrivateDirectory(cacheRoot, download);
		assert.equal(modeOf(cacheRoot), 0o700);
		assert.equal(modeOf(download), 0o700);

		const source = join(temporary, "source.json");
		writeFileSync(source, "{}\n", { mode: 0o644 });
		const backup = join(stateRoot, "backups", "tx", "settings.json");
		copyPrivateFile(source, backup, stateRoot);
		assert.equal(modeOf(join(stateRoot, "backups")), 0o700);
		assert.equal(modeOf(join(stateRoot, "backups", "tx")), 0o700);
		assert.equal(modeOf(backup), 0o600);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("private directory creation rejects root and descendant symlinks", {
	skip: process.platform === "win32" ? "symlink fixture requires privileges" : false,
}, () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-private-symlink-"));
	try {
		const outside = join(temporary, "outside");
		mkdirSync(outside);
		const linkedRoot = join(temporary, "state");
		symlinkSync(outside, linkedRoot);
		assert.throws(() => ensurePrivateDirectory(linkedRoot), PrivatePathError);
		assert.deepEqual(readdirSync(outside), []);

		const realRoot = join(temporary, "real-state");
		ensurePrivateDirectory(realRoot);
		const linkedBackup = join(realRoot, "backups");
		symlinkSync(outside, linkedBackup);
		assert.throws(() => ensurePrivateDirectory(realRoot, join(linkedBackup, "tx")), PrivatePathError);
		assert.deepEqual(readdirSync(outside), []);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("writeFilePrivateExclusive creates once and preserves an existing destination", () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-exclusive-"));
	try {
		const root = join(temporary, "state");
		const target = join(root, "nested", "value.json");
		writeFilePrivateExclusive(target, "first\n", root);
		assert.equal(readFileSync(target, "utf8"), "first\n");
		assert.throws(() => writeFilePrivateExclusive(target, "second\n", root), /EEXIST/);
		assert.equal(readFileSync(target, "utf8"), "first\n");
		if (process.platform !== "win32") assert.equal(modeOf(target), 0o600);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("writeFilePrivateAtomic replaces content and leaves no temporary file", () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-atomic-"));
	try {
		const root = join(temporary, "state");
		const target = join(root, "nested", "value.json");

		writeFilePrivateAtomic(target, "first\n", root);
		assert.equal(readFileSync(target, "utf8"), "first\n");

		writeFilePrivateAtomic(target, "second\n", root);
		assert.equal(readFileSync(target, "utf8"), "second\n", "an existing file is replaced, not appended");

		writeFilePrivateAtomic(target, new Uint8Array([0x7b, 0x7d]), root);
		assert.equal(readFileSync(target, "utf8"), "{}", "byte payloads are written verbatim");

		assert.deepEqual(
			readdirSync(join(root, "nested")).filter((entry) => entry.endsWith(".tmp")),
			[],
			"no temporary file survives a successful write",
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("writeFilePrivateAtomic creates private files and defaults its root to the destination", {
	skip: process.platform === "win32" ? "POSIX permission assertion" : false,
}, () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-atomic-mode-"));
	try {
		const target = join(temporary, "owned", "value.json");
		// Omitting the root treats the destination's own directory as the boundary.
		writeFilePrivateAtomic(target, "{}\n");
		assert.equal(modeOf(target), 0o600);
		assert.equal(modeOf(join(temporary, "owned")), 0o700);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});

for (const scenario of [
	{ platform: "win32", code: "EPERM", failures: 2, calls: 3, succeeds: true },
	{ platform: "win32", code: "EACCES", failures: 1, calls: 2, succeeds: true },
	{ platform: "win32", code: "EBUSY", failures: 1, calls: 2, succeeds: true },
	{ platform: "win32", code: "EPERM", failures: Infinity, calls: 21, succeeds: false },
	{ platform: "win32", code: "ENOENT", failures: Infinity, calls: 1, succeeds: false },
	{ platform: "linux", code: "EPERM", failures: Infinity, calls: 1, succeeds: false },
]) {
	test(`atomic replacement retry: ${JSON.stringify(scenario)}`, () => {
		const temporary = mkdtempSync(join(tmpdir(), "jouzu-atomic-retry-"));
		const target = join(temporary, "value.json");
		const platform = Object.getOwnPropertyDescriptor(process, "platform");
		const rename = fs.renameSync;
		const error = Object.assign(new Error("replacement denied"), { code: scenario.code });
		let calls = 0;
		writeFileSync(target, "previous");
		try {
			Object.defineProperty(process, "platform", { ...platform, value: scenario.platform });
			const wait = mock.method(Atomics, "wait", () => "timed-out");
			mock.method(fs, "renameSync", (source, destination) => {
				calls++;
				assert.equal(readFileSync(target, "utf8"), "previous");
				assert.equal(readFileSync(source, "utf8"), "replacement");
				if (calls <= scenario.failures) throw error;
				return rename(source, destination);
			});
			syncBuiltinESMExports();
			if (scenario.succeeds) writeFilePrivateAtomic(target, "replacement");
			else
				assert.throws(
					() => writeFilePrivateAtomic(target, "replacement"),
					(caught) => caught === error,
				);
			assert.equal(calls, scenario.calls);
			assert.equal(wait.mock.callCount(), scenario.calls - 1);
			assert.equal(readFileSync(target, "utf8"), scenario.succeeds ? "replacement" : "previous");
			assert.deepEqual(readdirSync(temporary), ["value.json"]);
		} finally {
			mock.restoreAll();
			syncBuiltinESMExports();
			Object.defineProperty(process, "platform", platform);
			rmSync(temporary, { recursive: true, force: true });
		}
	});
}

test("writeFilePrivateAtomic refuses a destination outside its owned root", () => {
	const temporary = mkdtempSync(join(tmpdir(), "jouzu-atomic-escape-"));
	try {
		const root = join(temporary, "state");
		ensurePrivateDirectory(root);
		assert.throws(
			() => writeFilePrivateAtomic(join(temporary, "elsewhere", "value.json"), "{}\n", root),
			PrivatePathError,
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
