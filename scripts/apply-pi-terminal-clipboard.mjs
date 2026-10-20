#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { additionSource, additions, paths, transform } from "../upstream/pi-terminal-clipboard/patch.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = "upstream/pi-terminal-clipboard/patch.lock.json";
const sha = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Apply the pinned tmux clipboard forwarding patch. The manifest and every installed
 * input are checked before any dependency file is changed.
 */
export async function applyTerminalClipboard(packageRoot, options = {}) {
	const settings = typeof options === "boolean" ? { checkOnly: options } : options;
	const checkOnly = settings.checkOnly === true;
	const manifest = await readFile(join(root, manifestPath), "utf8");
	const lock = JSON.parse(manifest);
	const pin = JSON.parse(await readFile(join(root, "upstream/pi.lock.json"), "utf8"));
	const records = pin.deviations?.filter((record) => record.path === manifestPath) ?? [];
	if (records.length !== 1 || records[0].sha256 !== sha(manifest))
		throw new Error("Pi terminal-clipboard manifest does not match the pinned deviation");
	if (
		lock.schemaVersion !== 1 ||
		lock.package !== "@earendil-works/pi-coding-agent" ||
		lock.version !== pin.packages[lock.package]?.version
	)
		throw new Error("Pi terminal-clipboard lock identity mismatch");
	const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (pkg.name !== lock.package || pkg.version !== lock.version)
		throw new Error("Pi terminal-clipboard package identity mismatch");
	if (JSON.stringify(Object.keys(lock.files).sort()) !== JSON.stringify([...paths].sort()))
		throw new Error("Pi terminal-clipboard path manifest mismatch");
	if (JSON.stringify(Object.keys(lock.additions).sort()) !== JSON.stringify(Object.keys(additions).sort()))
		throw new Error("Pi terminal-clipboard addition manifest mismatch");
	const writes = [];
	for (const path of paths) {
		const original = await readFile(join(packageRoot, path), "utf8");
		const hashes = lock.files[path];
		if (sha(original) === hashes.after) continue;
		if (checkOnly || sha(original) !== hashes.before) throw new Error(`Pi terminal-clipboard hash mismatch: ${path}`);
		const patched = transform(path, original);
		if (sha(patched) !== hashes.after) throw new Error(`Pi terminal-clipboard transformed hash mismatch: ${path}`);
		writes.push([join(packageRoot, path), patched]);
	}
	for (const [path, sourceName] of Object.entries(additions)) {
		const source = additionSource(sourceName);
		const hashes = lock.additions[path];
		if (sha(source) !== hashes.sha256) throw new Error(`Pi terminal-clipboard source hash mismatch: ${sourceName}`);
		const target = join(packageRoot, path);
		const existing = await readFile(target, "utf8").catch((error) => {
			if (error.code === "ENOENT") return undefined;
			throw error;
		});
		if (existing === source) continue;
		if (checkOnly || existing !== undefined) throw new Error(`Pi terminal-clipboard installed hash mismatch: ${path}`);
		writes.push([target, source]);
	}
	// Verify every input and output before changing any installed dependency file.
	for (const [path, text] of writes) await writeFile(path, text);
	return writes.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const roots = new Set();
	for (const base of [root, join(root, "packages/cli")]) {
		try {
			roots.add(await realpath(join(base, "node_modules/@earendil-works/pi-coding-agent")));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	if (roots.size === 0) throw new Error("Pi package is missing; run npm ci first");
	let count = 0;
	for (const packageRoot of roots) {
		count += await applyTerminalClipboard(packageRoot, { checkOnly: process.argv.includes("--check") });
	}
	console.log(`Pi terminal-clipboard patch verified (${roots.size} package trees, ${count} files written)`);
}
