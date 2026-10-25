#!/usr/bin/env node

/**
 * Per-language model and artifact smoke.
 *
 * This is the opt-in harness that measures one language at a time for the six
 * dimensions frozen in `docs/evaluation/per-language-eval-criteria.md`:
 * comprehension, fluency, coding, tool use, mixed-language retention, and
 * artifact-policy compliance. It shares the contract of `live-ja-smoke.mjs`:
 * `JOUZU_LIVE_SMOKE=1` is required, and `JOUZU_LIVE_PROVIDER`,
 * `JOUZU_LIVE_MODEL`, and `JOUZU_LIVE_MAX_USD` (no greater than 0.25) are read.
 * `JOUZU_LIVE_LOCALE` selects the language and defaults to `ja`.
 *
 * One run is one session in one language. It installs the packed artifact into a
 * temporary consumer, sets the response language and a `preserve` artifact
 * policy through the settings file, permits only `read` and `write`, stores no
 * session or transcript, and grades the six dimensions from the files the model
 * writes and the tool events it emits. It prints conditions, cost, and per
 * dimension results; it never prints transcript content.
 *
 * The run spends real provider credit. It is not part of the deterministic gate.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedModelCatalog } from "./live-model-catalog.mjs";
import { packedTarballEntry } from "./pack-output.mjs";

/**
 * The saved localization settings for one run. The CLI accepts only the nested
 * `localization` object, so a flat file is rejected as unknown fields and the
 * run falls back to English.
 */
export function localizationSettings(locale) {
	return {
		schemaVersion: 2,
		localization: {
			uiLocale: locale,
			responseLanguage: locale,
			artifactPolicy: PRESERVE_ARTIFACT_POLICY,
		},
	};
}

/**
 * The supported languages and the content each run uses. The wording is a draft
 * until a reviewer for that language approves it, so an unapproved wording makes
 * the run provisional. `script` is the target-script probe used by the fluency
 * and artifact graders; `requiresCjk` adds the Latin-fallback ratio check.
 */
export const LOCALES = {
	en: {
		name: "English",
		comprehensionSentence: "The capital of Japan is Tokyo.",
		mixedNoteLine: "Keep this note in English.",
		translationSource: "Bonjour le monde.",
		script: /[A-Za-z]/u,
		requiresCjk: false,
	},
	ja: {
		name: "Japanese",
		comprehensionSentence: "日本の首都は東京です。",
		mixedNoteLine: "このメモは日本語のまま保持してください。",
		translationSource: "Hello, world.",
		script: /[\u3040-\u30ff]/u,
		requiresCjk: true,
	},
	"zh-Hans": {
		name: "Simplified Chinese",
		comprehensionSentence: "日本的首都是东京。",
		mixedNoteLine: "请保留此备注为中文。",
		translationSource: "Hello, world.",
		script: /[\u4e00-\u9fff]/u,
		requiresCjk: true,
	},
	"zh-Hant": {
		name: "Traditional Chinese",
		comprehensionSentence: "日本的首都是東京。",
		mixedNoteLine: "請保留此備註為中文。",
		translationSource: "Hello, world.",
		script: /[\u4e00-\u9fff]/u,
		requiresCjk: true,
	},
};

/** The language tags a run accepts. */
export const LIVE_LOCALES = Object.keys(LOCALES);

/** The artifact files a run grades, and the artifact policy it sets for the run. */
const GRADED_FILES = ["answer.txt", "explanation.txt", "sum.py", "notes.md", "kept.txt", "translated.txt"];
const PRESERVE_ARTIFACT_POLICY = Object.freeze({
	comments: "preserve",
	documentation: "preserve",
	commits: "preserve",
	reviews: "preserve",
});

/** Read `--locale <tag>` or `--locale=<tag>` from an argument list. */
function localeFromArguments(argv) {
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (token === "--locale") return argv[index + 1];
		if (token.startsWith("--locale=")) return token.slice("--locale=".length);
	}
	return undefined;
}

/**
 * Validate the opt-in contract. Throws before any provider call or build, so a
 * missing opt-in or an over-budget ceiling refuses without spending anything.
 */
export function parseLiveEnv(env = process.env, argv = []) {
	if (env.JOUZU_LIVE_SMOKE !== "1") throw new Error("live smoke is opt-in; set JOUZU_LIVE_SMOKE=1");
	const provider = env.JOUZU_LIVE_PROVIDER;
	const model = env.JOUZU_LIVE_MODEL;
	if (!provider || !model) throw new Error("set JOUZU_LIVE_PROVIDER and JOUZU_LIVE_MODEL");
	const budget = Number(env.JOUZU_LIVE_MAX_USD);
	if (!Number.isFinite(budget) || budget <= 0 || budget > 0.25) {
		throw new Error("set JOUZU_LIVE_MAX_USD to a positive release-smoke budget no greater than 0.25");
	}
	const locale = localeFromArguments(argv) ?? env.JOUZU_LIVE_LOCALE ?? "ja";
	if (!LIVE_LOCALES.includes(locale)) {
		throw new Error(`set JOUZU_LIVE_LOCALE or --locale to one of: ${LIVE_LOCALES.join(", ")}`);
	}
	const route = env.JOUZU_LIVE_ROUTE || provider;
	return { provider, model, budget, locale, route };
}

/** The composed prompt for one language. The digest of this string names the run. */
export function buildPrompt(locale) {
	const config = LOCALES[locale];
	if (!config) throw new Error(`unsupported locale: ${locale}`);
	return [
		`You are being evaluated for response-language and artifact handling in ${config.name} (${locale}).`,
		"Work only inside the current working directory. Complete every step, then reply briefly.",
		"",
		`1. A user wrote this sentence: "${config.comprehensionSentence}"`,
		"   Does it state that the capital of Japan is Tokyo? Write exactly true or false to answer.txt.",
		"2. Explain briefly, in your response language, why the sky is blue. Write the explanation to explanation.txt.",
		"3. Write sum.py: a Python function sum_list(values) that returns the sum of the numbers in values.",
		"4. Read sum.py back with the read tool to confirm it was written.",
		"5. Write notes.md with exactly these two lines:",
		"   API_KEY=abc123",
		`   ${config.mixedNoteLine}`,
		"6. Write kept.txt whose entire content is exactly the text: Hello, world.",
		"   Do not translate it and do not add a trailing newline.",
		`7. Translate this text into ${config.name} and write only the translation to translated.txt: "${config.translationSource}"`,
		"Reply with a one-line summary in your response language.",
	].join("\n");
}

/** The SHA-256 of the composed prompt. */
export function promptDigest(prompt) {
	return createHash("sha256").update(prompt).digest("hex");
}

function grade(id, passed, detail) {
	return { id, status: passed ? "passed" : "failed", detail };
}

/** Comprehension: `answer.txt` answers a true statement with `true`. */
export function gradeComprehension(answerText) {
	const normalized = typeof answerText === "string" ? answerText.trim().toLowerCase().replace(/\.$/u, "") : "";
	return grade("comprehension", normalized === "true", `answer.txt=${JSON.stringify(answerText ?? null)}`);
}

/** Fluency: the explanation uses the target script and, for CJK, is not Latin-dominant. */
export function gradeFluency(explanationText, locale) {
	const config = LOCALES[locale];
	const value = typeof explanationText === "string" ? explanationText : "";
	if (!value.trim()) return grade("fluency", false, "explanation.txt is empty or missing");
	const hasScript = config.script.test(value);
	let latinRatio = 0;
	if (config.requiresCjk) {
		const latin = (value.match(/[A-Za-z]/gu) ?? []).length;
		latinRatio = latin / ([...value].length || 1);
	}
	const passed = hasScript && (!config.requiresCjk || latinRatio < 0.5);
	return grade("fluency", passed, `script=${hasScript} latinRatio=${latinRatio.toFixed(3)}`);
}

/** Coding: `sum.py` defines `sum_list`, returns, and calls `sum(`. */
export function gradeCoding(source) {
	const value = typeof source === "string" ? source : "";
	const hasFunction = /def\s+sum_list\s*\(/u.test(value);
	const hasReturn = /\breturn\b/u.test(value);
	const hasSum = /\bsum\s*\(/u.test(value);
	return grade("coding", hasFunction && hasReturn && hasSum, `def=${hasFunction} return=${hasReturn} sum=${hasSum}`);
}

/** Tool use: at least one successful `write` and one successful `read`. */
export function gradeToolUse(events) {
	const used = (name) =>
		events.some((event) => event?.type === "tool_execution_end" && event.toolName === name && !event.isError);
	const wrote = used("write");
	const read = used("read");
	return grade("tool-use", wrote && read, `write=${wrote} read=${read}`);
}

/** Mixed-language retention: the identifier line is exact and the note stays in the target script. */
export function gradeMixedLanguage(notesText, locale) {
	const config = LOCALES[locale];
	const lines = (typeof notesText === "string" ? notesText : "").split("\n");
	const identifier = lines.some((line) => line === "API_KEY=abc123");
	const localeLine = lines.some((line) => line.trim().length > 0 && config.script.test(line));
	return grade("mixed-language", identifier && localeLine, `identifier=${identifier} localeLine=${localeLine}`);
}

/** Artifact policy: the unasked file is byte-exact and the asked file is translated. */
export function gradeArtifactPolicy({ keptText, translatedText }, locale) {
	const config = LOCALES[locale];
	const keptExact = keptText === "Hello, world.";
	const translated = typeof translatedText === "string" ? translatedText.trim() : "";
	const translation =
		translated.length > 0 && translated !== config.translationSource && config.script.test(translated);
	return grade("artifact-policy", keptExact && translation, `keptExact=${keptExact} translated=${translation}`);
}

/** Grade the six dimensions from the run's files and session events. */
export function analyzeLocaleRun({ locale, events, files }) {
	return [
		gradeComprehension(files["answer.txt"]),
		gradeFluency(files["explanation.txt"], locale),
		gradeCoding(files["sum.py"]),
		gradeToolUse(events),
		gradeMixedLanguage(files["notes.md"], locale),
		gradeArtifactPolicy({ keptText: files["kept.txt"], translatedText: files["translated.txt"] }, locale),
	];
}

const root = resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		timeout: 300_000,
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
	if (result.error) throw result.error;
	assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
	assert.equal(result.status, 0, `${command} exited ${result.status}: ${result.stderr || result.stdout}`);
	return result;
}

function scrubbedHarnessEnv() {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key === "AI_AGENT" || /^JOUZU_/u.test(key) || /^PI_CODING_AGENT(?:_|$)/u.test(key)) continue;
		env[key] = value;
	}
	return env;
}

function jouzuVersion() {
	return JSON.parse(readFileSync(resolve(root, "packages", "cli", "package.json"), "utf8")).version;
}

async function runLocaleSmoke({ provider, model, budget, locale, route }) {
	const prompt = buildPrompt(locale);
	const temp = mkdtempSync(resolve(tmpdir(), `jouzu-live-${locale}-`));
	const project = resolve(temp, "project");
	const jouzuHome = resolve(temp, "jouzu-home");
	try {
		mkdirSync(project, { recursive: true });
		mkdirSync(jouzuHome, { recursive: true });
		writeFileSync(
			resolve(jouzuHome, "localization.json"),
			`${JSON.stringify(localizationSettings(locale), null, 2)}\n`,
		);
		let tarball = process.env.JOUZU_PACKED_TARBALL;
		if (!tarball) {
			run("npm", ["run", "build"]);
			const packed = packedTarballEntry(
				run("npm", ["pack", "--workspace", "jouzu", "--ignore-scripts", "--json", "--pack-destination", temp]).stdout,
			);
			tarball = resolve(temp, packed.filename);
		}
		tarball = resolve(tarball);
		const artifactIntegrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
		run("npm", [
			"install",
			"--prefix",
			resolve(temp, "consumer"),
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			tarball,
		]);
		const cli = resolve(temp, "consumer", "node_modules", "jouzu", "dist", "cli.js");
		// The provider id names a catalog-backed provider, and a fresh home has no
		// catalog. Refresh it into the run's home before the run.
		seedModelCatalog({ cli, home: jouzuHome, env: { ...scrubbedHarnessEnv(), JOUZU_NO_UPDATE: "1" }, run });
		const result = run(
			process.execPath,
			[
				cli,
				"--jouzu-home",
				jouzuHome,
				"--jouzu-profile",
				"core",
				"--jouzu-ui-locale",
				locale,
				"--mode",
				"json",
				"--no-session",
				"--provider",
				provider,
				"--model",
				model,
				"--tools",
				"read,write",
				prompt,
			],
			{ cwd: project, env: { ...scrubbedHarnessEnv(), JOUZU_NO_UPDATE: "1", PI_OFFLINE: "1" } },
		);
		const events = result.stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const end = events.findLast((event) => event.type === "agent_end");
		const assistant = end?.messages?.findLast((message) => message.role === "assistant");
		if (!assistant || assistant.stopReason === "error" || assistant.errorMessage) {
			throw new Error(`live provider failed: ${assistant?.errorMessage ?? "no assistant completion"}`);
		}
		const completions = end.messages.filter((message) => message.role === "assistant");
		assert.ok(
			completions.every((message) => Number.isFinite(message.usage?.cost?.total)),
			"provider cost is unavailable",
		);
		const cost = completions.reduce((total, message) => total + message.usage.cost.total, 0);
		if (!Number.isFinite(cost) || cost > budget) throw new Error(`live smoke cost ${cost} exceeded budget ${budget}`);
		const files = {};
		for (const name of GRADED_FILES) {
			try {
				files[name] = readFileSync(resolve(project, name), "utf8");
			} catch {
				files[name] = undefined;
			}
		}
		const measurements = analyzeLocaleRun({ locale, events, files });
		const report = {
			schemaVersion: 1,
			locale,
			conditions: {
				provider,
				model,
				route,
				nodeVersion: process.version,
				jouzuVersion: jouzuVersion(),
				artifactIntegrity,
				promptDigest: promptDigest(prompt),
				date: new Date().toISOString(),
			},
			budgetUsd: budget,
			costUsd: cost,
			measurements,
			status: measurements.every((measurement) => measurement.status === "passed") ? "passed" : "failed",
		};
		console.log(JSON.stringify(report, null, 2));
		if (report.status !== "passed") process.exitCode = 1;
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		await runLocaleSmoke(parseLiveEnv(process.env, process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
