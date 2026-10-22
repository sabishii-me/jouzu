import { createContext, Script } from "node:vm";

/** Maximum time for one notify regex compilation or execution. */
export const OUTPUT_MATCHER_DEADLINE_MS = 25;

/** A notify regex exceeded its deadline and is disabled for this task. */
export class OutputMatcherBudgetError extends Error {
	constructor() { super(`Notify pattern exceeded ${OUTPUT_MATCHER_DEADLINE_MS} ms; output matching is disabled for this task.`); }
}

function isMatcherTimeout(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}

function disabledMatcher(): (text: string) => boolean {
	let reported = false;
	return () => {
		if (reported) return false;
		reported = true;
		throw new OutputMatcherBudgetError();
	};
}

/** Compile a substring or regex matcher; a timed-out regex reports once. */
export function parseOutputMatcher(pattern: string | undefined): ((text: string) => boolean) | null {
	const needle = pattern?.trim();
	if (!needle) return null;

	const regexMatch = needle.match(/^\/(.*)\/([gimsuy]*)$/);
	if (regexMatch) {
		const context = createContext({ source: regexMatch[1], flags: regexMatch[2], text: "" });
		try {
			context.regex = new Script("new RegExp(source, flags)").runInContext(context, { timeout: OUTPUT_MATCHER_DEADLINE_MS });
		} catch (error) {
			if (isMatcherTimeout(error)) return disabledMatcher();
			if ((error as Error).name !== "SyntaxError") throw error;
			// Invalid regex falls through to substring matching.
		}
		if (context.regex) {
			const script = new Script("regex.lastIndex = 0; regex.test(text)");
			let disabled = false;
			return (text: string) => {
				if (disabled) return false;
				context.text = text;
				try {
					return script.runInContext(context, { timeout: OUTPUT_MATCHER_DEADLINE_MS }) as boolean;
				} catch (error) {
					if (!isMatcherTimeout(error)) throw error;
					disabled = true;
					throw new OutputMatcherBudgetError();
				} finally {
					context.text = "";
				}
			};
		}
	}

	const lower = needle.toLowerCase();
	return (text: string) => text.toLowerCase().includes(lower);
}

