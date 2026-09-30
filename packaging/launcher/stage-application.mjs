import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function inside(parent, child) {
	const path = relative(parent, child);
	return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function inventory(directory) {
	const root = resolve(directory);
	const files = [];
	function walk(path) {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error(`Linked entries are not supported: ${relative(root, path)}`);
		if (stat.isDirectory()) {
			for (const entry of readdirSync(path).sort()) walk(join(path, entry));
		} else if (stat.isFile()) {
			files.push({ path: relative(root, path).split(sep).join("/"), bytes: stat.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
		} else throw new Error(`Unsupported filesystem entry: ${relative(root, path)}`);
	}
	walk(root);
	const hashes = new Map();
	const packages = new Map();
	for (const file of files) {
		const group = hashes.get(file.sha256) ?? [];
		group.push(file);
		hashes.set(file.sha256, group);
		// Attribute each file to the closest enclosing package, avoiding double counting nested dependencies.
		const matches = [...file.path.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
		const match = matches.at(-1);
		if (match) {
			const end = match.index + match[0].length;
			const tree = file.path.slice(0, end);
			packages.set(tree, (packages.get(tree) ?? 0) + file.bytes);
		}
	}
	return {
		fileCount: files.length,
		unpackedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
		files,
		duplicates: [...hashes.values()].filter(group => group.length > 1 && group[0].bytes > 0).map(group => ({ sha256: group[0].sha256, bytesPerCopy: group[0].bytes, redundantBytes: group[0].bytes * (group.length - 1), paths: group.map(file => file.path) })),
		largestPackageTrees: [...packages].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 30),
	};
}

// Input is a prepared npm prefix containing node_modules/jouzu, NOT an npm tarball.
// This does not run npm, execute package scripts, or certify native compatibility.
export function stageApplication({ source, output, target, sourceCommit }) {
	if (!/^(windows|macos|linux)-(x64|arm64)$/.test(target)) throw new Error("Unsupported target");
	if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Expected full source commit");
	const input = realpathSync(source);
	const destination = resolve(output);
	if (existsSync(destination)) throw new Error("Output must not exist");
	if (!existsSync(dirname(destination))) throw new Error("Output parent must exist");
	const resolvedDestination = join(realpathSync(dirname(destination)), destination.slice(dirname(destination).length + 1));
	if (inside(input, resolvedDestination)) throw new Error("Output must be outside source");
	const entries = readdirSync(input);
	for (const entry of entries) {
		if (!["node_modules", "package.json", "package-lock.json"].includes(entry)) throw new Error(`Unexpected application-prefix entry: ${entry}`);
	}
	inventory(input); // Validate links before copying.
	const packagePath = join(input, "node_modules", "jouzu", "package.json");
	const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
	if (pkg.name !== "jouzu" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error("Invalid Jouzu package metadata");
	if (!existsSync(join(input, "node_modules", "jouzu", "dist", "cli.js"))) throw new Error("Missing Jouzu CLI entrypoint");
	if (!existsSync(join(input, "package-lock.json"))) throw new Error("Prepared application lockfile is required");
	const temporary = `${destination}.staging-${process.pid}`;
	mkdirSync(temporary); // Never reuse somebody else's staging directory.
	try {
		cpSync(input, join(temporary, "app"), { recursive: true, dereference: false });
		// Remove build-host tarball paths from the same metadata normalized by the legacy builder.
		for (const name of ["package.json", "package-lock.json", "node_modules/.package-lock.json"]) {
			const path = join(temporary, "app", name);
			if (!existsSync(path)) continue;
			const metadata = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
			if (metadata.dependencies?.jouzu) metadata.dependencies.jouzu = "file:jouzu.tgz";
			if (metadata.packages?.[""]?.dependencies?.jouzu) metadata.packages[""].dependencies.jouzu = "file:jouzu.tgz";
			if (metadata.packages?.["node_modules/jouzu"]) metadata.packages["node_modules/jouzu"].resolved = "file:jouzu.tgz";
			writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
		}
		const report = { schemaVersion: 1, target, version: pkg.version, sourceCommit, entrypoint: "app/node_modules/jouzu/dist/cli.js", ...inventory(join(temporary, "app")) };
		writeFileSync(join(temporary, "inventory.json"), `${JSON.stringify(report, null, 2)}\n`);
		renameSync(temporary, destination);
		return report;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [source, output, target, sourceCommit, ...extra] = process.argv.slice(2);
	if (!source || !output || !target || !sourceCommit || extra.length) {
		console.error("Usage: node stage-application.mjs <prepared-npm-prefix> <new-output-directory> <os-arch> <source-commit>");
		process.exitCode = 1;
	} else {
		const report = stageApplication({ source, output, target, sourceCommit });
		console.log(JSON.stringify({ version: report.version, target, fileCount: report.fileCount, unpackedBytes: report.unpackedBytes }, null, 2));
	}
}
