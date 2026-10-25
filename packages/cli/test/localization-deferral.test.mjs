import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CatalogSettingsComponent } from "../dist/catalog-settings.js";
import { CatalogSourceStore } from "../dist/catalog-sources.js";
import {
	activeDeferralConditions,
	createLocalizationActivityTracker,
	deferralNotice,
	deferralReason,
	detectLocalizationDeferral,
	displayLanguageFixed,
	LOCALIZATION_DEFERRAL_CONDITIONS,
	reapprovalNotice,
	upstreamSwitchNotice,
} from "../dist/localization-deferral.js";
import { parseAndValidateModelCatalog } from "../dist/model-catalog.js";
import { refreshCatalogSource } from "../dist/model-catalog-sync.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { createSessionUiStyles } from "../dist/session-ui/index.js";
import { terminalTextWidth } from "../dist/terminal-layout.js";

const identityTheme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
};

function fakeKeybindings(overrides = {}) {
	const keys = {
		"tui.select.cancel": ["escape", "ctrl+c"],
		"tui.select.confirm": ["enter"],
		"tui.select.up": ["up"],
		"tui.select.down": ["down"],
		"tui.select.pageUp": ["pageUp"],
		"tui.select.pageDown": ["pageDown"],
		...overrides,
	};
	return {
		matches(data, action) {
			return keys[action]?.includes(data) ?? false;
		},
		getKeys(action) {
			return [...(keys[action] ?? [])];
		},
	};
}

function setup(options = {}) {
	const root = mkdtempSync(join(tmpdir(), "jouzu-localization-deferral-"));
	const paths = resolveJouzuPaths({ homeOverride: join(root, "jouzu") });
	const renders = [];
	const closes = [];
	const context = {
		tui: {
			requestRender() {
				renders.push(true);
			},
			terminal: { rows: options.rows ?? 32, columns: options.columns ?? 100 },
		},
		theme: identityTheme,
		keybindings: options.keybindings ?? fakeKeybindings(),
		styles: createSessionUiStyles(identityTheme),
		close() {
			closes.push(true);
		},
	};
	return { root, paths, context, renders, closes };
}

/** A recursive `path:content` snapshot, so a no-write assertion covers the whole tree. */
function snapshotTree(dir) {
	const entries = [];
	const walk = (current, prefix) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				entries.push(`${rel}/`);
				walk(join(current, entry.name), rel);
			} else {
				entries.push(`${rel}:${readFileSync(join(current, entry.name)).toString("base64")}`);
			}
		}
	};
	if (existsSync(dir)) walk(dir, "");
	return entries.sort();
}

function localizationFile(paths, settings) {
	mkdirSync(paths.configDir, { recursive: true });
	const file = join(paths.configDir, "localization.json");
	writeFileSync(file, `${JSON.stringify({ schemaVersion: 2, localization: settings })}\n`);
	return file;
}

function selectedLine(rendered) {
	return rendered.find((value) => value.slice(2).startsWith("→ "));
}

const manyModelsFixture = (() => {
	const raw = JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "catalog", "fixtures", "account-snapshot-v1.json"), "utf8"),
	);
	return parseAndValidateModelCatalog(
		JSON.stringify({
			...raw,
			modelOfferings: Array.from({ length: 30 }, (_, index) => ({
				...raw.modelOfferings[0],
				id: `ai.example.gateway/model-${index}`,
				modelId: `model-${index}`,
				name: `Example Model ${index}`,
			})),
		}),
		{ remote: true },
	);
})();

function catalogResponse(document) {
	return new Response(JSON.stringify(document, null, 2), {
		status: 200,
		headers: { "Content-Type": "application/vnd.jouzu.model-catalog+json; version=1", ETag: '"fixture"' },
	});
}

/** The activity flag that raises each condition. */
const CONDITION_FLAGS = {
	confirmation: { destructiveConfirmation: true },
	ime: { imeComposing: true },
	streaming: { streaming: true },
	tool: { runningTool: true },
	update: { updating: true },
};

// --- The detection policy ---------------------------------------------------

test("each of the five conditions is detected and supplies its own reason", () => {
	const reasons = new Set();
	for (const condition of LOCALIZATION_DEFERRAL_CONDITIONS) {
		const decision = detectLocalizationDeferral(CONDITION_FLAGS[condition]);
		assert.equal(decision.deferred, true, `${condition} defers the change`);
		assert.deepEqual(decision.conditions, [condition]);
		assert.equal(decision.primary, condition);
		assert.equal(decision.reason, deferralReason(condition));
		assert.ok((decision.reason ?? "").length > 0, `${condition} has a reason`);
		reasons.add(decision.reason);
	}
	assert.equal(reasons.size, LOCALIZATION_DEFERRAL_CONDITIONS.length, "the reasons are distinct");

	const allowed = detectLocalizationDeferral({});
	assert.equal(allowed.deferred, false, "no condition lets the change proceed");
	assert.equal(allowed.primary, undefined);
	assert.equal(allowed.reason, undefined);
	assert.equal(deferralNotice(allowed), undefined);
	assert.deepEqual(activeDeferralConditions({}), []);
});

test("the priority order names the most important active condition", () => {
	assert.deepEqual(activeDeferralConditions({ streaming: true, runningTool: true, updating: true }), [
		"streaming",
		"tool",
		"update",
	]);
	assert.equal(detectLocalizationDeferral({ streaming: true, destructiveConfirmation: true }).primary, "confirmation");
	assert.equal(detectLocalizationDeferral({ imeComposing: true, streaming: true }).primary, "ime");
	assert.deepEqual(activeDeferralConditions({ streaming: false, runningTool: true }), ["tool"]);
});

test("the deferral notice wraps the reason and the reapproval notice names the keys", () => {
	const decision = detectLocalizationDeferral({ imeComposing: true });
	assert.equal(deferralNotice(decision), `Language change deferred: ${deferralReason("ime")}`);
	const notice = reapprovalNotice("Enter", "Esc");
	assert.match(notice, /Enter/);
	assert.match(notice, /Esc/);
	assert.match(notice, /does not approve the confirmation/);
});

test("the display language is fixed only by a destructive confirmation", () => {
	assert.equal(displayLanguageFixed({ destructiveConfirmation: true }), true);
	for (const flags of [{ imeComposing: true }, { streaming: true }, { runningTool: true }, { updating: true }, {}]) {
		assert.equal(displayLanguageFixed(flags), false);
	}
	const fixed = detectLocalizationDeferral({ destructiveConfirmation: true });
	assert.equal(fixed.deferred, true);
	assert.equal(fixed.displayLanguageFixed, true);
});

test("the upstream switch condition names the next open and the restart", () => {
	const notice = upstreamSwitchNotice();
	assert.match(notice, /next time they open/);
	assert.match(notice, /restart/);
});

test("the tracker holds each condition and clears on reset", () => {
	const tracker = createLocalizationActivityTracker();
	assert.deepEqual(tracker.snapshot(), {});
	tracker.set("streaming", true);
	tracker.set("tool", true);
	assert.equal(detectLocalizationDeferral(tracker.snapshot()).primary, "streaming");
	tracker.set("streaming", false);
	assert.equal(detectLocalizationDeferral(tracker.snapshot()).primary, "tool");
	tracker.set("tool", false);
	assert.equal(detectLocalizationDeferral(tracker.snapshot()).deferred, false);
	tracker.set("confirmation", true);
	assert.equal(displayLanguageFixed(tracker.snapshot()), true);
	tracker.reset();
	assert.deepEqual(tracker.snapshot(), {});
	assert.equal(detectLocalizationDeferral(tracker.snapshot()).deferred, false);
});

// --- The Language view ------------------------------------------------------

test("the Language view shows the switch condition for upstream screens", () => {
	const f = setup();
	try {
		const component = new CatalogSettingsComponent({ context: f.context, paths: f.paths, env: {} });
		component.route({ view: "settings", query: "language" });
		assert.match(component.render(90).join("\n"), /Screens Jouzu does not own keep the current language/);
		for (const width of [48, 80, 120]) {
			const rows = component.render(width);
			assert.ok(
				rows.every((row) => terminalTextWidth(row) <= width),
				`every row fits ${width} columns`,
			);
		}
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("a deferred language change shows its reason and changes nothing", () => {
	for (const condition of LOCALIZATION_DEFERRAL_CONDITIONS) {
		const f = setup();
		try {
			const file = localizationFile(f.paths, { uiLocale: "ja", responseLanguage: "ja" });
			const before = readFileSync(file, "utf8");
			const beforeTree = snapshotTree(join(f.root, "jouzu"));
			const component = new CatalogSettingsComponent({
				context: f.context,
				paths: f.paths,
				env: {},
				activity: () => CONDITION_FLAGS[condition],
			});
			component.route({ view: "settings", query: "language" });
			component.handleInput("down");
			const rowFor = (label) => component.render(90).find((value) => value.includes(label));
			assert.ok(rowFor("Display language")?.includes("日本語"), `${condition}: the saved value shows first`);

			component.handleInput("\u001b[C");
			const rendered = component.render(90).join(" ").replace(/│/gu, "").replace(/\s+/gu, " ");
			assert.match(rendered, /Language change deferred:/, `${condition}: the deferral is named`);
			assert.ok(rendered.includes(deferralReason(condition)), `${condition}: the reason is shown`);
			assert.ok(rowFor("Display language")?.includes("日本語"), `${condition}: the value did not change`);
			assert.ok(!rowFor("Display language")?.includes("preview"), `${condition}: no preview was applied`);
			assert.equal(readFileSync(file, "utf8"), before, `${condition}: no file was written`);
			assert.deepEqual(snapshotTree(join(f.root, "jouzu")), beforeTree, `${condition}: no state changed`);
		} finally {
			rmSync(f.root, { recursive: true, force: true });
		}
	}
});

test("a change during a confirmation is deferred and never taken as approval", () => {
	const f = setup();
	try {
		const component = new CatalogSettingsComponent({
			context: f.context,
			paths: f.paths,
			env: {},
			activity: () => ({ destructiveConfirmation: true }),
		});
		component.route({ view: "settings", query: "language" });
		component.handleInput("down");
		component.handleInput("\u001b[C");
		const rendered = component.render(90).join(" ").replace(/│/gu, "").replace(/\s+/gu, " ");
		assert.match(rendered, /Language change deferred:/);
		assert.ok(rendered.includes(deferralReason("confirmation")));
		// The change is not an answer to the confirmation; the keys that are are named.
		assert.match(rendered, /does not approve the confirmation/);
		assert.match(rendered, /Enter/);
		assert.match(rendered, /Esc/);
		// No preview was applied while the confirmation is open.
		const row = component.render(90).find((value) => value.includes("Display language"));
		assert.ok(row?.includes("builtin"), "the display language source is unchanged");
		assert.ok(!row?.includes("preview"));
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("a preview change keeps the selected catalog item", () => {
	const f = setup();
	try {
		localizationFile(f.paths, { uiLocale: "en", responseLanguage: "en" });
		const store = new CatalogSourceStore(f.paths);
		store.add({ label: "Office pool", url: "https://office.example/catalog", auth: { type: "none" } });
		const component = new CatalogSettingsComponent({ context: f.context, paths: f.paths, env: {} });
		component.route({ view: "settings", query: "catalogs" });
		component.handleInput("down");
		assert.ok(selectedLine(component.render(90))?.includes("Office pool"), "the user source is selected");
		const retained = component.snapshotRoute();

		component.route({ view: "settings", query: "language" });
		component.handleInput("down");
		component.handleInput("\u001b[C");
		assert.equal(component.allowsGlobalNavigation(), false, "preview must be resolved before leaving");
		component.handleInput("escape");
		component.route({ ...retained, resume: true });
		assert.ok(
			selectedLine(component.render(90))?.includes("Office pool"),
			"the selection survives the language preview",
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("a deferred change keeps the selection and the scroll position", async () => {
	const f = setup({ rows: 24 });
	try {
		const store = new CatalogSourceStore(f.paths);
		const source = store.add({
			label: "Paged pool",
			url: "https://paged.example/v1/jouzu/model-catalog",
			auth: { type: "none" },
		});
		await refreshCatalogSource(f.paths, source, { env: {}, fetch: async () => catalogResponse(manyModelsFixture) });
		const component = new CatalogSettingsComponent({
			context: f.context,
			paths: f.paths,
			env: {},
			activity: () => ({ streaming: true }),
		});
		component.route({ view: "settings", query: "catalogs" });
		component.handleInput("down");
		component.handleInput("\u001b[C");
		component.render(84);
		component.handleInput("pageDown");
		const before = component.render(84).join("\n");
		assert.ok(selectedLine(component.render(84))?.includes("Paged pool"));
		const position = /\d+-\d+\/30/u.exec(before)?.[0];
		assert.ok(position && !position.startsWith("1-"), "the scroll position moved off the first page");
		const retained = component.snapshotRoute();

		// Attempt a language change while a reply is streaming: it is deferred.
		component.route({ view: "settings", query: "language" });
		component.handleInput("down");
		component.handleInput("\u001b[C");
		assert.match(component.render(90).join("\n"), /Language change deferred:/);

		component.route({ ...retained, resume: true });
		const after = component.render(84).join("\n");
		assert.ok(selectedLine(component.render(84))?.includes("Paged pool"), "the selection is unchanged");
		assert.equal(
			/\d+-\d+\/30/u.exec(after)?.[0]?.split("-")[0],
			position.split("-")[0],
			"the first visible offering is unchanged",
		);
		assert.equal(
			component.expandedOffset,
			JSON.parse(retained.query).offering,
			"the stored offering offset is unchanged",
		);
		assert.ok(component.render(84).every((row) => terminalTextWidth(row) <= 84));
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("a language change cannot discard a catalog form draft", () => {
	const f = setup();
	try {
		const component = new CatalogSettingsComponent({ context: f.context, paths: f.paths, env: {} });
		component.route({ view: "settings", query: "catalogs" });
		component.handleInput("a");
		for (const character of "Draft pool") component.handleInput(character);
		assert.equal(component.allowsGlobalNavigation(), false, "a live form blocks global navigation");
		component.route({ view: "settings", query: "language" });
		const rendered = component.render(90).join("\n");
		assert.match(rendered, /Draft pool/, "the typed input survives the refused change");
		assert.match(rendered, /Add catalog/);
		assert.doesNotMatch(rendered, /Settings \/ Language/);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("the component's own destructive confirmation fixes the display language", () => {
	const f = setup();
	try {
		const store = new CatalogSourceStore(f.paths);
		const source = store.add({
			label: "Removable pool",
			url: "https://removable.example/catalog",
			auth: { type: "none" },
		});
		const component = new CatalogSettingsComponent({ context: f.context, paths: f.paths, env: {} });
		component.route({ view: "settings", query: "catalogs" });
		component.handleInput("down");
		component.handleInput("d");
		const prompt = component.render(90).join("\n");
		assert.match(prompt, /Press Enter to remove this catalog source/);
		assert.equal(component.allowsGlobalNavigation(), false, "the confirmation holds the panel");

		// A language route is refused while the confirmation is open, and the
		// confirmation survives it: the language change did not answer it.
		component.route({ view: "settings", query: "language" });
		const after = component.render(90).join("\n");
		assert.match(after, /Press Enter to remove this catalog source/, "the confirmation is unchanged");
		assert.doesNotMatch(after, /Settings \/ Language/);
		assert.ok(
			new CatalogSourceStore(f.paths).list().some((entry) => entry.id === source.id),
			"the operation was not performed by the language change",
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
