import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";
import { createTaskControllerExtension } from "../dist/flow-control/task-extension.js";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { createJouzuPresentationExtension } from "../dist/presentation.js";
import { JouzuUpdater, UpdateError } from "../dist/updater.js";
import {
	assembledRuntime,
	assembledSession,
	capturedNotices,
	installedProducerExtensions,
} from "./fixtures/flow-assembly.mjs";
import { controlledBackground } from "./fixtures/flow-background-gate.mjs";
import { campaignScript, liveWait } from "./fixtures/flow-campaign.mjs";

const ja = () => resolveCatalog("ja").bundle;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const theme = { fg: (_role, text) => text };

/** Capture what an extension factory registers, without a live session or TUI. */
function capturePi() {
	const tools = new Map();
	const commands = new Map();
	const renderers = new Map();
	const handlers = new Map();
	const pi = {
		on: (name, handler) => {
			handlers.set(name, handler);
		},
		registerTool: (tool) => {
			tools.set(tool.name, tool);
		},
		registerCommand: (name, command) => {
			commands.set(name, command);
		},
		registerMessageRenderer: (name, renderer) => {
			renderers.set(name, renderer);
		},
		events: { on: () => () => {}, emit: () => {} },
		getActiveTools: () => [],
		keyText: () => "",
		appendEntry: () => {},
	};
	return { pi, tools, commands, renderers, handlers };
}

function loadRuntimeExtensions(flow) {
	const { pi, tools, commands, renderers, handlers } = capturePi();
	for (const extension of flow.extensions) extension.factory(pi);
	return { tools, commands, renderers, handlers };
}

test("a Japanese session renders the flow status and its wait line in Japanese through the runtime", async (t) => {
	const background = await controlledBackground(t);
	const f = await assembledSession(t, {
		catalog: ja(),
		producerExtensions: await installedProducerExtensions(),
		script: campaignScript({ command: background.command, goal: "Report the sweep" }),
	});
	await f.session.prompt("start the sweep and wait");
	await liveWait(f.ingress, "the campaign leaves one live wait");

	const notices = capturedNotices(f.session);
	await f.session.prompt("/flow");
	await settle();
	const text = notices.map((notice) => notice.text).join("\n");

	assert.match(text, /未達 1 件/, "the waiting line is Japanese");
	assert.match(text, /自動実行の対象/, "the work eligibility line is Japanese");
	assert.doesNotMatch(text, /unmet; deadline in/, "no English wait line survives");
	assert.doesNotMatch(text, /Eligible for automation/, "no English eligibility line survives");
	assert.deepEqual(f.errors, []);
});

test("the English default runtime renders the same flow status in English", async (t) => {
	const background = await controlledBackground(t);
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: campaignScript({ command: background.command, goal: "Report the sweep" }),
	});
	await f.session.prompt("start the sweep and wait");
	await liveWait(f.ingress, "the campaign leaves one live wait");

	const notices = capturedNotices(f.session);
	await f.session.prompt("/flow");
	await settle();
	const text = notices.map((notice) => notice.text).join("\n");

	assert.match(text, /unmet; deadline in/, "the default wait line stays English");
	assert.match(text, /Eligible for automation/, "the default eligibility line stays English");
	assert.doesNotMatch(text, /未達/, "no Japanese leaks into the default runtime");
	assert.deepEqual(f.errors, []);
});

test("the runtime tool labels and flow renderer read the resolved bundle", async (t) => {
	const { flow } = await assembledRuntime(t, { catalog: ja() });
	const { tools, renderers } = loadRuntimeExtensions(flow);
	assert.equal(tools.get("agent_wait").label, "依存関係を待機");
	assert.equal(tools.get("agent_results").label, "完了結果を読む");
	const rendered = renderers
		.get("jouzu-flow")(
			{
				content: [
					{ type: "text", text: JSON.stringify({ flowInput: ["jouzu-flow"], kind: "work", content: "hello" }) },
				],
			},
			{ expanded: false, outputPad: 1 },
			theme,
		)
		.render(120);
	assert.match(rendered.join("\n"), /▶ 作業/, "the flow message renderer is Japanese");

	const { flow: english } = await assembledRuntime(t);
	const englishCapture = loadRuntimeExtensions(english);
	assert.equal(englishCapture.tools.get("agent_wait").label, "Wait for dependencies");
	assert.equal(englishCapture.tools.get("agent_results").label, "Read completion results");
	const englishRendered = englishCapture.renderers
		.get("jouzu-flow")(
			{
				content: [
					{ type: "text", text: JSON.stringify({ flowInput: ["jouzu-flow"], kind: "work", content: "hello" }) },
				],
			},
			{ expanded: false, outputPad: 1 },
			theme,
		)
		.render(120);
	assert.match(englishRendered.join("\n"), /▶ work/, "the default renderer stays English");
});

test("the presentation compaction tool label reads the presentation bundle", () => {
	const metadata = {
		jouzuVersion: "0.1.0",
		displayVersion: "0.1.0",
		build: undefined,
		piVersion: "0.84.2",
		profileSchemaVersion: 1,
		lock: { tag: "v0.84.2", tagCommit: "commit", commit: "commit", compatibilityStatus: "qualified", deviations: [] },
	};
	const profile = { id: "core", source: "default" };
	const japanese = capturePi();
	createJouzuPresentationExtension(metadata, profile, { colorMode: "none", catalog: ja() }).factory(japanese.pi);
	assert.equal(japanese.tools.get("compact_context").label, "コンテキストを圧縮");

	const english = capturePi();
	createJouzuPresentationExtension(metadata, profile, { colorMode: "none" }).factory(english.pi);
	assert.equal(english.tools.get("compact_context").label, "Compact Context");
});

test("the task controller extension reads the resolved bundle for its skip notice", async () => {
	const attempt = {
		id: "attempt",
		admission: { choice: { intent: { producer: "tasks" } } },
		members: [{ kind: "work" }],
	};
	const ingress = () => ({
		branch: () => ({
			attachment: { ledger: { snapshot: async () => ({ attempts: [attempt], activeAttemptId: "attempt" }) } },
		}),
	});
	const run = async (catalog) => {
		const extension = createTaskControllerExtension({ ingress, onError: () => {}, ...(catalog ? { catalog } : {}) });
		const { pi, handlers } = capturePi();
		extension.factory(pi);
		const notices = [];
		const ctx = {
			sessionManager: { getBranch: () => [] },
			ui: { notify: (text) => notices.push(text) },
			abort: () => {},
		};
		await handlers.get("session_start")({}, ctx);
		const source = {
			role: "custom",
			customType: "jouzu-flow",
			content: "Exact original task bytes",
			details: { attemptId: "attempt" },
			display: true,
			timestamp: 1,
		};
		await handlers.get("message_start")({ message: source }, ctx);
		await handlers.get("context")({ messages: [source] }, ctx);
		return notices.join("\n");
	};
	assert.match(await run(ja()), /タスクが変更されたため、タスクの継続をスキップしました。/u);
	assert.match(await run(), /Skipped a task continuation because its task changed./u);
});

test("the flow attachment reads the resolved bundle for its ownership text", async (t) => {
	const root = await mkdtempSync(join(tmpdir(), "jouzu-flow-locale-attachment-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const scope = { sessionId: "session", branchId: "branch" };
	const holder = await PiFlowAttachment.open(root, scope, undefined, undefined, ja());
	t.after(() => holder.close());
	await assert.rejects(
		() => PiFlowAttachment.open(root, scope, undefined, undefined, ja()),
		(error) =>
			error.code === "busy" && /このセッションブランチは既に別のアタッチメントが所有しています。/u.test(error.message),
	);
	const englishRoot = await mkdtempSync(join(tmpdir(), "jouzu-flow-locale-attachment-en-"));
	t.after(() => rmSync(englishRoot, { recursive: true, force: true }));
	const englishHolder = await PiFlowAttachment.open(englishRoot, scope);
	t.after(() => englishHolder.close());
	await assert.rejects(
		() => PiFlowAttachment.open(englishRoot, scope),
		(error) => error.code === "busy" && /This session branch is already owned/u.test(error.message),
	);
});

test("the self-update status line is Japanese through the CLI and English by default", () => {
	const cli = join(import.meta.dirname, "..", "dist", "cli.js");
	const run = (locale) => {
		const home = mkdtempSync(join(tmpdir(), "jouzu-flow-locale-cli-"));
		const env = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (key === "AI_AGENT" || /^JOUZU_/.test(key) || /^PI_CODING_AGENT(?:_|$)/.test(key)) continue;
			env[key] = value;
		}
		try {
			return spawnSync(process.execPath, [cli, "self-update", "status"], {
				encoding: "utf8",
				timeout: 30_000,
				env: { ...env, JOUZU_HOME: home, JOUZU_UI_LOCALE: locale, PI_OFFLINE: "1" },
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	};
	const japanese = run("ja");
	assert.equal(japanese.status, 0, japanese.stderr);
	assert.match(japanese.stdout, /Jouzu 自己更新ステータス/);
	assert.match(japanese.stdout, /ポリシー: /);
	const english = run("en");
	assert.equal(english.status, 0, english.stderr);
	assert.match(english.stdout, /Jouzu self-update status/);
	assert.match(english.stdout, /Policy: /);
});

test("the updater reads the resolved bundle for its lock-busy line", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-flow-locale-updater-"));
	const globalRoot = join(root, "global", "node_modules");
	const paths = {
		agentDir: join(root, "agent"),
		stateDir: join(root, "state"),
		cacheDir: join(root, "cache"),
		sessionDir: join(root, "state", "sessions"),
		profileStatePath: join(root, "state", "profile-state.json"),
		backupDir: join(root, "state", "backups"),
	};
	mkdirSync(paths.stateDir, { recursive: true });
	writeFileSync(
		join(paths.stateDir, "self-update.lock"),
		`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: "other" })}\n`,
	);
	const runNpm = (args) =>
		args[0] === "root" ? { status: 0, stdout: `${globalRoot}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "" };
	const check = { status: "available", installedVersion: "0.1.0", version: "0.1.1", integrity: "sha512-x" };
	const japanese = new JouzuUpdater({
		paths,
		currentVersion: "0.1.0",
		executable: join(globalRoot, "jouzu", "dist", "cli.js"),
		packageRoot: join(globalRoot, "jouzu"),
		runNpm,
		catalog: ja(),
	});
	assert.throws(
		() => japanese.apply(check),
		(error) =>
			error instanceof UpdateError &&
			error.code === "update-busy" &&
			/別の Jouzu 更新が実行中です/u.test(error.message),
	);
	const english = new JouzuUpdater({
		paths,
		currentVersion: "0.1.0",
		executable: join(globalRoot, "jouzu", "dist", "cli.js"),
		packageRoot: join(globalRoot, "jouzu"),
		runNpm,
	});
	assert.throws(
		() => english.apply(check),
		(error) =>
			error instanceof UpdateError &&
			error.code === "update-busy" &&
			/another Jouzu update is running/u.test(error.message),
	);
	rmSync(root, { recursive: true, force: true });
});
