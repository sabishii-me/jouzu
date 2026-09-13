import {
	detectTerminalColorMode,
	sanitizeTerminalText,
	type TerminalColorMode,
	terminalTextWidth,
} from "./terminal-layout.js";

/**
 * Line-oriented styling for Jouzu command output: `doctor`, `catalog`, `keybindings`, `profile`.
 *
 * The output stays a plain list so a user can copy it into a bug report: no frames, no
 * clipped labels, and no token is broken to fit a column. Every status carries a marker
 * glyph as well as a color, so `NO_COLOR`, a pipe, and a monochrome terminal all keep the
 * same meaning (`docs/ux.md`, "Non-interactive and degraded modes").
 */

export type CommandReportStatus = "ok" | "warning" | "problem" | "idle" | "update";

/** One marker per status, so color is never the only signal. */
const STATUS_MARKERS: Readonly<Record<CommandReportStatus, string>> = Object.freeze({
	ok: "✓",
	warning: "⚠",
	problem: "✗",
	idle: "○",
	update: "↑",
});

/** Basic ANSI foregrounds, so the user's terminal palette decides the exact hue. */
const STATUS_COLORS: Readonly<Record<CommandReportStatus, number | undefined>> = Object.freeze({
	ok: 32,
	warning: 33,
	problem: 31,
	idle: undefined,
	update: 36,
});

const INDENT = "   ";
const GAP = "  ";
const MARKER_WIDTH = 2;
const DETAIL_INDENT = "  ";
const LABEL_COLUMN_LIMIT = 30;
const KEY_COLUMN_LIMIT = 24;
const MINIMUM_VALUE_COLUMNS = 12;
const DEFAULT_COLUMNS = 80;
const MINIMUM_COLUMNS = 40;
const MAXIMUM_COLUMNS = 100;
const SEPARATOR = "·";

export interface CommandReportOptions {
	env?: NodeJS.ProcessEnv;
	colorMode?: TerminalColorMode;
	colorDepth?: number;
	stdoutIsTTY?: boolean;
	colorEnabled?: boolean;
	columns?: number;
}

/** A marker line: a status, a short key, and one message. */
export interface CommandReportEntry {
	status: CommandReportStatus;
	key: string;
	message: string;
}

/** One observed value, rendered as an aligned label and value pair. */
export interface CommandReportField {
	label: string;
	value: string;
	/** Extra lines rendered under the value, such as the offerings behind a count. */
	details?: readonly string[];
}

export interface CommandReportSectionOptions {
	status?: CommandReportStatus;
	detail?: string;
}

type Block =
	| { kind: "line"; text: string }
	| { kind: "blank" }
	| { kind: "rule" }
	| { kind: "paragraph"; text: string }
	| { kind: "section"; heading: string; fields: readonly CommandReportField[]; options: CommandReportSectionOptions }
	| { kind: "entries"; heading: string; entries: readonly CommandReportEntry[] };

function clampColumns(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_COLUMNS;
	return Math.max(MINIMUM_COLUMNS, Math.min(MAXIMUM_COLUMNS, Math.floor(value)));
}

function envFlagIsTrue(value: string | undefined): boolean {
	return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Break lines only at runs of ASCII spaces, and only between words. Other whitespace is part
 * of the text and is preserved exactly, because an ideographic space can appear inside a
 * Japanese path. A token wider than the column (a path, a revision digest, a model ID)
 * overflows instead of being split, so it survives a copy and paste.
 */
export function wrapTerminalWords(value: string, columns: number): string[] {
	const width = Math.max(1, Math.floor(columns));
	const lines: string[] = [];
	for (const paragraph of value.split("\n")) {
		let current = "";
		let separator = "";
		for (const part of paragraph.split(/( +)/u)) {
			if (part === "") continue;
			if (part.trimStart() === "") {
				separator = current === "" ? "" : part;
				continue;
			}
			if (current === "") current = part;
			else if (terminalTextWidth(current + separator + part) <= width) current += separator + part;
			else {
				lines.push(current);
				current = part;
			}
			separator = "";
		}
		lines.push(current);
	}
	return lines;
}

/**
 * Prepare external text for styling: control characters and escape sequences are removed,
 * and the line breaks and tabs among them become spaces so words do not run together.
 */
function clean(value: string): string {
	return sanitizeTerminalText(value.replace(/[\t\r\n\v\f]+/gu, " "));
}

/** Padding for a value that is styled separately, so no escape sequence spans trailing spaces. */
function padColumns(value: string, columns: number): string {
	return " ".repeat(Math.max(0, columns - terminalTextWidth(value)));
}

function widestColumn(values: readonly string[], limit: number): number {
	return Math.min(
		limit,
		values.reduce((widest, value) => Math.max(widest, terminalTextWidth(value)), 0),
	);
}

/**
 * Collects one command's output. Label and key columns are resolved once over the whole
 * report at render time, so every section shares one gutter.
 */
export class CommandReport {
	private readonly blocks: Block[] = [];
	private readonly columns: number;
	private readonly colorMode: TerminalColorMode;
	private readonly colorEnabled: boolean;

	constructor(options: CommandReportOptions = {}) {
		const env = options.env ?? process.env;
		const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
		this.colorMode =
			options.colorMode ??
			detectTerminalColorMode({
				env,
				stdoutIsTTY,
				...(options.colorDepth !== undefined ? { colorDepth: options.colorDepth } : {}),
			});
		// Styling a redirected stream would put escape sequences into the file a user pastes,
		// so color needs a terminal unless FORCE_COLOR asks for it.
		this.colorEnabled =
			options.colorEnabled ?? (this.colorMode !== "none" && (stdoutIsTTY || envFlagIsTrue(env.FORCE_COLOR)));
		this.columns = clampColumns(options.columns ?? process.stdout.columns);
	}

	private bold(value: string): string {
		return this.colorEnabled && value ? `[1m${value}[22m` : value;
	}

	private dim(value: string): string {
		return this.colorEnabled && value ? `[2m${value}[22m` : value;
	}

	private tone(status: CommandReportStatus, value: string): string {
		const code = STATUS_COLORS[status];
		if (code === undefined) return this.dim(value);
		return this.colorEnabled && value ? `[${code}m${value}[39m` : value;
	}

	private joinDetails(details: readonly (string | undefined)[]): string {
		return details
			.filter((value): value is string => Boolean(value))
			.map((value) => clean(value))
			.join(` ${SEPARATOR} `);
	}

	/** Separate the next block from the previous one; repeated blanks collapse at render time. */
	blank(): this {
		this.blocks.push({ kind: "blank" });
		return this;
	}

	/** The command name, followed by identifying details a user should quote in a report. */
	title(name: string, ...details: readonly (string | undefined)[]): this {
		const detail = this.joinDetails(details);
		const heading = this.bold(clean(name));
		this.blocks.push({ kind: "line", text: detail ? `${heading} ${this.dim(detail)}` : heading });
		return this;
	}

	/** A full-width horizontal rule. It carries no blank line of its own. */
	rule(): this {
		this.blocks.push({ kind: "rule" });
		return this;
	}

	/** A heading followed by marker lines, used for diagnoses and planned actions. */
	entries(heading: string, entries: readonly CommandReportEntry[]): this {
		if (entries.length > 0) this.blocks.push({ kind: "entries", heading, entries });
		return this;
	}

	/** A heading followed by aligned label and value pairs. */
	section(heading: string, fields: readonly CommandReportField[], options: CommandReportSectionOptions = {}): this {
		if (fields.length > 0) this.blocks.push({ kind: "section", heading, fields, options });
		return this;
	}

	/** Wrapped prose with no label column, for a closing note. */
	paragraph(text: string): this {
		this.blocks.push({ kind: "paragraph", text });
		return this;
	}

	/** The closing verdict. It carries no blank line of its own, so it can sit under a rule. */
	summary(status: CommandReportStatus, text: string, ...details: readonly (string | undefined)[]): this {
		const detail = this.joinDetails(details);
		const marker = this.tone(status, STATUS_MARKERS[status]);
		const body = clean(text);
		this.blocks.push({
			kind: "line",
			text: detail ? `${marker} ${body} ${this.dim(`${SEPARATOR} ${detail}`)}` : `${marker} ${body}`,
		});
		return this;
	}

	private renderSection(block: Extract<Block, { kind: "section" }>, labelColumns: number, lines: string[]): void {
		const name = this.bold(clean(block.heading));
		const status = block.options.status;
		const marker = status ? `${this.tone(status, STATUS_MARKERS[status])} ` : "";
		const detail = block.options.detail ? ` ${this.dim(clean(block.options.detail))}` : "";
		lines.push(`${marker}${name}${detail}`);
		const alignedStart = INDENT.length + labelColumns + GAP.length;
		// Below the minimum value width the two-column form would clip values, so put each
		// value on its own line under an unclipped label instead.
		const stacked = this.columns - alignedStart < MINIMUM_VALUE_COLUMNS;
		const valueStart = stacked ? INDENT.length + DETAIL_INDENT.length : alignedStart;
		const valueColumns = Math.max(MINIMUM_VALUE_COLUMNS, this.columns - valueStart);
		for (const field of block.fields) {
			const label = clean(field.label);
			const value = wrapTerminalWords(clean(field.value), valueColumns);
			if (stacked || terminalTextWidth(label) > labelColumns) {
				lines.push(`${INDENT}${this.dim(label)}`);
				for (const line of value) lines.push(`${" ".repeat(valueStart)}${line}`);
			} else {
				lines.push(`${INDENT}${this.dim(label)}${padColumns(label, labelColumns)}${GAP}${value[0]}`);
				for (const line of value.slice(1)) lines.push(`${" ".repeat(valueStart)}${line}`);
			}
			for (const detailLine of field.details ?? []) {
				lines.push(`${" ".repeat(valueStart)}${DETAIL_INDENT}${this.dim(clean(detailLine))}`);
			}
		}
	}

	private renderEntries(block: Extract<Block, { kind: "entries" }>, keyColumns: number, lines: string[]): void {
		lines.push(this.bold(clean(block.heading)));
		const messageStart = INDENT.length + MARKER_WIDTH + keyColumns + GAP.length;
		const messageColumns = Math.max(MINIMUM_VALUE_COLUMNS, this.columns - messageStart);
		for (const entry of block.entries) {
			const key = clean(entry.key);
			const marker = this.tone(entry.status, STATUS_MARKERS[entry.status]);
			const head = `${INDENT}${marker} ${this.tone(entry.status, key)}${padColumns(key, keyColumns)}${GAP}`;
			const message = wrapTerminalWords(clean(entry.message), messageColumns);
			lines.push(`${head}${message[0]}`);
			for (const line of message.slice(1)) lines.push(`${" ".repeat(messageStart)}${line}`);
		}
	}

	toString(): string {
		const labelColumns = widestColumn(
			this.blocks.flatMap((block) => (block.kind === "section" ? block.fields.map((field) => clean(field.label)) : [])),
			LABEL_COLUMN_LIMIT,
		);
		const keyColumns = widestColumn(
			this.blocks.flatMap((block) => (block.kind === "entries" ? block.entries.map((entry) => clean(entry.key)) : [])),
			KEY_COLUMN_LIMIT,
		);
		const lines: string[] = [];
		const separate = (): void => {
			if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
		};
		for (const block of this.blocks) {
			switch (block.kind) {
				case "blank":
					separate();
					break;
				case "rule":
					lines.push(this.dim("─".repeat(this.columns)));
					break;
				case "line":
					lines.push(block.text);
					break;
				case "paragraph": {
					separate();
					for (const line of wrapTerminalWords(clean(block.text), this.columns - INDENT.length)) {
						lines.push(`${INDENT}${this.dim(line)}`);
					}
					break;
				}
				case "section":
					separate();
					this.renderSection(block, labelColumns, lines);
					break;
				case "entries":
					separate();
					this.renderEntries(block, keyColumns, lines);
					break;
			}
		}
		return lines.join("\n");
	}
}

/** Use the first dotted segment of a diagnosis ID as its short key column. */
export function commandReportKey(id: string): string {
	const [first = id] = id.split(".");
	return first;
}

/** "1 warning" / "2 warnings", so a summary line reads naturally. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}
