/**
 * Deterministic checks for the per-language live smoke. No provider, build, or
 * packed CLI is involved: these tests exercise the opt-in contract, the refusal
 * path, and the pure graders against hand-built files and event streams. The
 * paid measurement itself is out of this gate.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

import {
	analyzeLocaleRun,
	buildPrompt,
	gradeArtifactPolicy,
	gradeCoding,
	gradeComprehension,
	gradeFluency,
	gradeMixedLanguage,
	gradeToolUse,
	LIVE_LOCALES,
	localizationSettings,
	parseLiveEnv,
	promptDigest,
} from "./live-locale-smoke.mjs";
import { catalogRefreshArgs } from "./live-model-catalog.mjs";

const scriptPath = resolve(import.meta.dirname, "live-locale-smoke.mjs");
const baseEnv = { JOUZU_LIVE_SMOKE: "1", JOUZU_LIVE_PROVIDER: "p", JOUZU_LIVE_MODEL: "m", JOUZU_LIVE_MAX_USD: "0.25" };

function envWithoutLive() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (/^JOUZU_LIVE_/u.test(key)) continue;
		env[key] = value;
	}
	return env;
}

test("the opt-in flag is required", () => {
	assert.throws(() => parseLiveEnv({}), /JOUZU_LIVE_SMOKE=1/u);
	assert.throws(() => parseLiveEnv({ JOUZU_LIVE_SMOKE: "0" }), /opt-in/u);
});

test("the provider and model are required", () => {
	assert.throws(() => parseLiveEnv({ ...baseEnv, JOUZU_LIVE_PROVIDER: "" }), /JOUZU_LIVE_PROVIDER/u);
	assert.throws(() => parseLiveEnv({ ...baseEnv, JOUZU_LIVE_MODEL: "" }), /JOUZU_LIVE_MODEL/u);
});

test("the budget must be positive and no greater than 0.25", () => {
	for (const budget of ["0.5", "1", "0", "-0.1", "nope", ""]) {
		assert.throws(
			() => parseLiveEnv({ ...baseEnv, JOUZU_LIVE_MAX_USD: budget }),
			/no greater than 0.25/u,
			`budget ${JSON.stringify(budget)} must be rejected`,
		);
	}
	assert.equal(parseLiveEnv(baseEnv).budget, 0.25);
});

test("the locale is selectable and defaults to ja", () => {
	assert.equal(parseLiveEnv(baseEnv).locale, "ja");
	assert.equal(parseLiveEnv({ ...baseEnv, JOUZU_LIVE_LOCALE: "zh-Hant" }).locale, "zh-Hant");
	assert.equal(parseLiveEnv(baseEnv, ["--locale", "zh-Hans"]).locale, "zh-Hans");
	assert.equal(parseLiveEnv(baseEnv, ["--locale=en"]).locale, "en");
	assert.throws(() => parseLiveEnv({ ...baseEnv, JOUZU_LIVE_LOCALE: "fr" }), /JOUZU_LIVE_LOCALE/u);
	assert.throws(() => parseLiveEnv(baseEnv, ["--locale", "zh"]), /JOUZU_LIVE_LOCALE/u);
	assert.deepEqual(LIVE_LOCALES, ["en", "ja", "zh-Hans", "zh-Hant"]);
});

test("the route defaults to the provider and is overridable", () => {
	assert.equal(parseLiveEnv(baseEnv).route, "p");
	assert.equal(parseLiveEnv({ ...baseEnv, JOUZU_LIVE_ROUTE: "shisa" }).route, "shisa");
});

test("the prompt digest names the prompt and changes per language", () => {
	assert.equal(promptDigest(buildPrompt("ja")), promptDigest(buildPrompt("ja")));
	assert.notEqual(promptDigest(buildPrompt("ja")), promptDigest(buildPrompt("zh-Hans")));
	assert.match(promptDigest(buildPrompt("ja")), /^[0-9a-f]{64}$/u);
});

test("comprehension accepts true and rejects anything else", () => {
	assert.equal(gradeComprehension("true\n").status, "passed");
	assert.equal(gradeComprehension("True.").status, "passed");
	assert.equal(gradeComprehension("false").status, "failed");
	assert.equal(gradeComprehension(undefined).status, "failed");
});

test("fluency requires the target script and rejects an English fallback for CJK", () => {
	assert.equal(gradeFluency("空が青いのは光の散乱のためです。", "ja").status, "passed");
	assert.equal(gradeFluency("The sky is blue because of scattering.", "ja").status, "failed");
	assert.equal(gradeFluency("天空是蓝色的。", "zh-Hans").status, "passed");
	assert.equal(gradeFluency("The sky is blue.", "zh-Hant").status, "failed");
	assert.equal(gradeFluency("Because of Rayleigh scattering.", "en").status, "passed");
	assert.equal(gradeFluency("", "ja").status, "failed");
});

test("coding requires the function, a return, and a sum call", () => {
	assert.equal(gradeCoding("def sum_list(values):\n    return sum(values)\n").status, "passed");
	assert.equal(gradeCoding("def total(values):\n    return sum(values)\n").status, "failed");
	assert.equal(gradeCoding("def sum_list(values):\n    return 0\n").status, "failed");
	assert.equal(gradeCoding(undefined).status, "failed");
});

test("tool use requires a successful write and read", () => {
	const write = { type: "tool_execution_end", toolName: "write", isError: false };
	const read = { type: "tool_execution_end", toolName: "read", isError: false };
	assert.equal(gradeToolUse([write, read]).status, "passed");
	assert.equal(gradeToolUse([write, { ...read, isError: true }]).status, "failed");
	assert.equal(gradeToolUse([]).status, "failed");
});

test("mixed-language retention keeps the identifier and the target-script note", () => {
	const notes = "API_KEY=abc123\nこのメモは日本語のまま保持してください。";
	assert.equal(gradeMixedLanguage(notes, "ja").status, "passed");
	assert.equal(gradeMixedLanguage("API_KEY=abc123\nKeep this note in English.", "ja").status, "failed");
	assert.equal(gradeMixedLanguage("api_key=abc123\nこのメモ", "ja").status, "failed");
});

test("artifact policy checks the unasked file and the asked translation", () => {
	assert.equal(
		gradeArtifactPolicy({ keptText: "Hello, world.", translatedText: "こんにちは、世界。" }, "ja").status,
		"passed",
	);
	assert.equal(
		gradeArtifactPolicy({ keptText: "Hello, world.\n", translatedText: "こんにちは、世界。" }, "ja").status,
		"failed",
	);
	assert.equal(
		gradeArtifactPolicy({ keptText: "Hello, world.", translatedText: "Hello, world." }, "ja").status,
		"failed",
	);
	assert.equal(
		gradeArtifactPolicy({ keptText: "Hello, world.", translatedText: "Hello, world." }, "en").status,
		"passed",
	);
});

test("a run grades the six dimensions in order", () => {
	const events = [
		{ type: "tool_execution_end", toolName: "write", isError: false },
		{ type: "tool_execution_end", toolName: "read", isError: false },
	];
	const files = {
		"answer.txt": "true",
		"explanation.txt": "空が青いのは光の散乱のためです。",
		"sum.py": "def sum_list(values):\n    return sum(values)\n",
		"notes.md": "API_KEY=abc123\nこのメモは日本語のまま保持してください。",
		"kept.txt": "Hello, world.",
		"translated.txt": "こんにちは、世界。",
	};
	const measurements = analyzeLocaleRun({ locale: "ja", events, files });
	assert.deepEqual(
		measurements.map((measurement) => measurement.id),
		["comprehension", "fluency", "coding", "tool-use", "mixed-language", "artifact-policy"],
	);
	assert.ok(measurements.every((measurement) => measurement.status === "passed"));
});

test("the script refuses to run without the opt-in flag", () => {
	const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env: envWithoutLive() });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /JOUZU_LIVE_SMOKE=1/u);
});

test("the script refuses a budget above 0.25 before any provider call", () => {
	const result = spawnSync(process.execPath, [scriptPath], {
		encoding: "utf8",
		env: { ...envWithoutLive(), ...baseEnv, JOUZU_LIVE_MAX_USD: "0.5" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no greater than 0.25/u);
});

test("the run settings use the nested shape the CLI accepts", () => {
	const settings = localizationSettings("zh-Hans");
	assert.equal(settings.schemaVersion, 2);
	assert.deepEqual(settings.localization, {
		uiLocale: "zh-Hans",
		responseLanguage: "zh-Hans",
		artifactPolicy: { comments: "preserve", documentation: "preserve", commits: "preserve", reviews: "preserve" },
	});
	// A flat file is rejected as unknown fields, and the run then uses English.
	assert.equal(settings.uiLocale, undefined);
	assert.equal(settings.artifactPolicy, undefined);
});

test("the catalog refresh targets the run's own home", () => {
	assert.deepEqual(catalogRefreshArgs({ cli: "/tmp/cli.js", home: "/tmp/home" }), [
		"/tmp/cli.js",
		"--jouzu-home",
		"/tmp/home",
		"catalog",
		"refresh",
		"--json",
	]);
});
