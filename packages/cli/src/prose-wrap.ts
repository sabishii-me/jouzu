import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Japanese punctuation-aware wrapping for rendered Markdown prose.
 *
 * The wrapper works on the visible stream of one rendered line, keeps ANSI
 * escapes and OSC 8 links attached to their graphemes, and only breaks where a
 * Japanese line-start or line-end prohibition allows it. English text still
 * breaks at ordinary spaces; a word wider than the column is split at grapheme
 * boundaries, as Pi's baseline wrapper does. Lines without CJK characters are
 * delegated to Pi's baseline wrapper so non-Japanese prose stays byte-identical.
 */

export interface ProseWrapMetrics {
	readonly visibleWidth: (text: string) => number;
	readonly stripTerminalSequences: (text: string) => string;
	readonly wrapTextWithAnsi: (text: string, width: number) => string[];
}

/** A protected visible range, such as inline code or a displayed URL. */
export interface VisibleSpan {
	readonly start: number;
	readonly end: number;
}

const DEFAULT_METRICS: ProseWrapMetrics = Object.freeze({
	visibleWidth,
	stripTerminalSequences,
	wrapTextWithAnsi,
});

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Japanese line-start prohibitions (行頭禁則): a line must not begin with closing
 * punctuation, a small kana, an iteration mark, or a prolonged sound mark.
 * ASCII closing brackets and sentence punctuation are included because a long
 * unbroken word can otherwise push them onto the next line.
 */
const LINE_START_PROHIBITED = new Set(
	[
		"、。，．：；？！）］｝〕〉》」』】〙〗〟｠»",
		"ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ",
		"ゝゞヽヾ々ー",
		")]}>,.;:!?",
	].join(""),
);

/** Japanese line-end prohibitions (行末禁則): a line must not end with an opening mark. */
const LINE_END_PROHIBITED = new Set([..."（［｛〔〈《「『【〘〖〝｟«([{<"]);

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

function containsCjkVisible(visible: string): boolean {
	for (const character of visible) {
		if (isCjkCharacter(character)) return true;
	}
	return false;
}

/** True when the visible text contains a CJK character. Non-CJK prose uses Pi's baseline wrapper. */
export function containsCjkText(text: string, metrics: ProseWrapMetrics = DEFAULT_METRICS): boolean {
	return containsCjkVisible(metrics.stripTerminalSequences(text));
}

function firstCodePoint(text: string): string {
	const code = text.codePointAt(0);
	return code === undefined ? "" : String.fromCodePoint(code);
}

function lastCodePoint(text: string): string {
	const characters = [...text];
	return characters[characters.length - 1] ?? "";
}

/** True when ANSI sequences occur before a trailing run of ANSI-only sequences. */
function hasAnsiBeforeSuffix(text: string): boolean {
	let end = text.length;
	while (end > 0) {
		const escapeIndex = text.lastIndexOf("\x1b", end - 1);
		if (escapeIndex < 0) return false;
		const length = scanAnsiAt(text, escapeIndex);
		if (escapeIndex + length !== end) return true;
		end = escapeIndex;
	}
	return false;
}

/** Return the length of the escape sequence at `index`, or zero for ordinary text. */
function scanAnsiAt(text: string, index: number): number {
	if (text.charCodeAt(index) !== 0x1b) return 0;
	const next = text[index + 1];
	if (next === undefined) return 1;
	if (next === "[") {
		let cursor = index + 2;
		while (cursor < text.length) {
			const code = text.charCodeAt(cursor);
			if (code >= 0x40 && code <= 0x7e) return cursor - index + 1;
			cursor++;
		}
		return text.length - index;
	}
	if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
		let cursor = index + 2;
		while (cursor < text.length) {
			if (text[cursor] === "\x07") return cursor - index + 1;
			if (text[cursor] === "\x1b" && text[cursor + 1] === "\\") return cursor - index + 2;
			cursor++;
		}
		return text.length - index;
	}
	if (next === "(" || next === ")" || next === "*" || next === "+") {
		return Math.min(3, text.length - index);
	}
	return Math.min(2, text.length - index);
}

interface AnsiPart {
	readonly kind: "ansi";
	readonly raw: string;
}

interface TextPart {
	readonly kind: "text";
	readonly raw: string;
	readonly rawStart: number;
	readonly visibleStart: number;
}

type StyledPart = AnsiPart | TextPart;

function parseStyledParts(text: string): { visible: string; parts: StyledPart[] } {
	const parts: StyledPart[] = [];
	let visible = "";
	let cursor = 0;
	while (cursor < text.length) {
		if (text[cursor] === "\x1b") {
			const length = scanAnsiAt(text, cursor);
			if (length > 0) {
				parts.push({ kind: "ansi", raw: text.slice(cursor, cursor + length) });
				cursor += length;
				continue;
			}
		}
		const start = cursor;
		while (cursor < text.length && text[cursor] !== "\x1b") cursor++;
		const raw = text.slice(start, cursor);
		parts.push({ kind: "text", raw, rawStart: start, visibleStart: visible.length });
		visible += raw;
	}
	return { visible, parts };
}

interface HyperlinkState {
	readonly params: string;
	readonly url: string;
	readonly terminator: string;
}

/** Parse an OSC 8 open/close sequence; `null` closes the active link. */
function parseOsc8(sequence: string): HyperlinkState | null | undefined {
	if (!sequence.startsWith("\x1b]8;")) return undefined;
	const body = sequence.slice(4);
	const separator = body.indexOf(";");
	if (separator < 0) return undefined;
	const params = body.slice(0, separator);
	let rest = body.slice(separator + 1);
	let terminator: string;
	if (rest.endsWith("\x07")) {
		terminator = "\x07";
		rest = rest.slice(0, -1);
	} else if (rest.endsWith("\x1b\\")) {
		terminator = "\x1b\\";
		rest = rest.slice(0, -2);
	} else {
		return undefined;
	}
	return rest ? { params, url: rest, terminator } : null;
}

/** Parsed SGR extended-color parameters, including colon subparameters. */
interface ParsedExtendedColor {
	readonly value: string;
	readonly consumed: number;
}

function parseExtendedColor(
	code: number,
	groups: readonly string[],
	index: number,
	subparts: readonly string[],
): ParsedExtendedColor | undefined {
	if (subparts.length > 1) {
		const mode = subparts[1];
		if (mode === "5" && subparts[2] !== undefined) {
			return { value: `${code}:5:${subparts[2]}`, consumed: 0 };
		}
		if (mode === "2") {
			if (subparts.length >= 6) {
				return {
					value: `${code}:2:${subparts[2]}:${subparts[3]}:${subparts[4]}:${subparts[5]}`,
					consumed: 0,
				};
			}
			if (subparts.length >= 5) {
				return { value: `${code}:2:${subparts[2]}:${subparts[3]}:${subparts[4]}`, consumed: 0 };
			}
		}
		return undefined;
	}

	const mode = groups[index + 1];
	if (mode === "5" && groups[index + 2] !== undefined) {
		return { value: `${code};5;${groups[index + 2]}`, consumed: 2 };
	}
	if (mode === "2") {
		const offset = groups[index + 2] === "" ? 1 : 0;
		const red = groups[index + 2 + offset];
		const green = groups[index + 3 + offset];
		const blue = groups[index + 4 + offset];
		if (red !== undefined && green !== undefined && blue !== undefined) {
			return { value: `${code};2;${red};${green};${blue}`, consumed: 4 + offset };
		}
	}
	return undefined;
}

/** Tracks the SGR and OSC 8 state needed to close and reopen a generated break. */
class AnsiState {
	private bold = false;
	private dim = false;
	private italic = false;
	private underline = false;
	private underlineStyle: string | null = null;
	private blink = false;
	private inverse = false;
	private hidden = false;
	private strikethrough = false;
	private fgColor: string | null = null;
	private bgColor: string | null = null;
	private underlineColor: string | null = null;
	private hyperlink: HyperlinkState | null = null;

	processRaw(raw: string): void {
		let cursor = 0;
		while (cursor < raw.length) {
			const escapeIndex = raw.indexOf("\x1b", cursor);
			if (escapeIndex < 0) return;
			const length = scanAnsiAt(raw, escapeIndex);
			if (length <= 0) {
				cursor = escapeIndex + 1;
				continue;
			}
			this.process(raw.slice(escapeIndex, escapeIndex + length));
			cursor = escapeIndex + length;
		}
	}

	private process(sequence: string): void {
		if (sequence.startsWith("\x1b]8;")) {
			const parsed = parseOsc8(sequence);
			if (parsed !== undefined) this.hyperlink = parsed;
			return;
		}
		if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return;
		const body = sequence.slice(2, -1);
		if (body === "" || body === "0") {
			this.resetAttributes();
			return;
		}
		const groups = body.split(";");
		for (let index = 0; index < groups.length; index++) {
			const group = groups[index] ?? "";
			if (group === "") {
				// An empty SGR parameter is the default parameter (0), which resets attributes.
				this.resetAttributes();
				continue;
			}
			const subparts = group.split(":");
			const code = Number.parseInt(subparts[0] ?? "", 10);
			if (!Number.isFinite(code)) continue;
			if (code === 38 || code === 48 || code === 58) {
				const parsed = parseExtendedColor(code, groups, index, subparts);
				if (!parsed) return;
				if (code === 38) this.fgColor = parsed.value;
				else if (code === 48) this.bgColor = parsed.value;
				else this.underlineColor = parsed.value;
				index += parsed.consumed;
				continue;
			}
			if (code === 4) {
				if (subparts.length > 1) {
					const style = subparts[1];
					if (style === "0") {
						this.underline = false;
						this.underlineStyle = null;
					} else if (style !== undefined && style !== "") {
						this.underline = true;
						this.underlineStyle = group;
					} else {
						this.underline = true;
						this.underlineStyle = null;
					}
				} else {
					this.underline = true;
					this.underlineStyle = null;
				}
				continue;
			}
			switch (code) {
				case 0:
					this.resetAttributes();
					break;
				case 1:
					this.bold = true;
					break;
				case 2:
					this.dim = true;
					break;
				case 3:
					this.italic = true;
					break;
				case 5:
					this.blink = true;
					break;
				case 7:
					this.inverse = true;
					break;
				case 8:
					this.hidden = true;
					break;
				case 9:
					this.strikethrough = true;
					break;
				case 21:
				case 22:
					this.bold = false;
					this.dim = false;
					break;
				case 23:
					this.italic = false;
					break;
				case 24:
					this.underline = false;
					this.underlineStyle = null;
					break;
				case 25:
					this.blink = false;
					break;
				case 27:
					this.inverse = false;
					break;
				case 28:
					this.hidden = false;
					break;
				case 29:
					this.strikethrough = false;
					break;
				case 39:
					this.fgColor = null;
					break;
				case 49:
					this.bgColor = null;
					break;
				case 59:
					this.underlineColor = null;
					break;
				default:
					if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) this.fgColor = String(code);
					else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) this.bgColor = String(code);
					break;
			}
		}
	}

	private resetAttributes(): void {
		this.bold = false;
		this.dim = false;
		this.italic = false;
		this.underline = false;
		this.underlineStyle = null;
		this.blink = false;
		this.inverse = false;
		this.hidden = false;
		this.strikethrough = false;
		this.fgColor = null;
		this.bgColor = null;
		this.underlineColor = null;
	}

	private hasAttributes(): boolean {
		return (
			this.bold ||
			this.dim ||
			this.italic ||
			this.underline ||
			this.blink ||
			this.inverse ||
			this.hidden ||
			this.strikethrough ||
			this.fgColor !== null ||
			this.bgColor !== null ||
			this.underlineColor !== null
		);
	}

	getActiveCodes(): string {
		const codes: string[] = [];
		if (this.bold) codes.push("1");
		if (this.dim) codes.push("2");
		if (this.italic) codes.push("3");
		if (this.underline) codes.push(this.underlineStyle ?? "4");
		if (this.blink) codes.push("5");
		if (this.inverse) codes.push("7");
		if (this.hidden) codes.push("8");
		if (this.strikethrough) codes.push("9");
		if (this.fgColor) codes.push(this.fgColor);
		if (this.bgColor) codes.push(this.bgColor);
		if (this.underlineColor) codes.push(this.underlineColor);
		let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
		if (this.hyperlink) {
			result += `\x1b]8;${this.hyperlink.params};${this.hyperlink.url}${this.hyperlink.terminator}`;
		}
		return result;
	}

	closeForBreak(): string {
		let result = this.hasAttributes() ? "\x1b[0m" : "";
		if (this.hyperlink) result += `\x1b]8;;${this.hyperlink.terminator}`;
		return result;
	}
}

interface Cell {
	readonly raw: string;
	readonly visible: string;
	readonly visibleStart: number;
	readonly visibleEnd: number;
	readonly width: number;
	readonly newline: boolean;
	readonly plainSpace: boolean;
}

interface CellRange {
	start: number;
	end: number;
}

const widthCaches = new WeakMap<ProseWrapMetrics, Map<string, number>>();

function graphemeWidth(text: string, metrics: ProseWrapMetrics): number {
	let cache = widthCaches.get(metrics);
	if (!cache) {
		cache = new Map();
		widthCaches.set(metrics, cache);
	}
	const cached = cache.get(text);
	if (cached !== undefined) return cached;
	const width = metrics.visibleWidth(text);
	if (cache.size >= 4096) cache.clear();
	cache.set(text, width);
	return width;
}

function tokenizeCells(text: string, metrics: ProseWrapMetrics): Cell[] {
	const { visible, parts } = parseStyledParts(text);
	if (visible.length === 0) return [];

	const rawAtVisible = new Int32Array(visible.length + 1);
	rawAtVisible.fill(-1);
	for (const part of parts) {
		if (part.kind !== "text") continue;
		for (let index = 0; index <= part.raw.length; index++) {
			rawAtVisible[part.visibleStart + index] = part.rawStart + index;
		}
	}

	const boundaries: number[] = [0];
	let previous = 0;
	const segments = [...graphemeSegmenter.segment(visible)];
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (!segment) continue;
		if (index > 0) {
			const mapped = rawAtVisible[segment.index] ?? -1;
			const boundary = mapped >= 0 ? Math.max(previous, mapped) : previous;
			boundaries.push(boundary);
			previous = boundary;
		}
	}
	boundaries.push(text.length);

	const cells: Cell[] = [];
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (!segment) continue;
		const start = boundaries[index] ?? 0;
		const end = boundaries[index + 1] ?? text.length;
		const visibleText = segment.segment;
		const newline = visibleText === "\n" || visibleText === "\r" || visibleText === "\r\n";
		const raw = text.slice(start, end);
		cells.push({
			raw,
			visible: visibleText,
			visibleStart: segment.index,
			visibleEnd: segment.index + visibleText.length,
			width: newline ? 0 : graphemeWidth(visibleText, metrics),
			newline,
			plainSpace: visibleText === " " && raw === " ",
		});
	}
	return cells;
}

interface ProtectedIndex {
	readonly ranges: readonly CellRange[];
	readonly starts: ReadonlySet<number>;
	readonly ends: ReadonlySet<number>;
	readonly cells: Uint8Array;
}

/** Sort and merge visible spans so each cell is visited at most once. */
export function mergeVisibleSpans(spans: readonly VisibleSpan[]): VisibleSpan[] {
	const sorted: VisibleSpan[] = [];
	for (const span of spans) {
		const start = Math.max(0, span.start);
		const end = Math.max(0, span.end);
		if (end > start) sorted.push({ start, end });
	}
	sorted.sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: VisibleSpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span.start <= last.end) {
			merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

function mapProtectedSpans(cells: readonly Cell[], spans: readonly VisibleSpan[]): ProtectedIndex {
	const ranges: CellRange[] = [];
	let cellIndex = 0;
	for (const span of mergeVisibleSpans(spans)) {
		while (cellIndex < cells.length) {
			const cell = cells[cellIndex];
			if (!cell || cell.visibleEnd > span.start) break;
			cellIndex++;
		}
		const start = cellIndex;
		while (cellIndex < cells.length) {
			const cell = cells[cellIndex];
			if (!cell || cell.visibleStart >= span.end) break;
			cellIndex++;
		}
		if (cellIndex > start) ranges.push({ start, end: cellIndex });
	}

	const merged: CellRange[] = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}

	const starts = new Set<number>();
	const ends = new Set<number>();
	const protectedCells = new Uint8Array(cells.length);
	for (const range of merged) {
		starts.add(range.start);
		ends.add(range.end);
		protectedCells.fill(1, range.start, range.end);
	}
	return { ranges: merged, starts, ends, cells: protectedCells };
}

function rangeContaining(protectedIndex: ProtectedIndex, boundary: number): CellRange | undefined {
	let low = 0;
	let high = protectedIndex.ranges.length - 1;
	let candidate = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const range = protectedIndex.ranges[middle];
		if (!range) break;
		if (range.start < boundary) {
			candidate = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	const range = candidate >= 0 ? protectedIndex.ranges[candidate] : undefined;
	return range && boundary < range.end ? range : undefined;
}

function isProtectedBoundary(protectedIndex: ProtectedIndex, boundary: number): boolean {
	return protectedIndex.starts.has(boundary) || protectedIndex.ends.has(boundary);
}

function isProtectedCell(protectedIndex: ProtectedIndex, cellIndex: number): boolean {
	return protectedIndex.cells[cellIndex] === 1;
}

function isPlainSpace(cell: Cell | undefined): boolean {
	return cell?.plainSpace === true;
}

function isCjkBoundary(previous: Cell, next: Cell): boolean {
	return isCjkCharacter(lastCodePoint(previous.visible)) || isCjkCharacter(firstCodePoint(next.visible));
}

function legalBreak(cells: readonly Cell[], start: number, end: number, boundary: number): boolean {
	let next = boundary;
	while (next < end && isPlainSpace(cells[next])) next++;
	let previous = boundary - 1;
	while (previous >= start && isPlainSpace(cells[previous])) previous--;
	if (next >= end || previous < start) return true;
	const startCharacter = firstCodePoint(cells[next]?.visible ?? "");
	const endCharacter = lastCodePoint(cells[previous]?.visible ?? "");
	return !LINE_START_PROHIBITED.has(startCharacter) && !LINE_END_PROHIBITED.has(endCharacter);
}

function latestCandidate(
	cells: readonly Cell[],
	start: number,
	fitEnd: number,
	end: number,
	protectedIndex: ProtectedIndex,
	emergency: boolean,
	allowProtected: boolean,
): number {
	for (let boundary = fitEnd; boundary > start; boundary--) {
		if (boundary >= end) continue;
		const insideProtected = rangeContaining(protectedIndex, boundary) !== undefined;
		if (insideProtected && !(emergency && allowProtected)) continue;
		if (!emergency) {
			const previous = cells[boundary - 1];
			const next = cells[boundary];
			if (!previous || !next) continue;
			if (isPlainSpace(next)) continue;
			const spaceBreak = isPlainSpace(previous);
			const cjkBreak = isCjkBoundary(previous, next);
			const literalEdge = isProtectedBoundary(protectedIndex, boundary);
			if (!spaceBreak && !cjkBreak && !literalEdge) continue;
		}
		if (!legalBreak(cells, start, end, boundary)) continue;
		return boundary;
	}
	return start;
}

function chooseBreak(
	cells: readonly Cell[],
	start: number,
	end: number,
	width: number,
	protectedIndex: ProtectedIndex,
): number {
	let fitEnd = start;
	let used = 0;
	while (fitEnd < end) {
		const cell = cells[fitEnd];
		if (!cell) break;
		if (used + cell.width > width && fitEnd > start) break;
		used += cell.width;
		fitEnd++;
		if (used > width) break;
	}
	if (fitEnd <= start) fitEnd = Math.min(end, start + 1);
	if (fitEnd >= end) return end;

	const containing = rangeContaining(protectedIndex, fitEnd);
	if (containing && containing.start > start) {
		const normalBefore = latestCandidate(cells, start, containing.start, end, protectedIndex, false, false);
		if (normalBefore > start) return normalBefore;
		const emergencyBefore = latestCandidate(cells, start, containing.start, end, protectedIndex, true, false);
		if (emergencyBefore > start) return emergencyBefore;
		return containing.start;
	}
	const allowProtected = containing !== undefined && containing.start === start;

	const normal = latestCandidate(cells, start, fitEnd, end, protectedIndex, false, allowProtected);
	if (normal > start) return normal;
	const emergency = latestCandidate(cells, start, fitEnd, end, protectedIndex, true, allowProtected);
	if (emergency > start) return emergency;
	return fitEnd;
}

function wrapSegment(
	cells: readonly Cell[],
	start: number,
	end: number,
	width: number,
	protectedIndex: ProtectedIndex,
	state: AnsiState,
	continuation: boolean,
): string[] {
	if (start >= end) return [""];
	const lines: string[] = [];
	let lineStart = start;
	let firstLine = true;
	while (lineStart < end) {
		const lineEnd = chooseBreak(cells, lineStart, end, width, protectedIndex);
		const prefix = !firstLine || continuation ? state.getActiveCodes() : "";
		let trimEnd = lineEnd;
		while (trimEnd > lineStart && isPlainSpace(cells[trimEnd - 1]) && !isProtectedCell(protectedIndex, trimEnd - 1)) {
			trimEnd--;
		}
		let raw = "";
		for (let index = lineStart; index < trimEnd; index++) {
			const cell = cells[index];
			if (!cell) continue;
			raw += cell.raw;
			state.processRaw(cell.raw);
		}
		const close = lineEnd < end ? state.closeForBreak() : "";
		lines.push(raw === "" ? "" : prefix + raw + close);
		lineStart = lineEnd;
		while (lineStart < end && isPlainSpace(cells[lineStart]) && !isProtectedCell(protectedIndex, lineStart)) {
			lineStart++;
		}
		firstLine = false;
	}
	return lines;
}

function closeSegmentAtNewline(lines: string[], followedByNewline: boolean, state: AnsiState): void {
	if (!followedByNewline || lines.length === 0) return;
	const lastIndex = lines.length - 1;
	const last = lines[lastIndex];
	if (last === undefined || last === "") return;
	const close = state.closeForBreak();
	if (close) lines[lastIndex] = last + close;
}

/**
 * Wrap one rendered Markdown line, preserving explicit newlines, blank lines,
 * ANSI SGR state, and OSC 8 hyperlinks. `protectedSpans` are visible offsets in
 * the ANSI-stripped text; a span is kept whole unless it is wider than the
 * column at the start of a line, where width wins. Each explicit newline starts
 * a fresh segment: segments without CJK characters use Pi's baseline wrapper so
 * mixed Japanese/English prose does not change English lines.
 */
export function wrapProseText(
	text: string,
	width: number,
	protectedSpans: readonly VisibleSpan[] = [],
	metrics: ProseWrapMetrics = DEFAULT_METRICS,
): string[] {
	if (text === "") return [""];
	const normalized = text.replace(/\r\n?/gu, "\n");
	const columns = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
	if (!containsCjkText(normalized, metrics)) return metrics.wrapTextWithAnsi(normalized, columns);

	const segments = normalized.split("\n");
	const visibleSegments = segments.map((segment) => metrics.stripTerminalSequences(segment));
	const visibleStarts: number[] = [];
	let visibleOffset = 0;
	for (const visible of visibleSegments) {
		visibleStarts.push(visibleOffset);
		visibleOffset += visible.length + 1;
	}
	const spans = mergeVisibleSpans(protectedSpans);
	const state = new AnsiState();
	const result: string[] = [];
	let spanIndex = 0;
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index] ?? "";
		const visible = visibleSegments[index] ?? "";
		const followedByNewline = index < segments.length - 1;
		const continuation = index > 0;

		// Preserve the existing blank-line behavior for whitespace-only segments,
		// while still carrying ANSI state opened or closed on that line.
		if (visible === "" || /^ +$/u.test(visible)) {
			state.processRaw(segment);
			result.push("");
			continue;
		}

		if (!containsCjkVisible(visible)) {
			const prefix = continuation ? state.getActiveCodes() : "";
			let lines: string[];
			if (prefix && !hasAnsiBeforeSuffix(segment)) {
				// Baseline wrapping does not reopen every inherited style (notably
				// colon SGR forms) on continuation lines. With no local ANSI state,
				// the inherited state applies to every line, so apply it explicitly.
				lines = metrics.wrapTextWithAnsi(segment, columns);
				for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
					const line = lines[lineIndex];
					if (line !== undefined && line !== "") lines[lineIndex] = prefix + line;
				}
			} else {
				lines = metrics.wrapTextWithAnsi(prefix + segment, columns);
			}
			state.processRaw(segment);
			closeSegmentAtNewline(lines, followedByNewline, state);
			result.push(...lines);
			continue;
		}

		const segmentStart = visibleStarts[index] ?? 0;
		const segmentEnd = segmentStart + visible.length;
		while (spanIndex < spans.length && (spans[spanIndex]?.end ?? 0) <= segmentStart) spanIndex++;
		const localSpans: VisibleSpan[] = [];
		for (let localIndex = spanIndex; localIndex < spans.length; localIndex++) {
			const span = spans[localIndex];
			if (!span || span.start >= segmentEnd) break;
			const start = Math.max(span.start, segmentStart) - segmentStart;
			const end = Math.min(span.end, segmentEnd) - segmentStart;
			if (end > start) localSpans.push({ start, end });
		}
		const cells = tokenizeCells(segment, metrics);
		if (cells.length === 0) {
			result.push("");
			continue;
		}
		const protectedIndex = mapProtectedSpans(cells, localSpans);
		const lines = wrapSegment(cells, 0, cells.length, columns, protectedIndex, state, continuation);
		closeSegmentAtNewline(lines, followedByNewline, state);
		result.push(...lines);
	}
	return result.length > 0 ? result : [""];
}
