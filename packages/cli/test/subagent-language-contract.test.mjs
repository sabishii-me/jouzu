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
import { runPromptHook } from "../../../scripts/fixtures/prompt-hook.mjs";
import {
	buildLanguageContract,
	buildResponseLanguageSection,
	createLanguageContractExtension,
	LANGUAGE_CONTRACT_PRESERVE_EXACT,
	languageContractId,
} from "../dist/language-contract.js";
import { resolveArtifactPolicy, resolveResponseLanguage } from "../dist/language-settings.js";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { createWorkflowIntegration } from "../dist/subagents/integration.js";
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
import { configureChildResources, expandedChildResourceLoader } from "../dist/subagents/resources.js";
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
const mixedArtifacts = { comments: "preserve", documentation: "ja", commits: "en", reviews: "project" };

function parentContract(response = "auto", artifacts = mixedArtifacts) {
	return buildLanguageContract({
		responseLanguage: resolveResponseLanguage({ config: response }),
		artifactPolicy: resolveArtifactPolicy({ config: artifacts }),
	});
}

async function childRenderer(launch) {
	configureChildResources(launch);
	const loader = await expandedChildResourceLoader(launch);
	const child = loader.getExtensions().extensions.find((extension) => extension.path === "<inline:jouzu-child>");
	return () =>
		runPromptHook(child.handlers.get("before_agent_start")[0], {
			options: {
				selectedTools: launch.role.tools,
				skills: loader.getSkills().skills,
				sections: { addendum: loader.getAppendSystemPrompt().join("\n") },
			},
		}).systemPrompt;
}

function preserveEnvironment(t) {
	const previous = { ...process.env };
	t.after(() => {
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
	});
}

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

test("caller language and artifact preferences reach ordinary roles without widening role permissions", () => {
	for (const response of ["auto", "en", "ja", "zh-Hans", "zh-Hant"]) {
		const parent = parentContract(response);
		for (const role of [byId("coder"), byId("reviewer"), researcher, { id: "compactor" }, { id: "monitor" }]) {
			const base = defaultLanguageContract(role);
			const resolved = roleLanguageContract(role, parent);
			const conversational = base.returnLanguage === "parent-response-language";
			const producesArtifacts = conversational && base.artifactLanguage !== "preserve";
			assert.equal(resolved.contractId, languageContractId(resolved));
			assert.ok(Object.isFrozen(resolved));
			assert.equal(resolved.taskLanguage, conversational && response !== "auto" ? response : base.taskLanguage);
			assert.equal(resolved.artifactLanguage, base.artifactLanguage);
			assert.deepEqual(resolved.artifactPolicy, producesArtifacts ? mixedArtifacts : undefined);
			assert.deepEqual(resolved.preserveExact, base.preserveExact);
			assert.equal(resolved.returnLanguage, conversational && response !== "auto" ? response : base.returnLanguage);
			const section = buildRoleLanguageSection(resolved);
			if (conversational && response !== "auto") assert.match(section, /Write user-facing explanations/);
			else assert.doesNotMatch(section, /Write user-facing explanations/);
			if (base.artifactLanguage === "preserve") {
				assert.ok(forbidsHistoryRewrite(resolved));
				assert.match(section, /Never translate or rewrite history, summaries, quotes, tool results, or code/);
				assert.match(section, /Do not translate or rewrite existing files/);
				assert.doesNotMatch(section, /edit source code when the assignment requires it|Artifact language policy/);
			}
		}
	}
});

test("JA profile is a fallback for conversational roles, not an override or a structured-role instruction", () => {
	for (const role of [byId("coder"), byId("reviewer"), researcher, { id: "compactor" }, { id: "monitor" }]) {
		const base = defaultLanguageContract(role);
		const conversational = base.returnLanguage === "parent-response-language";
		for (const profile of ["core", "ja"]) {
			for (const response of [undefined, "auto", "en", "ja"]) {
				const resolved = roleLanguageContract(role, response ? parentContract(response) : undefined, profile);
				const fixed = response && response !== "auto" ? response : profile === "ja" ? "ja" : undefined;
				assert.equal(resolved.taskLanguage, conversational && fixed ? fixed : base.taskLanguage);
				assert.equal(resolved.returnLanguage, conversational && fixed ? fixed : base.returnLanguage);
			}
		}
	}
});

test("a preserved caller task with a concrete return language outranks the profile fallback", () => {
	const parent = { ...parentContract("auto"), returnLanguage: "en" };
	const resolved = roleLanguageContract(byId("coder"), parent, "ja");
	assert.equal(resolved.taskLanguage, "en");
	assert.equal(resolved.returnLanguage, "en");
	const next = roleLanguageContract(byId("reviewer"), resolved, "ja");
	assert.equal(next.taskLanguage, "en");
	assert.equal(next.returnLanguage, "en");
	assert.deepEqual(next.artifactPolicy, mixedArtifacts);
	assert.equal(roleLanguageContract(byId("coder"), { ...parent, taskLanguage: "ja" }).returnLanguage, "ja");
});

test("per-field artifact instructions replace the generic project rule and do not imply translation", () => {
	const parent = parentContract("ja");
	const resolved = roleLanguageContract(byId("coder"), parent);
	const section = buildRoleLanguageSection(resolved);
	assert.match(section, /comments: Preserve the existing language\./);
	assert.match(section, /documentation: Use Japanese \(ja\)\./);
	assert.match(section, /commits: Use English \(en\)\./);
	assert.match(section, /reviews: Follow the project's existing language\./);
	assert.doesNotMatch(section, /Follow the project's existing language for comments/);
	assert.match(section, /not as a request to translate existing files or comments/);
	assert.match(section, /Do not translate task input or existing source solely to satisfy a language preference/);
	assert.match(section, /Preserve commands, identifiers, paths, source error text, quoted text exactly/);
	assert.ok(Object.isFrozen(resolved.artifactPolicy));
	parent.artifactPolicy.documentation = "en";
	assert.equal(resolved.artifactPolicy.documentation, "ja");
	assert.notEqual(resolved.contractId, roleLanguageContract(byId("coder"), parent).contractId);

	const preserve = roleLanguageContract(
		byId("coder"),
		parentContract("auto", {
			comments: "preserve",
			documentation: "preserve",
			commits: "preserve",
			reviews: "preserve",
		}),
	);
	assert.equal(preserve.artifactLanguage, "preserve");
	assert.equal(forbidsHistoryRewrite(preserve), false, "preserving artifact language does not prohibit assigned edits");
	assert.match(buildRoleLanguageSection(preserve), /edit source code when the assignment requires it/);
	assert.doesNotMatch(buildRoleLanguageSection(preserve), /Do not translate or rewrite existing files/);
});

test("a language snapshot retains and freezes a full artifact policy", () => {
	const contract = buildLanguageContract({
		responseLanguage: resolveResponseLanguage({ config: "auto" }),
		artifactPolicy: resolveArtifactPolicy({ config: { commits: "ja", reviews: "en" } }),
	});
	const snapshot = snapshotLanguageContract(contract);
	assert.deepEqual(snapshot, contract);
	assert.notEqual(snapshot.artifactPolicy, contract.artifactPolicy);
	assert.ok(Object.isFrozen(snapshot.artifactPolicy));
	contract.artifactPolicy.commits = "en";
	assert.equal(snapshot.artifactPolicy.commits, "ja");
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
	assert.match(implementationSection, /edit source code when the assignment requires it/);
	assert.doesNotMatch(
		implementationSection,
		/Never translate or rewrite history, summaries, quotes, tool results, or code/,
	);
	assert.match(implementationSection, /including quoted code/);
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

test("queued children retain their requested language and artifact policy while direct launches resolve JA", async () => {
	const f = fixture();
	try {
		f.manager.setConcurrency(1);
		const first = f.manager.launch({ role: byId("coder"), model, auth: {}, cwd: f.root, task: "First", profile: "ja" });
		assert.equal(f.children[0].launch.languageContract.taskLanguage, "ja");
		assert.equal(f.children[0].launch.languageContract.returnLanguage, "ja");
		const source = structuredClone(roleLanguageContract(byId("coder"), parentContract("en")));
		const queued = f.manager.launch({
			role: byId("coder"),
			model,
			auth: {},
			cwd: f.root,
			task: "Queued",
			languageContract: source,
		});
		assert.equal(queued.status, "queued");
		assert.equal(f.children.length, 1);
		source.taskLanguage = "ja";
		source.returnLanguage = "ja";
		source.artifactPolicy.documentation = "en";
		await f.manager.stop(first.id);
		const launched = f.children[1].launch.languageContract;
		assert.equal(launched.taskLanguage, "en");
		assert.equal(launched.returnLanguage, "en");
		assert.equal(launched.artifactPolicy.documentation, "ja");
		assert.ok(Object.isFrozen(launched.artifactPolicy));
		assert.equal(launched.contractId, languageContractId(launched));
	} finally {
		await f.manager.dispose();
		rmSync(f.root, { recursive: true, force: true });
	}
});

async function workflowFixture(t, { response = "en", profile = "core", uiLocale = "en", withParent = true } = {}) {
	preserveEnvironment(t);
	const root = mkdtempSync(join(tmpdir(), "jouzu-child-parent-language-"));
	const paths = { agentDir: join(root, "agent"), configDir: join(root, "config"), stateDir: join(root, "state") };
	const children = [];
	const entries = [];
	const handlers = new Map();
	const api = {
		on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
		registerTool() {},
		registerCommand() {},
		registerMessageRenderer() {},
		sendMessage() {},
		getThinkingLevel: () => "off",
	};
	const ctx = {
		cwd: root,
		mode: "rpc",
		model,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getEntries: () => entries,
			getBranch: () => [],
			getSessionId: () => "parent-language",
			getLeafId: () => "leaf",
		},
		modelRegistry: {
			getAvailable: () => [model],
			getRegisteredProviderConfig: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fixture-only" }),
		},
		ui: { notify() {} },
	};
	const emit = async (event, data = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(data, ctx);
	};
	const language = createLanguageContractExtension({
		responseLanguage: resolveResponseLanguage({ config: response }),
		artifactPolicy: resolveArtifactPolicy({}),
	});
	if (withParent) language.extension.factory(api);
	const integration = createWorkflowIntegration(
		paths,
		(launch, emit, exit) => {
			const child = {
				launch,
				emit,
				exit,
				send() {},
				async stop() {
					exit(false);
				},
			};
			children.push(child);
			return child;
		},
		{ dashboardVisibility() {}, profile: () => profile, catalog: resolveCatalog(uiLocale).bundle },
	);
	integration.register(api, async () => true);
	t.after(async () => {
		await emit("session_shutdown");
		rmSync(root, { recursive: true, force: true });
	});
	await emit("session_start", { reason: "startup" });
	return { root, language, integration, children, emit };
}

test("production child dispatch snapshots active preferences on launch and resolves them again on resume", async (t) => {
	const { language, integration, children, emit } = await workflowFixture(t);
	language.applyLanguage(
		resolveResponseLanguage({ session: "ja" }),
		resolveArtifactPolicy({ session: mixedArtifacts }),
	);
	const task = "Inspect `src/日本語.ts`; preserve `TypeError: unchanged` and quoted English text.";
	const first = await integration.service.launch("coder", task);
	const original = children[0].launch;
	assert.equal(original.profile, "core");
	assert.equal(original.task, task);
	assert.equal(original.languageContract.returnLanguage, "en", "staged language is not active yet");
	assert.equal(original.languageContract.artifactPolicy.documentation, "project");
	const renderOriginal = await childRenderer(original);
	assert.match(renderOriginal(), /Write user-facing explanations in English \(en\)/);
	const savedContext = readFileSync(original.parentContextFile, "utf8");
	const sessionFile = join(original.directory, "session.jsonl");
	const history = `${JSON.stringify({ type: "message", message: { role: "user", content: task } })}\n`;
	writeFileSync(sessionFile, history);
	children[0].emit({ type: "ready", sessionFile, sessionId: "child-language" });

	await emit("before_agent_start", { systemPromptOptions: { sections: {} } });
	const second = await integration.service.launch("coder", task);
	const contract = children[1].launch.languageContract;
	assert.equal(contract.returnLanguage, "ja");
	assert.equal(contract.taskLanguage, "ja");
	assert.equal(contract.artifactLanguage, "project");
	assert.deepEqual(contract.artifactPolicy, mixedArtifacts);
	assert.ok(Object.isFrozen(contract));
	assert.ok(Object.isFrozen(contract.artifactPolicy));
	const currentPrompt = (await childRenderer(children[1].launch))();
	assert.match(currentPrompt, /Write user-facing explanations in Japanese \(ja\)/);
	assert.match(currentPrompt, /Return your result in Japanese\./);
	assert.match(currentPrompt, /documentation: Use Japanese \(ja\)/);
	assert.match(currentPrompt, /commits: Use English \(en\)/);
	assert.doesNotMatch(currentPrompt, /Follow the project's existing language for comments/);
	assert.equal(original.languageContract.returnLanguage, "en", "the running launch keeps its snapshot");
	assert.match(renderOriginal(), /Return your result in English\./);
	await integration.service.stop(second.id);
	children[0].emit({ type: "result", status: "completed", text: "Original English result." });
	children[0].exit(true);

	const resumed = await integration.service.resume(first.id, "Continue the assigned work.");
	const followUp = children[2].launch;
	assert.equal(resumed.previousRunId, first.id);
	assert.equal(followUp.sessionFile, sessionFile);
	assert.equal(followUp.parentContextFile, original.parentContextFile);
	assert.equal(readFileSync(followUp.parentContextFile, "utf8"), savedContext);
	assert.equal(readFileSync(sessionFile, "utf8"), history);
	assert.equal(followUp.languageContract.returnLanguage, "ja", "explicit resume inherits the current caller");
	assert.deepEqual(followUp.languageContract.artifactPolicy, mixedArtifacts);
	assert.match((await childRenderer(followUp))(), /Write user-facing explanations in Japanese \(ja\)/);
	assert.equal(original.languageContract.returnLanguage, "en");
});

for (const selection of [
	{ response: "ja", profile: "core", uiLocale: "en", expected: "Japanese" },
	{ response: "en", profile: "core", uiLocale: "ja", expected: "English" },
	{ response: "auto", profile: "core", uiLocale: "ja" },
	{ response: "auto", profile: "ja", uiLocale: "en", expected: "Japanese" },
	{ response: "en", profile: "ja", uiLocale: "ja", expected: "English" },
	{ withParent: false, profile: "ja", uiLocale: "en", expected: "Japanese" },
]) {
	test(`dispatch renders caller language in child resources: ${JSON.stringify(selection)}`, async (t) => {
		const { integration, children } = await workflowFixture(t, selection);
		await integration.service.launch("coder", "Inspect only; preserve English task text.");
		const prompt = (await childRenderer(children[0].launch))();
		assert.doesNotMatch(prompt, /Jouzu Japanese-First Policy/);
		if (selection.expected) {
			assert.match(prompt, new RegExp(`Write user-facing explanations in ${selection.expected}`));
			assert.match(prompt, new RegExp(`Return your result in ${selection.expected}\\.`));
			assert.doesNotMatch(prompt, /Work in the language of the task you were given/);
		} else {
			assert.doesNotMatch(prompt, /Write user-facing explanations in|Return your result in (Japanese|English)/);
			assert.match(prompt, /Work in the language of the task you were given/);
		}
	});
}

test("child resources preserve specialized role boundaries even with the JA profile and caller policy", async (t) => {
	preserveEnvironment(t);
	const root = mkdtempSync(join(tmpdir(), "jouzu-child-role-language-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const id of ["researcher", "compactor", "monitor"]) {
		const role = { ...byId("coder"), id, tools: ["read"], instructions: "Read-only assignment." };
		const contract = roleLanguageContract(role, parentContract("ja"), "ja");
		const prompt = (
			await childRenderer({
				cwd: root,
				directory: join(root, id),
				profile: "ja",
				role,
				model,
				languageContract: contract,
			})
		)();
		assert.match(prompt, /Do not translate or rewrite existing files/);
		assert.match(prompt, /Never translate or rewrite history, summaries, quotes, tool results, or code/);
		assert.doesNotMatch(prompt, /edit source code when the assignment requires it|Artifact language policy/);
		assert.doesNotMatch(prompt, /Jouzu Japanese-First Policy/);
		if (id === "researcher") assert.match(prompt, /Write user-facing explanations in Japanese \(ja\)/);
		else assert.doesNotMatch(prompt, /Write user-facing explanations|Return your result in Japanese/);
	}
});

test("child resource rendering freezes the supplied conversational and per-field policy", async (t) => {
	preserveEnvironment(t);
	const root = mkdtempSync(join(tmpdir(), "jouzu-child-resource-snapshot-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const contract = structuredClone(roleLanguageContract(byId("coder"), parentContract("ja")));
	const render = await childRenderer({
		cwd: root,
		directory: root,
		role: byId("coder"),
		model,
		languageContract: contract,
	});
	const before = render();
	contract.taskLanguage = "en";
	contract.returnLanguage = "en";
	contract.artifactPolicy.documentation = "en";
	assert.equal(render(), before);
	assert.match(before, /Write user-facing explanations in Japanese \(ja\)/);
	assert.match(before, /documentation: Use Japanese \(ja\)/);
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
