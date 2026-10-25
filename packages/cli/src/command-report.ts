import type { HumanLocale, ProtectedValue } from "./human-messages.js";
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

/**
 * The display state one renderer reads: the width, the color decision, and the
 * locale. A caller resolves it once, then passes the same fields to every
 * human-facing renderer instead of reaching into `process` in each one.
 */
export interface DisplayContext {
	columns: number;
	colorMode: TerminalColorMode;
	colorEnabled: boolean;
	locale: HumanLocale;
}

/**
 * Renderer inputs, derivable from `DisplayContext`: every display field is an
 * optional override, and `env`, `colorDepth`, and `stdoutIsTTY` only resolve the
 * defaults when the caller does not supply a display value. `locale` defaults
 * to `en`.
 */
export interface CommandReportOptions extends Partial<DisplayContext> {
	env?: NodeJS.ProcessEnv;
	colorDepth?: number;
	stdoutIsTTY?: boolean;
}

/**
 * The line-breaking rules a locale uses. English breaks only at ASCII spaces;
 * every CJK locale (`ja`, `zh-Hans`, `zh-Hant`) also breaks between CJK
 * characters and applies the CJK line-start and line-end prohibitions (currently
 * the Japanese sets, which cover the shared CJK punctuation).
 */
export type WrapLocale = HumanLocale;

/** One piece of human text: natural language, or a value that must not be split. */
export type HumanTextSegment = string | ProtectedValue;

export interface WrapOptions {
	columns: number;
	/** Selects the line-breaking rules. Defaults to `en`. */
	locale?: WrapLocale;
	/** Pre-tokenized content. When present it replaces the `value` argument. */
	segments?: readonly HumanTextSegment[];
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

/** One closing count, such as "2 problems". */
export interface CommandReportCount {
	status: CommandReportStatus;
	text: string;
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

/** Resolve the injectable options into the one display state the renderer uses. */
export function resolveDisplayContext(options: CommandReportOptions = {}): DisplayContext {
	const env = options.env ?? process.env;
	const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY === true;
	const colorMode =
		options.colorMode ??
		detectTerminalColorMode({
			env,
			stdoutIsTTY,
			...(options.colorDepth !== undefined ? { colorDepth: options.colorDepth } : {}),
		});
	return {
		columns: clampColumns(options.columns ?? process.stdout.columns),
		colorMode,
		// Styling a redirected stream would put escape sequences into the file a user pastes,
		// so color needs a terminal unless FORCE_COLOR asks for it.
		colorEnabled: options.colorEnabled ?? (colorMode !== "none" && (stdoutIsTTY || envFlagIsTrue(env.FORCE_COLOR))),
		locale: options.locale ?? "en",
	};
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
 * Japanese line-start prohibitions (行頭禁則): a line must not begin with closing
 * punctuation, a small kana, an iteration mark, or a prolonged sound mark.
 */
const LINE_START_PROHIBITED = new Set(
	[
		"、。，．：；？！）］｝〕〉》」』】〙〗〟｠»",
		"ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ",
		"ゝゞヽヾ々ー",
	].join(""),
);

/** Japanese line-end prohibitions (行末禁則): a line must not end with an opening mark. */
const LINE_END_PROHIBITED = new Set([..."（［｛〔〈《「『【〘〖〝｟«"]);

type WrapAtom =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "space"; readonly text: string }
	| { readonly kind: "protected"; readonly text: string }
	| { readonly kind: "break" };

type TextAtom = Extract<WrapAtom, { kind: "text" }>;

/** Ranges whose characters may break next to one another without a space. */
function isCjkCharacter(character: string): boolean {
	const code = character.codePointAt(0) ?? 0;
	return (
		(code >= 0x2e80 && code <= 0x2eff) ||
		(code >= 0x3000 && code <= 0x303f) ||
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0x31f0 && code <= 0x31ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xff00 && code <= 0xffef) ||
		(code >= 0x20000 && code <= 0x2fa1f)
	);
}

function firstCharacter(text: string): string {
	return [...text][0] ?? "";
}

function lastCharacter(text: string): string {
	const characters = [...text];
	return characters[characters.length - 1] ?? "";
}

function isLineStartProhibited(text: string): boolean {
	return LINE_START_PROHIBITED.has(firstCharacter(text));
}

function isLineEndProhibited(text: string): boolean {
	return LINE_END_PROHIBITED.has(lastCharacter(text));
}

/** A run of natural text: one atom for `en`, CJK characters split apart for a CJK locale. */
function pushTextAtoms(atoms: WrapAtom[], text: string, locale: WrapLocale): void {
	if (text === "") return;
	if (locale === "en") {
		atoms.push({ kind: "text", text });
		return;
	}
	let buffer = "";
	const flushBuffer = (): void => {
		if (buffer !== "") atoms.push({ kind: "text", text: buffer });
		buffer = "";
	};
	for (const character of text) {
		if (isCjkCharacter(character)) {
			flushBuffer();
			atoms.push({ kind: "text", text: character });
		} else {
			buffer += character;
		}
	}
	flushBuffer();
}

/** Split one string segment into space, text, and explicit-break atoms. */
function pushSegmentAtoms(atoms: WrapAtom[], segment: string, locale: WrapLocale): void {
	const paragraphs = segment.split("\n");
	for (let index = 0; index < paragraphs.length; index += 1) {
		if (index > 0) atoms.push({ kind: "break" });
		let buffer = "";
		let spaces = false;
		const flushBuffer = (): void => {
			if (buffer === "") return;
			if (spaces) atoms.push({ kind: "space", text: buffer });
			else pushTextAtoms(atoms, buffer, locale);
			buffer = "";
		};
		for (const character of paragraphs[index] ?? "") {
			const isSpace = character === " ";
			if (buffer !== "" && isSpace !== spaces) flushBuffer();
			spaces = isSpace;
			buffer += character;
		}
		flushBuffer();
	}
}

function joinAtoms(atoms: readonly WrapAtom[]): string {
	return atoms.map((atom) => (atom.kind === "break" ? "" : atom.text)).join("");
}

/**
 * Wrap human-facing text into terminal lines.
 *
 * Natural text breaks at runs of ASCII spaces and, in a CJK locale, at every
 * CJK boundary. A `ProtectedValue` segment is one atom: it is never split, even
 * when it is wider than the column, so a path, digest, or model ID survives a
 * copy and paste. Lines are neither padded nor truncated; a word or protected
 * value wider than the column overflows.
 *
 * A CJK locale also applies the CJK prohibitions: a line never begins with a
 * closing mark or small kana, and never ends with an opening mark. The
 * preceding breakable character is moved down so the prohibited character does
 * not sit alone; a run of prohibited characters hangs on the previous line when
 * no breakable character is available.
 *
 * The design signature is `wrapHumanText(value: string, options)`; the first
 * argument also accepts pre-tokenized segments, and `options.segments` is an
 * equivalent alternative.
 */
export function wrapHumanText(value: string | readonly HumanTextSegment[], options: WrapOptions): string[] {
	const columns = Math.max(1, Math.floor(options.columns));
	const locale: WrapLocale = options.locale ?? "en";
	const content: readonly HumanTextSegment[] = options.segments ?? (typeof value === "string" ? [value] : value);
	const atoms: WrapAtom[] = [];
	for (const segment of content) {
		if (typeof segment === "string") pushSegmentAtoms(atoms, segment, locale);
		else atoms.push({ kind: "protected", text: segment.value });
	}

	const lines: string[] = [];
	let current: WrapAtom[] = [];
	let pendingSpace = "";

	const flush = (): void => {
		lines.push(joinAtoms(current));
		current = [];
	};

	/** The last atom when it is one breakable character, so it can move down. */
	const movableTail = (): TextAtom | undefined => {
		const last = current[current.length - 1];
		if (last === undefined || last.kind !== "text") return undefined;
		return [...last.text].length === 1 ? last : undefined;
	};

	for (const atom of atoms) {
		if (atom.kind === "break") {
			flush();
			pendingSpace = "";
			continue;
		}
		if (atom.kind === "space") {
			if (current.length === 0) continue;
			pendingSpace = atom.text;
			continue;
		}
		if (current.length === 0) {
			current = [atom];
			pendingSpace = "";
			continue;
		}
		const separator = pendingSpace;
		if (terminalTextWidth(joinAtoms(current) + separator + atom.text) <= columns) {
			if (separator !== "") current.push({ kind: "space", text: separator });
			current.push(atom);
			pendingSpace = "";
			continue;
		}

		// Overflow: apply the prohibitions before the ordinary break.
		if (locale !== "en" && atom.kind === "text" && isLineStartProhibited(atom.text)) {
			const tail = movableTail();
			if (tail !== undefined && !isLineStartProhibited(tail.text) && !isLineEndProhibited(tail.text)) {
				current.pop();
				if (current.length > 0) flush();
				current = [tail, atom];
			} else {
				// No breakable character to move: hang the prohibited run on this line.
				current.push(atom);
			}
			pendingSpace = "";
			continue;
		}
		if (locale !== "en") {
			const tail = current[current.length - 1];
			if (tail !== undefined && tail.kind === "text" && isLineEndProhibited(tail.text)) {
				const previous = movableTail();
				if (previous !== undefined && !isLineStartProhibited(previous.text)) {
					current.pop();
					if (current.length > 0) flush();
					current = [previous, atom];
					pendingSpace = "";
					continue;
				}
			}
		}
		flush();
		current = [atom];
		pendingSpace = "";
	}
	flush();
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
	private readonly display: DisplayContext;

	constructor(options: CommandReportOptions = {}) {
		this.display = resolveDisplayContext(options);
	}

	/** Natural text goes through the locale-aware wrapper; data keeps the ASCII-only rule. */
	private wrapHuman(value: string, columns: number): string[] {
		return wrapHumanText(value, { columns, locale: this.display.locale });
	}

	private bold(value: string): string {
		return this.display.colorEnabled && value ? `[1m${value}[22m` : value;
	}

	private dim(value: string): string {
		return this.display.colorEnabled && value ? `[2m${value}[22m` : value;
	}

	private tone(status: CommandReportStatus, value: string): string {
		const code = STATUS_COLORS[status];
		if (code === undefined) return this.dim(value);
		return this.display.colorEnabled && value ? `[${code}m${value}[39m` : value;
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

	/**
	 * The closing counts, one marker per count. It carries no blank line of its own, so it sits
	 * directly under a rule, and it names no release, so it stays true across versions.
	 */
	tally(counts: readonly CommandReportCount[]): this {
		const text = counts
			.map((count) => `${this.tone(count.status, STATUS_MARKERS[count.status])} ${clean(count.text)}`)
			.join(this.dim(` ${SEPARATOR} `));
		this.blocks.push({ kind: "line", text });
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
		const stacked = this.display.columns - alignedStart < MINIMUM_VALUE_COLUMNS;
		const valueStart = stacked ? INDENT.length + DETAIL_INDENT.length : alignedStart;
		const valueColumns = Math.max(MINIMUM_VALUE_COLUMNS, this.display.columns - valueStart);
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
			const detailStart = valueStart + DETAIL_INDENT.length;
			const detailColumns = Math.max(MINIMUM_VALUE_COLUMNS, this.display.columns - detailStart - DETAIL_INDENT.length);
			for (const detailLine of field.details ?? []) {
				const wrapped = wrapTerminalWords(clean(detailLine), detailColumns);
				lines.push(`${" ".repeat(detailStart)}${this.dim(wrapped[0])}`);
				for (const line of wrapped.slice(1)) {
					lines.push(`${" ".repeat(detailStart)}${DETAIL_INDENT}${this.dim(line)}`);
				}
			}
		}
	}

	private renderEntries(block: Extract<Block, { kind: "entries" }>, keyColumns: number, lines: string[]): void {
		lines.push(this.bold(clean(block.heading)));
		const messageStart = INDENT.length + MARKER_WIDTH + keyColumns + GAP.length;
		const messageColumns = Math.max(MINIMUM_VALUE_COLUMNS, this.display.columns - messageStart);
		for (const entry of block.entries) {
			const key = clean(entry.key);
			const marker = this.tone(entry.status, STATUS_MARKERS[entry.status]);
			const head = `${INDENT}${marker} ${this.tone(entry.status, key)}${padColumns(key, keyColumns)}${GAP}`;
			const message = this.wrapHuman(clean(entry.message), messageColumns);
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
					lines.push(this.dim("─".repeat(this.display.columns)));
					break;
				case "line":
					lines.push(block.text);
					break;
				case "paragraph": {
					separate();
					for (const line of this.wrapHuman(clean(block.text), this.display.columns - INDENT.length)) {
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
