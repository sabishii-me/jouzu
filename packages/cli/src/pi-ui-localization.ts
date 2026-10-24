import type {
	SessionSelectorComponent,
	TreeSelectorComponent,
	UserMessageSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyFilter,
	SelectList,
	SettingsList,
	stripTerminalSequences,
	Text,
	TruncatedText,
} from "@earendil-works/pi-tui";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";

/**
 * The catalog IDs for every setting in Pi's `SettingsSelectorComponent`,
 * `WarningSettingsSubmenu`, and `ThemeSubmenu`, keyed by `item.id`.
 */
export const PI_SETTINGS_ITEM_IDS: Readonly<
	Record<
		string,
		{ readonly labelId: string; readonly descriptionId: string; readonly keyMode?: "followUp" | "cycleThinking" }
	>
> = Object.freeze({
	autocompact: {
		labelId: "jouzu.cli.piUi.settings.autocompact.label",
		descriptionId: "jouzu.cli.piUi.settings.autocompact.description",
	},
	"show-images": {
		labelId: "jouzu.cli.piUi.settings.showImages.label",
		descriptionId: "jouzu.cli.piUi.settings.showImages.description",
	},
	"image-width-cells": {
		labelId: "jouzu.cli.piUi.settings.imageWidthCells.label",
		descriptionId: "jouzu.cli.piUi.settings.imageWidthCells.description",
	},
	"auto-resize-images": {
		labelId: "jouzu.cli.piUi.settings.autoResizeImages.label",
		descriptionId: "jouzu.cli.piUi.settings.autoResizeImages.description",
	},
	"block-images": {
		labelId: "jouzu.cli.piUi.settings.blockImages.label",
		descriptionId: "jouzu.cli.piUi.settings.blockImages.description",
	},
	"skill-commands": {
		labelId: "jouzu.cli.piUi.settings.skillCommands.label",
		descriptionId: "jouzu.cli.piUi.settings.skillCommands.description",
	},
	"show-hardware-cursor": {
		labelId: "jouzu.cli.piUi.settings.showHardwareCursor.label",
		descriptionId: "jouzu.cli.piUi.settings.showHardwareCursor.description",
	},
	"editor-padding": {
		labelId: "jouzu.cli.piUi.settings.editorPadding.label",
		descriptionId: "jouzu.cli.piUi.settings.editorPadding.description",
	},
	"output-padding": {
		labelId: "jouzu.cli.piUi.settings.outputPadding.label",
		descriptionId: "jouzu.cli.piUi.settings.outputPadding.description",
	},
	"autocomplete-max-visible": {
		labelId: "jouzu.cli.piUi.settings.autocompleteMaxVisible.label",
		descriptionId: "jouzu.cli.piUi.settings.autocompleteMaxVisible.description",
	},
	"clear-on-shrink": {
		labelId: "jouzu.cli.piUi.settings.clearOnShrink.label",
		descriptionId: "jouzu.cli.piUi.settings.clearOnShrink.description",
	},
	"terminal-progress": {
		labelId: "jouzu.cli.piUi.settings.terminalProgress.label",
		descriptionId: "jouzu.cli.piUi.settings.terminalProgress.description",
	},
	"steering-mode": {
		labelId: "jouzu.cli.piUi.settings.steeringMode.label",
		descriptionId: "jouzu.cli.piUi.settings.steeringMode.description",
	},
	"follow-up-mode": {
		labelId: "jouzu.cli.piUi.settings.followUpMode.label",
		descriptionId: "jouzu.cli.piUi.settings.followUpMode.description",
		keyMode: "followUp",
	},
	transport: {
		labelId: "jouzu.cli.piUi.settings.transport.label",
		descriptionId: "jouzu.cli.piUi.settings.transport.description",
	},
	"share-destination": {
		labelId: "jouzu.cli.piUi.settings.shareDestination.label",
		descriptionId: "jouzu.cli.piUi.settings.shareDestination.description",
	},
	"http-idle-timeout": {
		labelId: "jouzu.cli.piUi.settings.httpIdleTimeout.label",
		descriptionId: "jouzu.cli.piUi.settings.httpIdleTimeout.description",
	},
	"cache-warming-mode": {
		labelId: "jouzu.cli.piUi.settings.cacheWarmingMode.label",
		descriptionId: "jouzu.cli.piUi.settings.cacheWarmingMode.description",
	},
	"hide-thinking": {
		labelId: "jouzu.cli.piUi.settings.hideThinking.label",
		descriptionId: "jouzu.cli.piUi.settings.hideThinking.description",
	},
	"mermaid-rendering": {
		labelId: "jouzu.cli.piUi.settings.mermaidRendering.label",
		descriptionId: "jouzu.cli.piUi.settings.mermaidRendering.description",
	},
	"cache-miss-notices": {
		labelId: "jouzu.cli.piUi.settings.cacheMissNotices.label",
		descriptionId: "jouzu.cli.piUi.settings.cacheMissNotices.description",
	},
	"collapse-changelog": {
		labelId: "jouzu.cli.piUi.settings.collapseChangelog.label",
		descriptionId: "jouzu.cli.piUi.settings.collapseChangelog.description",
	},
	"quiet-startup": {
		labelId: "jouzu.cli.piUi.settings.quietStartup.label",
		descriptionId: "jouzu.cli.piUi.settings.quietStartup.description",
	},
	"install-telemetry": {
		labelId: "jouzu.cli.piUi.settings.installTelemetry.label",
		descriptionId: "jouzu.cli.piUi.settings.installTelemetry.description",
	},
	"default-project-trust": {
		labelId: "jouzu.cli.piUi.settings.defaultProjectTrust.label",
		descriptionId: "jouzu.cli.piUi.settings.defaultProjectTrust.description",
	},
	"double-escape-action": {
		labelId: "jouzu.cli.piUi.settings.doubleEscapeAction.label",
		descriptionId: "jouzu.cli.piUi.settings.doubleEscapeAction.description",
	},
	"tree-filter-mode": {
		labelId: "jouzu.cli.piUi.settings.treeFilterMode.label",
		descriptionId: "jouzu.cli.piUi.settings.treeFilterMode.description",
	},
	warnings: {
		labelId: "jouzu.cli.piUi.settings.warnings.label",
		descriptionId: "jouzu.cli.piUi.settings.warnings.description",
	},
	"model-thinking": {
		labelId: "jouzu.cli.piUi.settings.modelThinking.label",
		descriptionId: "jouzu.cli.piUi.settings.modelThinking.description",
		keyMode: "cycleThinking",
	},
	"tui-mode": {
		labelId: "jouzu.cli.piUi.settings.tuiMode.label",
		descriptionId: "jouzu.cli.piUi.settings.tuiMode.description",
	},
	"fullscreen-exit-output": {
		labelId: "jouzu.cli.piUi.settings.fullscreenExitOutput.label",
		descriptionId: "jouzu.cli.piUi.settings.fullscreenExitOutput.description",
	},
	"fullscreen-scrollbar": {
		labelId: "jouzu.cli.piUi.settings.fullscreenScrollbar.label",
		descriptionId: "jouzu.cli.piUi.settings.fullscreenScrollbar.description",
	},
	"fullscreen-copy-on-select": {
		labelId: "jouzu.cli.piUi.settings.fullscreenCopyOnSelect.label",
		descriptionId: "jouzu.cli.piUi.settings.fullscreenCopyOnSelect.description",
	},
	"fullscreen-wheel-scroll-lines": {
		labelId: "jouzu.cli.piUi.settings.fullscreenWheelScrollLines.label",
		descriptionId: "jouzu.cli.piUi.settings.fullscreenWheelScrollLines.description",
	},
	theme: {
		labelId: "jouzu.cli.piUi.settings.theme.label",
		descriptionId: "jouzu.cli.piUi.settings.theme.description",
	},
	"anthropic-extra-usage": {
		labelId: "jouzu.cli.piUi.settings.anthropicExtraUsage.label",
		descriptionId: "jouzu.cli.piUi.settings.anthropicExtraUsage.description",
	},
	"light-theme": {
		labelId: "jouzu.cli.piUi.settings.lightTheme.label",
		descriptionId: "jouzu.cli.piUi.settings.lightTheme.description",
	},
	"dark-theme": {
		labelId: "jouzu.cli.piUi.settings.darkTheme.label",
		descriptionId: "jouzu.cli.piUi.settings.darkTheme.description",
	},
	apply: {
		labelId: "jouzu.cli.piUi.settings.apply.label",
		descriptionId: "jouzu.cli.piUi.settings.apply.description",
	},
	"single-mode": {
		labelId: "jouzu.cli.piUi.settings.singleMode.label",
		descriptionId: "jouzu.cli.piUi.settings.singleMode.description",
	},
});

const THINKING_LEVEL_IDS: Readonly<Record<string, string>> = Object.freeze({
	off: "jouzu.cli.piUi.thinking.off",
	minimal: "jouzu.cli.piUi.thinking.minimal",
	low: "jouzu.cli.piUi.thinking.low",
	medium: "jouzu.cli.piUi.thinking.medium",
	high: "jouzu.cli.piUi.thinking.high",
	xhigh: "jouzu.cli.piUi.thinking.xhigh",
	max: "jouzu.cli.piUi.thinking.max",
});

const EXACT_TEXT_IDS: readonly string[] = Object.freeze([
	"jouzu.cli.piUi.thinking.title",
	"jouzu.cli.piUi.thinking.perModelTitle",
	"jouzu.cli.piUi.thinking.perModelSelectModel",
	"jouzu.cli.piUi.thinking.perModelSelectLevel",
	"jouzu.cli.piUi.theme.title",
	"jouzu.cli.piUi.theme.description",
	"jouzu.cli.piUi.theme.automaticTitle",
	"jouzu.cli.piUi.theme.automaticSubtitle1",
	"jouzu.cli.piUi.theme.automaticSubtitle2",
	"jouzu.cli.piUi.theme.lightTitle",
	"jouzu.cli.piUi.theme.lightDescription",
	"jouzu.cli.piUi.theme.darkTitle",
	"jouzu.cli.piUi.theme.darkDescription",
	"jouzu.cli.piUi.submenu.hintFilterBack",
	"jouzu.cli.piUi.submenu.hintBack",
	"jouzu.cli.piUi.trust.title",
	"jouzu.cli.piUi.trust.savedNone",
	"jouzu.cli.piUi.trust.sessionTrusted",
	"jouzu.cli.piUi.trust.sessionUntrusted",
	"jouzu.cli.piUi.trust.optionTrust",
	"jouzu.cli.piUi.trust.optionTrustSession",
	"jouzu.cli.piUi.trust.optionDoNotTrust",
	"jouzu.cli.piUi.trust.optionDoNotTrustSession",
	"jouzu.cli.piUi.oauth.loginTitle",
	"jouzu.cli.piUi.oauth.logoutTitle",
	"jouzu.cli.piUi.fork.title",
	"jouzu.cli.piUi.fork.description",
	"jouzu.cli.piUi.fork.empty",
	"jouzu.cli.piUi.resume.titleCurrent",
	"jouzu.cli.piUi.resume.titleAll",
	"jouzu.cli.piUi.resume.renameTitle",
	"jouzu.cli.piUi.tree.title",
	"jouzu.cli.piUi.tree.search",
	"jouzu.cli.piUi.tree.labelPrompt",
]);

interface SettingsItemShape {
	id: string;
	label: string;
	description?: string;
}

interface SelectItemShape {
	value: string;
	label: string;
	description?: string;
}

export interface PiUiRuntime {
	SessionSelectorComponent?: typeof SessionSelectorComponent;
	TreeSelectorComponent?: typeof TreeSelectorComponent;
	UserMessageSelectorComponent?: typeof UserMessageSelectorComponent;
}

/**
 * Localize a `SettingsList` instance's items in place once, preserving the
 * English label in `originalLabels` so fuzzy search matches both languages.
 */
export function localizePiSettingsList(
	list: SettingsList,
	catalog: CatalogBundle,
	seen: WeakSet<SettingsList>,
	originalLabels: WeakMap<object, string>,
): void {
	if (seen.has(list)) return;
	seen.add(list);
	const en = defaultCatalog();
	const items = (list as unknown as { items?: SettingsItemShape[] }).items ?? [];
	for (const item of items) {
		const spec = PI_SETTINGS_ITEM_IDS[item.id];
		if (!spec) continue;
		originalLabels.set(item, item.label);
		item.label = catalogText(catalog, spec.labelId);
		if (spec.keyMode === "followUp") {
			const enTemplate = catalogText(en, spec.descriptionId, { key: "{key}" });
			const [, suffix = ""] = enTemplate.split("{key}");
			const key =
				suffix && item.description?.endsWith(suffix)
					? item.description.slice(0, item.description.length - suffix.length)
					: "";
			item.description = catalogText(catalog, spec.descriptionId, { key });
		} else if (spec.keyMode === "cycleThinking") {
			const enTemplate = catalogText(en, spec.descriptionId, { key: "{key}" });
			const [prefix = "", suffix = ""] = enTemplate.split("{key}");
			const key =
				item.description?.startsWith(prefix) && item.description.endsWith(suffix)
					? item.description.slice(prefix.length, item.description.length - suffix.length)
					: "";
			item.description = catalogText(catalog, spec.descriptionId, { key });
		} else {
			item.description = catalogText(catalog, spec.descriptionId);
		}
	}
}

/** Localize a `SelectList` instance's items in place once. */
export function localizePiSelectList(list: SelectList, catalog: CatalogBundle, seen: WeakSet<SelectList>): void {
	if (seen.has(list)) return;
	seen.add(list);
	const en = defaultCatalog();
	const enDefaultSuffix = ` · ${catalogText(en, "jouzu.cli.piUi.thinking.defaultSuffix")}`;
	const localDefaultSuffix = ` · ${catalogText(catalog, "jouzu.cli.piUi.thinking.defaultSuffix")}`;
	const enClearLabel = `  ${catalogText(en, "jouzu.cli.piUi.thinking.clearOverride")}`;
	const enRevertTemplate = catalogText(en, "jouzu.cli.piUi.thinking.revertDefault", { level: "{level}" });
	const [enRevertPrefix = "", enRevertSuffix = ""] = enRevertTemplate.split("{level}");
	const enNoModelsLabel = catalogText(en, "jouzu.cli.piUi.thinking.noModelsLabel");
	const enSystemDesc = catalogText(en, "jouzu.cli.piUi.theme.systemDescription");
	const enAutoLabel = `  ${catalogText(en, "jouzu.cli.piUi.theme.automaticLabel")}`;
	const enCurrent = catalogText(en, "jouzu.cli.piUi.theme.current");
	const enYesDesc = catalogText(en, "jouzu.cli.piUi.showImages.yesDescription");
	const enNoDesc = catalogText(en, "jouzu.cli.piUi.showImages.noDescription");

	const items = (list as unknown as { items?: SelectItemShape[] }).items ?? [];
	for (const item of items) {
		const thinkingId = THINKING_LEVEL_IDS[item.value];
		if (thinkingId && item.description) {
			const enDesc = catalogText(en, thinkingId);
			if (item.description === enDesc) {
				item.description = catalogText(catalog, thinkingId);
			} else if (item.description === `${enDesc}${enDefaultSuffix}`) {
				item.description = `${catalogText(catalog, thinkingId)}${localDefaultSuffix}`;
			}
			continue;
		}
		if (item.value === "__clear__" && item.label === enClearLabel) {
			item.label = `  ${catalogText(catalog, "jouzu.cli.piUi.thinking.clearOverride")}`;
			if (item.description?.startsWith(enRevertPrefix) && item.description.endsWith(enRevertSuffix)) {
				const level = item.description.slice(enRevertPrefix.length, item.description.length - enRevertSuffix.length);
				item.description = catalogText(catalog, "jouzu.cli.piUi.thinking.revertDefault", { level });
			}
			continue;
		}
		if (item.value === "__none__" && item.label === enNoModelsLabel) {
			item.label = catalogText(catalog, "jouzu.cli.piUi.thinking.noModelsLabel");
			item.description = catalogText(catalog, "jouzu.cli.piUi.thinking.noModelsDescription");
			continue;
		}
		if (item.value === "system" && item.description === enSystemDesc) {
			item.description = catalogText(catalog, "jouzu.cli.piUi.theme.systemDescription");
			continue;
		}
		if (item.value === "/" && item.label === enAutoLabel) {
			item.label = `  ${catalogText(catalog, "jouzu.cli.piUi.theme.automaticLabel")}`;
			item.description = catalogText(catalog, "jouzu.cli.piUi.theme.automaticDescription");
			continue;
		}
		if (item.value === "yes" && item.description === enYesDesc) {
			item.label = catalogText(catalog, "jouzu.cli.piUi.showImages.yesLabel");
			item.description = catalogText(catalog, "jouzu.cli.piUi.showImages.yesDescription");
			continue;
		}
		if (item.value === "no" && item.description === enNoDesc) {
			item.label = catalogText(catalog, "jouzu.cli.piUi.showImages.noLabel");
			item.description = catalogText(catalog, "jouzu.cli.piUi.showImages.noDescription");
			continue;
		}
		if (item.description === enCurrent) {
			item.description = catalogText(catalog, "jouzu.cli.piUi.theme.current");
		}
	}
}

function buildTextTranslator(catalog: CatalogBundle): (raw: string) => string {
	const en = defaultCatalog();
	const exactPairs: Array<[string, string]> = [];
	for (const id of EXACT_TEXT_IDS) {
		const from = catalogText(en, id);
		const to = catalogText(catalog, id);
		if (from && to && from !== to) exactPairs.push([from, to]);
	}
	const exactMap = new Map(exactPairs);

	const splitTemplate = (id: string, token: string): [string, string] => {
		const rendered = catalogText(en, id, { [token]: `{${token}}` });
		const [prefix = "", suffix = ""] = rendered.split(`{${token}}`);
		return [prefix, suffix];
	};

	const [forModelPre, forModelSuf] = splitTemplate("jouzu.cli.piUi.thinking.perModelForModel", "model");
	const [cyclePre, cycleSuf] = splitTemplate("jouzu.cli.piUi.thinking.cycleHint", "key");
	const [loginPre, loginSuf] = splitTemplate("jouzu.cli.piUi.login.title", "provider");
	const [codePre, codeSuf] = splitTemplate("jouzu.cli.piUi.login.enterCode", "code");
	const [trustParentPre, trustParentSuf] = splitTemplate("jouzu.cli.piUi.trust.optionTrustParent", "path");
	const [savedTrustedPre, savedTrustedSuf] = splitTemplate("jouzu.cli.piUi.trust.savedTrusted", "path");
	const [savedUntrustedPre, savedUntrustedSuf] = splitTemplate("jouzu.cli.piUi.trust.savedUntrusted", "path");
	const [savedInhTrustedPre, savedInhTrustedSuf] = splitTemplate("jouzu.cli.piUi.trust.savedInheritedTrusted", "path");
	const [savedInhUntrustedPre, savedInhUntrustedSuf] = splitTemplate(
		"jouzu.cli.piUi.trust.savedInheritedUntrusted",
		"path",
	);

	const enFooter = catalogText(en, "jouzu.cli.piUi.thinking.footerHint", {
		confirm: "{confirm}",
		save: "{save}",
		cancel: "{cancel}",
	});
	const footerParts = enFooter.split(/\{(?:confirm|save|cancel)\}/u);

	const enNotConfigured = ` • ${catalogText(en, "jouzu.cli.piUi.oauth.notConfigured")}`;
	const localNotConfigured = ` • ${catalogText(catalog, "jouzu.cli.piUi.oauth.notConfigured")}`;
	const enConfigured = ` ✓ ${catalogText(en, "jouzu.cli.piUi.oauth.configured")}`;
	const localConfigured = ` ✓ ${catalogText(catalog, "jouzu.cli.piUi.oauth.configured")}`;

	return (raw: string): string => {
		const stripped = stripTerminalSequences(raw);
		const trimmed = stripped.trim();
		const exact = exactMap.get(trimmed);
		if (exact) return raw.replace(trimmed, exact);

		// Trust option row with selection/current markers (`→ ✓ Trust`, `    Do not trust`, etc.)
		const trustRowMatch = /^((?:→ | {2})(?:✓ | {2}))(.+)$/u.exec(stripped);
		if (trustRowMatch?.[2]) {
			const optionText = trustRowMatch[2];
			const exactOption = exactMap.get(optionText);
			if (exactOption) return raw.replace(optionText, exactOption);
			if (optionText.startsWith(trustParentPre) && optionText.endsWith(trustParentSuf)) {
				const path = optionText.slice(trustParentPre.length, optionText.length - trustParentSuf.length);
				return raw.replace(optionText, catalogText(catalog, "jouzu.cli.piUi.trust.optionTrustParent", { path }));
			}
		}

		const matchSingle = (pre: string, suf: string, id: string, key: string): string | undefined => {
			if (trimmed.startsWith(pre) && trimmed.endsWith(suf) && trimmed.length > pre.length + suf.length) {
				const val = trimmed.slice(pre.length, trimmed.length - suf.length);
				return raw.replace(trimmed, catalogText(catalog, id, { [key]: val }));
			}
			return undefined;
		};

		const singleMatched =
			matchSingle(forModelPre, forModelSuf, "jouzu.cli.piUi.thinking.perModelForModel", "model") ??
			matchSingle(cyclePre, cycleSuf, "jouzu.cli.piUi.thinking.cycleHint", "key") ??
			matchSingle(loginPre, loginSuf, "jouzu.cli.piUi.login.title", "provider") ??
			matchSingle(codePre, codeSuf, "jouzu.cli.piUi.login.enterCode", "code") ??
			matchSingle(savedInhTrustedPre, savedInhTrustedSuf, "jouzu.cli.piUi.trust.savedInheritedTrusted", "path") ??
			matchSingle(savedInhUntrustedPre, savedInhUntrustedSuf, "jouzu.cli.piUi.trust.savedInheritedUntrusted", "path") ??
			matchSingle(savedTrustedPre, savedTrustedSuf, "jouzu.cli.piUi.trust.savedTrusted", "path") ??
			matchSingle(savedUntrustedPre, savedUntrustedSuf, "jouzu.cli.piUi.trust.savedUntrusted", "path");
		if (singleMatched) return singleMatched;

		const [fp0, fp1, fp2, fp3] = footerParts;
		if (fp0 !== undefined && fp1 && fp2 && fp3 !== undefined && trimmed.includes(fp1) && trimmed.includes(fp2)) {
			const i1 = trimmed.indexOf(fp1);
			const i2 = trimmed.indexOf(fp2, i1 + fp1.length);
			if (i1 > 0 && i2 > i1 && trimmed.endsWith(fp3)) {
				const confirm = trimmed.slice(fp0.length, i1);
				const save = trimmed.slice(i1 + fp1.length, i2);
				const cancel = trimmed.slice(i2 + fp2.length, trimmed.length - fp3.length);
				return raw.replace(
					trimmed,
					catalogText(catalog, "jouzu.cli.piUi.thinking.footerHint", { confirm, save, cancel }),
				);
			}
		}

		const trustHintMatch = /^(\S+)\s+navigate\s+(\S+)\s+save\s+(\S+)\s+cancel$/u.exec(trimmed);
		if (trustHintMatch) {
			return catalogText(catalog, "jouzu.cli.piUi.trust.hint", {
				nav: trustHintMatch[1] ?? "",
				save: trustHintMatch[2] ?? "",
				cancel: trustHintMatch[3] ?? "",
			});
		}

		if (raw.includes(enNotConfigured)) return raw.replace(enNotConfigured, localNotConfigured);
		if (raw.includes(enConfigured)) return raw.replace(enConfigured, localConfigured);
		return raw;
	};
}

/**
 * Localize Pi's built-in interactive settings menu, submenus, and selector
 * components for the duration of `operation` when `catalog.locale` is not `en`.
 */
export async function withPiUiLocalization<T>(
	catalog: CatalogBundle,
	operation: () => Promise<T>,
	runtime: PiUiRuntime = {},
): Promise<T> {
	if (catalog.locale === "en") return operation();

	const en = defaultCatalog();
	const seenSettings = new WeakSet<SettingsList>();
	const originalLabels = new WeakMap<object, string>();
	const seenSelects = new WeakSet<SelectList>();
	const translatedTextCache = new WeakMap<object, string>();
	const translateText = buildTextTranslator(catalog);

	const enSettingsReplacements: ReadonlyArray<readonly [string, string]> = [
		[catalogText(en, "jouzu.cli.piUi.settings.hintSearch"), catalogText(catalog, "jouzu.cli.piUi.settings.hintSearch")],
		[catalogText(en, "jouzu.cli.piUi.settings.hintPlain"), catalogText(catalog, "jouzu.cli.piUi.settings.hintPlain")],
		[catalogText(en, "jouzu.cli.piUi.settings.empty"), catalogText(catalog, "jouzu.cli.piUi.settings.empty")],
		[catalogText(en, "jouzu.cli.piUi.settings.noMatch"), catalogText(catalog, "jouzu.cli.piUi.settings.noMatch")],
	];
	const enSelectNoMatch = catalogText(en, "jouzu.cli.piUi.select.noMatch");
	const localSelectNoMatch = catalogText(catalog, "jouzu.cli.piUi.select.noMatch");

	const settingsProto = SettingsList.prototype as unknown as {
		renderMainList(width: number): string[];
		applyFilter(query: string): void;
		items: SettingsItemShape[];
		filteredItems: SettingsItemShape[];
		selectedIndex: number;
	};
	const selectProto = SelectList.prototype;
	const textProto = Text.prototype;
	const truncatedProto = TruncatedText.prototype;

	const origRenderMainList = settingsProto.renderMainList;
	const origApplyFilter = settingsProto.applyFilter;
	const origSelectRender = selectProto.render;
	const origTextRender = textProto.render;
	const origTruncatedRender = truncatedProto.render;

	settingsProto.renderMainList = function (this: SettingsList, width: number): string[] {
		localizePiSettingsList(this, catalog, seenSettings, originalLabels);
		const lines = origRenderMainList.call(this, width);
		return lines.map((line) => {
			let updated = line;
			for (const [from, to] of enSettingsReplacements) {
				if (updated.includes(from)) updated = updated.replace(from, to);
			}
			return updated;
		});
	};

	settingsProto.applyFilter = function (this: SettingsList, query: string): void {
		localizePiSettingsList(this, catalog, seenSettings, originalLabels);
		const self = this as unknown as typeof settingsProto;
		self.filteredItems = fuzzyFilter(self.items, query, (item) => `${item.label} ${originalLabels.get(item) ?? ""}`);
		self.selectedIndex = 0;
	};

	selectProto.render = function (this: SelectList, width: number): string[] {
		localizePiSelectList(this, catalog, seenSelects);
		const lines = origSelectRender.call(this, width);
		return lines.map((line) =>
			line.includes(enSelectNoMatch) ? line.replace(enSelectNoMatch, localSelectNoMatch) : line,
		);
	};

	textProto.render = function (this: Text, width: number): string[] {
		const self = this as unknown as { text: string; cachedText?: string; cachedLines?: string[] };
		if (typeof self.text === "string" && self.text.length > 0 && translatedTextCache.get(this) !== self.text) {
			const next = translateText(self.text);
			if (next !== self.text) {
				self.text = next;
				self.cachedText = undefined;
				self.cachedLines = undefined;
			}
			translatedTextCache.set(this, self.text);
		}
		return origTextRender.call(this, width);
	};

	truncatedProto.render = function (this: TruncatedText, width: number): string[] {
		const self = this as unknown as { text: string };
		if (typeof self.text === "string" && self.text.length > 0 && translatedTextCache.get(this) !== self.text) {
			self.text = translateText(self.text);
			translatedTextCache.set(this, self.text);
		}
		return origTruncatedRender.call(this, width);
	};

	const sessionProto = runtime.SessionSelectorComponent?.prototype;
	const treeProto = runtime.TreeSelectorComponent?.prototype;
	const forkProto = runtime.UserMessageSelectorComponent?.prototype;
	const origSessionRender = sessionProto?.render;
	const origTreeRender = treeProto?.render;
	const origForkRender = forkProto?.render;

	const enForkEmpty = catalogText(en, "jouzu.cli.piUi.fork.empty");
	const localForkEmpty = catalogText(catalog, "jouzu.cli.piUi.fork.empty");
	const enForkPosTemplate = catalogText(en, "jouzu.cli.piUi.fork.messagePosition", {
		position: "{pos}",
		total: "{tot}",
	});
	const [forkPosPre = "", forkPosMid = "", forkPosSuf = ""] = enForkPosTemplate.split(/\{(?:pos|tot)\}/u);

	if (sessionProto && origSessionRender) {
		sessionProto.render = function (width: number): string[] {
			return origSessionRender.call(this, width).map((line) => translateText(line));
		};
	}
	if (treeProto && origTreeRender) {
		treeProto.render = function (width: number): string[] {
			return origTreeRender.call(this, width).map((line) => translateText(line));
		};
	}
	if (forkProto && origForkRender) {
		forkProto.render = function (width: number): string[] {
			return origForkRender.call(this, width).map((line) => {
				if (line.includes(enForkEmpty)) return line.replace(enForkEmpty, localForkEmpty);
				const stripped = stripTerminalSequences(line).trim();
				if (
					forkPosMid &&
					stripped.startsWith(forkPosPre) &&
					stripped.includes(forkPosMid) &&
					stripped.endsWith(forkPosSuf)
				) {
					const midIdx = stripped.indexOf(forkPosMid, forkPosPre.length);
					const position = stripped.slice(forkPosPre.length, midIdx);
					const total = stripped.slice(midIdx + forkPosMid.length, stripped.length - forkPosSuf.length);
					return line.replace(
						stripped,
						catalogText(catalog, "jouzu.cli.piUi.fork.messagePosition", { position, total }),
					);
				}
				return line;
			});
		};
	}

	try {
		return await operation();
	} finally {
		settingsProto.renderMainList = origRenderMainList;
		settingsProto.applyFilter = origApplyFilter;
		selectProto.render = origSelectRender;
		textProto.render = origTextRender;
		truncatedProto.render = origTruncatedRender;
		if (sessionProto && origSessionRender) sessionProto.render = origSessionRender;
		if (treeProto && origTreeRender) treeProto.render = origTreeRender;
		if (forkProto && origForkRender) forkProto.render = origForkRender;
	}
}
