#!/usr/bin/env node
// Summarize and compare timing records written by scripts/run-tests.mjs (JOUZU_TEST_TIMINGS_DIR).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  node scripts/test-timings.mjs summary [--top N] [--where key=value]... [--json] <record files or directories>
  node scripts/test-timings.mjs diff --base <path> --head <path> [--where key=value]... [--json]
  node scripts/test-timings.mjs budget --tiers <tiers.json> [--warn-only] [--where key=value]... [--json] <paths>

--where filters runs by a run-context field (label, platform, node, job, commit, hosted, concurrency).
node matches a major version (--where node=22) or an exact version.`;

function recordFiles(path) {
	const absolute = resolve(path);
	if (!statSync(absolute).isDirectory()) return [absolute];
	return readdirSync(absolute, { recursive: true })
		.filter((name) => String(name).endsWith(".jsonl"))
		.map((name) => join(absolute, String(name)))
		.sort();
}

export function parseRecord(text, source = "record") {
	const lines = text
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const context = lines.find((line) => line.type === "run");
	if (!context) throw new Error(`${source} has no run context`);
	return {
		source,
		context,
		tests: lines.filter((line) => line.type === "test"),
		end: lines.find((line) => line.type === "end") ?? null,
	};
}

export function readRecords(paths) {
	return paths.flatMap(recordFiles).map((path) => parseRecord(readFileSync(path, "utf8"), path));
}

export function matches(record, where) {
	return Object.entries(where).every(([key, expected]) => {
		const actual = record.context[key];
		if (key === "node") return actual === expected || actual?.replace(/^v/, "").split(".")[0] === expected;
		return String(actual) === expected;
	});
}

function quantile(sorted, q) {
	if (!sorted.length) return 0;
	const index = (sorted.length - 1) * q;
	const low = Math.floor(index);
	const high = Math.ceil(index);
	return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		median: quantile(sorted, 0.5),
		p90: quantile(sorted, 0.9),
		max: sorted.at(-1) ?? 0,
	};
}

export function summarize(records, { top = 25 } = {}) {
	const tests = new Map();
	const labels = new Map();
	for (const record of records) {
		const wall = labels.get(record.context.label) ?? [];
		if (record.end?.wallMs !== undefined) wall.push(record.end.wallMs);
		labels.set(record.context.label, wall);
		for (const entry of record.tests) {
			if (entry.status === "skip" || entry.status === "todo") continue;
			const key = `${entry.file} :: ${entry.test}`;
			const current = tests.get(key) ?? { file: entry.file, test: entry.test, nesting: entry.nesting, samples: [] };
			current.samples.push(entry.duration_ms);
			tests.set(key, current);
		}
	}
	const rows = [...tests.values()].map(({ samples, ...entry }) => ({ ...entry, ...stats(samples) }));
	const topLevel = rows.filter((row) => row.nesting === 0).sort((a, b) => b.median - a.median);
	const total = topLevel.reduce((sum, row) => sum + row.median, 0);
	const share = (count) => (total ? topLevel.slice(0, count).reduce((sum, row) => sum + row.median, 0) / total : 0);
	const files = new Map();
	for (const row of topLevel) {
		const file = files.get(row.file) ?? { file: row.file, tests: 0, median: 0 };
		file.tests++;
		file.median += row.median;
		files.set(row.file, file);
	}
	return {
		runs: records.length,
		suites: [...labels].map(([label, wall]) => ({ label, ...stats(wall) })),
		tests: topLevel.length,
		totalMedianMs: total,
		over1s: topLevel.filter((row) => row.median > 1_000).length,
		over10s: topLevel.filter((row) => row.median > 10_000).length,
		top10Share: share(10),
		top50Share: share(50),
		slowest: topLevel.slice(0, top),
		files: [...files.values()].sort((a, b) => b.median - a.median).slice(0, top),
		all: rows,
	};
}

export function compare(base, head, { minDeltaMs = 1_000, minRatio = 0.2 } = {}) {
	const index = (summary) =>
		new Map(summary.all.filter((row) => row.nesting === 0).map((row) => [`${row.file} :: ${row.test}`, row]));
	const before = index(base);
	const after = index(head);
	const changed = [];
	for (const [key, row] of after) {
		const previous = before.get(key);
		if (!previous) continue;
		const delta = row.median - previous.median;
		if (Math.abs(delta) >= minDeltaMs && Math.abs(delta) >= previous.median * minRatio)
			changed.push({ file: row.file, test: row.test, before: previous.median, after: row.median, delta });
	}
	changed.sort((a, b) => b.delta - a.delta);
	const suites = head.suites.map((suite) => {
		const previous = base.suites.find((entry) => entry.label === suite.label);
		return { label: suite.label, before: previous?.median ?? null, after: suite.median };
	});
	return {
		totalBefore: base.totalMedianMs,
		totalAfter: head.totalMedianMs,
		testsBefore: base.tests,
		testsAfter: head.tests,
		suites,
		added: [...after].filter(([key]) => !before.has(key)).map(([, row]) => row),
		removed: [...before].filter(([key]) => !after.has(key)).map(([, row]) => row),
		slower: changed.filter((row) => row.delta > 0),
		faster: changed.filter((row) => row.delta < 0).reverse(),
	};
}

// Tier lookup: an @tier suffix in the test name, then the exact test, then its file, then "unit".
export function tierOf(row, tiers) {
	const tag = row.test.match(/ @([a-z-]+)$/)?.[1];
	if (tag && tiers.budgets[tag]) return tag;
	return tiers.tests?.[`${row.file} :: ${row.test}`] ?? tiers.files?.[row.file] ?? "unit";
}

export function validateTiers(tiers) {
	if (!tiers?.budgets?.unit) throw new Error("Tier budgets must define unit.");
	for (const [name, budget] of Object.entries(tiers.budgets))
		if (!(budget.warnMs > 0 && budget.failMs >= budget.warnMs)) throw new Error(`Tier ${name} needs warnMs <= failMs.`);
	for (const tier of [...Object.values(tiers.tests ?? {}), ...Object.values(tiers.files ?? {})])
		if (!tiers.budgets[tier]) throw new Error(`Unknown tier ${tier}.`);
	return tiers;
}

// Compare each top-level test's median with its tier's budget.
export function budget(summary, tiers) {
	const rows = summary.all
		.filter((row) => row.nesting === 0)
		.map((row) => ({ ...row, tier: tierOf(row, tiers) }))
		.map((row) => ({ ...row, budget: tiers.budgets[row.tier] }));
	const totals = {};
	for (const row of rows) {
		totals[row.tier] ??= { tests: 0, medianMs: 0 };
		const total = totals[row.tier];
		total.tests++;
		total.medianMs += row.median;
	}
	const pick = (key) =>
		rows
			.filter((row) => row.median > row.budget[key])
			.map(({ budget: limit, ...row }) => ({ ...row, limitMs: limit[key] }))
			.sort((a, b) => b.median - a.median);
	const failures = pick("failMs");
	const warnings = pick("warnMs").filter(
		(row) => !failures.some((failure) => failure.test === row.test && failure.file === row.file),
	);
	return { totals, failures, warnings };
}

export function budgetMarkdown(result) {
	const row = (r) => `| ${cell(r.test)} | ${cell(r.file)} | ${r.tier} | ${seconds(r.median)} | ${seconds(r.limitMs)} |`;
	const table = (title, rows) =>
		rows.length
			? [
					"",
					`${title}:`,
					"",
					"| Test | File | Tier | Median | Limit |",
					"| --- | --- | --- | ---: | ---: |",
					...rows.map(row),
				]
			: [];
	const lines = [
		"| Tier | Tests | Summed median |",
		"| --- | ---: | ---: |",
		...Object.entries(result.totals).map(
			([tier, total]) => `| ${tier} | ${total.tests} | ${seconds(total.medianMs)} |`,
		),
		...table("Over the failure budget", result.failures),
		...table("Over the warning budget", result.warnings),
	];
	if (!result.failures.length && !result.warnings.length) lines.push("", "Every test is within its tier budget.");
	return `${lines.join("\n")}\n`;
}

const seconds = (ms) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const percent = (value) => `${Math.round(value * 100)}%`;
const cell = (text) => String(text).replaceAll("|", "\\|");

export function summaryMarkdown(summary) {
	const lines = [
		`Runs: ${summary.runs}. Top-level tests: ${summary.tests}. Summed median test time: ${seconds(summary.totalMedianMs)}.`,
		`Tests over 1 s: ${summary.over1s}; over 10 s: ${summary.over10s}. Slowest 10: ${percent(summary.top10Share)} of summed time; slowest 50: ${percent(summary.top50Share)}.`,
		"",
		"| Suite | Runs | Median wall | p90 | Max |",
		"| --- | ---: | ---: | ---: | ---: |",
		...summary.suites.map(
			(s) => `| ${cell(s.label)} | ${s.n} | ${seconds(s.median)} | ${seconds(s.p90)} | ${seconds(s.max)} |`,
		),
		"",
		"| Test | File | n | Median | p90 | Max |",
		"| --- | --- | ---: | ---: | ---: | ---: |",
		...summary.slowest.map(
			(t) =>
				`| ${cell(t.test)} | ${cell(t.file)} | ${t.n} | ${seconds(t.median)} | ${seconds(t.p90)} | ${seconds(t.max)} |`,
		),
		"",
		"| File | Tests | Summed median |",
		"| --- | ---: | ---: |",
		...summary.files.map((f) => `| ${cell(f.file)} | ${f.tests} | ${seconds(f.median)} |`),
	];
	return `${lines.join("\n")}\n`;
}

export function diffMarkdown(diff) {
	const list = (title, rows, format) => (rows.length ? ["", `${title}:`, ...rows.map(format)] : []);
	const lines = [
		`Summed median test time: ${seconds(diff.totalBefore)} -> ${seconds(diff.totalAfter)} (${seconds(diff.totalAfter - diff.totalBefore)}).`,
		`Top-level tests: ${diff.testsBefore} -> ${diff.testsAfter}.`,
		...diff.suites.map((s) => `Suite ${s.label} median wall: ${seconds(s.before)} -> ${seconds(s.after)}.`),
		...list("Slower", diff.slower, (r) => `- ${r.file} :: ${r.test}: ${seconds(r.before)} -> ${seconds(r.after)}`),
		...list("Faster", diff.faster, (r) => `- ${r.file} :: ${r.test}: ${seconds(r.before)} -> ${seconds(r.after)}`),
		...list("Added", diff.added, (r) => `- ${r.file} :: ${r.test}: ${seconds(r.median)}`),
		...list("Removed", diff.removed, (r) => `- ${r.file} :: ${r.test}: ${seconds(r.median)}`),
	];
	return `${lines.join("\n")}\n`;
}

export function parseArguments(args) {
	const [command, ...rest] = args;
	const options = {
		command,
		where: {},
		top: 25,
		json: false,
		warnOnly: false,
		tiers: null,
		paths: [],
		base: [],
		head: [],
	};
	for (let i = 0; i < rest.length; i++) {
		const argument = rest[i];
		const value = () => {
			const next = rest[++i];
			if (next === undefined) throw new Error(`${argument} requires a value.`);
			return next;
		};
		if (argument === "--json") options.json = true;
		else if (argument === "--warn-only") options.warnOnly = true;
		else if (argument === "--tiers") options.tiers = value();
		else if (argument === "--top") options.top = Number(value());
		else if (argument === "--where") {
			const [key, ...parts] = value().split("=");
			if (!key || !parts.length) throw new Error("--where requires key=value.");
			options.where[key] = parts.join("=");
		} else if (argument === "--base") options.base.push(value());
		else if (argument === "--head") options.head.push(value());
		else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}.`);
		else options.paths.push(argument);
	}
	if (!Number.isInteger(options.top) || options.top < 1) throw new Error("--top must be a positive integer.");
	if (["summary", "budget"].includes(command) && !options.paths.length)
		throw new Error(`${command} needs record files or directories.`);
	if (command === "budget" && !options.tiers) throw new Error("budget needs --tiers.");
	if (command === "diff" && (!options.base.length || !options.head.length))
		throw new Error("diff needs --base and --head.");
	if (!["summary", "diff", "budget"].includes(command)) throw new Error(usage);
	return options;
}

function load(paths, where) {
	const records = readRecords(paths).filter((record) => matches(record, where));
	if (!records.length) throw new Error(`No timing records match ${paths.join(", ")}.`);
	return records;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const options = parseArguments(process.argv.slice(2));
		if (options.command === "summary") {
			const summary = summarize(load(options.paths, options.where), options);
			const { all, ...visible } = summary;
			process.stdout.write(options.json ? `${JSON.stringify(visible, null, 2)}\n` : summaryMarkdown(summary));
		} else if (options.command === "budget") {
			const tiers = validateTiers(JSON.parse(readFileSync(options.tiers, "utf8")));
			const result = budget(summarize(load(options.paths, options.where)), tiers);
			process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : budgetMarkdown(result));
			if (result.failures.length && !options.warnOnly) process.exitCode = 1;
		} else {
			const diff = compare(summarize(load(options.base, options.where)), summarize(load(options.head, options.where)));
			process.stdout.write(options.json ? `${JSON.stringify(diff, null, 2)}\n` : diffMarkdown(diff));
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
	}
}
