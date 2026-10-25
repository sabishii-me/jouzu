import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { acquireStateLock } from "../dist/state-lock.js";
import {
	assertWritableUiLocalePreference,
	DEFAULT_UI_LOCALE,
	DEFAULT_UI_LOCALE_PREFERENCE,
	isSupportedUiLocale,
	isUiLocalePreference,
	LOCALIZATION_FILE_NAME,
	LOCALIZATION_LOCK_FILE_NAME,
	LOCALIZATION_MAX_BYTES,
	LOCALIZATION_SCHEMA_VERSION,
	normalizeUiLocale,
	osLocaleCandidates,
	readLocalizationConfig,
	readLocalizationConfigSnapshot,
	resolveUiLocale,
	saveLocalizationConfig,
	UI_LOCALE_PREFERENCES,
	UI_LOCALE_SOURCES,
	UI_LOCALES,
	UiLocaleConfigError,
	UiLocaleConflictError,
	UiLocaleUsageError,
} from "../dist/ui-locale.js";

test("supported UI locale values are the display locale set", () => {
	assert.deepEqual(UI_LOCALES, ["en", "ja", "zh-Hans", "zh-Hant"]);
	assert.deepEqual(UI_LOCALE_PREFERENCES, ["auto", "en", "ja", "zh-Hans", "zh-Hant"]);
	assert.deepEqual(UI_LOCALE_SOURCES, ["cli", "env", "config", "os", "builtin"]);
	assert.equal(DEFAULT_UI_LOCALE, "en");
	assert.equal(DEFAULT_UI_LOCALE_PREFERENCE, "auto");
});

test("C, POSIX, and the empty value resolve to en", () => {
	for (const value of ["C", "POSIX", "", "   "]) {
		assert.equal(normalizeUiLocale(value), "en", JSON.stringify(value));
	}
});

test("the POSIX sentinels keep resolving to en with a codeset", () => {
	for (const value of ["C.UTF-8", "POSIX.UTF-8", "c.utf8", "posix"]) {
		assert.equal(normalizeUiLocale(value), "en", value);
	}
});

test("every en tag resolves to en", () => {
	for (const value of ["en", "en-US", "en_GB", "en_US.UTF-8", "EN-us", "en-001", "en-US-x-lvariant-euro"]) {
		assert.equal(normalizeUiLocale(value), "en", value);
	}
});

test("every ja tag resolves to ja", () => {
	for (const value of ["ja", "ja_JP", "ja_JP.UTF-8", "ja-JP", "JA", "ja_JP.UTF-8@modifier", "ja-JP-u-ca-japanese"]) {
		assert.equal(normalizeUiLocale(value), "ja", value);
	}
});

test("ja_JP.UTF-8 resolves to ja", () => {
	assert.equal(normalizeUiLocale("ja_JP.UTF-8"), "ja");
});

test("zh regions map to the simplified or traditional script", () => {
	assert.equal(normalizeUiLocale("zh-CN"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh_CN.UTF-8"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh-SG"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh-TW"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh-HK"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh-MO"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh_TW.UTF-8"), "zh-Hant");
});

test("an explicit zh script wins over the region", () => {
	assert.equal(normalizeUiLocale("zh-Hans"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh-Hant"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh-hans"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh-Hans-CN"), "zh-Hans");
	assert.equal(normalizeUiLocale("zh-Hant-TW"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh-Hant-HK"), "zh-Hant");
	assert.equal(normalizeUiLocale("ZH-hant"), "zh-Hant");
	assert.equal(normalizeUiLocale("zh-Hans-x-private"), "zh-Hans");
});

test("unsupported and ambiguous values are rejected rather than guessed", () => {
	for (const value of [
		"fr",
		"fr-FR",
		"de_DE.UTF-8",
		"es-419",
		"zh",
		"zh-XX",
		"zh-Latn",
		"auto",
		"enochian",
		".UTF-8",
	]) {
		assert.equal(normalizeUiLocale(value), undefined, value);
	}
});

test("isSupportedUiLocale narrows only the supported values", () => {
	for (const value of UI_LOCALES) assert.equal(isSupportedUiLocale(value), true, value);
	for (const value of ["auto", "C", "ja-JP", "fr-FR", ""]) assert.equal(isSupportedUiLocale(value), false, value);
});

test("the resolution skeleton returns a valid resolved shape", () => {
	const resolved = resolveUiLocale();
	assert.ok(UI_LOCALE_PREFERENCES.includes(resolved.requested));
	assert.ok(UI_LOCALES.includes(resolved.effective));
	assert.ok(UI_LOCALE_SOURCES.includes(resolved.source));
	assert.equal(resolved.fallback, undefined);
});

test("isUiLocalePreference accepts auto and the supported values only", () => {
	for (const value of UI_LOCALE_PREFERENCES) assert.equal(isUiLocalePreference(value), true, value);
	for (const value of ["C", "ja-JP", "fr", ""]) assert.equal(isUiLocalePreference(value), false, value);
});

function config(preference) {
	return { status: "ok", preference };
}

function dirWithLocalization(contents) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-"));
	if (contents !== undefined) writeFileSync(join(dir, LOCALIZATION_FILE_NAME), contents);
	return dir;
}

test("a saved fixed preference wins over the explicit option and environment", () => {
	const resolved = resolveUiLocale({
		cli: "ja",
		env: "ja",
		config: config("en"),
		os: ["en_US.UTF-8"],
	});
	assert.deepEqual(resolved, { requested: "en", effective: "en", source: "config" });
});

test("the explicit option wins when no preference is saved", () => {
	const resolved = resolveUiLocale({ cli: "ja", env: "en", config: { status: "absent" }, os: ["en_US.UTF-8"] });
	assert.deepEqual(resolved, { requested: "ja", effective: "ja", source: "cli" });
});

test("saved Automatic overrides CLI and Jouzu environment inputs and follows the OS", () => {
	const resolved = resolveUiLocale({ cli: "ja", env: "ja_JP.UTF-8", config: config("auto"), os: ["en_US.UTF-8"] });
	assert.deepEqual(resolved, { requested: "auto", effective: "en", source: "os" });
});

test("the saved setting wins over the OS and the built-in default", () => {
	const resolved = resolveUiLocale({ config: config("zh-Hant"), os: ["ja_JP.UTF-8"] });
	assert.deepEqual(resolved, { requested: "zh-Hant", effective: "zh-Hant", source: "config" });
});

test("auto resolves from LC_ALL, then LC_MESSAGES, then LANG", () => {
	assert.deepEqual(resolveUiLocale({ os: ["ja_JP.UTF-8", "en_US.UTF-8", "en_US.UTF-8"] }), {
		requested: "auto",
		effective: "ja",
		source: "os",
	});
	assert.deepEqual(resolveUiLocale({ os: [undefined, "zh-TW", "ja_JP.UTF-8"] }), {
		requested: "auto",
		effective: "zh-Hant",
		source: "os",
	});
	assert.deepEqual(resolveUiLocale({ os: ["", "  ", "ja_JP.UTF-8"] }), {
		requested: "auto",
		effective: "ja",
		source: "os",
	});
	assert.deepEqual(resolveUiLocale({ os: ["C", "ja_JP.UTF-8"] }), {
		requested: "auto",
		effective: "en",
		source: "os",
	});
});

test("the built-in default applies when no source supplies a value", () => {
	assert.deepEqual(resolveUiLocale({ os: [] }), { requested: "auto", effective: "en", source: "builtin" });
	assert.deepEqual(resolveUiLocale({ os: [undefined, ""] }), {
		requested: "auto",
		effective: "en",
		source: "builtin",
	});
	assert.deepEqual(resolveUiLocale({ os: [], builtin: "ja" }), { requested: "ja", effective: "ja", source: "builtin" });
});

test("a saved auto is kept as an intent and resolved from the OS", () => {
	const state = readLocalizationConfig(
		dirWithLocalization(JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "auto" } })),
	);
	assert.deepEqual(state, { status: "ok", preference: "auto" });
	assert.deepEqual(resolveUiLocale({ config: state, os: ["ja_JP.UTF-8"] }), {
		requested: "auto",
		effective: "ja",
		source: "os",
	});
});

test("an unsupported environment value falls back to English with the reason", () => {
	const resolved = resolveUiLocale({ env: "fr_FR.UTF-8", os: ["ja_JP.UTF-8"] });
	assert.equal(resolved.effective, "en");
	assert.equal(resolved.source, "env");
	assert.equal(resolved.fallback?.requested, "fr_FR.UTF-8");
	assert.equal(resolved.fallback?.effective, "en");
	assert.match(resolved.fallback?.reason ?? "", /unsupported JOUZU_UI_LOCALE/u);
});

test("a saved fixed preference ignores an unsupported environment value", () => {
	assert.deepEqual(resolveUiLocale({ env: "fr_FR.UTF-8", config: config("ja"), os: ["ja_JP.UTF-8"] }), {
		requested: "ja",
		effective: "ja",
		source: "config",
	});
});

test("an unsupported OS candidate falls back to English with the reason", () => {
	const resolved = resolveUiLocale({ os: ["fr_FR.UTF-8", "ja_JP.UTF-8"] });
	assert.equal(resolved.effective, "en");
	assert.equal(resolved.source, "os");
	assert.equal(resolved.fallback?.requested, "fr_FR.UTF-8");
	assert.match(resolved.fallback?.reason ?? "", /unsupported OS locale/u);
});

test("an unsupported explicit option is a usage error, not a fallback", () => {
	assert.throws(() => resolveUiLocale({ cli: "fr" }), UiLocaleUsageError);
	assert.throws(() => resolveUiLocale({ cli: "fr" }), /--jouzu-ui-locale must be one of/u);
	assert.throws(
		() => resolveUiLocale({ cli: "fr", config: config("ja") }),
		UiLocaleUsageError,
		"a saved preference must not hide a bad launch value",
	);
});

test("a saved value is refused on write and never stored", () => {
	for (const value of ["auto", "en", "ja", "zh-Hans", "zh-Hant"]) {
		assert.equal(assertWritableUiLocalePreference(value), value);
	}
	for (const value of ["fr", "C", "ja-JP", ""]) {
		assert.throws(() => assertWritableUiLocalePreference(value), UiLocaleConfigError);
	}
});

test("reading a missing settings file reports absent and creates nothing", () => {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-absent-"));
	try {
		assert.deepEqual(readLocalizationConfig(dir), { status: "absent" });
		assert.equal(existsSync(join(dir, LOCALIZATION_FILE_NAME)), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the saved schema accepts only the supported shape", () => {
	const valid = dirWithLocalization(
		`${JSON.stringify({ schemaVersion: LOCALIZATION_SCHEMA_VERSION, localization: { uiLocale: "ja" } })}\n`,
	);
	try {
		assert.deepEqual(readLocalizationConfig(valid), { status: "ok", preference: "ja" });
	} finally {
		rmSync(valid, { recursive: true, force: true });
	}
	const cases = [
		"not json",
		"[]",
		JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" }, extra: true }),
		JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja", responseLanguage: "ja" } }),
		JSON.stringify({ schemaVersion: 1, localization: { uiLocale: 1 } }),
		JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "fr" } }),
		JSON.stringify({ schemaVersion: 1 }),
		JSON.stringify({ schemaVersion: 0, localization: { uiLocale: "ja" } }),
	];
	for (const contents of cases) {
		const dir = dirWithLocalization(contents);
		try {
			const state = readLocalizationConfig(dir);
			assert.equal(state.status, "invalid", contents);
			assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), contents);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("a saved value from a future schema falls back to English and is left intact", () => {
	const contents = `${JSON.stringify({ schemaVersion: 99, localization: { uiLocale: "ja" } })}\n`;
	const dir = dirWithLocalization(contents);
	try {
		const state = readLocalizationConfig(dir);
		assert.deepEqual(state, { status: "future", schemaVersion: 99 });
		const resolved = resolveUiLocale({ config: state, os: ["ja_JP.UTF-8"] });
		assert.equal(resolved.effective, "en");
		assert.equal(resolved.source, "config");
		assert.equal(resolved.fallback?.requested, "schemaVersion 99");
		assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), contents);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an invalid saved setting falls back to English without touching the file", () => {
	const contents = `${JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "fr" } })}\n`;
	const dir = dirWithLocalization(contents);
	try {
		const state = readLocalizationConfig(dir);
		assert.equal(state.status, "invalid");
		const resolved = resolveUiLocale({ config: state, os: ["ja_JP.UTF-8"] });
		assert.equal(resolved.effective, "en");
		assert.equal(resolved.source, "config");
		assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), contents);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a symbolic-link settings file is rejected without following it", () => {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-link-"));
	const target = join(dir, "target.json");
	writeFileSync(target, JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" } }));
	symlinkSync(target, join(dir, LOCALIZATION_FILE_NAME));
	try {
		const state = readLocalizationConfig(dir);
		assert.equal(state.status, "invalid");
		assert.match(state.reason, /regular file/u);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("osLocaleCandidates returns LC_ALL, LC_MESSAGES, and LANG in order", () => {
	assert.deepEqual(osLocaleCandidates({ LC_ALL: "a", LC_MESSAGES: "b", LANG: "c" }), ["a", "b", "c"]);
	assert.deepEqual(osLocaleCandidates({}), [undefined, undefined, undefined]);
});

function serializeLocalization(preference) {
	return `${JSON.stringify({ schemaVersion: LOCALIZATION_SCHEMA_VERSION, localization: { uiLocale: preference } }, null, 2)}\n`;
}

function makeLocation() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-save-"));
	const configDir = join(root, "config");
	const stateDir = join(root, "state");
	mkdirSync(configDir, { recursive: true });
	return { root, configDir, stateDir };
}

function locationFor(configDir, root) {
	return { configDir, stateDir: join(root, "state") };
}

test("a save writes the strict schema atomically with a private file mode", () => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		const snapshot = readLocalizationConfigSnapshot(configDir);
		assert.deepEqual(snapshot, { state: { status: "absent" }, revision: { kind: "absent" } });
		const saved = saveLocalizationConfig({ configDir, stateDir }, "ja", snapshot);
		assert.deepEqual(saved.state, { status: "ok", preference: "ja" });
		assert.deepEqual(saved.revision, { kind: "file", contents: serializeLocalization("ja") });
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "ja" });
		assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), serializeLocalization("ja"));
		if (process.platform !== "win32") {
			assert.equal(statSync(join(configDir, LOCALIZATION_FILE_NAME)).mode & 0o777, 0o600);
		}
		assert.equal(existsSync(join(stateDir, LOCALIZATION_LOCK_FILE_NAME)), false, "the lock is released");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save replaces the file when the snapshot still matches", () => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		const saved = saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot);
		assert.deepEqual(saved.state, { status: "ok", preference: "zh-Hant" });
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "zh-Hant" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save refuses a snapshot another session changed and keeps that value", () => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("en"));
		assert.throws(() => saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot), UiLocaleConflictError);
		assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), serializeLocalization("en"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save refuses settings that could not be read and never overwrites them", () => {
	const cases = [
		"not json",
		`${JSON.stringify({ schemaVersion: 99, localization: { uiLocale: "ja" } })}\n`,
		`${JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "fr" } })}\n`,
	];
	for (const contents of cases) {
		const root = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-refuse-"));
		const configDir = join(root, "config");
		mkdirSync(configDir, { recursive: true });
		try {
			writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), contents);
			const snapshot = readLocalizationConfigSnapshot(configDir);
			assert.ok(snapshot.state.status === "invalid" || snapshot.state.status === "future");
			assert.throws(() => saveLocalizationConfig(locationFor(configDir, root), "ja", snapshot), UiLocaleConfigError);
			assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), contents);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test("an oversized settings file is rejected and never overwritten", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-size-"));
	const configDir = join(root, "config");
	mkdirSync(configDir, { recursive: true });
	const contents = " ".repeat(LOCALIZATION_MAX_BYTES + 1);
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), contents);
		const snapshot = readLocalizationConfigSnapshot(configDir);
		assert.equal(snapshot.state.status, "invalid");
		assert.match(snapshot.state.reason, /exceed/u);
		assert.deepEqual(snapshot.revision, { kind: "rejected", reason: snapshot.state.reason });
		assert.throws(() => saveLocalizationConfig(locationFor(configDir, root), "ja", snapshot), UiLocaleConfigError);
		assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), contents);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save refuses a symbolic-link settings file without touching the target", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-save-link-"));
	const configDir = join(root, "config");
	mkdirSync(configDir, { recursive: true });
	const target = join(root, "target.json");
	const contents = serializeLocalization("ja");
	try {
		writeFileSync(target, contents);
		symlinkSync(target, join(configDir, LOCALIZATION_FILE_NAME));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		assert.equal(snapshot.state.status, "invalid");
		assert.match(snapshot.state.reason, /regular file/u);
		assert.throws(() => saveLocalizationConfig(locationFor(configDir, root), "ja", snapshot), UiLocaleConfigError);
		assert.equal(readFileSync(target, "utf8"), contents);
		assert.equal(
			readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"),
			contents,
			"the symlink is still in place",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failed write leaves the previous value in place", (t) => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		t.mock.method(fs, "renameSync", () => {
			throw new Error("simulated rename failure");
		});
		syncBuiltinESMExports();
		try {
			assert.throws(
				() => saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot),
				/simulated rename failure/u,
			);
		} finally {
			t.mock.restoreAll();
			syncBuiltinESMExports();
		}
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "ja" });
		assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), serializeLocalization("ja"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an unsupported preference is refused and leaves the previous value", () => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		assert.throws(() => saveLocalizationConfig({ configDir, stateDir }, "fr", snapshot), UiLocaleConfigError);
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "ja" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failed save keeps the display language the caller already resolved", () => {
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir);
		const resolved = resolveUiLocale({ config: snapshot.state, os: ["en_US.UTF-8"] });
		assert.deepEqual(resolved, { requested: "ja", effective: "ja", source: "config" });
		// Another session writes while this session still holds its old snapshot.
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("en"));
		assert.throws(() => saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot), UiLocaleConflictError);
		// The caller keeps the value it resolved before the failed write, and the
		// other session's value is what is actually on disk.
		assert.equal(resolved.effective, "ja");
		assert.equal(resolved.source, "config");
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "en" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const SAVE_WORKER_SCRIPT = [
	'import { pathToFileURL } from "node:url";',
	"const [modulePath, configDir, stateDir, preference] = process.argv.slice(1);",
	"const mod = await import(pathToFileURL(modulePath).href);",
	"let snapshot = mod.readLocalizationConfigSnapshot(configDir);",
	'process.stdout.write("READY\\n");',
	'await new Promise((resolve) => process.stdin.once("data", resolve));',
	'let outcome = "ERROR no attempt";',
	"for (let attempt = 0; attempt < 500; attempt++) {",
	"  try {",
	"    const saved = mod.saveLocalizationConfig({ configDir, stateDir }, preference, snapshot);",
	'    outcome = "SAVED " + saved.state.preference;',
	"    break;",
	"  } catch (error) {",
	'    if (error && error.name === "UiLocaleConflictError") {',
	"      snapshot = mod.readLocalizationConfigSnapshot(configDir);",
	"      continue;",
	"    }",
	'    if (error && typeof error.message === "string" && error.message.includes("in progress")) {',
	"      await new Promise((resolve) => setTimeout(resolve, 5));",
	"      continue;",
	"    }",
	'    outcome = "ERROR " + (error && error.message);',
	"    break;",
	"  }",
	"}",
	'process.stdout.write(outcome + "\\n", () => process.exit(0));',
].join("\n");

function spawnSaveWorker(modulePath, configDir, stateDir, preference) {
	const child = spawn(
		process.execPath,
		["--input-type=module", "-e", SAVE_WORKER_SCRIPT, modulePath, configDir, stateDir, preference],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	let markReady;
	const ready = new Promise((resolve, reject) => {
		markReady = resolve;
		child.once("exit", (code) => reject(new Error(`worker ${preference} exited before ready (${code}): ${stderr}`)));
	});
	child.stdout.on("data", (chunk) => {
		if (chunk.includes("READY")) markReady();
	});
	const done = new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`worker ${preference} exited ${code}: ${stderr}`));
		});
	});
	return { child, ready, go: () => child.stdin.write("go\n"), done };
}

test("two processes saving at once do not corrupt the file and neither update is lost", async () => {
	const { root, configDir, stateDir } = makeLocation();
	const modulePath = fileURLToPath(new URL("../dist/ui-locale.js", import.meta.url));
	const workers = [];
	let poller;
	try {
		workers.push(
			spawnSaveWorker(modulePath, configDir, stateDir, "ja"),
			spawnSaveWorker(modulePath, configDir, stateDir, "zh-Hant"),
		);
		// Both workers read the same (absent) revision before either may write.
		await Promise.all(workers.map((worker) => worker.ready));
		const observations = [];
		poller = setInterval(() => {
			observations.push(readLocalizationConfig(configDir));
		}, 1);
		for (const worker of workers) worker.go();
		const outputs = await Promise.all(workers.map((worker) => worker.done));
		clearInterval(poller);
		assert.ok(outputs[0].includes("SAVED ja"), outputs[0]);
		assert.ok(outputs[1].includes("SAVED zh-Hant"), outputs[1]);
		const finalContents = readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8");
		const finalState = readLocalizationConfig(configDir);
		assert.equal(finalState.status, "ok");
		assert.ok(["ja", "zh-Hant"].includes(finalState.preference));
		assert.equal(finalContents, serializeLocalization(finalState.preference));
		for (const observation of observations) {
			assert.notEqual(observation.status, "invalid", JSON.stringify(observation));
		}
		assert.equal(existsSync(join(stateDir, LOCALIZATION_LOCK_FILE_NAME)), false, "the lock is released");
	} finally {
		clearInterval(poller);
		for (const worker of workers) worker.child.kill("SIGKILL");
		rmSync(root, { recursive: true, force: true });
	}
});

/**
 * The localization-settings diagnostics moved onto the catalog without changing
 * their English bytes. Each case pins the English text the pre-migration module
 * produced and checks the Japanese rendering against its catalog message, so the
 * wiring is covered without pinning one locale's wording.
 */
test("the localization diagnostics keep their English bytes and localize", () => {
	const ja = resolveCatalog("ja").bundle;
	const cases = [
		["an array", "[]", "localization settings must be an object", "jouzu.cli.localization.config.notObject"],
		[
			"an unknown top-level field",
			JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" }, extra: true }),
			"localization settings have unknown fields",
			"jouzu.cli.localization.config.unknownFields",
		],
		[
			"an invalid schemaVersion",
			JSON.stringify({ schemaVersion: 0, localization: { uiLocale: "ja" } }),
			"localization settings schemaVersion is invalid",
			"jouzu.cli.localization.config.schemaVersionInvalid",
		],
		[
			"a missing localization object",
			JSON.stringify({ schemaVersion: 1 }),
			"localization settings must carry a localization object",
			"jouzu.cli.localization.config.localizationNotObject",
		],
		[
			"an unknown localization field",
			JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja", responseLanguage: "ja" } }),
			"localization settings have unknown localization fields",
			"jouzu.cli.localization.config.unknownLocalizationFields",
		],
		[
			"a non-string uiLocale",
			JSON.stringify({ schemaVersion: 1, localization: { uiLocale: 1 } }),
			"localization.uiLocale must be a string",
			"jouzu.cli.localization.uiLocaleNotString",
		],
		[
			"an unsupported uiLocale",
			JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "fr" } }),
			"localization.uiLocale is not a supported UI locale: fr",
			"jouzu.cli.localization.uiLocaleUnsupported",
			{ value: "fr" },
		],
	];
	for (const [name, contents, english, id, args] of cases) {
		const dir = dirWithLocalization(contents);
		try {
			assert.equal(readLocalizationConfig(dir).reason, english, `${name} keeps the English bytes`);
			const localized = readLocalizationConfig(dir, ja).reason;
			assert.equal(localized, ja.format(id, args), `${name} renders from the ja catalog`);
			assert.notEqual(localized, english, `${name} is localized`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	// The size limit and the regular-file rule are protected values.
	const notJson = dirWithLocalization("not json");
	const oversized = dirWithLocalization(" ".repeat(LOCALIZATION_MAX_BYTES + 1));
	const linked = mkdtempSync(join(tmpdir(), "jouzu-ui-locale-ja-link-"));
	try {
		// The V8 JSON message varies by Node version, so pin the prefix only.
		assert.ok(readLocalizationConfig(notJson).reason.startsWith("localization settings are invalid JSON: "));
		const jsonPrefix = ja.format("jouzu.cli.localization.config.invalidJson", { message: "" });
		assert.ok(readLocalizationConfig(notJson, ja).reason.startsWith(jsonPrefix));
		assert.equal(
			readLocalizationConfig(oversized).reason,
			`localization settings exceed ${LOCALIZATION_MAX_BYTES} bytes`,
		);
		assert.equal(
			readLocalizationConfig(oversized, ja).reason,
			ja.format("jouzu.cli.localization.config.tooLarge", { maxBytes: String(LOCALIZATION_MAX_BYTES) }),
		);
		const target = join(linked, "target.json");
		writeFileSync(target, JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" } }));
		symlinkSync(target, join(linked, LOCALIZATION_FILE_NAME));
		assert.equal(readLocalizationConfig(linked).reason, "localization settings must be a regular file");
		assert.equal(readLocalizationConfig(linked, ja).reason, ja.format("jouzu.cli.localization.config.notRegularFile"));
	} finally {
		rmSync(notJson, { recursive: true, force: true });
		rmSync(oversized, { recursive: true, force: true });
		rmSync(linked, { recursive: true, force: true });
	}
});

test("the OS-candidate fallback reason keeps its English bytes and localizes", () => {
	const ja = resolveCatalog("ja").bundle;
	assert.equal(
		resolveUiLocale({ os: ["fr_FR.UTF-8", "ja_JP.UTF-8"] }).fallback?.reason,
		"unsupported OS locale candidate: fr_FR.UTF-8",
	);
	assert.equal(
		resolveUiLocale({ os: ["fr_FR.UTF-8", "ja_JP.UTF-8"] }, ja).fallback?.reason,
		"サポートされていない OS ロケール候補です: fr_FR.UTF-8",
	);
});

test("the save-lock diagnostics keep their English bytes and localize", () => {
	const ja = resolveCatalog("ja").bundle;
	const { root, configDir, stateDir } = makeLocation();
	try {
		const snapshot = readLocalizationConfigSnapshot(configDir);
		const release = acquireStateLock({
			path: join(stateDir, LOCALIZATION_LOCK_FILE_NAME),
			describe: "test",
			onBusy: () => new Error("busy"),
		});
		try {
			assert.throws(
				() => saveLocalizationConfig({ configDir, stateDir }, "ja", snapshot),
				/another localization settings save is in progress/u,
			);
			assert.throws(
				() => saveLocalizationConfig({ configDir, stateDir }, "ja", snapshot, ja),
				/別の言語設定の保存が進行中です/u,
			);
		} finally {
			release();
		}
		// A lock that is not a regular file reports the other cause.
		rmSync(join(stateDir, LOCALIZATION_LOCK_FILE_NAME), { force: true });
		const lockTarget = join(root, "lock-target.json");
		writeFileSync(lockTarget, "{}\n");
		symlinkSync(lockTarget, join(stateDir, LOCALIZATION_LOCK_FILE_NAME));
		assert.throws(
			() => saveLocalizationConfig({ configDir, stateDir }, "ja", snapshot),
			/localization\.lock is not a regular lock file/u,
		);
		assert.throws(
			() => saveLocalizationConfig({ configDir, stateDir }, "ja", snapshot, ja),
			/localization\.lock は通常のロックファイルではありません/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save cycle reads and writes with the same Japanese catalog", () => {
	const ja = resolveCatalog("ja").bundle;
	const { root, configDir, stateDir } = makeLocation();
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), serializeLocalization("ja"));
		const snapshot = readLocalizationConfigSnapshot(configDir, ja);
		const saved = saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot, ja);
		assert.deepEqual(saved.state, { status: "ok", preference: "zh-Hant" });
		assert.deepEqual(readLocalizationConfig(configDir), { status: "ok", preference: "zh-Hant" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
