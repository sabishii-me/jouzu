import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transforms } from "./vcc-goals-transform.mjs";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
export async function applyVccGoals(packageRoot, checkOnly = false) {
	const manifest = await readFile(join(root, "upstream/vcc-goals/patch.lock.json"), "utf8");
	const lock = JSON.parse(manifest);
	const pin = JSON.parse(await readFile(join(root, "upstream/pi.lock.json"), "utf8"));
	if (
		pin.deviations.filter((item) => item.path === "upstream/vcc-goals/patch.lock.json" && item.sha256 === sha(manifest))
			.length !== 1
	)
		throw new Error("VCC goal patch manifest differs from its pinned deviation.");
	const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (lock.schemaVersion !== 1 || pkg.name !== lock.package || pkg.version !== lock.version)
		throw new Error("VCC goal patch package identity differs.");
	const writes = [];
	for (const [path, transform] of Object.entries(transforms)) {
		const source = await readFile(join(packageRoot, path), "utf8");
		if (sha(source) === lock.files[path].after) continue;
		if (checkOnly || sha(source) !== lock.files[path].before)
			throw new Error(`VCC goal patch source hash differs: ${path}`);
		const changed = transform(source);
		if (sha(changed) !== lock.files[path].after) throw new Error(`VCC goal patch transform differs: ${path}`);
		writes.push([join(packageRoot, path), changed]);
	}
	const runtime = await readFile(join(root, "upstream/vcc-goals/runtime.ts"), "utf8");
	if (sha(runtime) !== lock.runtime) throw new Error("VCC goal runtime hash differs.");
	const destination = join(packageRoot, "src/core/jouzu-goals.ts");
	const installed = await readFile(destination, "utf8").catch((error) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	if (installed !== runtime) {
		if (checkOnly || installed !== undefined) throw new Error("VCC installed goal runtime differs.");
		writes.push([destination, runtime]);
	}
	for (const [path, content] of writes) await writeFile(path, content);
	return writes.length;
}
export async function applyInstalledVccGoals(checkOnly = false) {
	const roots = new Set();
	for (const path of ["node_modules", "packages/cli/node_modules"]) {
		try {
			roots.add(await realpath(join(root, path, "@sting8k/pi-vcc")));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	if (!roots.size) throw new Error("VCC package is not installed.");
	let writes = 0;
	for (const packageRoot of roots) writes += await applyVccGoals(packageRoot, checkOnly);
	return writes;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
	await applyInstalledVccGoals(process.argv.includes("--check"));
