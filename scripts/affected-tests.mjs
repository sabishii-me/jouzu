#!/usr/bin/env node
// Select the Node test files affected by changed files, then optionally run them with the bounded runner.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const usage = `Usage: node scripts/affected-tests.mjs [--base REF] [--run] [--endurance] [changed files...]

Without files, compares the working tree and untracked files with REF (default HEAD).
Prints the affected test files, or runs them with --run (skipping @endurance tests unless
--endurance). Changes to dependencies, build scripts, or shared fixtures select every test
supported by the current platform.`;

// These suites exercise Windows process locking, Authenticode, registry PATH, and native hosts.
// Static launcher tests remain portable and must still run on every platform.
const windowsOnly = new Set([
	"packaging/launcher/command-entries.test.mjs",
	"packaging/launcher/command-path.test.mjs",
	"packaging/launcher/git-environment.test.mjs",
	"packaging/launcher/terminal-environment.test.mjs",
]);

// Changes here can affect any test; select everything rather than guess.
const global = [
	/^package(-lock)?\.json$/,
	/^packages\/[^/]+\/package(-lock)?\.json$/,
	/^packages\/[^/]+\/tsconfig\.json$/,
	/^tsconfig\.base\.json$/,
	/^upstream\//,
	/^scripts\/(apply-|install-|prepare-|copy-|configure-|build-|check-dist-fresh|run-tests)/,
	/^scripts\/fixtures\//,
];

const toPosix = (path) => path.split(sep).join("/");
const repo = (path) => toPosix(relative(root, path));

function walk(directory, accept, files = []) {
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) walk(path, accept, files);
		else if (accept(entry.name)) files.push(path);
	}
	return files;
}

// Relative specifiers in imports, re-exports, dynamic imports, and module URLs such as the built CLI
// that tests launch as a child process.
function specifiers(source) {
	return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map(
		(m) => m[1],
	);
}

// Map a resolved import target to the repository file that owns it: dist output maps to its source.
function owner(path) {
	const posix = repo(path);
	const dist = posix.match(/^(packages\/[^/]+)\/dist\/(.+)\.js$/);
	if (dist) {
		const source = `${dist[1]}/src/${dist[2]}.ts`;
		return existsSync(join(root, source)) ? source : null;
	}
	if (posix.endsWith(".js") && existsSync(join(root, posix.replace(/\.js$/, ".ts"))))
		return posix.replace(/\.js$/, ".ts");
	return existsSync(join(root, posix)) ? posix : null;
}

export function dependencyGraph() {
	const files = [
		...walk(join(root, "packages"), (name) => /\.(ts|mjs|js)$/.test(name) && !name.endsWith(".d.ts")),
		...walk(join(root, "scripts"), (name) => name.endsWith(".mjs")),
		...walk(join(root, "packaging"), (name) => name.endsWith(".mjs")),
	];
	const imports = new Map();
	for (const file of files) {
		const targets = new Set();
		for (const specifier of specifiers(readFileSync(file, "utf8"))) {
			const target = owner(normalize(resolve(dirname(file), specifier)));
			if (target) targets.add(target);
		}
		imports.set(repo(file), targets);
	}
	return imports;
}

export function affectedTests(
	changed,
	imports = dependencyGraph(),
	read = (file) => readFileSync(join(root, file), "utf8"),
	platform = process.platform,
) {
	const tests = [...imports.keys()]
		.filter((file) => file.endsWith(".test.mjs") && (platform === "win32" || !windowsOnly.has(file)))
		.sort();
	if (changed.some((file) => global.some((pattern) => pattern.test(file)))) return { all: true, tests };
	// Reverse edges: every file that (transitively) imports a changed file is affected.
	const importers = new Map();
	for (const [file, targets] of imports)
		for (const target of targets) importers.set(target, [...(importers.get(target) ?? []), file]);
	const affected = new Set(changed);
	// Workflows, manifests, and documents are read as data: select tests that name the file.
	const data = changed.filter((file) => !/\.(ts|mjs|js)$/.test(file));
	if (data.length)
		for (const test of tests) {
			const source = read(test);
			if (data.some((file) => source.includes(file.split("/").at(-1)))) affected.add(test);
		}
	const queue = [...changed];
	while (queue.length) {
		for (const importer of importers.get(queue.pop()) ?? [])
			if (!affected.has(importer)) {
				affected.add(importer);
				queue.push(importer);
			}
	}
	return { all: false, tests: tests.filter((file) => affected.has(file)) };
}

function changedFiles(base) {
	const git = (args) => {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
		return result.stdout.split("\n").filter(Boolean);
	};
	return [...new Set([...git(["diff", "--name-only", base]), ...git(["ls-files", "--others", "--exclude-standard"])])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const args = process.argv.slice(2);
		let base = "HEAD";
		let run = false;
		let endurance = false;
		const files = [];
		for (let i = 0; i < args.length; i++) {
			if (args[i] === "--run") run = true;
			else if (args[i] === "--endurance") endurance = true;
			else if (args[i] === "--base") base = args[++i] ?? "";
			else if (args[i] === "--help" || args[i].startsWith("-")) throw new Error(usage);
			else files.push(toPosix(args[i]));
		}
		if (!base) throw new Error(usage);
		const changed = files.length ? files : changedFiles(base);
		const { all, tests } = affectedTests(changed);
		if (all) {
			console.error("[affected] a dependency, build, or shared fixture changed; selecting every supported test file");
			if (process.platform !== "win32") console.error("[affected] native Windows launcher tests require Windows");
		}
		console.error(`[affected] ${changed.length} changed files; ${tests.length} test files`);
		if (!run) {
			for (const test of tests) console.log(test);
		} else if (tests.length) {
			// Tests import compiled output; refuse to run them against a stale build.
			if (tests.some((test) => test.startsWith("packages/"))) {
				const fresh = spawnSync(process.execPath, [join(root, "scripts/check-dist-fresh.mjs")], {
					cwd: root,
					stdio: "inherit",
				});
				if (fresh.status !== 0) throw new Error("[affected] run npm run build first");
			}
			const skip = endurance ? [] : ["--test-skip-pattern=@endurance"];
			const result = spawnSync(process.execPath, [join(root, "scripts/run-tests.mjs"), ...skip, ...tests], {
				cwd: root,
				stdio: "inherit",
			});
			process.exitCode = result.status ?? 1;
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	}
}
