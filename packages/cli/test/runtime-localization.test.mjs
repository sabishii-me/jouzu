import assert from "node:assert/strict";
import { test } from "node:test";
import { createFastModeExtension, FAST_MODE_STATUS } from "../dist/fast-mode.js";
import { loadCatalog } from "../dist/locale-catalog.js";
import { PI_SETTINGS_ITEM_IDS, withPiUiLocalization } from "../dist/pi-ui-localization.js";
import { renderScrollbackTranscript } from "../dist/scrollback.js";
import {
	createSessionUiStyles,
	formatSlashCommandDescription,
	renderSessionLine,
	SESSION_UI_SLASH_COMMAND_IDS,
	sessionUiText,
	terminalTextWidth,
} from "../dist/session-ui/index.js";
import { assembledSession, capturedNotices } from "./fixtures/flow-assembly.mjs";

const catalog = loadCatalog("ja");

test("Japanese Fast mode notices preserve persisted state and priority request payloads", async () => {
	const handlers = new Map();
	const commands = new Map();
	const entries = [];
	const statuses = new Map();
	const notices = [];
	const model = { id: "gpt-example", api: "openai-responses" };
	const ctx = {
		model,
		mode: "tui",
		isIdle: () => true,
		sessionManager: { getBranch: () => entries },
		ui: { setStatus: (key, value) => statuses.set(key, value), notify: (value) => notices.push(value) },
	};
	createFastModeExtension(catalog).factory({
		on: (key, value) => handlers.set(key, value),
		registerCommand: (key, value) => commands.set(key, value),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	});
	await commands.get("fast").handler("on", ctx);
	assert.match(notices.at(-1), /利用料金が高く/u);
	assert.equal(statuses.get(FAST_MODE_STATUS), "on");
	const payload = { model: model.id, input: [] };
	assert.deepEqual(handlers.get("before_provider_request")({ request: { model }, payload }, ctx), {
		...payload,
		service_tier: "priority",
	});
	assert.equal(payload.service_tier, undefined);
	await commands.get("fast").handler("off", ctx);
	assert.match(notices.at(-1), /無効/u);
	assert.deepEqual(
		entries.map((entry) => entry.data.enabled),
		[true, false],
	);
});

test("Japanese flow reset still requires explicit confirmation and leaves later prompts usable", async (t) => {
	const f = await assembledSession(t, { catalog });
	const notices = capturedNotices(f.session);
	await f.session.prompt("First request");
	await f.session.prompt("/flow reset");
	assert.equal(notices.at(-1).text, catalog.format("jouzu.cli.flow.resetConfirm"));
	assert.match(notices.at(-1).text, /\/flow reset confirm/u);
	await f.session.prompt("/flow reset confirm");
	assert.equal(notices.at(-1).text, catalog.format("jouzu.cli.flow.resetDone"));
	await f.session.prompt("After reset");
	assert.equal(f.bodies.length, 2);
	assert.equal(f.session.agent.state.errorMessage, undefined);
});

test("Japanese Fast mode stays visible in narrow session lines", () => {
	const theme = { fg: (_role, value) => value, bg: (_role, value) => value, bold: (value) => value };
	const styles = createSessionUiStyles(theme, { colorEnabled: false });
	const snapshot = { model: { providerId: "openai", modelId: "a-long-model-name", thinkingLevel: "high" } };
	for (const width of [12, 24, 48, 80]) {
		const line = renderSessionLine(snapshot, [], width, styles, sessionUiText(catalog), undefined, undefined, true);
		assert.equal(terminalTextWidth(line), width);
		assert.match(line, /高速/u);
	}
});

test("Japanese transcript export localizes labels without translating stored tool content", () => {
	const entries = [
		{
			type: "message",
			message: { role: "toolResult", toolName: "read", isError: true, content: "Exact stored output 日本語" },
		},
	];
	for (const width of [24, 48, 80]) {
		const output = renderScrollbackTranscript(entries, {
			width,
			catalog,
			sessionId: "session-id",
			exportedAt: new Date(0),
		});
		assert.ok(output.lines.every((line) => terminalTextWidth(line) <= width));
		const text = output.lines.join("\n");
		assert.match(text.replace(/\n/gu, ""), /ツール結果: read（エラー）/u);
		assert.match(text, /Exact stored output/u);
		assert.match(text, /session-id/u);
		assert.doesNotMatch(text, /Tool result:/u);
	}
});

test("every built-in Pi slash command and bundled command has a localized Japanese autocomplete description", async () => {
	const { BUILTIN_SLASH_COMMANDS } = await import(
		"../node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js"
	);
	const jaText = sessionUiText(catalog);
	const enText = sessionUiText(loadCatalog("en"));
	for (const command of BUILTIN_SLASH_COMMANDS) {
		if (command.name === "scoped-models") continue;
		assert.ok(command.name in SESSION_UI_SLASH_COMMAND_IDS, `missing slash command ID for /${command.name}`);
		const jaDesc = jaText.slashCommands[command.name];
		const enDesc = enText.slashCommands[command.name];
		assert.ok(jaDesc, `missing Japanese description for /${command.name}`);
		assert.ok(enDesc, `missing English description for /${command.name}`);
		assert.notEqual(jaDesc, enDesc, `/${command.name} should be localized in Japanese`);
	}
	assert.equal(enText.slashCommands.quit, "Quit Jouzu");
	assert.equal(jaText.slashCommands.quit, "Jouzu を終了");
	assert.equal(
		formatSlashCommandDescription("<provider> — Configure provider authentication", jaText.slashCommands.login),
		"<provider> — プロバイダー認証を設定",
	);
});

test("withPiUiLocalization localizes Pi /settings, submenus, and selector components in Japanese and restores prototypes", async () => {
	const pi = await import("../node_modules/@earendil-works/pi-coding-agent/dist/index.js");
	const tui = await import("../node_modules/@earendil-works/pi-tui/dist/index.js");
	const { TrustSelectorComponent } = await import(
		"../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/trust-selector.js"
	);
	pi.initTheme("dark");
	tui.setCapabilityOverrides({ images: "kitty" });

	const settingsConfig = {
		autoCompact: true,
		showImages: true,
		imageWidthCells: 80,
		autoResizeImages: true,
		blockImages: false,
		enableSkillCommands: true,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		transport: "auto",
		sessionShareDestination: "auto",
		httpIdleTimeoutMs: 300000,
		cacheWarmingMode: "off",
		hideThinkingBlock: false,
		mermaidRenderingMode: "final",
		showCacheMissNotices: false,
		collapseChangelog: true,
		quietStartup: true,
		enableInstallTelemetry: false,
		defaultProjectTrust: "ask",
		doubleEscapeAction: "tree",
		treeFilterMode: "default",
		warnings: {},
		modelThinkingLevels: {},
		availableDefaultModels: [],
		showHardwareCursor: true,
		editorPaddingX: 0,
		outputPad: 1,
		autocompleteMaxVisible: 5,
		clearOnShrink: false,
		showTerminalProgress: true,
		tuiMode: "fullscreen",
		fullscreenExitOutput: "resume-hint",
		fullscreenScrollbar: "auto",
		fullscreenCopyOnSelect: true,
		fullscreenWheelScrollLines: "auto",
		currentTheme: "dark",
		terminalTheme: "dark",
		availableThemes: ["dark", "light", "system"],
	};

	await withPiUiLocalization(
		catalog,
		async () => {
			const selector = new pi.SettingsSelectorComponent(settingsConfig, {
				onCancel() {},
				onWarningsChange() {},
				onThemeChange() {},
			});
			const list = selector.getSettingsList();
			for (const item of list.items) {
				assert.ok(item.id in PI_SETTINGS_ITEM_IDS, `missing PI_SETTINGS_ITEM_IDS entry for ${item.id}`);
			}
			const renderedSettings = tui.stripTerminalSequences(selector.render(100).join("\n"));
			assert.match(renderedSettings, /自動圧縮/u);
			assert.match(renderedSettings, /コンテキストが大きくなったときに自動で圧縮します/u);
			assert.match(renderedSettings, /入力して検索 · Enter\/Space で変更 · Esc でキャンセル/u);

			// Search in /settings matches both Japanese and original English labels.
			list.applyFilter("テーマ");
			assert.equal(
				list.filteredItems.some((item) => item.id === "theme"),
				true,
			);
			list.applyFilter("theme");
			assert.equal(
				list.filteredItems.some((item) => item.id === "theme"),
				true,
			);

			// Theme submenu and Automatic Theme submenu
			const themeItem = list.items.find((item) => item.id === "theme");
			const themeSubmenu = themeItem.submenu("dark/light", () => {});
			const renderedAutoTheme = tui.stripTerminalSequences(themeSubmenu.render(100).join("\n"));
			assert.match(renderedAutoTheme, /自動テーマ/u);
			assert.match(renderedAutoTheme, /ライトテーマ/u);
			assert.match(renderedAutoTheme, /ダークテーマ/u);

			// ThinkingSelectorComponent (/thinking)
			const thinking = new pi.ThinkingSelectorComponent(
				"medium",
				["off", "low", "medium", "high"],
				() => {},
				() => {},
				() => {},
				"medium",
			);
			const renderedThinking = tui.stripTerminalSequences(thinking.render(100).join("\n"));
			assert.match(renderedThinking, /思考レベル/u);
			assert.match(renderedThinking, /標準の推論（約 8k トークン） · 既定/u);

			// TrustSelectorComponent (/trust)
			const trust = new TrustSelectorComponent({
				cwd: "/workspace/sample",
				savedDecision: null,
				projectTrusted: false,
				onSelect() {},
				onCancel() {},
			});
			const renderedTrust = tui.stripTerminalSequences(trust.render(100).join("\n"));
			assert.match(renderedTrust, /プロジェクトの信頼設定/u);
			assert.match(renderedTrust, /保存された設定: なし/u);
			assert.match(renderedTrust, /現在のセッション: 未信頼/u);
			assert.match(renderedTrust, /信頼する/u);
			assert.match(renderedTrust, /信頼しない/u);

			// OAuthSelectorComponent (/login, /logout)
			const oauth = new pi.OAuthSelectorComponent(
				"login",
				[{ id: "anthropic", name: "Anthropic", authType: "oauth", subscription: true }],
				() => {},
				() => {},
			);
			const renderedOauth = tui.stripTerminalSequences(oauth.render(100).join("\n"));
			assert.match(renderedOauth, /設定するプロバイダーを選択:/u);
			assert.match(renderedOauth, /未設定/u);

			// UserMessageSelectorComponent (/fork)
			const fork = new pi.UserMessageSelectorComponent(
				[{ id: "m1", text: "Hello 日本語" }],
				() => {},
				() => {},
			);
			const renderedFork = tui.stripTerminalSequences(fork.render(100).join("\n"));
			assert.match(renderedFork, /メッセージからフォーク/u);
			assert.match(renderedFork, /メッセージ 1 \/ 1/u);
		},
		pi,
	);

	// After withPiUiLocalization finishes, English rendering is restored.
	const englishSelector = new pi.SettingsSelectorComponent(settingsConfig, { onCancel() {} });
	const englishRendered = tui.stripTerminalSequences(englishSelector.render(100).join("\n"));
	assert.match(englishRendered, /Auto-compact/u);
	assert.doesNotMatch(englishRendered, /自動圧縮/u);
});
