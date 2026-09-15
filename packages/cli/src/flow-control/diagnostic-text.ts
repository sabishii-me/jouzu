import { fitTerminalText, sanitizeTerminalText } from "../terminal-layout.js";

/** Bound user-facing diagnostics and remove terminal controls and common credential forms. */
export function flowDiagnosticText(value: string, columns = 120): string {
	const redacted = value
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(
			/((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
			"$1[redacted]",
		)
		.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]{12,})\b/g, "[redacted]")
		.replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, "$1[redacted]@");
	return fitTerminalText(sanitizeTerminalText(redacted), columns);
}
