import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
	stripTerminalSequences as localStripTerminalSequences,
	visibleWidth as localVisibleWidth,
	wrapTextWithAnsi as localWrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	containsCjkText,
	mergeVisibleSpans,
	type ProseWrapMetrics,
	type VisibleSpan,
	wrapProseText,
} from "./prose-wrap.js";

/**
 * Scoped adapter for Pi's Markdown renderer.
 *
 * Pi owns the tokenizer and the block renderer. This module patches
 * `Markdown.prototype.renderToken` for the duration of an operation: paragraph,
 * heading, and text lines are wrapped with the Japanese punctuation-aware
 * wrapper after Pi renders them. Lists and blockquotes recurse through
 * `renderToken` at their reduced width, so their prose is wrapped there too;
 * code blocks, tables, and aggregate list/quote lines are left untouched. A
 * narrow `Markdown.prototype.render` guard invalidates Pi's line cache when the
 * wrapping scope changes; it does not reimplement rendering.
 */

interface MarkdownInstance {
	options?: {
		preserveBackslashEscapes?: boolean;
		renderLatex?: boolean;
	};
	invalidate?: () => void;
}

interface MarkdownToken {
	type?: string;
	text?: string;
	raw?: string;
	href?: string;
	depth?: number;
	tokens?: MarkdownToken[];
	pending?: boolean;
	[key: string]: unknown;
}

interface MarkdownPrototype {
	render?(this: MarkdownInstance, width: number): string[];
	invalidate?(this: MarkdownInstance): void;
	renderToken(
		this: MarkdownInstance,
		token: MarkdownToken,
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	): string[];
}

export interface MarkdownConstructor {
	readonly prototype: MarkdownPrototype;
}

interface TuiModule {
	Markdown?: MarkdownConstructor;
	visibleWidth?: (text: string) => number;
	stripTerminalSequences?: (text: string) => string;
	wrapTextWithAnsi?: (text: string, width: number) => string[];
}

export interface ProseWrappingRuntime {
	/** Inject the Markdown constructor Pi actually uses, when it is not the default resolution. */
	Markdown?: MarkdownConstructor;
	/** Inject width/strip/baseline helpers from the same pi-tui copy. */
	metrics?: ProseWrapMetrics;
	/** Inject the inline-math renderer from the same pi-tui copy. */
	renderLatex?: (source: string) => string | undefined;
}

export interface ResolvedProseWrappingRuntime {
	readonly markdown: MarkdownConstructor;
	readonly metrics: ProseWrapMetrics;
	readonly renderLatex?: (source: string) => string | undefined;
	readonly moduleUrl?: string;
}

const LOCAL_METRICS: ProseWrapMetrics = Object.freeze({
	visibleWidth: localVisibleWidth,
	stripTerminalSequences: localStripTerminalSequences,
	wrapTextWithAnsi: localWrapTextWithAnsi,
});

function metricsFromModule(module: TuiModule): ProseWrapMetrics | undefined {
	const { visibleWidth, stripTerminalSequences, wrapTextWithAnsi } = module;
	if (
		typeof visibleWidth !== "function" ||
		typeof stripTerminalSequences !== "function" ||
		typeof wrapTextWithAnsi !== "function"
	) {
		return undefined;
	}
	return { visibleWidth, stripTerminalSequences, wrapTextWithAnsi };
}

async function loadTuiModule(moduleUrl: string): Promise<TuiModule | undefined> {
	try {
		const module = (await import(moduleUrl)) as TuiModule;
		return typeof module.Markdown === "function" ? module : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Resolve pi-tui from Pi's own entry point first. A packed install can contain a
 * nested pi-tui copy that differs from the one Jouzu imports directly; patching
 * the wrong copy would leave conversation Markdown unchanged.
 */
async function resolvePiTuiModule(): Promise<{ moduleUrl: string; module: TuiModule } | undefined> {
	const candidates: string[] = [];
	try {
		const piUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
		const require = createRequire(piUrl);
		candidates.push(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
	} catch {
		// Fall through to Jouzu's own resolution.
	}
	try {
		candidates.push(import.meta.resolve("@earendil-works/pi-tui"));
	} catch {
		// The injected constructor can still be used without a resolvable module.
	}
	for (const moduleUrl of [...new Set(candidates)]) {
		const module = await loadTuiModule(moduleUrl);
		if (module) return { moduleUrl, module };
	}
	return undefined;
}

async function loadRenderLatex(moduleUrl: string): Promise<((source: string) => string | undefined) | undefined> {
	try {
		const module = (await import(new URL("./latex.js", moduleUrl).href)) as {
			renderLatex?: (source: string) => string | undefined;
		};
		return typeof module.renderLatex === "function" ? module.renderLatex : undefined;
	} catch {
		return undefined;
	}
}

/** Resolve Pi's Markdown constructor and the matching pi-tui helpers. */
export async function resolvePiProseWrappingRuntime(
	runtime: ProseWrappingRuntime = {},
): Promise<ResolvedProseWrappingRuntime> {
	const resolved = await resolvePiTuiModule();
	const markdown = runtime.Markdown ?? resolved?.module.Markdown;
	if (!markdown) throw new Error("Could not resolve Pi's Markdown component for prose wrapping.");
	const metrics = runtime.metrics ?? (resolved ? metricsFromModule(resolved.module) : undefined) ?? LOCAL_METRICS;
	const renderLatex = runtime.renderLatex ?? (resolved ? await loadRenderLatex(resolved.moduleUrl) : undefined);
	return {
		markdown,
		metrics,
		...(renderLatex ? { renderLatex } : {}),
		...(resolved ? { moduleUrl: resolved.moduleUrl } : {}),
	};
}

interface InlineLayout {
	readonly text: string;
	readonly literals: readonly VisibleSpan[];
	readonly complex: boolean;
}

interface LayoutOptions {
	readonly includeLinkUrls: boolean;
	readonly preserveBackslashEscapes: boolean;
	readonly renderLatexEnabled: boolean;
	readonly renderLatex?: (source: string) => string | undefined;
}

interface LayoutVariants {
	readonly needsLayout: boolean;
	readonly variants: readonly InlineLayout[];
}

class LayoutBuilder {
	text = "";
	readonly literals: VisibleSpan[] = [];
	complex = false;

	appendPlain(text: string): void {
		this.text += text;
	}

	appendLiteral(text: string): void {
		const start = this.text.length;
		this.text += text;
		if (this.text.length > start) this.literals.push({ start, end: this.text.length });
	}

	appendChild(child: InlineLayout): void {
		const offset = this.text.length;
		this.text += child.text;
		for (const span of child.literals) {
			this.literals.push({ start: span.start + offset, end: span.end + offset });
		}
		this.complex ||= child.complex;
	}
}

function isUrlLike(text: string): boolean {
	return /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)/iu.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text);
}

function buildInlineLayout(tokens: readonly MarkdownToken[], options: LayoutOptions): InlineLayout {
	const builder = new LayoutBuilder();
	for (const token of tokens) {
		switch (token.type) {
			case "latex": {
				builder.complex = true;
				const rendered =
					!token.pending && options.renderLatexEnabled ? options.renderLatex?.(token.text ?? "") : undefined;
				builder.appendLiteral(rendered ?? token.raw ?? token.text ?? "");
				break;
			}
			case "escape":
				builder.appendPlain(options.preserveBackslashEscapes ? (token.raw ?? "") : (token.text ?? ""));
				break;
			case "text":
				if (token.tokens && token.tokens.length > 0) builder.appendChild(buildInlineLayout(token.tokens, options));
				else builder.appendPlain(token.text ?? "");
				break;
			case "paragraph":
				builder.appendChild(buildInlineLayout(token.tokens ?? [], options));
				break;
			case "strong":
			case "em":
			case "del":
				builder.appendChild(buildInlineLayout(token.tokens ?? [], options));
				break;
			case "codespan":
				builder.complex = true;
				builder.appendLiteral(token.text ?? "");
				break;
			case "link": {
				builder.complex = true;
				const labelStart = builder.text.length;
				builder.appendChild(buildInlineLayout(token.tokens ?? [], options));
				const labelEnd = builder.text.length;
				const text = token.text ?? "";
				const href = token.href ?? "";
				const hrefForComparison = href.startsWith("mailto:") ? href.slice(7) : href;
				if (labelEnd > labelStart && (text === href || text === hrefForComparison || isUrlLike(text))) {
					builder.literals.push({ start: labelStart, end: labelEnd });
				}
				if (options.includeLinkUrls && href && text !== href && text !== hrefForComparison) {
					builder.appendPlain(" (");
					builder.appendLiteral(href);
					builder.appendPlain(")");
				}
				break;
			}
			case "br":
				builder.appendPlain("\n");
				break;
			case "html":
				builder.appendPlain(token.raw ?? "");
				break;
			default:
				if (typeof token.text === "string") builder.appendPlain(token.text);
				break;
		}
	}
	return { text: builder.text, literals: builder.literals, complex: builder.complex };
}

function buildLayoutVariants(
	token: MarkdownToken,
	instance: MarkdownInstance,
	runtime: ResolvedProseWrappingRuntime,
): LayoutVariants {
	const headingPrefix =
		token.type === "heading" && typeof token.depth === "number" && token.depth >= 3
			? `${"#".repeat(token.depth)} `
			: "";
	const options: LayoutOptions = {
		includeLinkUrls: false,
		preserveBackslashEscapes: instance.options?.preserveBackslashEscapes === true,
		renderLatexEnabled: instance.options?.renderLatex !== false,
		...(runtime.renderLatex ? { renderLatex: runtime.renderLatex } : {}),
	};
	const tokens = token.type === "text" ? [token] : (token.tokens ?? []);
	const addHeadingPrefix = (layout: InlineLayout): InlineLayout => {
		if (!headingPrefix) return layout;
		const offset = headingPrefix.length;
		return {
			text: headingPrefix + layout.text,
			literals: layout.literals.map((span) => ({ start: span.start + offset, end: span.end + offset })),
			complex: layout.complex,
		};
	};
	const withoutUrls = addHeadingPrefix(buildInlineLayout(tokens, { ...options, includeLinkUrls: false }));
	if (!withoutUrls.complex) return { needsLayout: false, variants: [] };
	const withUrls = addHeadingPrefix(buildInlineLayout(tokens, { ...options, includeLinkUrls: true }));
	const variants =
		withUrls.text === withoutUrls.text &&
		withUrls.literals.length === withoutUrls.literals.length &&
		withUrls.literals.every(
			(span, index) =>
				span.start === withoutUrls.literals[index]?.start && span.end === withoutUrls.literals[index]?.end,
		)
			? [withoutUrls]
			: [withoutUrls, withUrls];
	return { needsLayout: true, variants };
}

function globalizeSpans(layout: InlineLayout, segments: readonly string[], metrics: ProseWrapMetrics): VisibleSpan[] {
	const layoutLines = layout.text.split("\n");
	const layoutOffsets: number[] = [];
	const layoutEnds: number[] = [];
	let layoutOffset = 0;
	for (const line of layoutLines) {
		layoutOffsets.push(layoutOffset);
		layoutEnds.push(layoutOffset + line.length);
		layoutOffset += line.length + 1;
	}
	const actualOffsets: number[] = [];
	let actualOffset = 0;
	for (let index = 0; index < layoutLines.length; index++) {
		actualOffsets.push(actualOffset);
		actualOffset += metrics.stripTerminalSequences(segments[index] ?? "").length + 1;
	}

	const spans: VisibleSpan[] = [];
	let lineIndex = 0;
	for (const span of mergeVisibleSpans(layout.literals)) {
		while (lineIndex < layoutLines.length && (layoutEnds[lineIndex] ?? 0) <= span.start) lineIndex++;
		for (let index = lineIndex; index < layoutLines.length; index++) {
			const lineStart = layoutOffsets[index] ?? 0;
			if (lineStart >= span.end) break;
			const lineEnd = layoutEnds[index] ?? lineStart;
			const start = Math.max(span.start, lineStart);
			const end = Math.min(span.end, lineEnd);
			if (end > start) {
				const actualStart = actualOffsets[index] ?? 0;
				spans.push({ start: actualStart + start - lineStart, end: actualStart + end - lineStart });
			}
		}
	}
	return spans;
}

function selectLayout(
	variants: readonly InlineLayout[],
	segments: readonly string[],
	metrics: ProseWrapMetrics,
): InlineLayout | undefined {
	for (const variant of variants) {
		const layoutLines = variant.text.split("\n");
		if (layoutLines.length > segments.length) continue;
		let matches = true;
		for (let index = 0; index < layoutLines.length; index++) {
			if (metrics.stripTerminalSequences(segments[index] ?? "") !== layoutLines[index]) {
				matches = false;
				break;
			}
		}
		if (!matches) continue;
		for (let index = layoutLines.length; index < segments.length; index++) {
			if (metrics.stripTerminalSequences(segments[index] ?? "") !== "") {
				matches = false;
				break;
			}
		}
		if (matches) return variant;
	}
	return undefined;
}

function wrapProseEntry(entry: string, width: number, variants: LayoutVariants, metrics: ProseWrapMetrics): string[] {
	const normalized = entry.replace(/\r\n?/gu, "\n");
	if (!containsCjkText(normalized, metrics)) return metrics.wrapTextWithAnsi(normalized, width);
	if (!variants.needsLayout) return wrapProseText(normalized, width, [], metrics);
	const segments = normalized.split("\n");
	const selected = selectLayout(variants.variants, segments, metrics);
	if (!selected) return metrics.wrapTextWithAnsi(normalized, width);
	const spans = globalizeSpans(selected, segments, metrics);
	return wrapProseText(normalized, width, spans, metrics);
}

function wrapRenderedToken(
	instance: MarkdownInstance,
	token: MarkdownToken,
	lines: readonly string[],
	width: number,
	runtime: ResolvedProseWrappingRuntime,
): string[] {
	if (token.type !== "paragraph" && token.type !== "heading" && token.type !== "text") return [...lines];
	if (!lines.some((line) => containsCjkText(line, runtime.metrics))) return [...lines];
	const variants = buildLayoutVariants(token, instance, runtime);
	const wrapped: string[] = [];
	for (const line of lines) {
		if (!containsCjkText(line, runtime.metrics)) {
			wrapped.push(line);
			continue;
		}
		wrapped.push(...wrapProseEntry(line, width, variants, runtime.metrics));
	}
	return wrapped;
}

type Render = NonNullable<MarkdownPrototype["render"]>;

interface RenderCacheInstallation {
	readonly original: Render;
	readonly wrapper: Render;
	count: number;
	readonly instances: Set<WeakRef<MarkdownInstance>>;
	readonly seen: WeakSet<MarkdownInstance>;
	additions: number;
}

const RENDER_INSTANCE_PRUNE_INTERVAL = 64;
const renderCacheInstallations = new WeakMap<MarkdownPrototype, RenderCacheInstallation>();
const instanceEpochs = new WeakMap<MarkdownInstance, number>();
let cacheEpoch = 0;

/** Drop dead weak references so a long session does not retain one entry per rendered message. */
function pruneDeadRenderInstances(installation: RenderCacheInstallation): void {
	for (const reference of installation.instances) {
		if (!reference.deref()) installation.instances.delete(reference);
	}
}

function invalidateInstance(instance: MarkdownInstance): void {
	try {
		if (typeof instance.invalidate === "function") instance.invalidate();
	} catch {
		// Cache invalidation is best-effort; never let restore mask the operation result.
	} finally {
		instanceEpochs.delete(instance);
	}
}

function invalidateRenderInstallation(installation: RenderCacheInstallation): void {
	for (const reference of installation.instances) {
		const instance = reference.deref();
		if (instance) invalidateInstance(instance);
	}
	installation.instances.clear();
}

/**
 * Guard Pi's cached Markdown output across scope changes. `render()` can return
 * cached lines without calling `renderToken`, so a narrow render wrapper
 * invalidates an instance's cache when the active scope epoch changes. On final
 * restore, tracked instances are invalidated so scoped output cannot leak into
 * the restored renderer. This does not copy Pi's renderer.
 */
function installRenderCacheGuard(prototype: MarkdownPrototype): (() => void) | undefined {
	const render = prototype.render;
	if (typeof render !== "function" || typeof prototype.invalidate !== "function") return undefined;
	cacheEpoch++;

	let installation = renderCacheInstallations.get(prototype);
	if (installation && prototype.render !== installation.wrapper) {
		invalidateRenderInstallation(installation);
		renderCacheInstallations.delete(prototype);
		installation = undefined;
	}
	if (!installation) {
		let created: RenderCacheInstallation | undefined;
		const wrapper: Render = function (this: MarkdownInstance, width: number): string[] {
			if (!created) return render.call(this, width);
			if (instanceEpochs.get(this) !== cacheEpoch) {
				if (typeof this.invalidate === "function") this.invalidate();
				instanceEpochs.set(this, cacheEpoch);
			}
			const result = created.original.call(this, width);
			if (!created.seen.has(this)) {
				created.seen.add(this);
				created.instances.add(new WeakRef(this));
				created.additions++;
				if (created.additions >= Math.max(RENDER_INSTANCE_PRUNE_INTERVAL, created.instances.size / 2)) {
					created.additions = 0;
					pruneDeadRenderInstances(created);
				}
			}
			return result;
		};
		created = {
			original: render,
			wrapper,
			count: 1,
			instances: new Set(),
			seen: new WeakSet(),
			additions: 0,
		};
		prototype.render = wrapper;
		renderCacheInstallations.set(prototype, created);
		installation = created;
	} else {
		installation.count++;
	}

	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		const current = renderCacheInstallations.get(prototype);
		if (!current || current !== installation) {
			invalidateRenderInstallation(installation);
			return;
		}
		if (prototype.render !== current.wrapper) {
			invalidateRenderInstallation(current);
			renderCacheInstallations.delete(prototype);
			return;
		}
		current.count--;
		cacheEpoch++;
		if (current.count > 0) return;
		prototype.render = current.original;
		invalidateRenderInstallation(current);
		renderCacheInstallations.delete(prototype);
	};
}

type RenderToken = MarkdownPrototype["renderToken"];

interface Installation {
	readonly original: RenderToken;
	readonly wrapper: RenderToken;
	count: number;
}

const installations = new WeakMap<MarkdownPrototype, Installation>();

/**
 * Install the prose wrapper on one Markdown prototype and return an idempotent
 * restore function. Nested installs share one wrapper; restoration only removes
 * the wrapper while this installation still owns `renderToken`.
 */
export function installPiProseWrapping(runtime: ResolvedProseWrappingRuntime): () => void {
	const prototype = runtime.markdown.prototype;
	if (typeof prototype.renderToken !== "function") {
		throw new Error("Pi's Markdown prototype has no renderToken method.");
	}
	let installation = installations.get(prototype);
	if (installation && prototype.renderToken !== installation.wrapper) {
		installations.delete(prototype);
		installation = undefined;
	}
	if (!installation) {
		const original = prototype.renderToken;
		const wrapper: RenderToken = function (
			this: MarkdownInstance,
			token: MarkdownToken,
			width: number,
			nextTokenType?: string,
			styleContext?: unknown,
		): string[] {
			const lines = original.call(this, token, width, nextTokenType, styleContext);
			return wrapRenderedToken(this, token, lines, width, runtime);
		};
		prototype.renderToken = wrapper;
		installation = { original, wrapper, count: 1 };
		installations.set(prototype, installation);
	} else {
		installation.count++;
	}
	const owner = installation;
	let restoredToken = false;
	const restoreToken = () => {
		if (restoredToken) return;
		restoredToken = true;
		const current = installations.get(prototype);
		if (!current || current !== owner) return;
		current.count--;
		if (current.count > 0) return;
		if (prototype.renderToken === current.wrapper) prototype.renderToken = current.original;
		installations.delete(prototype);
	};

	let restoreRender: (() => void) | undefined;
	try {
		restoreRender = installRenderCacheGuard(prototype);
	} catch (error) {
		restoreToken();
		throw error;
	}
	let restored = false;
	return () => {
		if (restored) return;
		restored = true;
		try {
			restoreRender?.();
		} finally {
			restoreToken();
		}
	};
}

/**
 * Run `operation` with Japanese punctuation-aware wrapping for Pi conversation
 * Markdown, then restore the original renderer.
 */
export async function withPiProseWrapping<T>(
	operation: () => Promise<T> | T,
	runtime: ProseWrappingRuntime = {},
): Promise<T> {
	let restore: (() => void) | undefined;
	try {
		const resolved = await resolvePiProseWrappingRuntime(runtime);
		restore = installPiProseWrapping(resolved);
	} catch {
		// This is a cosmetic wrapper; an unavailable runtime must not stop Pi from starting.
		return operation();
	}
	try {
		return await operation();
	} finally {
		restore?.();
	}
}
