/**
 * Run a `before_agent_start` handler the way Pi does: on a fresh event whose options carry
 * mutable sections. Returns the sections the handler set and the prompt they render to, with
 * the preamble first and every other section tagged. A handler that returns `systemPrompt`
 * (a forced prompt) yields that text instead.
 */
export function runPromptHook(handler, { systemPrompt = "Base", options = {}, ctx } = {}) {
	const event = { systemPrompt, systemPromptOptions: { sections: {}, toolGuidelines: {}, ...options } };
	const result = handler(event, ctx);
	const sections = event.systemPromptOptions.sections;
	if (result?.systemPrompt !== undefined) return { systemPrompt: result.systemPrompt, sections, event, result };
	const rest = Object.entries(sections)
		.filter(([name]) => name !== "preamble")
		.map(([name, text]) => `<${name}>\n${text}\n</${name}>`);
	return { systemPrompt: [sections.preamble ?? systemPrompt, ...rest].join("\n\n"), sections, event, result };
}
