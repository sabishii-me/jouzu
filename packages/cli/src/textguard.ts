export const MAX_SCAN_BYTES = 256 * 1024;
export type UnavailableReason =
	| "input-limit"
	| "unsupported-content"
	| "finding-limit"
	| "decode-limit"
	| "scanner"
	| "output-limit"
	| "timeout"
	| "process"
	| "version"
	| "protocol"
	| "busy"
	| "closed"
	| "file"
	| "budget";
export interface ScanFinding {
	kind: string;
	severity: "info" | "warn" | "error";
	offset: number | null;
}
export interface ScanEvidence {
	status: "clear" | "findings" | "unavailable";
	findings: ScanFinding[];
	reason?: UnavailableReason;
	findingCount?: number;
	severityCounts?: Record<ScanFinding["severity"], number>;
}
export interface TextScanner {
	scan(text: string, timeoutMs?: number, signal?: AbortSignal): Promise<ScanEvidence>;
	close(): Promise<void>;
}
export const unavailable = (reason: UnavailableReason): ScanEvidence => ({
	status: "unavailable",
	findings: [],
	reason,
});

/**
 * The shape of a scan summary, so the user and model readers share one analysis
 * of the same evidence instead of recomputing the counts separately.
 */
export type EvidenceSummary =
	| { status: "unavailable"; reason: UnavailableReason }
	| { status: "errors"; count: number; kinds: string }
	| { status: "warnings"; count: number }
	| { status: "none" };

/** Reduce scan evidence to what both readers name: the reason, or the error and warning counts. */
export function summarizeEvidence(evidence: ScanEvidence): EvidenceSummary {
	if (evidence.status === "unavailable") return { status: "unavailable", reason: evidence.reason ?? "scanner" };
	const counts = evidence.severityCounts ?? { info: 0, warn: 0, error: 0 };
	const errors = counts.error ?? 0;
	if (errors > 0) {
		const kinds = [...new Set(evidence.findings.filter((item) => item.severity === "error").map((item) => item.kind))]
			.slice(0, 3)
			.join(", ");
		return { status: "errors", count: errors, kinds };
	}
	const warnings = counts.warn ?? 0;
	return warnings > 0 ? { status: "warnings", count: warnings } : { status: "none" };
}

/**
 * The catalog message ID for each reason an incomplete check did not finish.
 *
 * The user reads these in the TextGuard review overlay and in the alert detail.
 * The model reads a separate fixed English copy in the withheld-result tool
 * result, so this map is the user-facing half of the split and the reason a
 * locale can translate the review while the tool result stays English.
 */
export const UNAVAILABLE_REASON_MESSAGE_ID: Record<UnavailableReason, string> = {
	"input-limit": "jouzu.cli.textguard.unavailable.inputLimit",
	"unsupported-content": "jouzu.cli.textguard.unavailable.unsupportedContent",
	"finding-limit": "jouzu.cli.textguard.unavailable.findingLimit",
	"decode-limit": "jouzu.cli.textguard.unavailable.decodeLimit",
	"output-limit": "jouzu.cli.textguard.unavailable.outputLimit",
	scanner: "jouzu.cli.textguard.unavailable.scanner",
	timeout: "jouzu.cli.textguard.unavailable.timeout",
	process: "jouzu.cli.textguard.unavailable.process",
	version: "jouzu.cli.textguard.unavailable.version",
	protocol: "jouzu.cli.textguard.unavailable.protocol",
	busy: "jouzu.cli.textguard.unavailable.busy",
	closed: "jouzu.cli.textguard.unavailable.closed",
	file: "jouzu.cli.textguard.unavailable.file",
	budget: "jouzu.cli.textguard.unavailable.budget",
};
