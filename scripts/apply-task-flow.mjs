import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reconnectTaskFlowOnTree, transformTaskFlow } from "./task-flow-transform.mjs";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
export async function applyTaskFlow(packageRoot, checkOnly = false) {
	const manifest = await readFile(join(root, "upstream/task-flow/patch.lock.json"), "utf8");
	const lock = JSON.parse(manifest);
	const pin = JSON.parse(await readFile(join(root, "upstream/pi.lock.json"), "utf8"));
	if (
		pin.deviations.filter((item) => item.path === "upstream/task-flow/patch.lock.json" && item.sha256 === sha(manifest))
			.length !== 1
	)
		throw new Error("Task flow manifest differs from its pinned deviation.");
	const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
	if (lock.schemaVersion !== 1 || pkg.name !== lock.package || pkg.version !== lock.version)
		throw new Error("Task flow package identity differs.");
	const path = join(packageRoot, "src/index.ts");
	const original = await readFile(path, "utf8");
	const writes = [];
	if (sha(original) !== lock.after) {
		const digest = sha(original);
		if (checkOnly || (digest !== lock.before && digest !== lock.previousAfter))
			throw new Error("Task flow source hash differs.");
		const changed = digest === lock.before ? transformTaskFlow(original) : reconnectTaskFlowOnTree(original);
		if (sha(changed) !== lock.after) throw new Error("Task flow transform differs.");
		writes.push([path, changed]);
	}
	const runtime = await readFile(join(root, "upstream/task-flow/runtime.ts"), "utf8");
	if (sha(runtime) !== lock.runtime) throw new Error("Task flow runtime hash differs.");
	const destination = join(packageRoot, "src/jouzu-flow.ts");
	const installed = await readFile(destination, "utf8").catch((error) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	if (installed !== runtime) {
		if (checkOnly || (installed !== undefined && sha(installed) !== lock.previousRuntime))
			throw new Error("Installed task flow runtime differs.");
		writes.push([destination, runtime]);
	}
	for (const [path, content] of writes) await writeFile(path, content);
	return writes.length;
}
export async function applyInstalledTaskFlow(checkOnly = false) {
	return applyTaskFlow(await realpath(join(root, "packages/cli/node_modules/@lhl/pi-tasks")), checkOnly);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
	await applyInstalledTaskFlow(process.argv.includes("--check"));
