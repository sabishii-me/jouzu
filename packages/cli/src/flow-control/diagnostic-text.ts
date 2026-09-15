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
	const clean = sanitizeTerminalText(redacted);
	// Display width alone does not bound combining marks or other zero-width text.
	let bounded = clean.slice(0, Math.min(1024, Math.max(32, columns * 4)));
	const last = bounded.charCodeAt(bounded.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1);
	return fitTerminalText(bounded + (bounded.length < clean.length ? "..." : ""), columns);
}
