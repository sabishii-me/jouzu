import { Text } from "@earendil-works/pi-tui";
import { fitTerminalText, sanitizeTerminalText } from "../terminal-layout.js";

interface Theme {
	fg(color: "success" | "warning" | "error" | "accent" | "muted" | "dim", text: string): string;
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown): string => sanitizeTerminalText(String(value ?? "?"));
const short = (value: unknown, width: number): string => fitTerminalText(safe(value), width, "…");
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function summarize(kind: unknown, content: unknown, theme: Theme): string[] | undefined {
	if (typeof content === "string" && (kind === "wait" || kind === "result")) {
		try {
			content = JSON.parse(content);
		} catch {
			return undefined;
		}
	}
	if (kind === "wait" && record(content) && record(content.wait)) {
		const wait = content.wait;
		if (typeof wait.state !== "string" || !Array.isArray(wait.observations) || !wait.observations.every(record))
			return undefined;
		const observations = wait.observations;
		const satisfied = observations.filter((item) => item.state === "satisfied").length;
		const resolved = wait.state === "resolved";
		const failed = ["failed", "unhealthy", "health-unknown"].includes(wait.state);
		const lines = [
			`${theme.fg(resolved ? "success" : failed ? "error" : "warning", `${resolved ? "✓" : failed ? "✗" : "⏱"} wait ${safe(wait.state)}`)}${observations.length ? theme.fg("muted", ` — ${satisfied}/${observations.length} dependencies satisfied`) : ""}`,
		];
		if (wait.reason) lines.push(theme.fg("dim", short(wait.reason, 120)));
		for (const item of observations)
			lines.push(
				theme.fg(
					"dim",
					`  · ${safe(item.handle)} (${safe(item.producer)}/${safe(item.until)})${item.health ? ` · ${safe(item.health)}` : ""} · ${safe(item.state)}`,
				),
			);
		return lines;
	}
	if (kind === "result" && record(content)) {
		const { total, counts, sample, omitted, manifest, warningResults, reviewNote } = content;
		if (
			!count(total) ||
			!record(counts) ||
			![counts.success, counts.failure, counts.cancelled].every(count) ||
			!Array.isArray(sample) ||
			!sample.every(record) ||
			!count(omitted) ||
			typeof manifest !== "string" ||
			total !== sample.length + omitted
		)
			return undefined;
		const lines = [
			[
				theme.fg("accent", `◆ ${total} result${total === 1 ? "" : "s"}`),
				theme.fg("success", `✓${counts.success}`),
				counts.failure ? theme.fg("error", `✗${counts.failure}`) : "",
				counts.cancelled ? theme.fg("warning", `⊘${counts.cancelled}`) : "",
			]
				.filter(Boolean)
				.join(theme.fg("dim", " · ")),
		];
		for (const item of sample.slice(0, 4)) {
			const status = item.status;
			lines.push(
				`  ${theme.fg(status === "success" ? "success" : status === "cancelled" ? "warning" : "error", status === "success" ? "✓" : status === "cancelled" ? "⊘" : "✗")} ${short(item.title ?? item.id, 100)}`,
			);
		}
		const hidden = total - Math.min(4, sample.length);
		if (hidden) lines.push(theme.fg("dim", `  +${hidden} more results`));
		if (count(warningResults) && warningResults > 0)
			lines.push(
				theme.fg(
					"warning",
					`  ⚠ ${warningResults} result${warningResults === 1 ? "" : "s"} with warnings${reviewNote ? ` · ${safe(reviewNote)}` : ""}`,
				),
			);
		lines.push(
			theme.fg(
				"dim",
				`  manifest ${safe(manifest)
					.replace(/^flow-results:/, "")
					.slice(0, 12)}`,
			),
		);
		if (content.noReply) lines.push(theme.fg("dim", "  notification only — no reply owed"));
		return lines;
	}
	if ((kind === "work" || kind === "alert") && typeof content === "string") {
		const [first, ...rest] = content.split("\n");
		const lines = [
			`${theme.fg(kind === "work" ? "accent" : "warning", kind === "work" ? "▶ work" : "⚠ alert")} ${short(first, 120)}`,
		];
		if (rest.length) lines.push(theme.fg("dim", short(rest.join(" "), 200)));
		return lines;
	}
	return undefined;
}

/** Presentation never changes the retained message or the model's content. */
export function renderFlowMessage(
	message: { content: unknown },
	{ expanded, outputPad }: { expanded: boolean; outputPad: number },
	theme: Theme,
): Text {
	const lines: string[] = [];
	const parts = Array.isArray(message.content) ? message.content : [{ type: "text", text: message.content }];
	for (const part of parts) {
		if (!record(part)) continue;
		if (part.type === "image") {
			lines.push(theme.fg("dim", `[image: ${safe(part.mimeType)}]`));
			continue;
		}
		if (part.type !== "text" || typeof part.text !== "string") continue;
		let summary: string[] | undefined;
		try {
			const parsed: unknown = JSON.parse(part.text);
			if (record(parsed) && Array.isArray(parsed.flowInput) && parsed.flowInput[0] === "jouzu-flow")
				summary = summarize(parsed.kind, parsed.content, theme);
		} catch {
			/* Unknown or malformed messages remain inspectable as text. */
		}
		if (summary) lines.push(...summary);
		if (!summary || expanded) lines.push(...part.text.split("\n").map((line) => theme.fg("dim", safe(line))));
	}
	return new Text(lines.join("\n"), outputPad, 0);
}
