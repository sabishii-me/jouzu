#!/usr/bin/env node
// Repeat test files under CPU load to expose timing-dependent failures before they reach CI.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRecords } from "./test-timings.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const usage = `Usage: node scripts/stress-tests.mjs [--repeat N] [--load N] [runner options] <test files>

Runs the files N times (default 10) through the bounded runner while N busy CPU workers
(default: four per CPU) oversubscribe the machine, then lists every test that failed in any run.
Runner options such as --test-name-pattern pass through.`;

export function parseStressArguments(args, cpus = availableParallelism()) {
	// Timing races appear when the host is oversubscribed, not merely busy.
	const options = { repeat: 10, load: cpus * 4, runner: [] };
	for (let i = 0; i < args.length; i++) {
		const argument = args[i];
		if (argument === "--repeat" || argument === "--load") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value) || value < (argument === "--load" ? 0 : 1) || value > 1000)
				throw new Error(`${argument} must be an integer from ${argument === "--load" ? 0 : 1} to 1000.`);
			options[argument.slice(2)] = value;
		} else options.runner.push(argument);
	}
	if (!options.runner.some((argument) => !argument.startsWith("-"))) throw new Error(usage);
	return options;
}

// Count failures per test across timing records.
export function flaky(records) {
	const tests = new Map();
	for (const record of records)
		for (const entry of record.tests) {
			if (entry.nesting !== 0 || entry.status === "skip" || entry.status === "todo") continue;
			const key = `${entry.file} :: ${entry.test}`;
			const current = tests.get(key) ?? { file: entry.file, test: entry.test, runs: 0, failures: 0 };
			current.runs++;
			if (entry.status !== "pass") current.failures++;
			tests.set(key, current);
		}
	return [...tests.values()].filter((entry) => entry.failures).sort((a, b) => b.failures - a.failures);
}

// The failing test names and error messages, including multi-line ones, from one run's TAP output.
export function failureLines(tap) {
	const lines = [];
	let block;
	for (const line of tap.split("\n")) {
		const indent = line.length - line.trimStart().length;
		if (block !== undefined && indent > block && line.trim()) lines.push(`  ${line.trim()}`);
		else {
			block = undefined;
			if (/^\s*not ok \d+ - /.test(line)) lines.push(line.trim());
			else if (/^\s+error: /.test(line)) {
				lines.push(line.trim());
				if (/error: [|>]-?$/.test(line)) block = indent;
			}
		}
	}
	return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	let workers = [];
	const directory = mkdtempSync(join(tmpdir(), "jouzu-stress-"));
	try {
		const options = parseStressArguments(process.argv.slice(2));
		workers = Array.from({ length: options.load }, () =>
			spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore", windowsHide: true }),
		);
		let failedRuns = 0;
		for (let run = 1; run <= options.repeat; run++) {
			const result = spawnSync(process.execPath, [join(root, "scripts/run-tests.mjs"), ...options.runner], {
				cwd: process.cwd(),
				stdio: ["ignore", "pipe", "inherit"],
				encoding: "utf8",
				maxBuffer: 256 * 1024 * 1024,
				env: { ...process.env, JOUZU_TEST_TIMINGS_DIR: directory, JOUZU_TEST_TIMINGS_LABEL: `stress-${run}` },
			});
			if (result.status !== 0) failedRuns++;
			console.error(`[stress] run ${run}/${options.repeat}: exit ${result.status}`);
			// A failed run reports why, so a rare failure is diagnosable without reproducing it again.
			if (result.status !== 0) for (const line of failureLines(result.stdout ?? "")) console.error(`  ${line}`);
		}
		const records = readRecords([directory]);
		if (!records.some((record) => record.tests.some((entry) => entry.status === "pass" || entry.status === "fail")))
			throw new Error("[stress] no tests ran; check the file selection and name pattern");
		const failures = flaky(records);
		for (const entry of failures) console.log(`${entry.failures}/${entry.runs} failed: ${entry.file} :: ${entry.test}`);
		console.log(
			`[stress] ${options.repeat} runs under ${options.load} load workers: ${failedRuns} failed runs, ${failures.length} failing tests`,
		);
		process.exitCode = failedRuns ? 1 : 0;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	} finally {
		for (const worker of workers) worker.kill("SIGKILL");
		rmSync(directory, { recursive: true, force: true });
	}
}
