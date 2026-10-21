#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const SIDECAR_NAME = "jouzu-diagnostics.cjs";
// Keep the sidecar under dist/ so Defuddle's package "files" list ships it.
const MARKER_START = "/* jouzu-defuddle-diagnostics:start */";
const MARKER_END = "/* jouzu-defuddle-diagnostics:end */";
const CONSOLE_USAGE = /\bconsole\s*(?:\??\.|\[)/;
const LOCAL_CONSOLE_DECLARATION = /(?:^|[;{}\n])[ \t]*(?:const|let|var|function|class)[ \t]+console\b/;
const REQUIRED_LAYOUT_FILES = ["defuddle.js", "metadata.js", "extractor-registry.js"];
// cli.js prints the command's result, not a diagnostic. It is the package's bin
// entry, not part of the runtime module tree loaded by pi-webaio.
const NON_RUNTIME_FILES = new Set(["cli.js"]);
const MAX_DIAGNOSTICS = 50;
const MAX_MESSAGE_LENGTH = 500;

const SIDECAR_SOURCE = `"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { formatWithOptions, types } = require("node:util");

const MAX_DIAGNOSTICS = ${MAX_DIAGNOSTICS};
const MAX_MESSAGE_LENGTH = ${MAX_MESSAGE_LENGTH};
// inspect-based formatting keeps this sidecar small. customInspect and getters
// stay disabled so a logged object cannot execute page-controlled code. Strings
// remain unbounded until the final bound so sanitization sees whole values.
const FORMAT_OPTIONS = {
	breakLength: Infinity,
	colors: false,
	compact: true,
	customInspect: false,
	depth: 2,
	getters: false,
	maxArrayLength: 50,
	maxStringLength: Infinity,
	showHidden: false,
};

const storage = new AsyncLocalStorage();
const CONTROL_CHARACTERS = /[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u2028\\u2029]/g;

function escapeTerminalControls(text) {
	return text
		.replace(/\\r/g, "\\\\r")
		.replace(/\\n/g, "\\\\n")
		.replace(/\\t/g, "\\\\t")
		.replace(CONTROL_CHARACTERS, (character) => {
			const code = character.charCodeAt(0);
			return code <= 0xff
				? \`\\\\x\${code.toString(16).padStart(2, "0")}\`
				: \`\\\\u\${code.toString(16).padStart(4, "0")}\`;
		});
}

function boundedText(text) {
	const escaped = escapeTerminalControls(text);
	if (escaped.length <= MAX_MESSAGE_LENGTH) return escaped;
	return \`\${escaped.slice(0, MAX_MESSAGE_LENGTH - 3)}...\`;
}

function dataProperty(object, key) {
	try {
		for (let current = object; current; current = Object.getPrototypeOf(current)) {
			const descriptor = Object.getOwnPropertyDescriptor(current, key);
			if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function isError(value) {
	try {
		return value instanceof Error || types.isNativeError(value);
	} catch {
		return false;
	}
}

function normalizedValue(value, seen = new Set(), depth = 0) {
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[Circular]";
	if (depth > 3) return "[Object]";
	if (isError(value)) return errorSummary(value, seen, depth);
	seen.add(value);
	try {
		const copy = Array.isArray(value) ? [] : {};
		for (const key of Object.keys(value).slice(0, 50)) {
			if (key === "stack") continue;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			Object.defineProperty(copy, key, {
				value: descriptor && "value" in descriptor ? normalizedValue(descriptor.value, seen, depth + 1) : "[Getter]",
				enumerable: true,
			});
		}
		return copy;
	} finally {
		seen.delete(value);
	}
}

function formatNested(value, seen, depth) {
	return formatWithOptions(FORMAT_OPTIONS, normalizedValue(value, seen, depth));
}

// Summarize errors instead of inspecting their stacks. name/message/code/input
// are read as data properties so an error getter cannot run.
function errorSummary(error, seen, depth) {
	if (seen.has(error)) return "[Circular]";
	seen.add(error);
	try {
		const nameValue = dataProperty(error, "name");
		const message = dataProperty(error, "message");
		const code = dataProperty(error, "code");
		const input = dataProperty(error, "input");
		const name = typeof nameValue === "string" && nameValue ? nameValue : "Error";
		const parts = [typeof message === "string" && message ? \`\${name}: \${message}\` : name];
		if (code !== undefined) parts.push(\`(code: \${formatNested(code, seen, depth + 1)})\`);
		if (input !== undefined) parts.push(\`(input: \${formatNested(input, seen, depth + 1)})\`);
		return parts.join(" ");
	} finally {
		seen.delete(error);
	}
}

function formatArguments(args) {
	const seen = new Set();
	const normalized = args.map((value) => normalizedValue(value, seen));
	return formatWithOptions(FORMAT_OPTIONS, ...normalized);
}

function record(level, args) {
	const store = storage.getStore();
	if (!store || !store.active) return;
	try {
		if (store.diagnostics.length >= MAX_DIAGNOSTICS) {
			store.omitted += 1;
			return;
		}
		const raw = formatArguments(args);
		let sanitized;
		try {
			sanitized = store.sanitize(raw);
		} catch {
			sanitized = "[unredacted diagnostic omitted]";
		}
		// Sanitize the whole message first; escape controls and truncate after.
		const message = typeof sanitized === "string" ? boundedText(sanitized) : "[invalid sanitized diagnostic]";
		store.diagnostics.push({ level, message });
	} catch {
		if (store.diagnostics.length < MAX_DIAGNOSTICS) {
			store.diagnostics.push({ level, message: "[unformattable diagnostic]" });
		} else {
			store.omitted += 1;
		}
	}
}

// Keep the object console-compatible so an unexpected Defuddle console call
// cannot fall through to the process console.
const quietConsole = Object.freeze({
	log: (...args) => record("log", args),
	info: (...args) => record("info", args),
	warn: (...args) => record("warn", args),
	error: (...args) => record("error", args),
	debug: (...args) => record("debug", args),
	trace: (...args) => record("trace", args),
	dir: (...args) => record("log", args),
	dirxml: (...args) => record("log", args),
	table: (...args) => record("log", args),
	assert: (condition, ...args) => {
		if (!condition) record("error", args.length > 0 ? ["Assertion failed:", ...args] : ["Assertion failed"]);
	},
	group: () => {},
	groupCollapsed: () => {},
	groupEnd: () => {},
	time: () => {},
	timeEnd: () => {},
	timeLog: () => {},
	count: () => {},
	countReset: () => {},
	clear: () => {},
	profile: () => {},
	profileEnd: () => {},
	timeStamp: () => {},
});

function capture(callback, sanitize = (value) => value) {
	if (typeof callback !== "function") {
		return Promise.reject(new TypeError("capture(callback, sanitize) requires a callback function"));
	}
	if (typeof sanitize !== "function") {
		return Promise.reject(new TypeError("capture(callback, sanitize) requires sanitize to be a function"));
	}
	const store = { diagnostics: [], omitted: 0, active: true, sanitize };
	return storage.run(store, async () => {
		try {
			const value = await callback();
			return { value, diagnostics: store.diagnostics, omitted: store.omitted };
		} finally {
			store.active = false;
		}
	});
}

module.exports = {
	capture,
	console: quietConsole,
	MAX_DIAGNOSTICS,
	MAX_MESSAGE_LENGTH,
};
`;

function resolveDefuddleLayout(webaioRoot) {
	const manifestPath = resolve(webaioRoot, "package.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`pi-webaio root is missing package.json: ${manifestPath}`);
	}
	const require = createRequire(realpathSync(manifestPath));
	let entry;
	try {
		entry = require.resolve("defuddle");
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`cannot resolve Defuddle from ${webaioRoot}: ${reason}`);
	}
	const realEntry = realpathSync(entry);
	const distRoot = dirname(realEntry);
	if (basename(distRoot) !== "dist") {
		throw new Error(`Defuddle package layout changed: expected the package entry under dist/, found ${realEntry}`);
	}
	const defuddleManifestPath = join(dirname(distRoot), "package.json");
	if (!existsSync(defuddleManifestPath)) {
		throw new Error(`Defuddle package layout changed: missing ${defuddleManifestPath}`);
	}
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(defuddleManifestPath, "utf8"));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Defuddle package layout changed: cannot read ${defuddleManifestPath}: ${reason}`);
	}
	if (manifest.name !== "defuddle") {
		throw new Error(`Defuddle package layout changed: ${defuddleManifestPath} names ${manifest.name ?? "no package"}`);
	}
	if (manifest.type === "module") {
		throw new Error("Defuddle package layout changed: dist modules are ESM, not CommonJS");
	}
	return distRoot;
}

/**
 * Resolve the Defuddle runtime entry that pi-webaio loads. Kept for callers
 * that only need the path; the installer below resolves the whole dist tree.
 */
export function resolveDefuddleSource(webaioRoot) {
	return join(resolveDefuddleLayout(webaioRoot), "defuddle.js");
}

function listJavaScriptFiles(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.c?js$/.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

const DIRECTIVE_PREFIX =
	/^(?:(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)|(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')[ \t]*(?:;|(?=\r?\n|$)))*/;

function insertionIndex(source) {
	let index = source.startsWith("\uFEFF") ? 1 : 0;
	if (source.startsWith("#!", index)) {
		const newline = source.indexOf("\n", index);
		if (newline === -1) throw new Error("module has a shebang without a newline");
		index = newline + 1;
	}
	return index + DIRECTIVE_PREFIX.exec(source.slice(index))[0].length;
}

function injectionBlock(requirePath) {
	return `${MARKER_START}\nconst console = require(${JSON.stringify(requirePath)}).console;\n${MARKER_END}`;
}

function markerRange(source, filePath) {
	const starts = source.split(MARKER_START).length - 1;
	const ends = source.split(MARKER_END).length - 1;
	if (starts === 0 && ends === 0) return undefined;
	if (starts !== 1 || ends !== 1) {
		throw new Error(`Defuddle package layout changed: ${filePath} has ${starts} start and ${ends} end markers`);
	}
	const start = source.indexOf(MARKER_START);
	const end = source.indexOf(MARKER_END);
	if (end < start) {
		throw new Error(`Defuddle package layout changed: ${filePath} has its diagnostics end marker before its start`);
	}
	return { start, end: end + MARKER_END.length };
}

function applyInjection(source, filePath, block) {
	const range = markerRange(source, filePath);
	if (range) return `${source.slice(0, range.start)}${block}${source.slice(range.end)}`;
	let index;
	try {
		index = insertionIndex(source);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`Defuddle package layout changed: cannot patch ${filePath}: ${reason}`);
	}
	const prefix = source.slice(0, index);
	const suffix = source.slice(index);
	const separator = prefix.length === 0 || prefix.endsWith("\n") ? "" : "\n";
	const trailing = suffix.startsWith("\n") ? "" : "\n";
	return `${prefix}${separator}${block}${trailing}${suffix}`;
}

function removeInjection(source, filePath) {
	const range = markerRange(source, filePath);
	if (!range) return source;
	let start = range.start;
	if (source[start - 1] === "\n") start -= 1;
	if (source[start - 1] === "\r") start -= 1;
	return `${source.slice(0, start)}${source.slice(range.end)}`;
}

function withoutInjection(source, range) {
	return range ? `${source.slice(0, range.start)}${source.slice(range.end)}` : source;
}

function requirePathFor(filePath, sidecarPath) {
	const path = relative(dirname(filePath), sidecarPath).split(sep).join("/");
	return path.startsWith("../") ? path : `./${path}`;
}

function readOptional(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
}

/**
 * Install one module-local console binding in every CommonJS runtime module
 * under Defuddle's dist tree. The binding delegates to a generated sidecar
 * backed by AsyncLocalStorage, so each pi-webaio fetchPage call can capture
 * Defuddle diagnostics without replacing the process-wide console.
 *
 * `patchedFiles` is stable across repeated applications: it lists every module
 * that currently carries the binding, not only the modules rewritten by this
 * call.
 */
export function applyInstalledDefuddleDiagnostics(webaioRoot) {
	const distRoot = resolveDefuddleLayout(webaioRoot);
	for (const name of REQUIRED_LAYOUT_FILES) {
		const path = join(distRoot, name);
		if (!existsSync(path)) {
			throw new Error(`Defuddle package layout changed: missing ${path}`);
		}
	}
	const files = listJavaScriptFiles(distRoot);
	if (files.length === 0) throw new Error(`Defuddle package layout changed: no JavaScript modules in ${distRoot}`);

	const sidecarPath = join(distRoot, SIDECAR_NAME);
	const writes = [];
	if (readOptional(sidecarPath) !== SIDECAR_SOURCE) writes.push([sidecarPath, SIDECAR_SOURCE]);
	const patchedFiles = [];

	for (const filePath of files) {
		const relativeName = relative(distRoot, filePath).split(sep).join("/");
		if (relativeName === SIDECAR_NAME) continue;
		const source = readFileSync(filePath, "utf8");
		const range = markerRange(source, filePath);
		const hasMarker = range !== undefined;
		if (NON_RUNTIME_FILES.has(relativeName) || !CONSOLE_USAGE.test(source)) {
			if (hasMarker) {
				const updated = removeInjection(source, filePath);
				if (updated !== source) writes.push([filePath, updated]);
			}
			continue;
		}
		if (LOCAL_CONSOLE_DECLARATION.test(withoutInjection(source, range))) {
			throw new Error(`Defuddle package layout changed: ${relativeName} already declares a console binding`);
		}
		const block = injectionBlock(requirePathFor(filePath, sidecarPath));
		const updated = applyInjection(source, filePath, block);
		if (updated !== source) writes.push([filePath, updated]);
		patchedFiles.push(filePath);
	}

	if (patchedFiles.length === 0) {
		throw new Error(`Defuddle package layout changed: no console usage found under ${distRoot}`);
	}
	for (const [path, content] of writes) writeFileSync(path, content);

	if (readFileSync(sidecarPath, "utf8") !== SIDECAR_SOURCE) {
		throw new Error(`Defuddle diagnostics sidecar was not written: ${sidecarPath}`);
	}
	for (const filePath of patchedFiles) {
		const source = readFileSync(filePath, "utf8");
		const block = injectionBlock(requirePathFor(filePath, sidecarPath));
		if (!source.includes(block)) {
			throw new Error(`Defuddle diagnostics binding was not written: ${filePath}`);
		}
	}
	return { helperPath: sidecarPath, patchedFiles: patchedFiles.sort() };
}
