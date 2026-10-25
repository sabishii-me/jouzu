import type { BeforeAgentStartEvent, BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";

/**
 * Set or clear named sections of the run's system prompt; an undefined value clears its
 * section. Pi diffs sections between runs and sends a change as a section update, so the
 * leading prompt stays byte-stable. When another extension has forced a full prompt, sections
 * are not rendered, so the text is appended to that prompt instead.
 */
export function setPromptSections(
	event: BeforeAgentStartEvent,
	sections: Record<string, string | undefined>,
): BeforeAgentStartEventResult | undefined {
	const options = event.systemPromptOptions;
	if (options.forceSystemPrompt !== undefined) {
		const text = Object.values(sections).filter(Boolean);
		return text.length ? { systemPrompt: [event.systemPrompt, ...text].join("\n\n") } : undefined;
	}
	options.sections ??= {};
	const target = options.sections;
	for (const [name, text] of Object.entries(sections)) {
		if (text) target[name] = text;
		else delete target[name];
	}
	return undefined;
}
