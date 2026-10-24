import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

/** The settings shape Pi's SettingsSelectorComponent expects for adapter tests. */
export function createSettingsConfig(overrides = {}) {
	return {
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
		...overrides,
	};
}

/** One native SessionInfo row whose display text must survive localization. */
export function createSessionInfo(overrides = {}) {
	const timestamp = new Date(0);
	return {
		path: "/workspace/sample/session.jsonl",
		id: "session-1",
		cwd: "/workspace/sample",
		created: timestamp,
		modified: timestamp,
		messageCount: 1,
		firstMessage: "First message",
		allMessagesText: "First message",
		...overrides,
	};
}

/** A one-entry native session tree with a user message that must stay verbatim. */
export function createSessionTree() {
	return [
		{
			entry: {
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				message: { role: "user", content: "hello from the user" },
			},
			children: [],
		},
	];
}

/** Render a component and remove styling so assertions can match visible text. */
export function renderedLines(component, width) {
	return component.render(width).map((line) => stripTerminalSequences(line));
}

/** Render a component and join its visible lines for multi-line assertions. */
export function renderedText(component, width) {
	return renderedLines(component, width).join("\n");
}

/** Assert every visible line fits the requested terminal width. */
export function assertLinesFit(assert, component, width) {
	for (const line of renderedLines(component, width)) {
		assert.ok(visibleWidth(line) <= width, `line exceeds ${width} columns: ${JSON.stringify(line)}`);
	}
}
