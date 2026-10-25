import { CatalogMessageId, catalogText, defaultCatalog } from "../cli-messages.js";
import type { CatalogBundle } from "../locale-catalog.js";
import { catalogRuntimeIdentity } from "../model-catalog-projection.js";
import { sanitizeTerminalText } from "../terminal-layout.js";
import { type AgentModel, isSameModelSelector, resolveAgentModel } from "./roles.js";

export function agentModelDisplay(model: { provider: string; id: string; name?: string }) {
	const identity = catalogRuntimeIdentity(model.provider);
	const provider = identity?.provider ?? model.provider;
	const name = typeof model.name === "string" && model.name.trim() ? model.name : undefined;
	return {
		name: sanitizeTerminalText(name || model.id),
		source: sanitizeTerminalText(identity ? `${provider} · ${identity.catalogId}` : provider),
		label: sanitizeTerminalText(
			name || (model.id.startsWith(`${provider}/`) ? model.id : [provider, model.id].filter(Boolean).join("/")),
		),
	};
}

export function agentModelSelectorLabel(
	selector: string,
	models: readonly AgentModel[],
	catalog: CatalogBundle = defaultCatalog(),
): string {
	if (isSameModelSelector(selector)) return catalogText(catalog, CatalogMessageId.workflowRowSameAsThisSession);
	try {
		return agentModelDisplay(resolveAgentModel(selector, models)).label;
	} catch {
		// Unavailable or ambiguous saved selectors must remain inspectable.
		const slash = selector.indexOf("/");
		return slash < 0
			? sanitizeTerminalText(selector)
			: agentModelDisplay({ provider: selector.slice(0, slash), id: selector.slice(slash + 1) }).label;
	}
}
