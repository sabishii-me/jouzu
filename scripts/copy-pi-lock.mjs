#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "upstream", "pi.lock.json");
const destination = resolve(process.cwd(), process.argv[2] ?? "dist/pi.lock.json");
const packageName = "@earendil-works/pi-coding-agent";
const serverPackageName = "@earendil-works/pi-server";
const directRuntimePackageNames = [
	"@earendil-works/pi-ai",
	packageName,
	serverPackageName,
	"@earendil-works/pi-telemetry",
	"@earendil-works/pi-tui",
];
const lock = JSON.parse(readFileSync(source, "utf8"));
const cliPackage = JSON.parse(readFileSync(resolve(root, "packages", "cli", "package.json"), "utf8"));
const version = lock.packages?.[packageName]?.version;
const serverVersion = lock.packages?.[serverPackageName]?.version;

if (!version) throw new Error(`${source} is missing ${packageName}`);
if (!serverVersion) throw new Error(`${source} is missing ${serverPackageName}`);
if (directRuntimePackageNames.some((name) => cliPackage.dependencies?.[name] !== version)) {
	throw new Error(`jouzu runtime dependencies do not match the exact Pi lock tuple ${version}`);
}
if (serverVersion !== version || cliPackage.bundleDependencies?.includes(serverPackageName)) {
	throw new Error(`jouzu runtime does not install Pi server lock ${serverVersion} as an external exact dependency`);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`copied Pi ${version} lock to ${destination}`);

// Runtime diagnostics reuse the same expected bytes as the build patch checks.
const taskPatch = JSON.parse(readFileSync(resolve(root, "upstream/task-flow/patch.lock.json"), "utf8"));
const backgroundPatch = JSON.parse(readFileSync(resolve(root, "upstream/background-flow/patch.lock.json"), "utf8"));
const loopPatch = JSON.parse(readFileSync(resolve(root, "upstream/multiloop-wait-skill/patch.lock.json"), "utf8"));
const patches = [
	{ package: taskPatch.package, files: { "src/index.ts": taskPatch.after, "src/jouzu-flow.ts": taskPatch.runtime } },
	{
		package: backgroundPatch.package,
		files: {
			...Object.fromEntries(Object.entries(backgroundPatch.files).map(([path, hashes]) => [path, hashes.after])),
			"extensions/jouzu-flow.ts": backgroundPatch.runtime,
		},
	},
	{
		package: loopPatch.package,
		files: {
			[loopPatch.extension.path]: loopPatch.extension.after,
			"extensions/pi-multiloop/jouzu-flow.ts": loopPatch.runtime,
		},
	},
];
writeFileSync(resolve(dirname(destination), "flow-patches.json"), `${JSON.stringify(patches, null, 2)}\n`);
