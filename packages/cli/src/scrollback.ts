import type { ExtensionContext, InlineExtension, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	isKeyRelease,
	type KeybindingsManager,
	matchesKey,
	type Terminal,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";

/**
 * Export the active transcript to the terminal's main screen so a user can search and select it
 * with the terminal or tmux, then return to the fullscreen TUI.
 *
 * The export is deliberately plain text. It reads only the active branch from the in-memory
 * session manager, never the session file, and it writes through the supplied TUI's terminal.
 */

const BUSY_MESSAGE = "jouzu.cli.scrollback.busy";
const ALREADY_OPEN_MESSAGE = "jouzu.cli.scrollback.alreadyOpen";
const FULLSCREEN_MESSAGE = "jouzu.cli.scrollback.fullscreen";
const DEFAULT_CHUNK_SIZE = 16 * 1024;
const MAX_NOTICE_LENGTH = 240;

export interface ScrollbackDependencies {
	catalog: CatalogBundle;
	env: NodeJS.ProcessEnv;
	isTTY(): boolean;
	isShellBusy?(): boolean;
	now(): Date;
	chunkSize: number;
	yieldToEventLoop(): Promise<void>;
}

const DEFAULT_DEPENDENCIES: ScrollbackDependencies = {
	catalog: defaultCatalog(),
	env: process.env,
	isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
	isShellBusy: () => false,
	now: () => new Date(),
	chunkSize: DEFAULT_CHUNK_SIZE,
	yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve)),
};

export interface ScrollbackRenderOptions {
	catalog?: CatalogBundle;
	/** Terminal columns the exported lines must fit. */
	width: number;
	sessionId?: string;
	sessionName?: string;
	exportedAt?: Date;
}

export interface ScrollbackTranscript {
	/** Plain text lines, each within the requested display width. */
	lines: string[];
	/** Included message, custom-message, compaction, and branch-summary entries. */
	entryCount: number;
	imageCount: number;
	omittedSystem: number;
	omittedState: number;
}

export interface ScrollbackKeyMatcher {
	matches(data: string, action: string): boolean;
}

type ScrollbackCloseReason = "return" | "session" | "agent" | "shutdown" | "busy" | "failure" | "dispose";
type NoticeType = "info" | "warning" | "error";

interface Notice {
	message: string;
	type: NoticeType;
}

interface LineWriter {
	lines: string[];
	width: number;
}

interface RenderContext extends LineWriter {
	catalog: CatalogBundle;
	entryCount: number;
	imageCount: number;
	omittedSystem: number;
	omittedState: number;
}

interface ScrollbackExport {
	start(): void;
	handleInput(data: string): void;
	finish(reason: ScrollbackCloseReason, notice?: Notice): void;
}

interface ScrollbackExportOptions {
	tui: TUI;
	keybindings: KeybindingsManager;
	done: () => void;
	ctx: ExtensionContext;
	deps: ScrollbackDependencies;
	notify(message: string, type: NoticeType): void;
	onClosed(): void;
}

/**
 * Remove terminal control strings before any line splitting. Sanitizing the whole value first
 * matters for OSC, DCS, APC, PM, and SOS strings that span lines or never terminate: splitting
 * first would leave the tail of such a string as ordinary-looking text.
 *
 * Unicode is preserved. Tabs become spaces, CRLF and CR become LF, and other C0, DEL, and C1
 * controls are removed. Unterminated control strings are removed through the end of the value.
 */
export function sanitizeScrollbackText(value: string): string {
	const text = normalizeNewlines(value);
	let result = "";
	let index = 0;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code === 0x1b) {
			const next = text[index + 1];
			if (next === "[") {
				index = skipCsi(text, index + 2);
				continue;
			}
			if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
				index = skipControlString(text, index + 2);
				continue;
			}
			const nextCode = next === undefined ? -1 : text.charCodeAt(index + 1);
			if (nextCode >= 0x20 && nextCode <= 0x7e) {
				// Two-character escape sequence (for example ESC 7, ESC =, or ST).
				index += 2;
				continue;
			}
			index += 1;
			continue;
		}
		if (code === 0x9b) {
			index = skipCsi(text, index + 1);
			continue;
		}
		if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
			index = skipControlString(text, index + 1);
			continue;
		}
		if (code === 0x9c) {
			index += 1;
			continue;
		}
		if (code === 0x0a) {
			result += "\n";
			index += 1;
			continue;
		}
		if (code === 0x09) {
			result += "    ";
			index += 1;
			continue;
		}
		if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
			index += 1;
			continue;
		}
		if (code >= 0xd800 && code <= 0xdbff) {
			const nextCode = text.charCodeAt(index + 1);
			if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
				result += text.slice(index, index + 2);
				index += 2;
				continue;
			}
			result += "\uFFFD";
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) {
			result += "\uFFFD";
			index += 1;
			continue;
		}
		result += text[index];
		index += 1;
	}
	return result;
}

function normalizeNewlines(value: string): string {
	let result = "";
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x0d) {
			if (value.charCodeAt(index + 1) === 0x0a) index += 1;
			result += "\n";
			continue;
		}
		if (code === 0x2028 || code === 0x2029) {
			result += "\n";
			continue;
		}
		result += value[index];
	}
	return result;
}

function skipCsi(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		index += 1;
		if (code >= 0x40 && code <= 0x7e) break;
	}
	return index;
}

function skipControlString(value: string, start: number): number {
	let index = start;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if (code === 0x07) return index + 1;
		if (code === 0x9c) return index + 1;
		if (code === 0x1b && value[index + 1] === "\\") return index + 2;
		index += 1;
	}
	return index;
}

function normalizeWidth(width: number): number {
	return Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 80;
}

function indentFor(width: number, desired: number): string {
	return " ".repeat(Math.min(desired, Math.max(0, width - 1)));
}

function pushWrapped(writer: LineWriter, value: string, indent: string): void {
	const text = sanitizeScrollbackText(value);
	const available = Math.max(1, writer.width - indent.length);
	for (const line of wrapTextWithAnsi(text, available)) {
		writer.lines.push(`${indent}${line}`.trimEnd());
	}
}

function pushBlank(writer: LineWriter): void {
	if (writer.lines.length > 0 && writer.lines[writer.lines.length - 1] !== "") writer.lines.push("");
}

function beginEntry(ctx: RenderContext, label: string): void {
	if (ctx.entryCount > 0) pushBlank(ctx);
	ctx.entryCount += 1;
	pushWrapped(ctx, label, "");
}

function renderContent(ctx: RenderContext, content: unknown, indent: string): boolean {
	if (typeof content === "string") {
		if (content.length === 0) return false;
		pushWrapped(ctx, content, indent);
		return true;
	}
	if (!Array.isArray(content)) return false;
	let rendered = false;
	for (const block of content) {
		if (renderBlock(ctx, block, indent)) rendered = true;
	}
	return rendered;
}

function renderBlock(ctx: RenderContext, block: unknown, indent: string): boolean {
	if (typeof block === "string") {
		if (block.length === 0) return false;
		pushWrapped(ctx, block, indent);
		return true;
	}
	if (!block || typeof block !== "object") return false;
	const type = (block as { type?: unknown }).type;
	if (type === "text") {
		const text = (block as { text?: unknown }).text;
		if (typeof text !== "string" || text.length === 0) return false;
		pushWrapped(ctx, text, indent);
		return true;
	}
	if (type === "thinking") {
		const thinking = (block as { thinking?: unknown }).thinking;
		const redacted = (block as { redacted?: unknown }).redacted === true;
		pushBlank(ctx);
		pushWrapped(ctx, "Thinking", indent);
		const nested = indentFor(ctx.width, indent.length + 2);
		if (typeof thinking === "string" && thinking.length > 0) pushWrapped(ctx, thinking, nested);
		else if (redacted) pushWrapped(ctx, "[redacted thinking]", nested);
		else pushWrapped(ctx, "(empty)", nested);
		return true;
	}
	if (type === "toolCall") {
		const name = stringValue((block as { name?: unknown }).name) || "tool";
		const namespace = stringValue((block as { namespace?: unknown }).namespace);
		const label = catalogText(ctx.catalog, "jouzu.cli.scrollback.toolCall", {
			name: namespace ? `${namespace}.${name}` : name,
		});
		pushBlank(ctx);
		pushWrapped(ctx, label, indent);
		const nested = indentFor(ctx.width, indent.length + 2);
		pushWrapped(ctx, formatJson((block as { arguments?: unknown }).arguments, ctx.catalog), nested);
		return true;
	}
	if (type === "image") {
		const mimeType = stringValue((block as { mimeType?: unknown }).mimeType) || "image";
		const data = stringValue((block as { data?: unknown }).data);
		ctx.imageCount += 1;
		pushWrapped(ctx, `[image: ${mimeType}, ${formatBytes(base64Bytes(data))}]`, indent);
		return true;
	}
	const label = typeof type === "string" && type.length > 0 ? type : "unknown";
	pushWrapped(ctx, `[unsupported content: ${label}]`, indent);
	return true;
}

function renderMessage(ctx: RenderContext, message: unknown): void {
	if (!message || typeof message !== "object") {
		beginEntry(ctx, "Message");
		pushWrapped(ctx, "[invalid message]", indentFor(ctx.width, 2));
		return;
	}
	const role = (message as { role?: unknown }).role;
	const indent = indentFor(ctx.width, 2);
	if (role === "system") {
		ctx.omittedSystem += 1;
		return;
	}
	if (role === "user") {
		beginEntry(ctx, "User");
		if (!renderContent(ctx, (message as { content?: unknown }).content, indent)) {
			pushWrapped(ctx, "(no content)", indent);
		}
		return;
	}
	if (role === "assistant") {
		beginEntry(ctx, "Assistant");
		const rendered = renderContent(ctx, (message as { content?: unknown }).content, indent);
		const errorMessage = stringValue((message as { errorMessage?: unknown }).errorMessage);
		if (errorMessage) {
			pushBlank(ctx);
			pushWrapped(ctx, `[error: ${errorMessage}]`, indent);
		}
		const stopReason = (message as { stopReason?: unknown }).stopReason;
		if (stopReason === "aborted") pushWrapped(ctx, "[aborted]", indent);
		else if (stopReason === "length") pushWrapped(ctx, "[response truncated]", indent);
		if (!rendered && !errorMessage && stopReason !== "aborted" && stopReason !== "length") {
			pushWrapped(ctx, "(no content)", indent);
		}
		return;
	}
	if (role === "toolResult") {
		const toolName = stringValue((message as { toolName?: unknown }).toolName) || "tool";
		const isError = (message as { isError?: unknown }).isError === true;
		beginEntry(
			ctx,
			catalogText(ctx.catalog, isError ? "jouzu.cli.scrollback.toolError" : "jouzu.cli.scrollback.toolResult", {
				name: toolName,
			}),
		);
		if (!renderContent(ctx, (message as { content?: unknown }).content, indent)) {
			pushWrapped(ctx, "(no output)", indent);
		}
		return;
	}
	if (role === "bashExecution") {
		renderBashExecution(ctx, message, indent);
		return;
	}
	if (role === "custom") {
		const customType = stringValue((message as { customType?: unknown }).customType) || "custom";
		beginEntry(ctx, `Custom message (${customType})`);
		if ((message as { display?: unknown }).display === false) {
			pushWrapped(ctx, "[not shown in the interactive transcript]", indent);
		}
		if (!renderContent(ctx, (message as { content?: unknown }).content, indent)) {
			pushWrapped(ctx, "(no content)", indent);
		}
		return;
	}
	if (role === "branchSummary") {
		beginEntry(ctx, "Branch summary");
		const summary = stringValue((message as { summary?: unknown }).summary);
		pushWrapped(ctx, summary || catalogText(ctx.catalog, "jouzu.cli.scrollback.emptySummary"), indent);
		const fromId = stringValue((message as { fromId?: unknown }).fromId);
		if (fromId) pushWrapped(ctx, `[from ${fromId}]`, indent);
		return;
	}
	if (role === "compactionSummary") {
		beginEntry(ctx, "Compaction summary");
		const summary = stringValue((message as { summary?: unknown }).summary);
		pushWrapped(ctx, summary || catalogText(ctx.catalog, "jouzu.cli.scrollback.emptySummary"), indent);
		const tokensBefore = numberValue((message as { tokensBefore?: unknown }).tokensBefore);
		if (tokensBefore !== undefined) pushWrapped(ctx, `[${tokensBefore} tokens before]`, indent);
		return;
	}
	const label = stringValue(role) || "unknown";
	beginEntry(ctx, `Message (${label})`);
	if (!renderContent(ctx, (message as { content?: unknown }).content, indent)) {
		pushWrapped(ctx, "(no content)", indent);
	}
}

function renderBashExecution(ctx: RenderContext, message: unknown, indent: string): void {
	beginEntry(ctx, "Bash");
	const command = stringValue((message as { command?: unknown }).command);
	if (command) pushWrapped(ctx, `$ ${command}`, indent);
	const output = stringValue((message as { output?: unknown }).output);
	pushWrapped(ctx, output || catalogText(ctx.catalog, "jouzu.cli.scrollback.noOutput"), indent);
	const status: string[] = [];
	const exitCode = numberValue((message as { exitCode?: unknown }).exitCode);
	if (exitCode !== undefined) status.push(`exit code ${exitCode}`);
	if ((message as { cancelled?: unknown }).cancelled === true) status.push("cancelled");
	if ((message as { truncated?: unknown }).truncated === true) status.push("output truncated");
	if ((message as { excludeFromContext?: unknown }).excludeFromContext === true) status.push("not sent to the model");
	const fullOutputPath = stringValue((message as { fullOutputPath?: unknown }).fullOutputPath);
	if (fullOutputPath) status.push(`full output: ${fullOutputPath}`);
	if (status.length > 0) pushWrapped(ctx, `[${status.join("; ")}]`, indent);
}

function renderCustomMessageEntry(ctx: RenderContext, entry: SessionEntry & { type: "custom_message" }): void {
	const customType = stringValue(entry.customType) || "custom";
	const indent = indentFor(ctx.width, 2);
	beginEntry(ctx, `Custom message (${customType})`);
	if (entry.display === false) pushWrapped(ctx, "[not shown in the interactive transcript]", indent);
	if (!renderContent(ctx, entry.content, indent)) pushWrapped(ctx, "(no content)", indent);
}

function renderCompactionEntry(ctx: RenderContext, entry: SessionEntry & { type: "compaction" }): void {
	const indent = indentFor(ctx.width, 2);
	beginEntry(ctx, "Compaction summary");
	pushWrapped(ctx, stringValue(entry.summary) || catalogText(ctx.catalog, "jouzu.cli.scrollback.emptySummary"), indent);
	if (typeof entry.tokensBefore === "number") pushWrapped(ctx, `[${entry.tokensBefore} tokens before]`, indent);
}

function renderBranchSummaryEntry(ctx: RenderContext, entry: SessionEntry & { type: "branch_summary" }): void {
	const indent = indentFor(ctx.width, 2);
	beginEntry(ctx, "Branch summary");
	pushWrapped(ctx, stringValue(entry.summary) || catalogText(ctx.catalog, "jouzu.cli.scrollback.emptySummary"), indent);
	const fromId = stringValue(entry.fromId);
	if (fromId) pushWrapped(ctx, `[from ${fromId}]`, indent);
}

function renderEntry(ctx: RenderContext, entry: SessionEntry): void {
	switch (entry.type) {
		case "message":
			renderMessage(ctx, entry.message);
			return;
		case "custom_message":
			renderCustomMessageEntry(ctx, entry);
			return;
		case "compaction":
			renderCompactionEntry(ctx, entry);
			return;
		case "branch_summary":
			renderBranchSummaryEntry(ctx, entry);
			return;
		default:
			ctx.omittedState += 1;
	}
}

function renderHeader(options: {
	catalog: CatalogBundle;
	width: number;
	sessionId: string;
	sessionName: string;
	exportedAt: string;
	entryCount: number;
	imageCount: number;
	omittedSystem: number;
	omittedState: number;
}): string[] {
	const writer: LineWriter = { lines: [], width: options.width };
	pushWrapped(writer, catalogText(options.catalog, "jouzu.cli.scrollback.title"), "");
	const session =
		options.sessionName && options.sessionId
			? `${options.sessionName} (${options.sessionId})`
			: options.sessionName || options.sessionId;
	pushWrapped(
		writer,
		catalogText(options.catalog, session ? "jouzu.cli.scrollback.sessionNamed" : "jouzu.cli.scrollback.session", {
			session,
		}),
		"",
	);
	pushWrapped(writer, `Exported: ${options.exportedAt}`, "");
	pushWrapped(writer, "Scope: stored entries on the active branch, including entries before compaction.", "");
	pushWrapped(
		writer,
		"Limits: system prompts, tool details, and raw image data are not included; images appear as placeholders.",
		"",
	);
	pushWrapped(
		writer,
		`Active branch: ${options.entryCount} entries | ${options.imageCount} image placeholders | ${options.omittedSystem} system messages | ${options.omittedState} state entries omitted`,
		"",
	);
	pushWrapped(writer, "-".repeat(options.width), "");
	return writer.lines;
}

/**
 * Format the active branch as plain terminal text. Only entries passed in are read; the caller
 * supplies `sessionManager.getBranch()`. System messages, tool details, and raw image data are
 * omitted, and every rendered line fits `options.width` display columns.
 */
export function renderScrollbackTranscript(
	entries: readonly SessionEntry[],
	options: ScrollbackRenderOptions,
): ScrollbackTranscript {
	const width = normalizeWidth(options.width);
	const ctx: RenderContext = {
		catalog: options.catalog ?? defaultCatalog(),
		lines: [],
		width,
		entryCount: 0,
		imageCount: 0,
		omittedSystem: 0,
		omittedState: 0,
	};
	for (const entry of entries) renderEntry(ctx, entry);
	while (ctx.lines.length > 0 && ctx.lines[ctx.lines.length - 1] === "") ctx.lines.pop();

	const header = renderHeader({
		catalog: ctx.catalog,
		width,
		sessionId: sanitizeScrollbackText(options.sessionId ?? "").trim(),
		sessionName: sanitizeScrollbackText(options.sessionName ?? "").trim(),
		exportedAt: formatExportedAt(options.exportedAt ?? new Date()),
		entryCount: ctx.entryCount,
		imageCount: ctx.imageCount,
		omittedSystem: ctx.omittedSystem,
		omittedState: ctx.omittedState,
	});
	const lines = [...header, ""];
	if (ctx.entryCount === 0) {
		const empty: LineWriter = { lines, width };
		pushWrapped(empty, "No transcript content is stored on this branch yet.", "");
	} else {
		for (const line of ctx.lines) lines.push(line);
	}
	const footer: LineWriter = { lines: [], width };
	pushWrapped(footer, "-".repeat(width), "");
	pushWrapped(footer, "Press Enter, Escape, or Ctrl+C to return to Jouzu.", "");
	pushWrapped(footer, "Scroll and copy with your terminal or tmux.", "");
	lines.push("", ...footer.lines);
	return {
		lines,
		entryCount: ctx.entryCount,
		imageCount: ctx.imageCount,
		omittedSystem: ctx.omittedSystem,
		omittedState: ctx.omittedState,
	};
}

/**
 * Whether input should return from the export. Enter confirms; Escape and Ctrl+C cancel. Key
 * releases and bracketed-paste payloads are inert, so pasted text cannot dismiss the export.
 */
export function isScrollbackReturnKey(data: string, keybindings: ScrollbackKeyMatcher): boolean {
	if (!data) return false;
	try {
		if (data.startsWith("\x1b[200~")) return false;
		if (isKeyRelease(data)) return false;
		if (matchesKey(data, "enter") || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return true;
		return keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel");
	} catch {
		return false;
	}
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatExportedAt(date: Date): string {
	try {
		return date.toISOString();
	} catch {
		return "unknown";
	}
}

function base64Bytes(data: string): number {
	if (!data) return 0;
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatJson(value: unknown, catalog: CatalogBundle): string {
	if (value === undefined) return "{}";
	try {
		const text = JSON.stringify(value, null, 2);
		return typeof text === "string" ? text : catalogText(catalog, "jouzu.cli.scrollback.unserializable");
	} catch {
		return catalogText(catalog, "jouzu.cli.scrollback.unserializable");
	}
}

function failureNotice(error: unknown, catalog: CatalogBundle): Notice {
	const message = error instanceof Error ? error.message : String(error);
	const safe = sanitizeScrollbackText(message).replace(/\s+/g, " ").trim().slice(0, MAX_NOTICE_LENGTH);
	return {
		message: catalogText(catalog, "jouzu.cli.scrollback.failureDetail", {
			message: safe || catalogText(catalog, "jouzu.cli.scrollback.unknownError"),
		}),
		type: "error",
	};
}

/**
 * ExtensionContext exposes streaming, compaction, and queued-message state, but not
 * AgentSession.isBashRunning. A direct `!` command is covered separately by `user_bash`; a run
 * that starts later closes the export through `agent_start`.
 */
function sessionBusy(ctx: ExtensionContext, deps: ScrollbackDependencies): boolean {
	try {
		if (typeof deps.isShellBusy === "function" && deps.isShellBusy()) return true;
		if (typeof ctx.isIdle === "function" && !ctx.isIdle()) return true;
		if (ctx.signal !== undefined) return true;
		if (typeof ctx.hasPendingMessages === "function" && ctx.hasPendingMessages()) return true;
	} catch {
		return true;
	}
	return false;
}

async function writeTranscript(
	terminal: Terminal,
	lines: readonly string[],
	deps: ScrollbackDependencies,
	isClosed: () => boolean,
): Promise<void> {
	if (isClosed()) return;
	const text = lines.join("\r\n");
	const chunkSize =
		Number.isFinite(deps.chunkSize) && deps.chunkSize >= 1 ? Math.floor(deps.chunkSize) : DEFAULT_CHUNK_SIZE;
	terminal.write("\r\n");
	let start = 0;
	while (start < text.length) {
		if (isClosed()) return;
		let end = Math.min(text.length, start + Math.max(2, chunkSize));
		if (end < text.length) {
			const last = text.charCodeAt(end - 1);
			// Keep surrogate pairs and CRLF together across chunk boundaries.
			if (last >= 0xd800 && last <= 0xdbff) end -= 1;
			if (end > start && text.charCodeAt(end - 1) === 0x0d && text.charCodeAt(end) === 0x0a) end -= 1;
		}
		if (end <= start) end = Math.min(text.length, start + Math.max(2, chunkSize));
		terminal.write(text.slice(start, end));
		start = end;
		if (isClosed()) return;
		if (start < text.length) await deps.yieldToEventLoop();
	}
	if (!isClosed()) terminal.write("\r\n");
}

function createScrollbackExport(options: ScrollbackExportOptions): ScrollbackExport {
	const { tui, keybindings, done, ctx, deps, notify, onClosed } = options;
	let closed = false;
	let doneCalled = false;
	let tuiStopped = false;
	let inputStarted = false;
	let shuttingDown = false;
	let restartToken = 0;
	let notice: Notice | undefined;
	let noticeReported = false;

	const reportNotice = (): void => {
		if (!notice || noticeReported) return;
		noticeReported = true;
		notify(notice.message, notice.type);
	};

	const stopTemporaryInput = (): void => {
		if (!tuiStopped && !inputStarted) return;
		// Stop the temporary input parser first so no further key reaches the export, and make
		// sure raw mode is restored even when tui.stop() itself failed partway through.
		try {
			tui.terminal.stop();
		} catch {
			// Best-effort terminal cleanup.
		}
		inputStarted = false;
	};

	const startTui = (): void => {
		tuiStopped = false;
		try {
			tui.start();
			// Reset fullscreen render state after the normal-screen export.
			tui.requestRender(true);
		} catch (error) {
			// A failed start may already have entered the alternate screen. Clean the renderer
			// itself, not only the terminal, so no alt screen is left behind.
			try {
				tui.stop({ preserveScreen: true });
			} catch {
				// Best-effort renderer cleanup.
			}
			try {
				tui.terminal.stop();
			} catch {
				// Best-effort terminal cleanup.
			}
			if (!notice) notice = failureNotice(error, deps.catalog);
			reportNotice();
		} finally {
			onClosed();
		}
	};

	const scheduleRestart = (): void => {
		const token = ++restartToken;
		setImmediate(() => {
			if (token !== restartToken || shuttingDown) return;
			// StdinBuffer.process() may still be emitting the rest of this batch. The closed
			// handler stays installed as a sink until this deferred restart takes over.
			stopTemporaryInput();
			startTui();
		});
	};

	const finish = (reason: ScrollbackCloseReason, nextNotice?: Notice): void => {
		if (reason === "shutdown") {
			// Pi stops the TUI before session_shutdown. Clean up our parser, but never restart
			// the renderer or raw input during shutdown.
			shuttingDown = true;
			restartToken += 1;
			closed = true;
			onClosed();
			if (!notice && nextNotice) notice = nextNotice;
			stopTemporaryInput();
			if (!doneCalled) {
				doneCalled = true;
				try {
					done();
				} catch {
					// Pi is shutting down; completion is best-effort.
				}
			}
			reportNotice();
			return;
		}
		if (closed) {
			if (reason === "session" && tuiStopped && !shuttingDown) {
				restartToken += 1;
				stopTemporaryInput();
				startTui();
			}
			return;
		}
		closed = true;
		if (!notice) {
			if (nextNotice) notice = nextNotice;
			else if (reason === "busy") notice = { message: catalogText(deps.catalog, BUSY_MESSAGE), type: "warning" };
			else if (reason === "failure")
				notice = { message: catalogText(deps.catalog, "jouzu.cli.scrollback.failure"), type: "error" };
		}
		if (reason === "return") {
			// Keep the closed input handler installed until the current StdinBuffer batch unwinds.
			// Restarting synchronously would route the rest of the batch (for example "\rtext\r")
			// through the newly installed TUI handler and leak it into the editor.
			if (!doneCalled) {
				doneCalled = true;
				try {
					done();
				} catch {
					// Pi's completion callback is best-effort here; the terminal restore below matters more.
				}
			}
			if (tuiStopped) {
				try {
					tui.terminal.write("\r\n");
				} catch {
					// Best-effort newline before the TUI takes over again.
				}
				scheduleRestart();
			} else {
				onClosed();
			}
			reportNotice();
			return;
		}
		stopTemporaryInput();
		if (tuiStopped) {
			try {
				tui.terminal.write("\r\n");
			} catch {
				// Best-effort newline before the TUI takes over again.
			}
		}
		if (!doneCalled) {
			doneCalled = true;
			try {
				done();
			} catch {
				// Pi's completion callback is best-effort here; the terminal restore below matters more.
			}
		}
		if (tuiStopped) startTui();
		else onClosed();
		reportNotice();
	};

	const handleInput = (data: string): void => {
		if (closed) return;
		if (isScrollbackReturnKey(data, keybindings)) finish("return");
	};

	const run = async (): Promise<void> => {
		if (closed) return;
		if (sessionBusy(ctx, deps)) {
			finish("busy");
			return;
		}
		let document: ScrollbackTranscript;
		try {
			document = renderScrollbackTranscript(ctx.sessionManager.getBranch(), {
				width: tui.terminal.columns,
				sessionId: ctx.sessionManager.getSessionId(),
				sessionName: ctx.sessionManager.getSessionName(),
				exportedAt: deps.now(),
				catalog: deps.catalog,
			});
		} catch (error) {
			finish("failure", failureNotice(error, deps.catalog));
			return;
		}
		if (closed) return;
		if (sessionBusy(ctx, deps)) {
			finish("busy");
			return;
		}
		try {
			tuiStopped = true;
			// Leave the alternate screen without dumping the renderer's document; the transcript
			// below is the only thing written to the main screen.
			tui.stop({ preserveScreen: true });
			inputStarted = true;
			// The TUI stopped its terminal input parser with tui.stop(). Own a temporary parser
			// while the transcript is on screen, then stop it before tui.start() takes over again.
			tui.terminal.start(handleInput, () => {});
			if (closed) return;
			await writeTranscript(tui.terminal, document.lines, deps, () => closed);
		} catch (error) {
			finish("failure", failureNotice(error, deps.catalog));
		}
	};

	return {
		start() {
			// Let ctx.ui.custom() mount the overlay and finish the factory before the takeover.
			setImmediate(() => {
				void run().catch((error) => finish("failure", failureNotice(error, deps.catalog)));
			});
		},
		handleInput,
		finish,
	};
}

export function createScrollbackExtension(overrides: Partial<ScrollbackDependencies> = {}): InlineExtension {
	const deps = { ...DEFAULT_DEPENDENCIES, ...overrides };
	return {
		name: "jouzu-scrollback",
		factory(pi) {
			let active: ScrollbackExport | undefined;
			const closeActive = (reason: ScrollbackCloseReason) => active?.finish(reason);

			pi.on("session_shutdown", (event) => closeActive(event.reason === "reload" ? "session" : "shutdown"));
			pi.on("session_before_switch", () => closeActive("session"));
			pi.on("session_start", () => closeActive("session"));
			pi.on("agent_start", () => closeActive("agent"));
			pi.on("user_bash", () => closeActive("agent"));

			pi.registerCommand("scrollback", {
				description: "Export the active transcript to the terminal scrollback",
				handler: async (_args, ctx) => {
					const notify = (message: string, type: NoticeType) => {
						try {
							if (ctx.hasUI && typeof ctx.ui.notify === "function") ctx.ui.notify(message, type);
						} catch {
							// Non-interactive or shutting down; there is nowhere to report this.
						}
					};
					if (ctx.mode !== "tui" || !ctx.hasUI) {
						notify(catalogText(deps.catalog, "jouzu.cli.scrollback.interactive"), "warning");
						return;
					}
					if (deps.env.TERM?.toLowerCase() === "dumb") {
						notify(catalogText(deps.catalog, "jouzu.cli.scrollback.dumb"), "warning");
						return;
					}
					if (!deps.isTTY()) {
						notify(catalogText(deps.catalog, "jouzu.cli.scrollback.tty"), "warning");
						return;
					}
					const existing = active;
					if (existing) {
						notify(catalogText(deps.catalog, ALREADY_OPEN_MESSAGE), "warning");
						return;
					}
					if (sessionBusy(ctx, deps)) {
						notify(catalogText(deps.catalog, BUSY_MESSAGE), "warning");
						return;
					}
					try {
						await ctx.ui.custom<void>(
							(tui, _theme, keybindings, done) => {
								if (tui.mode !== "fullscreen") {
									notify(catalogText(deps.catalog, FULLSCREEN_MESSAGE), "warning");
									done();
									return {
										render: () => [],
										invalidate() {},
										handleInput() {},
									};
								}
								const exportSession = createScrollbackExport({
									tui,
									keybindings,
									done,
									ctx,
									deps,
									notify,
									onClosed: () => {
										if (active === exportSession) active = undefined;
									},
								});
								active = exportSession;
								exportSession.start();
								return {
									render: () => [],
									invalidate() {},
									handleInput: (data: string) => exportSession.handleInput(data),
									dispose: () => exportSession.finish("dispose"),
								};
							},
							{ overlay: true },
						);
					} catch (error) {
						const failure = failureNotice(error, deps.catalog);
						if (active) active.finish("failure", failure);
						else notify(failure.message, failure.type);
					}
				},
			});
		},
	};
}
