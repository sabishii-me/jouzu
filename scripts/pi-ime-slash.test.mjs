import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Editor, getKeybindings } from "@earendil-works/pi-tui";
import { CustomEditor } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/custom-editor.js";
import {
	InteractiveMode,
	JouzuFullwidthSlashAutocompleteProvider,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";

const FULLWIDTH_SLASH = "\uFF0F";
const signal = new AbortController().signal;

function interactiveHarness(editor, calls) {
	const fake = Object.create(InteractiveMode.prototype);
	fake.defaultEditor = editor;
	fake.editor = editor;
	fake.pendingUserInputs = [];
	Object.defineProperty(fake, "session", { value: { isCompacting: false, isStreaming: false } });
	fake.flushPendingBashComponents = () => {};
	fake.handleModelCommand = async (searchTerm) => calls.push(["model", searchTerm]);
	InteractiveMode.prototype.setupEditorSubmitHandler.call(fake);
	return fake;
}

function submitHarness() {
	const calls = [];
	const editor = {
		onSubmit: undefined,
		setText(text) {
			calls.push(["setText", text]);
		},
		addToHistory(text) {
			calls.push(["history", text]);
		},
	};
	const fake = interactiveHarness(editor, calls);
	return { fake, calls };
}

function realEditorHarness() {
	const calls = [];
	const editor = new Editor(
		{ requestRender() {}, terminal: { rows: 24, columns: 80 } },
		{ borderColor: (text) => text, selectList: {} },
	);
	const fake = interactiveHarness(editor, calls);
	return { editor, fake, calls };
}

function commandProvider() {
	return new JouzuFullwidthSlashAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{ name: "model", description: "Choose model" },
				{ name: "thinking", description: "Set thinking" },
			],
			process.cwd(),
		),
	);
}

function argumentProvider() {
	return new JouzuFullwidthSlashAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{
					name: "model",
					description: "Choose model",
					getArgumentCompletions: async (prefix) => [{ value: `${prefix}-arg`, label: `${prefix}-arg` }],
				},
			],
			process.cwd(),
		),
	);
}

function customEditorHarness(provider) {
	const editor = new CustomEditor(
		{ requestRender() {}, terminal: { rows: 24, columns: 80 } },
		{ borderColor: (text) => text, selectList: {} },
		getKeybindings(),
	);
	editor.setAutocompleteProvider(provider);
	return editor;
}

async function settleAutocomplete(editor) {
	await new Promise((resolve) => setTimeout(resolve, 30));
	await editor.autocompleteRequestTask;
}

function followUpHarness(text, { compacting = false, streaming = false, extension = false } = {}) {
	const calls = [];
	const editor = {
		getExpandedText: () => text,
		getText: () => text,
		addToHistory: (value) => calls.push(["history", value]),
		setText: (value) => calls.push(["setText", value]),
	};
	const fake = Object.create(InteractiveMode.prototype);
	fake.editor = editor;
	Object.defineProperty(fake, "session", {
		value: {
			isCompacting: compacting,
			isStreaming: streaming,
			extensionRunner: {
				getCommand: (name) => (extension && name === "extension" ? { name } : undefined),
			},
			prompt: async (value, options) => calls.push(["prompt", value, options]),
		},
	});
	Object.defineProperty(fake, "ui", { value: { requestRender: () => calls.push(["render"]) } });
	fake.queueCompactionMessage = (value, mode) => calls.push(["queueCompaction", value, mode]);
	fake.updatePendingMessagesDisplay = () => calls.push(["updatePending"]);
	return { fake, calls };
}

function pressEnter(editor) {
	const handler = editor.onSubmit;
	return new Promise((resolve) => {
		editor.onSubmit = async (text) => {
			try {
				await handler(text);
			} finally {
				resolve();
			}
		};
		editor.cancelAutocomplete();
		editor.handleInput("\r");
	});
}

test("interactive submit normalizes only a leading full-width command slash", async () => {
	const { fake, calls } = submitHarness();
	await fake.defaultEditor.onSubmit(`  ${FULLWIDTH_SLASH}model ${FULLWIDTH_SLASH}argument `);
	assert.deepEqual(calls, [
		["setText", ""],
		["model", `${FULLWIDTH_SLASH}argument`],
	]);
	await fake.defaultEditor.onSubmit(`${FULLWIDTH_SLASH}unknown ${FULLWIDTH_SLASH}arg\nsecond line`);
	assert.deepEqual(fake.pendingUserInputs, [`/unknown ${FULLWIDTH_SLASH}arg\nsecond line`]);
	await fake.defaultEditor.onSubmit(`日本語 ${FULLWIDTH_SLASH}model`);
	assert.equal(fake.pendingUserInputs.at(-1), `日本語 ${FULLWIDTH_SLASH}model`);
	await fake.defaultEditor.onSubmit(`/unknown ${FULLWIDTH_SLASH}arg`);
	assert.equal(fake.pendingUserInputs.at(-1), `/unknown ${FULLWIDTH_SLASH}arg`);
});

test("bracketed paste stays literal until Enter submits it", async () => {
	for (const pasted of ["/model", `${FULLWIDTH_SLASH}model`]) {
		const { editor, fake, calls } = realEditorHarness();
		editor.setAutocompleteProvider(commandProvider());
		editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
		assert.equal(editor.getText(), pasted);
		assert.deepEqual(calls, []);
		assert.deepEqual(fake.pendingUserInputs, []);
		await pressEnter(editor);
		assert.deepEqual(calls, [["model", undefined]]);
		assert.equal(editor.getText(), "");
	}
});

test("multiline paste preserves later-line full-width slashes and matches ASCII submit", async () => {
	const expected = `/unknown ${FULLWIDTH_SLASH}arg\nsecond ${FULLWIDTH_SLASH}line`;
	const results = [];
	for (const pasted of [
		`/unknown ${FULLWIDTH_SLASH}arg\nsecond ${FULLWIDTH_SLASH}line`,
		`${FULLWIDTH_SLASH}unknown ${FULLWIDTH_SLASH}arg\nsecond ${FULLWIDTH_SLASH}line`,
	]) {
		const { editor, fake, calls } = realEditorHarness();
		editor.setAutocompleteProvider(commandProvider());
		editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
		assert.equal(editor.getText(), pasted);
		assert.deepEqual(calls, []);
		assert.deepEqual(fake.pendingUserInputs, []);
		await pressEnter(editor);
		assert.deepEqual(calls, []);
		assert.equal(fake.pendingUserInputs.length, 1);
		results.push(fake.pendingUserInputs[0]);
	}
	assert.deepEqual(results[0], results[1]);
	assert.equal(results[1], expected);
});

test("leading tabs and ideographic spaces keep command completion semantics", async () => {
	const provider = commandProvider();
	for (const indent of ["\t", "\u3000"]) {
		const fullwidthLine = `${indent}${FULLWIDTH_SLASH}mod`;
		const asciiLine = `${indent}/mod`;
		const fullwidth = await provider.getSuggestions([fullwidthLine], 0, fullwidthLine.length, { signal });
		const ascii = await provider.getSuggestions([asciiLine], 0, asciiLine.length, { signal });
		assert.equal(fullwidth.prefix, "/mod");
		assert.equal(fullwidth.prefix, ascii.prefix);
		assert.deepEqual(
			fullwidth.items.map((item) => item.value),
			ascii.items.map((item) => item.value),
		);
		const completed = provider.applyCompletion(
			[fullwidthLine],
			0,
			fullwidthLine.length,
			{ value: "model", label: "model" },
			"/mod",
		);
		assert.deepEqual(completed.lines, [`${indent}/model `]);
		assert.equal(completed.cursorCol, indent.length + 7);
		const editor = customEditorHarness(provider);
		editor.setText(`${indent}${FULLWIDTH_SLASH}`);
		editor.handleTabCompletion();
		await editor.autocompleteRequestTask;
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "/");
	}
	const fullwidthSubmit = submitHarness();
	await fullwidthSubmit.fake.defaultEditor.onSubmit(`\t\u3000${FULLWIDTH_SLASH}model arg`);
	const asciiSubmit = submitHarness();
	await asciiSubmit.fake.defaultEditor.onSubmit("\t\u3000/model arg");
	assert.deepEqual(fullwidthSubmit.calls, [
		["setText", ""],
		["model", "arg"],
	]);
	assert.deepEqual(fullwidthSubmit.calls, asciiSubmit.calls);
});

test("full-width command completion stays on the first editor line", async () => {
	const provider = commandProvider();
	assert.ok(await provider.getSuggestions([`${FULLWIDTH_SLASH}mod`], 0, 4, { signal }));
	assert.equal(await provider.getSuggestions([`${FULLWIDTH_SLASH}mod`, "text"], 1, 4, { signal }), null);
	assert.equal(await provider.getSuggestions(["text", `${FULLWIDTH_SLASH}mod`], 1, 4, { signal }), null);
	for (const prefix of ["/", FULLWIDTH_SLASH]) {
		const { editor } = realEditorHarness();
		editor.setAutocompleteProvider(provider);
		editor.setText(`first line\n${prefix}mod`);
		editor.handleTabCompletion();
		await editor.autocompleteRequestTask;
		assert.equal(editor.isShowingAutocomplete(), false);
		assert.equal(editor.getText(), `first line\n${prefix}mod`);
	}
});

test("noninteractive session prompt keeps a leading full-width slash literal", async () => {
	const calls = [];
	const commandChecks = [];
	const session = Object.create(AgentSession.prototype);
	session._isEmittingAgentSettled = false;
	session._compactionAbortController = undefined;
	Object.defineProperties(session, {
		isStreaming: { value: false },
		model: { value: { provider: "fixture", id: "fixture" } },
		promptTemplates: { value: [] },
	});
	session._runInputHandlers = async (text, images) => ({ text, images });
	session._expandSkillCommand = async (text) => text;
	session._modelRuntime = { hasConfiguredAuth: () => true };
	session._tryExecuteExtensionCommand = async (text) => {
		commandChecks.push(text);
		return false;
	};
	session._startRun = async (payload) => calls.push(payload);
	const text = `${FULLWIDTH_SLASH}model ${FULLWIDTH_SLASH}argument`;
	await AgentSession.prototype.prompt.call(session, text, { source: "rpc" });
	await AgentSession.prototype.prompt.call(session, text, { source: "extension", expandPromptTemplates: false });
	assert.deepEqual(calls, [
		{ messageType: "user", prompt: text, images: undefined },
		{ messageType: "user", prompt: text, images: undefined },
	]);
	assert.deepEqual(commandChecks, []);
});

test("full-width slash completion suggests commands and preserves arguments", async () => {
	const commands = [
		{ name: "model", description: "Choose model", argumentHint: "<provider/model>" },
		{ name: "thinking", description: "Set thinking" },
		{
			name: "fixture",
			description: "Fixture",
			getArgumentCompletions: async (prefix) => [{ value: prefix, label: prefix }],
		},
	];
	const base = new CombinedAutocompleteProvider(commands, process.cwd());
	const provider = new JouzuFullwidthSlashAutocompleteProvider(base);
	assert.equal(await base.getSuggestions([FULLWIDTH_SLASH], 0, 1, { signal }), null);
	assert.equal(
		await provider.getSuggestions([`text ${FULLWIDTH_SLASH}mod`], 0, `text ${FULLWIDTH_SLASH}mod`.length, { signal }),
		null,
	);

	const all = await provider.getSuggestions([FULLWIDTH_SLASH], 0, 1, { signal });
	assert.equal(all.prefix, "/");
	assert.ok(all.items.some((item) => item.value === "model"));
	const partial = await provider.getSuggestions([`${FULLWIDTH_SLASH}mod`], 0, 4, { signal });
	assert.equal(partial.prefix, "/mod");
	assert.deepEqual(
		partial.items.map((item) => item.value),
		["model"],
	);
	const forced = await provider.getSuggestions([`${FULLWIDTH_SLASH}mod`], 0, 4, { signal, force: true });
	assert.equal(forced.prefix, "/mod");
	assert.deepEqual(
		forced.items.map((item) => item.value),
		["model"],
	);

	const argument = `${FULLWIDTH_SLASH}arg`;
	const argumentLine = `${FULLWIDTH_SLASH}fixture ${argument}`;
	const argumentSuggestions = await provider.getSuggestions([argumentLine], 0, argumentLine.length, { signal });
	assert.equal(argumentSuggestions.prefix, argument);
	assert.deepEqual(argumentSuggestions.items, [{ value: argument, label: argument }]);
	assert.equal(provider.shouldTriggerFileCompletion([FULLWIDTH_SLASH], 0, 1), false);

	const commandCompletion = provider.applyCompletion(
		[`${FULLWIDTH_SLASH}mod`],
		0,
		4,
		{ value: "model", label: "model" },
		"/mod",
	);
	assert.deepEqual(commandCompletion.lines, ["/model "]);
	assert.equal(commandCompletion.cursorCol, 7);
	const spacedCompletion = provider.applyCompletion(
		[`  ${FULLWIDTH_SLASH}mod`],
		0,
		6,
		{ value: "model", label: "model" },
		"/mod",
	);
	assert.deepEqual(spacedCompletion.lines, ["  /model "]);
	assert.equal(spacedCompletion.cursorCol, 9);
	const argumentCompletion = provider.applyCompletion(
		[`${FULLWIDTH_SLASH}fixture ${FULLWIDTH_SLASH}a`],
		0,
		`${FULLWIDTH_SLASH}fixture ${FULLWIDTH_SLASH}a`.length,
		{ value: argument, label: argument },
		`${FULLWIDTH_SLASH}a`,
	);
	assert.deepEqual(argumentCompletion.lines, [`/fixture ${argument}`]);
});

test("editor opens and applies command completion for a full-width slash", async () => {
	const provider = new JouzuFullwidthSlashAutocompleteProvider(
		new CombinedAutocompleteProvider(
			[
				{ name: "model", description: "Choose model" },
				{ name: "thinking", description: "Set thinking" },
			],
			process.cwd(),
		),
	);
	const editor = customEditorHarness(provider);
	assert.ok(editor.autocompleteTriggerCharacters.includes(FULLWIDTH_SLASH));
	assert.ok(editor.autocompleteTriggerPattern.test(FULLWIDTH_SLASH));
	editor.handleInput(FULLWIDTH_SLASH);
	assert.equal(editor.getText(), FULLWIDTH_SLASH);
	editor.handleTabCompletion();
	await editor.autocompleteRequestTask;
	assert.equal(editor.isShowingAutocomplete(), true);
	assert.equal(editor.autocompletePrefix, "/");
	editor.handleInput("\t");
	assert.equal(editor.getText(), "/model ");
	assert.equal(editor.isShowingAutocomplete(), false);
});

test("custom editor reopens full-width command completion after Esc", async () => {
	const provider = argumentProvider();
	const outcomes = [];
	for (const prefix of ["/", FULLWIDTH_SLASH]) {
		const editor = customEditorHarness(provider);
		editor.handleInput(prefix);
		await settleAutocomplete(editor);
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "/");

		editor.handleInput("\x1b");
		assert.equal(editor.isShowingAutocomplete(), false);
		editor.handleInput("m");
		await settleAutocomplete(editor);
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "/m");
		assert.deepEqual(
			editor.autocompleteList.items.map((item) => item.value),
			["model"],
		);

		editor.handleInput("o");
		editor.handleInput("d");
		await settleAutocomplete(editor);
		assert.equal(editor.autocompletePrefix, "/mod");

		editor.handleInput("\x1b");
		editor.handleTabCompletion();
		await editor.autocompleteRequestTask;
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "/mod");
		assert.deepEqual(
			editor.autocompleteList.items.map((item) => item.value),
			["model"],
		);
		assert.equal(editor.getText(), `${prefix}mod`);
		outcomes.push({
			prefix: editor.autocompletePrefix,
			items: editor.autocompleteList.items.map((item) => item.value),
		});
	}
	assert.deepEqual(outcomes[0], outcomes[1]);
});

test("custom editor reopens full-width argument completion after Esc", async () => {
	const provider = argumentProvider();
	const outcomes = [];
	for (const prefix of ["/", FULLWIDTH_SLASH]) {
		const editor = customEditorHarness(provider);
		editor.setText(`${prefix}model `);
		editor.tryTriggerAutocomplete();
		await settleAutocomplete(editor);
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "");

		editor.handleInput("\x1b");
		assert.equal(editor.isShowingAutocomplete(), false);
		editor.handleInput("g");
		await settleAutocomplete(editor);
		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompletePrefix, "g");
		assert.deepEqual(
			editor.autocompleteList.items.map((item) => item.value),
			["g-arg"],
		);
		assert.equal(editor.getText(), `${prefix}model g`);
		outcomes.push({
			prefix: editor.autocompletePrefix,
			items: editor.autocompleteList.items.map((item) => item.value),
		});
		editor.handleInput("\t");
		assert.equal(editor.getText(), "/model g-arg");
	}
	assert.deepEqual(outcomes[0], outcomes[1]);
});

test("Tab after a dismissed full-width command does not fall back to file completion", async () => {
	for (const prefix of ["/", FULLWIDTH_SLASH]) {
		const editor = customEditorHarness(argumentProvider());
		editor.setText(`${prefix}model `);
		editor.tryTriggerAutocomplete();
		await settleAutocomplete(editor);
		assert.equal(editor.isShowingAutocomplete(), true);
		editor.handleInput("\x1b");
		assert.equal(editor.isShowingAutocomplete(), false);
		editor.handleTabCompletion();
		await editor.autocompleteRequestTask;
		assert.equal(editor.isShowingAutocomplete(), false);
		assert.equal(editor.getText(), `${prefix}model `);
	}
});

test("follow-up normalizes a full-width slash while streaming", async () => {
	const text = `${FULLWIDTH_SLASH}extension ${FULLWIDTH_SLASH}arg`;
	const { fake, calls } = followUpHarness(text, { streaming: true });
	await InteractiveMode.prototype.handleFollowUp.call(fake);
	assert.deepEqual(calls, [
		["history", "/extension ／arg"],
		["setText", ""],
		["prompt", "/extension ／arg", { streamingBehavior: "followUp" }],
		["updatePending"],
		["render"],
	]);
});

test("follow-up normalizes a full-width slash during compaction", async () => {
	const text = `${FULLWIDTH_SLASH}extension ${FULLWIDTH_SLASH}arg`;
	const extension = followUpHarness(text, { compacting: true, extension: true });
	await InteractiveMode.prototype.handleFollowUp.call(extension.fake);
	assert.deepEqual(extension.calls, [
		["history", "/extension ／arg"],
		["setText", ""],
		["prompt", "/extension ／arg", undefined],
	]);

	const unknown = followUpHarness(`${FULLWIDTH_SLASH}unknown ${FULLWIDTH_SLASH}arg`, {
		compacting: true,
		extension: true,
	});
	await InteractiveMode.prototype.handleFollowUp.call(unknown.fake);
	assert.deepEqual(unknown.calls, [["queueCompaction", "/unknown ／arg", "followUp"]]);
});
