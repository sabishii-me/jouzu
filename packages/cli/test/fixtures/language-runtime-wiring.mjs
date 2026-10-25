// Exercise the real launcher, picker, Settings, contract, and presentation.
// Only line-input/onboarding and Pi's outer terminal loop are substituted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";

const scenario = JSON.parse(process.argv[2]);
const observed = { prompts: 0, catalogs: {}, callbacks: [], networkRequests: 0 };
const redirects = new Map();
const dist = (file) => new URL(`../../dist/${file}`, import.meta.url).href;
let languageContract;

function wrap(file, body) {
	const url = dist(file);
	redirects.set(url, `data:text/javascript,${encodeURIComponent(`export * from ${JSON.stringify(url)};\n${body}`)}`);
}

wrap(
	"language-choice.js",
	`
export async function promptForLanguageChoice() {
	globalThis.__languageWiring.observed.prompts += 1;
	return globalThis.__languageWiring.choice;
}`,
);
wrap(
	"pi-import.js",
	`
export async function offerPiConfigurationImport(_paths, options) {
	globalThis.__languageWiring.observed.catalogs.piImport = options.catalog.locale;
}`,
);
wrap(
	"shisa-link/onboarding.js",
	`
export async function offerShisaOnboarding(options) {
	globalThis.__languageWiring.observed.catalogs.onboarding = options.catalog.locale;
}`,
);
wrap(
	"language-contract.js",
	`
import { createLanguageContractExtension as original } from ${JSON.stringify(dist("language-contract.js"))};
export function createLanguageContractExtension(options) {
	const contract = original(options);
	globalThis.__languageWiring.captureContract(contract);
	return contract;
}`,
);
wrap(
	"model-picker.js",
	`
import { createJouzuModelPicker as original } from ${JSON.stringify(dist("model-picker.js"))};
export function createJouzuModelPicker(paths, options) {
	globalThis.__languageWiring.observed.catalogs.picker = options.catalog.locale;
	return original(paths, { ...options,
		onLanguageChanged: options.onLanguageChanged && ((language) => {
			globalThis.__languageWiring.languageSaved(language);
			options.onLanguageChanged(language);
		})
	});
}`,
);
wrap(
	"presentation.js",
	`
import { createJouzuPresentationExtension as original } from ${JSON.stringify(dist("presentation.js"))};
export function createJouzuPresentationExtension(metadata, profile, options) {
	globalThis.__languageWiring.observed.catalogs.presentation = options.catalog.locale;
	globalThis.__languageWiring.observed.profile = profile.id;
	return original(metadata, profile, options);
}`,
);
wrap(
	"session-ui/index.js",
	`
import { createSessionUiExtension as original } from ${JSON.stringify(dist("session-ui/index.js"))};
export function createSessionUiExtension(options) {
	globalThis.__languageWiring.observed.catalogs.sessionUi = options.catalog.locale;
	globalThis.__languageWiring.captureSessionUi(options);
	return original(options);
}`,
);

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (specifier === "@earendil-works/pi-coding-agent" && context.parentURL === dist("main-cli.js")) {
			return {
				shortCircuit: true,
				url: `data:text/javascript,${encodeURIComponent(`
export * from ${JSON.stringify(resolved.url)};
export function keyText(action) { return globalThis.__languageWiring.keyText(action); }
export async function main(args, options) { return globalThis.__languageWiring.run(args, options); }
`)}`,
			};
		}
		const wrapper = redirects.get(resolved.url);
		return wrapper && specifier !== resolved.url ? { url: wrapper, shortCircuit: true } : resolved;
	},
});

Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
globalThis.fetch = async () => {
	observed.networkRequests += 1;
	throw new Error("network access is not part of this regression test");
};

const { resolveJouzuPaths } = await import(dist("paths.js"));
const { LOCALIZATION_FILE_NAME, readLocalizationSettings } = await import(dist("ui-locale.js"));
const { LOCALIZATION_SESSION_FILE_NAME, readLocalizationSessionOverride } = await import(dist("localization-ops.js"));
const paths = resolveJouzuPaths({ homeOverride: scenario.home });
const settingsFile = join(paths.configDir, LOCALIZATION_FILE_NAME);
const sessionFile = join(paths.stateDir, LOCALIZATION_SESSION_FILE_NAME);
const sessionId = "language-wiring-session";
mkdirSync(paths.configDir, { recursive: true });
if (scenario.rawSettings !== undefined) writeFileSync(settingsFile, scenario.rawSettings);
else if (scenario.settings)
	writeFileSync(settingsFile, `${JSON.stringify({ schemaVersion: 2, localization: scenario.settings })}\n`);
const savedBefore = existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : undefined;

const theme = { fg: (_role, value) => value, bg: (_role, value) => value, bold: (value) => value };
const bindings = {
	"tui.select.down": ["down"],
	"tui.select.up": ["up"],
	"tui.select.confirm": ["enter"],
	"tui.select.cancel": ["escape", "ctrl+c"],
	"tui.select.pageUp": ["pageUp"],
	"tui.select.pageDown": ["pageDown"],
};
const keybindings = {
	matches: (key, action) => bindings[action]?.includes(key) ?? false,
	getKeys: (action) => bindings[action] ?? [],
};
const promptEvent = {
	systemPrompt:
		"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\n\nAvailable tools:\n- read: Read file contents",
	systemPromptOptions: { customPrompt: undefined, selectedTools: ["read"], skills: [] },
};

let sessionUiOptions;
let tuiStarted = false;

globalThis.__languageWiring = {
	observed,
	choice: scenario.choice,
	captureContract(contract) {
		languageContract = contract;
	},
	captureSessionUi(options) {
		sessionUiOptions = options;
	},
	keyText(action) {
		if (!tuiStarted) return "";
		if (action === "app.model.select") return "ctrl+l";
		if (action === "app.model.cycleForward") return "ctrl+p";
		return "";
	},
	languageSaved(language) {
		observed.callbacks.push({
			language,
			persisted: readLocalizationSessionOverride(paths.stateDir, sessionId),
			saved: readLocalizationSettings(paths.configDir),
		});
	},
	async run(args, options) {
		tuiStarted = true;
		observed.piArgs = args;
		observed.agentDir = process.env.PI_CODING_AGENT_DIR;
		observed.shortcutHint = sessionUiOptions?.getHints?.(undefined)?.[0]?.text;
		const handlers = new Map();
		const commands = new Map();
		const entries = [];
		const api = {
			on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			registerCommand: (name, command) => commands.set(name, command),
			registerTool() {},
			appendEntry: (customType, data) => entries.push({ type: "custom", customType, data: structuredClone(data) }),
			setModel: async () => true,
			events: {
				on() {
					return () => {};
				},
				emit() {},
			},
		};
		for (const extension of options.extensionFactories) {
			if (["jouzu-language-contract", "jouzu", "jouzu-model-picker"].includes(extension.name)) extension.factory(api);
		}
		let panel;
		let closePanel;
		const ctx = {
			mode: scenario.machine ? "rpc" : "tui",
			cwd: process.cwd(),
			scopedModels: [],
			sessionManager: { getEntries: () => entries, getBranch: () => [], getSessionId: () => sessionId },
			modelRegistry: { getAvailable: () => [], getAll: () => [] },
			getContextUsage: () => undefined,
			isIdle: () => true,
			ui: {
				theme,
				notify() {},
				setTitle() {},
				setWorkingIndicator() {},
				setHeader() {},
				custom: (factory) =>
					new Promise((resolve) => {
						closePanel = resolve;
						panel = factory({ requestRender() {}, terminal: { rows: 32, columns: 100 } }, theme, keybindings, resolve);
					}),
			},
		};
		const emit = async (event, data = {}) => {
			let result;
			for (const handler of handlers.get(event) ?? []) result = (await handler(data, ctx)) ?? result;
			return result;
		};
		// Pi hands each run fresh options; presentation sets the preamble section on them.
		const composedPreamble = async () => {
			const event = { ...promptEvent, systemPromptOptions: { ...promptEvent.systemPromptOptions, sections: {} } };
			await emit("before_agent_start", event);
			return event.systemPromptOptions.sections.preamble;
		};
		const snapshot = () => ({
			contract: structuredClone(languageContract.currentContract()),
			section: languageContract.currentSection(),
			epochs: entries.length,
		});
		await emit("session_start", { reason: "startup" });
		observed.initial = snapshot();
		observed.initialPrompt = await composedPreamble();
		if (scenario.action) {
			const opening = commands.get("catalogs").handler("", ctx);
			assert.ok(panel, "the production Settings caller opened a panel");
			panel.route({ view: "settings", query: "language" });
			if (scenario.action === "ui-only" || scenario.action === "ui-english") {
				panel.handleInput(scenario.action === "ui-english" ? "\u001b[D" : "\u001b[C");
			} else {
				panel.handleInput("down");
				if (scenario.action !== "artifact-only") panel.handleInput("\u001b[C");
				panel.handleInput("down");
				panel.handleInput("\u001b[C");
			}
			observed.preview = snapshot();
			panel.handleInput("enter");
			observed.confirmation = panel.render(80).join("\n");
			if (scenario.action === "cancel") {
				panel.handleInput("escape");
				panel.handleInput("escape");
			} else {
				if (scenario.action === "failure") writeFileSync(sessionFile, "{invalid\n");
				if (scenario.action.startsWith("defer-")) {
					const tool = scenario.action === "defer-tool";
					await emit(tool ? "tool_execution_start" : "agent_start");
					panel.handleInput("enter");
					observed.deferred = {
						...snapshot(),
						callbacks: observed.callbacks.length,
						sessionFileExists: existsSync(sessionFile),
						rendered: panel.render(80).join("\n"),
					};
					await emit(tool ? "tool_execution_end" : "agent_end");
				}
				panel.handleInput("enter");
			}
			observed.applied = snapshot();
			observed.activeUiLocale = sessionUiOptions.catalog.locale;
			observed.activeShortcutHint = sessionUiOptions.getHints?.(undefined)?.[0]?.text;
			observed.rendered = panel.render(80).join("\n");
			observed.nextPrompt = await composedPreamble();
			observed.next = snapshot();
			if (scenario.action === "reset") {
				panel.route({ view: "settings", query: "language" });
				panel.handleInput("r");
				panel.handleInput("enter");
				observed.resetStaged = snapshot();
				observed.resetRendered = panel.render(80).join("\n");
				observed.resetPrompt = await composedPreamble();
				observed.reset = snapshot();
			}
			closePanel();
			await opening;
		}
		await emit("session_shutdown");
	},
};

const { runMainCli } = await import(dist("main-cli.js"));
await runMainCli([
	"--jouzu-home",
	scenario.home,
	...(scenario.cliLocale ? ["--jouzu-ui-locale", scenario.cliLocale] : []),
	...(scenario.cliProfile ? ["--jouzu-profile", scenario.cliProfile] : []),
	"--no-extensions",
	...(scenario.machine ? ["--mode", "rpc"] : []),
]);
observed.settingsBefore = savedBefore;
observed.settingsAfter = existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : undefined;
observed.sessionFile = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : undefined;
observed.profileChoiceExists = existsSync(join(paths.stateDir, "profile-choice.json"));
const appendPath = join(paths.agentDir, "APPEND_SYSTEM.md");
observed.installedAppendSystem = existsSync(appendPath) ? readFileSync(appendPath, "utf8") : undefined;
writeFileSync(scenario.output, JSON.stringify(observed));
