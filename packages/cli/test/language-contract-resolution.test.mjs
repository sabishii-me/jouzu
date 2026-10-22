/**
 * The language-contract foundation: the `schemaVersion: 2` settings shape
 * and its version 1 migration, the response-language and artifact-policy
 * resolution orders, the independence from the OS and UI locale, and the
 * trusted project-policy boundary.
 *
 * The tests read the compiled `dist` modules, so `npm run build` must run first.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ARTIFACT_POLICY_FIELDS,
	ARTIFACT_POLICY_SOURCES,
	DEFAULT_ARTIFACT_POLICY,
	DEFAULT_RESPONSE_LANGUAGE,
	formatArtifactPolicy,
	PROJECT_POLICY_DIRECTORY,
	PROJECT_POLICY_FILE_NAME,
	projectPolicyPath,
	RESPONSE_LANGUAGE_SOURCES,
	ResponseLanguageUsageError,
	readProjectArtifactPolicy,
	resolveArtifactPolicy,
	resolveResponseLanguage,
} from "../dist/language-settings.js";
import {
	LOCALIZATION_FILE_NAME,
	LOCALIZATION_LEGACY_SCHEMA_VERSION,
	LOCALIZATION_SCHEMA_VERSION,
	readLocalizationConfig,
	readLocalizationConfigSnapshot,
	readLocalizationSettings,
	saveLocalizationConfig,
} from "../dist/ui-locale.js";

function makeDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

function dirWithLocalization(contents) {
	const dir = makeDir("jouzu-language-settings-");
	writeFileSync(join(dir, LOCALIZATION_FILE_NAME), contents);
	return dir;
}

const V1_FILE = `${JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja" } }, null, 2)}\n`;

const V2_FILE = `${JSON.stringify(
	{
		schemaVersion: 2,
		localization: {
			uiLocale: "en",
			responseLanguage: "ja",
			artifactPolicy: { comments: "preserve", documentation: "project", commits: "ja", reviews: "en" },
		},
	},
	null,
	2,
)}\n`;

// --- T01: the version 2 schema and the version 1 migration ------------------

test("a schemaVersion 1 settings file parses and its uiLocale survives migration to the version 2 shape", () => {
	const dir = dirWithLocalization(V1_FILE);
	try {
		const state = readLocalizationSettings(dir);
		assert.equal(state.status, "ok");
		assert.equal(state.settings.schemaVersion, LOCALIZATION_SCHEMA_VERSION);
		assert.equal(state.settings.schemaVersion, 2);
		assert.equal(state.settings.migratedFrom, LOCALIZATION_LEGACY_SCHEMA_VERSION);
		assert.equal(state.settings.uiLocale, "ja");
		// The new fields were absent, so they fall through to the built-in default
		// rather than being materialized as explicit settings.
		assert.equal(state.settings.responseLanguage, undefined);
		assert.equal(state.settings.artifactPolicy, undefined);
		// The legacy projection is unchanged, and the file is not rewritten.
		assert.deepEqual(readLocalizationConfig(dir), { status: "ok", preference: "ja" });
		assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), V1_FILE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("reading a version 1 settings file does not rewrite it only to change its version", () => {
	const dir = dirWithLocalization(V1_FILE);
	try {
		const before = readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8");
		readLocalizationConfigSnapshot(dir);
		readLocalizationSettings(dir);
		readLocalizationConfig(dir);
		assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a version 2 settings file carries uiLocale, responseLanguage, and artifactPolicy", () => {
	const dir = dirWithLocalization(V2_FILE);
	try {
		const state = readLocalizationSettings(dir);
		assert.equal(state.status, "ok");
		assert.equal(state.settings.uiLocale, "en");
		assert.equal(state.settings.responseLanguage, "ja");
		assert.deepEqual(state.settings.artifactPolicy, {
			comments: "preserve",
			documentation: "project",
			commits: "ja",
			reviews: "en",
		});
		assert.equal(state.settings.migratedFrom, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a version 1 file rejects the version 2 fields, and a version 2 file rejects an unknown field", () => {
	const cases = [
		`${JSON.stringify({ schemaVersion: 1, localization: { uiLocale: "ja", responseLanguage: "ja" } })}\n`,
		`${JSON.stringify({ schemaVersion: 2, localization: { uiLocale: "ja", extra: true } })}\n`,
		`${JSON.stringify({ schemaVersion: 2, localization: { responseLanguage: "fr" } })}\n`,
		`${JSON.stringify({ schemaVersion: 2, localization: { artifactPolicy: { comments: "fr" } } })}\n`,
		`${JSON.stringify({ schemaVersion: 2, localization: { artifactPolicy: { typo: "en" } } })}\n`,
	];
	for (const contents of cases) {
		const dir = dirWithLocalization(contents);
		try {
			const state = readLocalizationSettings(dir);
			assert.equal(state.status, "invalid", contents);
			assert.equal(readFileSync(join(dir, LOCALIZATION_FILE_NAME), "utf8"), contents);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("a version 2 file may omit uiLocale and keeps the auto intent", () => {
	const contents = `${JSON.stringify({ schemaVersion: 2, localization: { responseLanguage: "en" } })}\n`;
	const dir = dirWithLocalization(contents);
	try {
		const state = readLocalizationSettings(dir);
		assert.equal(state.status, "ok");
		assert.equal(state.settings.uiLocale, "auto");
		assert.equal(state.settings.responseLanguage, "en");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a UI-locale save preserves the saved responseLanguage and artifactPolicy", () => {
	const root = makeDir("jouzu-language-save-");
	const configDir = join(root, "config");
	const stateDir = join(root, "state");
	mkdirSync(configDir, { recursive: true });
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), V2_FILE);
		const snapshot = readLocalizationConfigSnapshot(configDir);
		saveLocalizationConfig({ configDir, stateDir }, "zh-Hant", snapshot);
		const state = readLocalizationSettings(configDir);
		assert.equal(state.status, "ok");
		assert.equal(state.settings.uiLocale, "zh-Hant");
		assert.equal(state.settings.responseLanguage, "ja");
		assert.deepEqual(state.settings.artifactPolicy, {
			comments: "preserve",
			documentation: "project",
			commits: "ja",
			reviews: "en",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a save of a migrated version 1 file writes the version 2 schema without inventing values", () => {
	const root = makeDir("jouzu-language-save-v1-");
	const configDir = join(root, "config");
	const stateDir = join(root, "state");
	mkdirSync(configDir, { recursive: true });
	try {
		writeFileSync(join(configDir, LOCALIZATION_FILE_NAME), V1_FILE);
		const snapshot = readLocalizationConfigSnapshot(configDir);
		saveLocalizationConfig({ configDir, stateDir }, "en", snapshot);
		const written = JSON.parse(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"));
		assert.equal(written.schemaVersion, 2);
		assert.deepEqual(written.localization, { uiLocale: "en" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// --- T02: the response-language resolution order ----------------------------

test("responseLanguage resolves in the order cli, session, config, builtin", () => {
	assert.deepEqual(RESPONSE_LANGUAGE_SOURCES, ["cli", "session", "config", "builtin"]);
	// Every source present: the CLI wins.
	assert.deepEqual(resolveResponseLanguage({ cli: "ja", session: "en", config: "zh-Hans" }), {
		requested: "ja",
		effective: "ja",
		source: "cli",
	});
	// The session wins over the saved setting and the built-in default.
	assert.deepEqual(resolveResponseLanguage({ session: "en", config: "zh-Hans" }), {
		requested: "en",
		effective: "en",
		source: "session",
	});
	// The saved setting wins over the built-in default.
	assert.deepEqual(resolveResponseLanguage({ config: "zh-Hant" }), {
		requested: "zh-Hant",
		effective: "zh-Hant",
		source: "config",
	});
	// The built-in default applies when no source supplies a value.
	assert.deepEqual(resolveResponseLanguage({}), {
		requested: DEFAULT_RESPONSE_LANGUAGE,
		effective: DEFAULT_RESPONSE_LANGUAGE,
		source: "builtin",
	});
});

test("an unsupported explicit response language is a usage error", () => {
	assert.throws(() => resolveResponseLanguage({ cli: "fr" }), ResponseLanguageUsageError);
	assert.throws(() => resolveResponseLanguage({ cli: "fr" }), /the response language must be one of/u);
});

test("an unsupported session response language falls back to the built-in default with the reason", () => {
	const resolved = resolveResponseLanguage({ session: "fr", config: "ja" });
	assert.equal(resolved.effective, DEFAULT_RESPONSE_LANGUAGE);
	assert.equal(resolved.source, "session");
	assert.equal(resolved.fallback?.requested, "fr");
	assert.match(resolved.fallback?.reason ?? "", /responseLanguage/u);
});

// --- T03: independence from the OS and UI locale ----------------------------

test("responseLanguage never changes when only the operating system locale changes", () => {
	const dir = dirWithLocalization(V2_FILE);
	try {
		const state = readLocalizationSettings(dir);
		const before = resolveResponseLanguage({ config: state.settings.responseLanguage });
		const savedEnv = { LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES, LANG: process.env.LANG };
		try {
			process.env.LC_ALL = "ja_JP.UTF-8";
			process.env.LC_MESSAGES = "ja_JP.UTF-8";
			process.env.LANG = "ja_JP.UTF-8";
			assert.deepEqual(resolveResponseLanguage({ config: state.settings.responseLanguage }), before);
			process.env.LC_ALL = "fr_FR.UTF-8";
			process.env.LC_MESSAGES = "fr_FR.UTF-8";
			process.env.LANG = "fr_FR.UTF-8";
			assert.deepEqual(resolveResponseLanguage({ config: state.settings.responseLanguage }), before);
		} finally {
			for (const [key, value] of Object.entries(savedEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("responseLanguage ignores an OS or UI locale input even when one is supplied", () => {
	// The resolver has no OS or UI field. Passing one is ignored, so a caller
	// cannot couple the response language to the display language.
	const withExtras = resolveResponseLanguage({ config: "ja", os: ["en_US.UTF-8"], uiLocale: "en", env: "en_US.UTF-8" });
	assert.deepEqual(withExtras, { requested: "ja", effective: "ja", source: "config" });
	const plain = resolveResponseLanguage({ config: "ja" });
	assert.deepEqual(withExtras, plain);
});

// --- T04: the artifact-policy resolution order ------------------------------

test("artifactPolicy resolves per field in the order task, project, session, config, builtin", () => {
	assert.deepEqual(ARTIFACT_POLICY_SOURCES, ["task", "project", "session", "config", "builtin"]);
	const resolved = resolveArtifactPolicy({
		task: { comments: "preserve" },
		project: { documentation: "project" },
		session: { commits: "ja" },
		config: { reviews: "en" },
	});
	assert.deepEqual(resolved.effective, {
		comments: "preserve",
		documentation: "project",
		commits: "ja",
		reviews: "en",
	});
	assert.deepEqual(resolved.fieldSources, {
		comments: "task",
		documentation: "project",
		commits: "session",
		reviews: "config",
	});
	// The highest-priority source that supplied any field is the dominant source.
	assert.equal(resolved.source, "task");
	assert.deepEqual(resolved.requested, { comments: "preserve" });
});

test("each artifactPolicy field takes the first source in the five-step order", () => {
	// A higher-priority source overrides a lower one for the same field.
	const taskWins = resolveArtifactPolicy({
		task: { comments: "en" },
		project: { comments: "ja" },
		session: { comments: "zh-Hans" },
		config: { comments: "zh-Hant" },
	});
	assert.equal(taskWins.effective.comments, "en");
	assert.equal(taskWins.fieldSources.comments, "task");

	const projectWins = resolveArtifactPolicy({
		project: { comments: "ja" },
		session: { comments: "zh-Hans" },
		config: { comments: "zh-Hant" },
	});
	assert.equal(projectWins.effective.comments, "ja");
	assert.equal(projectWins.fieldSources.comments, "project");
	assert.equal(projectWins.source, "project");

	const configWins = resolveArtifactPolicy({ config: { comments: "zh-Hant" } });
	assert.equal(configWins.effective.comments, "zh-Hant");
	assert.equal(configWins.fieldSources.comments, "config");
});

test("artifactPolicy uses the built-in default when no source supplies a field", () => {
	const resolved = resolveArtifactPolicy({});
	assert.deepEqual(resolved.effective, DEFAULT_ARTIFACT_POLICY);
	assert.deepEqual(resolved.requested, DEFAULT_ARTIFACT_POLICY);
	assert.equal(resolved.source, "builtin");
	for (const field of ARTIFACT_POLICY_FIELDS) {
		assert.equal(resolved.fieldSources[field], "builtin");
	}
});

test("formatArtifactPolicy renders the fields in the canonical order", () => {
	assert.equal(formatArtifactPolicy({ reviews: "en", comments: "preserve" }), "comments=preserve reviews=en");
	assert.equal(formatArtifactPolicy({}), "");
});

// --- T05: the trusted project-policy boundary -------------------------------

function dirWithProjectPolicy(contents) {
	const root = makeDir("jouzu-project-policy-");
	const dir = join(root, PROJECT_POLICY_DIRECTORY);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, PROJECT_POLICY_FILE_NAME), contents);
	return root;
}

const PROJECT_POLICY_FILE = `${JSON.stringify(
	{
		schemaVersion: 2,
		localization: {
			uiLocale: "ja",
			responseLanguage: "ja",
			artifactPolicy: { comments: "en", documentation: "ja", commits: "ja", reviews: "ja" },
		},
	},
	null,
	2,
)}\n`;

test("the project policy path is <repository root>/.jouzu/localization.json", () => {
	assert.equal(projectPolicyPath("/repo"), join("/repo", ".jouzu", "localization.json"));
});

test("an untrusted project .jouzu/localization.json does not change artifactPolicy resolution", () => {
	const root = dirWithProjectPolicy(PROJECT_POLICY_FILE);
	try {
		const state = readProjectArtifactPolicy(root, { trusted: false });
		assert.deepEqual(state, { status: "untrusted" });
		// The untrusted file contributes nothing, so the resolution is the saved
		// setting over the built-in default.
		const resolved = resolveArtifactPolicy({ config: { documentation: "project" } });
		assert.deepEqual(resolved.effective, { ...DEFAULT_ARTIFACT_POLICY, documentation: "project" });
		assert.equal(resolved.fieldSources.comments, "builtin");
		assert.equal(resolved.source, "config");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a trusted project .jouzu/localization.json supplies only localization.artifactPolicy", () => {
	const root = dirWithProjectPolicy(PROJECT_POLICY_FILE);
	try {
		const state = readProjectArtifactPolicy(root, { trusted: true });
		assert.equal(state.status, "ok");
		assert.deepEqual(state.artifactPolicy, {
			comments: "en",
			documentation: "ja",
			commits: "ja",
			reviews: "ja",
		});
		// The file's responseLanguage and uiLocale are ignored: only the artifact
		// policy crosses the boundary.
		assert.equal("responseLanguage" in state, false);
		const resolved = resolveArtifactPolicy({ project: state.artifactPolicy });
		assert.equal(resolved.effective.comments, "en");
		assert.equal(resolved.fieldSources.comments, "project");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a trusted project policy never changes the responseLanguage resolution", () => {
	const root = dirWithProjectPolicy(PROJECT_POLICY_FILE);
	try {
		// The response-language resolver has no project input, so even a trusted
		// file that names responseLanguage cannot move it.
		const state = readProjectArtifactPolicy(root, { trusted: true });
		assert.equal(state.status, "ok");
		const resolved = resolveResponseLanguage({});
		assert.equal(resolved.source, "builtin");
		assert.equal(resolved.effective, DEFAULT_RESPONSE_LANGUAGE);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an untrusted repository cannot change the global settings file", () => {
	const root = dirWithProjectPolicy(PROJECT_POLICY_FILE);
	const configDir = dirWithLocalization(V2_FILE);
	try {
		const before = readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8");
		readProjectArtifactPolicy(root, { trusted: false });
		// Reading the project policy never touches the global settings file.
		assert.equal(readFileSync(join(configDir, LOCALIZATION_FILE_NAME), "utf8"), before);
		assert.deepEqual(readLocalizationSettings(configDir).settings.artifactPolicy, {
			comments: "preserve",
			documentation: "project",
			commits: "ja",
			reviews: "en",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(configDir, { recursive: true, force: true });
	}
});

test("a trusted project policy that sets no artifactPolicy is treated as absent", () => {
	const root = dirWithProjectPolicy(
		`${JSON.stringify({ schemaVersion: 2, localization: { responseLanguage: "ja" } })}\n`,
	);
	try {
		assert.deepEqual(readProjectArtifactPolicy(root, { trusted: true }), { status: "absent" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a trusted project policy with an unsupported field is invalid and is left intact", () => {
	const contents = `${JSON.stringify({ localization: { artifactPolicy: { comments: "fr" } } })}\n`;
	const root = dirWithProjectPolicy(contents);
	try {
		const state = readProjectArtifactPolicy(root, { trusted: true });
		assert.equal(state.status, "invalid");
		assert.match(state.reason, /comments/u);
		assert.equal(readFileSync(projectPolicyPath(root), "utf8"), contents);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an untrusted project with a malformed policy file is still not read", () => {
	const root = dirWithProjectPolicy("not json");
	try {
		assert.deepEqual(readProjectArtifactPolicy(root, { trusted: false }), { status: "untrusted" });
		// The global settings file is untouched and none is created.
		const emptyConfig = makeDir("jouzu-project-policy-config-");
		try {
			assert.deepEqual(readLocalizationSettings(emptyConfig), { status: "absent" });
			assert.equal(existsSync(join(emptyConfig, LOCALIZATION_FILE_NAME)), false);
		} finally {
			rmSync(emptyConfig, { recursive: true, force: true });
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
