import { type ExtensionContext, type ModelRuntime, resolveCliModel } from "@earendil-works/pi-coding-agent";

import { MODEL_PICKER_THINKING_LEVELS, type ModelPickerThinkingLevel } from "./model-picker-state.js";

/** Retain an explicit level even when Pi's initial fallback model clamps it to off. */
export function startupThinkingArgument(args: readonly string[]): ModelPickerThinkingLevel | undefined {
	let explicit: ModelPickerThinkingLevel | undefined;
	for (let index = 0; index < args.length; index++) {
		const value =
			args[index] === "--thinking"
				? args[index + 1]
				: args[index].startsWith("--thinking=")
					? args[index].slice("--thinking=".length)
					: undefined;
		if (value && MODEL_PICKER_THINKING_LEVELS.some((level) => level === value))
			explicit = value as ModelPickerThinkingLevel;
	}
	return explicit;
}

/** Ask Pi to distinguish a reasoning suffix from a literal colon-bearing model ID. */
export function hasExplicitStartupThinking(
	args: readonly string[],
	registry: ExtensionContext["modelRegistry"],
): boolean {
	let cliModel: string | undefined;
	let cliProvider: string | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--thinking" || arg.startsWith("--thinking=")) return true;
		if (arg === "--model") cliModel = args[++index];
		else if (arg === "--provider") cliProvider = args[++index];
	}
	if (!cliModel) return false;
	// The resolver reads only these two runtime methods. Extensions receive the
	// registry facade, so adapt its model/auth reads without creating another runtime.
	const runtime: Pick<ModelRuntime, "getModels" | "hasConfiguredAuth"> = {
		getModels: () => registry.getAll(),
		hasConfiguredAuth: (provider) => registry.getProviderAuthStatus(provider).configured,
	};
	return resolveCliModel({ cliModel, cliProvider, modelRuntime: runtime as ModelRuntime }).thinkingLevel !== undefined;
}
