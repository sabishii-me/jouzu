/**
 * The role language contracts.
 *
 * The tests read the compiled `dist` modules, so `npm run build` must run first.
 * They cover the per-role default contracts and their role-specific terms, the
 * contract traveling on a worker launch and being snapshotted at launch (so a
 * parent change does not reach a running child), the unchanged child environment
 * variables, the compactor and background-monitor preservation contracts, the
 * unchanged scheduled work across a UI-locale or response-language change, and
 * the limitation-report path.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildLanguageContract,
	buildResponseLanguageSection,
	LANGUAGE_CONTRACT_PRESERVE_EXACT,
} from "../dist/language-contract.js";
import { resolveArtifactPolicy, resolveResponseLanguage } from "../dist/language-settings.js";
import {
	BACKGROUND_MONITOR_LANGUAGE_CONTRACT,
	buildLanguageLimitationReport,
	buildRoleLanguageSection,
	COMPACTOR_LANGUAGE_CONTRACT,
	forbidsHistoryRewrite,
	hasLanguageLimitation,
	LANGUAGE_LIMITATION_TAG,
	parseLanguageLimitation,
	roleLanguageContract,
	snapshotLanguageContract,
} from "../dist/subagents/language.js";
import { SubagentManager, workerEnvironment } from "../dist/subagents/manager.js";
import { configureChildResources } from "../dist/subagents/resources.js";
import {
	DEFAULT_ROLE_LANGUAGE_CONTRACTS,
	defaultAgentConfig,
	defaultLanguageContract,
	roleLanguageKind,
} from "../dist/subagents/roles.js";
import { resolveUiLocale } from "../dist/ui-locale.js";

const roles = defaultAgentConfig().roles;
const byId = (id) => roles.find((role) => role.id === id);
// The built-in configuration ships no researcher role; the family lookup only
// reads the id and the judging flag, so a minimal fixture is enough.
const researcher = { id: "researcher", judging: false };
const model = { id: "test", provider: "test", api: "openai-completions" };

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "jouzu-role-language-"));
	const paths = { configDir: join(root, "config"), stateDir: join(root, "state"), cwd: root };
	const children = [];
	const manager = new SubagentManager(paths, "parent", 2, (launch, emit, exit) => {
		const child = {
			launch,
			emit,
			exit,
			commands: [],
			send(command) {
				this.commands.push(command);
			},
			async stop() {
				exit(false);
			},
		};
		children.push(child);
		return child;
	});
	return { root, paths, manager, children };
}

// --- T14: a default contract per role, and only that role's terms -----------

test("every default role resolves to its own family's frozen language contract", () => {
	assert.equal(roleLanguageKind(byId("coder")), "implementation");
	assert.equal(roleLanguageKind(researcher), "research");
	assert.equal(roleLanguageKind(byId("reviewer")), "review");
	assert.equal(roleLanguageKind({ id: "compactor", judging: false }), "compaction");
	assert.equal(roleLanguageKind({ id: "monitor", judging: false }), "monitor");
	// An unknown role falls back by its judging flag rather than getting a wrong family.
	assert.equal(roleLanguageKind({ id: "custom-writer", judging: false }), "implementation");
	assert.equal(roleLanguageKind({ id: "custom-review", judging: true }), "review");

	for (const role of roles) {
		const contract = defaultLanguageContract(role);
		assert.equal(contract, DEFAULT_ROLE_LANGUAGE_CONTRACTS[roleLanguageKind(role)]);
		assert.equal(roleLanguageContract(role).contractId, contract.contractId);
		assert.ok(Object.isFrozen(contract), `${role.id} contract is frozen`);
		assert.ok(Object.isFrozen(contract.preserveExact), `${role.id} preserveExact is frozen`);
	}
});

test("a role's contract carries only the terms that role needs", () => {
	const implementation = defaultLanguageContract(byId("coder"));
	const research = defaultLanguageContract(researcher);
	const compactor = COMPACTOR_LANGUAGE_CONTRACT;
	const monitor = BACKGROUND_MONITOR_LANGUAGE_CONTRACT;

	// The writing worker follows the project artifact policy and returns to the parent.
	assert.equal(implementation.artifactLanguage, "project");
	assert.equal(implementation.returnLanguage, "parent-response-language");
	assert.deepEqual([...implementation.preserveExact], [...LANGUAGE_CONTRACT_PRESERVE_EXACT]);

	// A researcher produces no project artifacts, so its artifact term is preservation.
	assert.equal(research.artifactLanguage, "preserve");
	assert.ok(!research.preserveExact.includes("source-errors"));

	// The compactor and the monitor never author user-facing prose.
	for (const contract of [compactor, monitor]) {
		assert.equal(contract.taskLanguage, "preserve");
		assert.equal(contract.artifactLanguage, "preserve");
		assert.equal(contract.returnLanguage, "structured");
	}
	// The monitor reports execution state, so it protects a narrower set.
	assert.deepEqual([...monitor.preserveExact], ["commands", "identifiers", "paths"]);
	assert.deepEqual([...compactor.preserveExact], [...LANGUAGE_CONTRACT_PRESERVE_EXACT]);

	// The role-facing sections differ: a preservation-only role is never told to
	// write user-facing explanations or to follow an artifact language.
	const implementationSection = buildRoleLanguageSection(implementation);
	assert.match(implementationSection, /Follow the project's existing language/);
	assert.match(implementationSection, /Return your result in the parent's response language/);
	for (const contract of [research, compactor, monitor]) {
		const section = buildRoleLanguageSection(contract);
		assert.doesNotMatch(section, /Write user-facing explanations/);
		assert.doesNotMatch(section, /Write comments, documentation, commits, and reviews in/);
	}
	assert.match(buildRoleLanguageSection(compactor), /Never translate or rewrite history, summaries, quotes/);
});

// --- T15/T16: the contract travels on the launch and is snapshotted ---------

test("a worker launch carries a frozen snapshot of the role contract", async () => {
	const f = fixture();
	try {
		const run = f.manager.launch({
			role: byId("coder"),
			model,
			auth: { apiKey: "secret-never-persist" },
			cwd: f.paths.cwd,
			task: "Do the task",
		});
		assert.equal(run.role.id, "coder");
		const captured = f.children[0].launch.languageContract;
		assert.equal(captured.contractId, defaultLanguageContract(byId("coder")).contractId);
		assert.ok(Object.isFrozen(captured));
	} finally {
		await f.manager.dispose();
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("a parent change after launch does not reach a running child", async () => {
	const f = fixture();
	try {
		// A caller-supplied contract that the manager snapshots at launch.
		const source = {
			...defaultLanguageContract(byId("coder")),
			preserveExact: [...defaultLanguageContract(byId("coder")).preserveExact],
		};
		f.manager.launch({
			role: byId("coder"),
			model,
			auth: {},
			cwd: f.paths.cwd,
			task: "Do the task",
			languageContract: source,
		});
		const launched = f.children[0].launch.languageContract;
		// Mutating the caller's object must not change the child's snapshot.
		source.taskLanguage = "en";
		assert.equal(launched.taskLanguage, "preserve");

		// A later parent language change produces a different contract, but the
		// running child keeps the one it started with.
		const changed = buildLanguageContract({
			responseLanguage: resolveResponseLanguage({ cli: "en" }),
			artifactPolicy: resolveArtifactPolicy({}),
		});
		assert.notEqual(changed.contractId, launched.contractId);
		assert.equal(f.children[0].launch.languageContract.contractId, launched.contractId);

		// A snapshot rejects an unknown contract rather than passing it through.
		assert.throws(() => snapshotLanguageContract({ taskLanguage: "klingon" }), /invalid/);
	} finally {
		await f.manager.dispose();
		rmSync(f.root, { recursive: true, force: true });
	}
});

// --- T17: workerEnvironment is independent of the UI locale -----------------

test("workerEnvironment keeps LANG and LC_ALL unchanged across a UI-locale change", () => {
	const source = {
		PATH: "/usr/bin",
		HOME: "/home/user",
		LANG: "ja_JP.UTF-8",
		LC_ALL: "ja_JP.UTF-8",
		OPENAI_API_KEY: "secret",
		NODE_OPTIONS: "--require bad.js",
	};
	const before = workerEnvironment(source);

	// Change the UI locale through the real resolver; workerEnvironment takes only
	// the child's environment, so neither call can move it.
	const ja = resolveUiLocale({ cli: "ja" });
	const en = resolveUiLocale({ cli: "en" });
	assert.notEqual(ja.effective, en.effective);
	assert.deepEqual(workerEnvironment(source), before);

	assert.equal(before.LANG, "ja_JP.UTF-8");
	assert.equal(before.LC_ALL, "ja_JP.UTF-8");
	assert.equal(before.PI_SKIP_VERSION_CHECK, "1");
	assert.equal(before.NO_COLOR, "1");
	// The allowlist still drops credentials and code-loading variables.
	assert.equal(before.OPENAI_API_KEY, undefined);
	assert.equal(before.NODE_OPTIONS, undefined);
});

// --- T18: the compactor and the background monitor never translate history --

test("the compactor and background-monitor contracts forbid rewriting history", () => {
	for (const contract of [COMPACTOR_LANGUAGE_CONTRACT, BACKGROUND_MONITOR_LANGUAGE_CONTRACT]) {
		assert.equal(forbidsHistoryRewrite(contract), true);
	}
	// The writing worker may follow a project artifact language, so it is not a
	// preservation-only contract.
	assert.equal(forbidsHistoryRewrite(defaultLanguageContract(byId("coder"))), false);

	const section = buildRoleLanguageSection(COMPACTOR_LANGUAGE_CONTRACT);
	assert.match(section, /Do not translate or rewrite existing files, comments, documentation, or code/);
	assert.match(section, /Never translate or rewrite history, summaries, quotes, tool results, or code/);

	// The compactor reaches pi-vcc through an exact marker. Jouzu adds no
	// translation instruction to the compaction custom instructions.
	const request = readFileSync(new URL("../src/compaction-request.ts", import.meta.url), "utf8");
	assert.match(request, /PI_VCC_COMPACT_MARKER = "__pi_vcc__"/);
	assert.doesNotMatch(request, /languageContract|translate/i);
});

// --- T19: scheduled work is unchanged by a UI-locale change -----------------

test("scheduled work keeps its body, timezone, and execution time across a UI-locale change", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-schedule-language-"));
	const previous = { ...process.env };
	t.after(() => {
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
		rmSync(root, { recursive: true, force: true });
	});
	const directory = join(root, "child");
	const state = join(directory, ".pi");
	mkdirSync(state, { recursive: true });
	const file = join(state, "schedule-prompts.json");
	// `schedule` fixes the timezone/trigger; `nextRun` is the execution time; `prompt` is the body.
	const saved = {
		version: 1,
		jobs: [
			{
				id: "release-review",
				name: "Release review",
				schedule: "0 9 * * *",
				prompt: "Review the release notes and report blockers.",
				enabled: true,
				type: "cron",
				createdAt: "2026-01-01T00:00:00.000Z",
				nextRun: "2026-06-01T09:00:00.000Z",
				runCount: 0,
			},
		],
	};
	writeFileSync(file, JSON.stringify(saved));
	const before = readFileSync(file, "utf8");

	// Resolve two UI locales and two response languages, and build both contracts.
	resolveUiLocale({ cli: "ja" });
	resolveUiLocale({ cli: "en" });
	for (const language of ["ja", "en"]) {
		const resolved = resolveResponseLanguage({ cli: language });
		buildLanguageContract({ responseLanguage: resolved, artifactPolicy: resolveArtifactPolicy({}) });
		buildResponseLanguageSection(
			buildLanguageContract({ responseLanguage: resolved, artifactPolicy: resolveArtifactPolicy({}) }),
		);
	}

	assert.equal(readFileSync(file, "utf8"), before, "no language or UI resolution writes the schedule store");
	const after = JSON.parse(readFileSync(file, "utf8"));
	assert.equal(after.jobs[0].prompt, saved.jobs[0].prompt);
	assert.equal(after.jobs[0].schedule, saved.jobs[0].schedule);
	assert.equal(after.jobs[0].nextRun, saved.jobs[0].nextRun);

	// The child schedule-disable path only flips `enabled`; body, schedule, and
	// execution time survive.
	assert.equal(configureChildResources({ directory }), 1);
	const disabled = JSON.parse(readFileSync(file, "utf8")).jobs[0];
	assert.equal(disabled.enabled, false);
	assert.equal(disabled.prompt, saved.jobs[0].prompt);
	assert.equal(disabled.schedule, saved.jobs[0].schedule);
	assert.equal(disabled.nextRun, saved.jobs[0].nextRun);
});

// --- T20: the limitation-report path ---------------------------------------

test("a child can report a language limitation and the parent surfaces it", async () => {
	const contract = defaultLanguageContract(byId("coder"));
	// The role section tells the child to report a limitation instead of translating.
	assert.match(buildRoleLanguageSection(contract), new RegExp(LANGUAGE_LIMITATION_TAG));

	const report = buildLanguageLimitationReport({
		contractId: contract.contractId,
		requested: contract.returnLanguage,
		detail: "the model cannot produce reliable Japanese",
	});
	const parsed = parseLanguageLimitation(report);
	assert.equal(parsed.contractId, contract.contractId);
	assert.equal(parsed.requested, "parent-response-language");
	assert.equal(parsed.detail, "the model cannot produce reliable Japanese");
	assert.equal(hasLanguageLimitation(report), true);
	// Prose that merely names the tag is not a report.
	assert.equal(parseLanguageLimitation(`see ${LANGUAGE_LIMITATION_TAG} docs`), undefined);

	const f = fixture();
	try {
		const run = f.manager.launch({ role: byId("coder"), model, auth: {}, cwd: f.paths.cwd, task: "Do the task" });
		f.children[0].emit({ type: "result", status: "completed", text: `Done.\n${report}` });
		f.children[0].exit(true);
		const result = f.manager.get(run.id);
		assert.equal(result.status, "completed");
		assert.match(result.result, /The child reported a language limitation/);
		assert.match(result.result, /cannot produce reliable Japanese/);
	} finally {
		await f.manager.dispose();
		rmSync(f.root, { recursive: true, force: true });
	}
});
