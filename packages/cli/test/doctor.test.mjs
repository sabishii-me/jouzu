import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDoctorReport, formatDoctorReport } from "../dist/doctor.js";
import { ModelPickerStore } from "../dist/model-picker-state.js";

const ESCAPE = String.fromCharCode(27);
const ANSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;]*m`, "gu");

function stripAnsi(value) {
	return value.replace(ANSI_SEQUENCE, "");
}

/** Render every assertion at a fixed width without color, so layout is deterministic. */
const RENDER = { colorEnabled: false, columns: 100 };

function render(result) {
	return formatDoctorReport(result.report, RENDER);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Collapse the renderer's alignment and wrapping so message assertions stay readable. */
function flat(text) {
	return text.replace(/\s+/gu, " ");
}

/** Assert one aligned label and value row of the rendered report. */
function assertField(text, label, value) {
	assert.match(
		text,
		new RegExp(`^ +${escapeRegExp(label)} {2,}${escapeRegExp(value)}$`, "mu"),
		`expected the row "${label}  ${value}"`,
	);
}

function metadata(overrides = {}) {
	return {
		jouzuVersion: "0.1.0",
		displayVersion: "0.1.0",
		build: undefined,
		piVersion: "0.84.2",
		profileSchemaVersion: 1,
		lock: {
			schemaVersion: 2,
			repository: "https://github.com/earendil-works/pi-mono",
			tag: "v0.84.2",
			tagCommit: "914cf1472e715297caa30db4b9535d534a9eb718",
			commit: "914cf1472e715297caa30db4b9535d534a9eb718",
			packages: {},
			reviewedAt: "2026-08-20",
			compatibilityStatus: "qualified",
			deviations: [],
			...overrides,
		},
	};
}

function paths(root) {
	return {
		agentDir: join(root, "agent"),
		stateDir: join(root, "state"),
		cacheDir: join(root, "cache"),
		sessionDir: join(root, "state", "sessions"),
		profileStatePath: join(root, "state", "profile-state.json"),
		backupDir: join(root, "state", "backups"),
	};
}

test("doctor reports an injected healthy Linux runtime without mutating roots", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-unit-"));
	rmSync(root, { recursive: true, force: true });
	const report = createDoctorReport({
		metadata: metadata(),
		paths: paths(root),
		profile: { id: "ja", source: "default" },
		piRuntimeVersion: "0.84.2",
		executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
		env: { HOME: "/home/利用者", ANTHROPIC_API_KEY: "must-not-appear", HTTPS_PROXY: "must-not-appear" },
		platform: "linux",
		architecture: "x64",
		nodeVersion: "v22.19.0",
		locale: "ja-JP",
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
		keybindingPlan: {
			schemaVersion: 1,
			defaultsVersion: 1,
			configPath: "/home/利用者/.config/jouzu/agent/keybindings.json",
			statePath: "/home/利用者/.local/state/jouzu/keybindings-state.json",
			configExists: true,
			policy: "applied",
			status: "converged",
			portabilityWarnings: [],
			actions: [],
		},
		updateStatus: {
			policy: "auto-restart",
			installChannel: "global-npm",
			startupEligible: true,
			state: {
				schemaVersion: 1,
				policy: "auto-restart",
				channel: "latest",
				lastCheckedAt: null,
				nextCheckAt: null,
				lastResult: "never",
				installedVersion: "0.1.0",
				latestVersion: null,
				latestIntegrity: null,
				previousVersion: null,
				lastUpdatedAt: null,
				lastErrorCode: null,
			},
		},
	});
	assert.equal(report.healthy, true);
	const healthy = render(report);
	assertField(healthy, "Platform", "linux x64");
	assertField(healthy, "Locale", "ja-JP");
	assertField(healthy, "Provider environment", "present");
	assertField(healthy, "Proxy configured", "yes");
	assertField(healthy, "Self-update policy", "auto-restart");
	assertField(healthy, "Automatic startup update", "eligible");
	assertField(healthy, "Keybinding defaults", "converged");
	assertField(healthy, "Model picker state", "absent");
	assertField(healthy, "Optional Camoufox runtime", "not installed; installs on first browser tool use");
	assertField(healthy, "Camoufox runtime install lock", "free");
	assertField(healthy, "Jouzu default follow-up key", "ctrl+enter");
	assertField(healthy, "Jouzu default dequeue key", "ctrl+up");
	assert.doesNotMatch(healthy, /must-not-appear/);
	assert.equal(rmSync(root, { recursive: true, force: true }), undefined);
});

test("doctor summarizes catalog thinking-level gaps and points to the catalog detail", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-catalog-"));
	rmSync(root, { recursive: true, force: true });
	const reportFor = (extra) =>
		createDoctorReport({
			metadata: metadata(),
			paths: paths(root),
			profile: { id: "core", source: "default" },
			piRuntimeVersion: "0.84.2",
			executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
			env: { HOME: "/home/user", ANTHROPIC_API_KEY: "redacted" },
			platform: "linux",
			commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
			...extra,
		});
	const complete = reportFor({ catalogLevels: { activeCatalogs: 1, offerings: 36, gaps: [] } });
	assertField(render(complete), "Catalog thinking levels", "complete");
	assert.doesNotMatch(render(complete), /jz catalog status/);
	assert.equal(complete.healthy, true);

	const gaps = reportFor({
		catalogLevels: {
			activeCatalogs: 2,
			offerings: 36,
			gaps: [
				{ providerId: "aiand", modelId: "deepseek-ai/deepseek-v4-flash" },
				{ providerId: "aiand", modelId: "qwen/qwen3.6-27b" },
			],
		},
	});
	const gapsText = render(gaps);
	assertField(gapsText, "Catalog thinking levels", "2 of 36 offerings without declared levels");
	assert.match(flat(gapsText), /⚠ catalog 2 of 36 offerings declare no thinking levels/u);
	assert.match(flat(gapsText), /Run "jz catalog status" for the list/u);
	assert.equal(gaps.healthy, true, "a catalog gap is a warning, not a problem");

	const unconfigured = reportFor({ catalogLevels: { activeCatalogs: 0, offerings: 0, gaps: [] } });
	assertField(render(unconfigured), "Catalog thinking levels", "no active catalog");

	const unavailable = reportFor({ catalogDiagnostic: "cached catalog digest mismatch" });
	const unavailableText = render(unavailable);
	assertField(unavailableText, "Catalog thinking levels", "unavailable");
	assert.match(flat(unavailableText), /Catalog status is unavailable: cached catalog digest mismatch/u);

	assert.equal(rmSync(root, { recursive: true, force: true }), undefined);
});

test("doctor reports model picker counts and unreadable state without rewriting it", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-model-picker-"));
	try {
		const resolvedPaths = paths(root);
		const store = new ModelPickerStore(resolvedPaths);
		store.toggleFavorite({ provider: "anthropic", modelId: "claude-test" }, new Date("2026-08-23T00:00:00.000Z"));
		store.recordDispatch({ provider: "anthropic", modelId: "claude-test" }, "a".repeat(64), {
			now: new Date("2026-08-23T00:00:01.000Z"),
		});
		const reportFor = () =>
			createDoctorReport({
				metadata: metadata(),
				paths: resolvedPaths,
				profile: { id: "core", source: "default" },
				piRuntimeVersion: "0.84.2",
				executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
				env: { HOME: "/home/user", ANTHROPIC_API_KEY: "redacted" },
				platform: "linux",
				commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
			});
		assert.match(
			flat(render(reportFor())),
			/Model picker state 0 project defaults; 1 favorites; 1 global recents; 1 project scopes/u,
		);

		const statePath = join(root, "state", "model-picker.json");
		writeFileSync(statePath, "{ broken");
		const unreadable = reportFor();
		const unreadableText = render(unreadable);
		assertField(unreadableText, "Model picker state", "unreadable");
		assert.match(flat(unreadableText), /⚠ modelPicker Model picker state is unreadable:/u);
		assert.equal(readFileSync(statePath, "utf8"), "{ broken");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor fails closed for unsupported Windows prerequisites and Pi drift", () => {
	const root = "C:\\Users\\利用者\\Jouzu 上手";
	const report = createDoctorReport({
		metadata: metadata({ compatibilityStatus: "pending" }),
		paths: {
			agentDir: `${root}\\agent`,
			stateDir: `${root}\\state`,
			cacheDir: `${root}\\cache`,
			sessionDir: `${root}\\state\\sessions`,
			profileStatePath: `${root}\\state\\profile-state.json`,
			backupDir: `${root}\\state\\backups`,
		},
		profile: { id: "core", source: "command line" },
		piRuntimeVersion: "0.85.0",
		executable: "C:\\Program Files\\nodejs\\node_modules\\jouzu\\dist\\cli.js",
		env: { USERPROFILE: "C:\\Users\\利用者", PATH: "" },
		platform: "win32",
		architecture: "x64",
		nodeVersion: "v20.18.0",
		locale: "ja-JP",
		commandPaths: { git: null, bash: null, npm: null },
	});
	assert.equal(report.healthy, false);
	const unsupported = flat(render(report));
	assert.match(unsupported, /Node v20\.18\.0 is unsupported/u);
	assert.match(unsupported, /Git was not found/u);
	assert.match(unsupported, /Bash was not found; install Bash or Git Bash/u);
	assert.match(unsupported, /npm was not found on PATH/u);
	assert.match(unsupported, /Pinned Pi 0\.84\.2 does not match loaded runtime 0\.85\.0/u);
	assert.match(unsupported, /Pi lock status is pending/u);
	assert.match(unsupported, /Result: action required/u);
});

test("doctor reports a Pi runtime load failure as action required", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-pi-fail-"));
	rmSync(root, { recursive: true, force: true });
	const report = createDoctorReport({
		metadata: metadata(),
		paths: paths(root),
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "unavailable",
		piRuntimeDiagnostic: "Cannot find module '@earendil-works/pi-coding-agent'",
		executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
		env: { HOME: "/home/user" },
		platform: "linux",
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
	});
	assert.equal(report.healthy, false);
	assert.match(flat(render(report)), /Pi runtime could not be loaded: Cannot find module/u);
	assert.match(flat(render(report)), /Result: action required/u);
	assert.equal(rmSync(root, { recursive: true, force: true }), undefined);
});

test("doctor reports a Pi version mismatch as action required", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-pi-version-"));
	rmSync(root, { recursive: true, force: true });
	const report = createDoctorReport({
		metadata: metadata(),
		paths: paths(root),
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "0.85.0",
		executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
		env: { HOME: "/home/user" },
		platform: "linux",
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
	});
	assert.equal(report.healthy, false);
	assert.match(flat(render(report)), /Pinned Pi 0\.84\.2 does not match loaded runtime 0\.85\.0/u);
	assert.match(flat(render(report)), /Result: action required/u);
	assert.equal(rmSync(root, { recursive: true, force: true }), undefined);
});

test("doctor reports degraded optional extensions and disabled tools as action required", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-optional-extension-"));
	try {
		const report = createDoctorReport({
			...healthyContext(root),
			releaseExtensionStatus: {
				manifest: { schemaVersion: 1, packages: [], compatibilityDependencies: [], runtimeDependencyRedirects: [] },
				extensionCount: 10,
				skillCount: 2,
				resolvedExtensions: [],
				resolvedExtensionPaths: Array.from({ length: 9 }, (_, index) => `/extension-${index}.js`),
				resolvedSkillPaths: ["/skill-1.md", "/skill-2.md"],
				resolvedPackageRoots: {},
				degradedExtensions: [
					{
						packageName: "fixture-fetch-extension",
						packageVersion: "1.2.3",
						tools: ["web_fetch", "batch_web_fetch"],
						error: "/lib64/libc.so.6: version `GLIBC_2.34' not found",
					},
				],
				errors: [],
			},
		});
		assert.equal(report.healthy, false);
		const degraded = render(report);
		assertField(degraded, "Release-owned extensions", "10 selected; 9 ready; 1 optional unavailable");
		assert.match(flat(degraded), /Optional release extensions are unavailable: fixture-fetch-extension@1\.2\.3/u);
		assert.match(flat(degraded), /disabled tools: web_fetch, batch_web_fetch/u);
		assert.match(flat(degraded), /GLIBC_2\.34/u);
		assert.match(flat(degraded), /rerun `jz doctor`/u);
		assert.ok(report.report.issues.some((issue) => issue.id === "extensions.optionalUnavailable"));
		assert.match(flat(degraded), /Result: action required/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor reports invalid optional Camoufox runtime state as action required", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-camoufox-"));
	try {
		const installRoot = join(root, "state", "camoufox-runtime", "v1.0.0");
		mkdirSync(installRoot, { recursive: true });
		const report = createDoctorReport(healthyContext(root));
		assert.equal(report.healthy, false);
		const camoufox = render(report);
		assertField(camoufox, "Optional Camoufox runtime", "invalid");
		assert.match(flat(camoufox), /The optional Camoufox runtime is invalid/u);
		assert.match(flat(camoufox), /remove that directory and retry a browser tool/u);
		assert.ok(report.report.issues.some((issue) => issue.id === "camoufox.runtimeInvalid"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor reports a leftover profile lock as action required", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-lock-"));
	try {
		const stateDir = join(root, "state");
		mkdirSync(stateDir, { recursive: true });
		const lock = join(stateDir, "profile.lock");
		writeFileSync(lock, "");
		const past = new Date(Date.now() - 31 * 60 * 1000);
		utimesSync(lock, past, past);
		const report = createDoctorReport({
			metadata: metadata(),
			paths: paths(root),
			profile: { id: "core", source: "default" },
			piRuntimeVersion: "0.84.2",
			executable: "/opt/jouzu/node_modules/jouzu/dist/cli.js",
			env: { HOME: "/home/user" },
			platform: "linux",
			commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
		});
		assert.equal(report.healthy, false);
		const locked = render(report);
		assert.match(flat(locked), /Profile lock owner unknown \(/u);
		assert.match(flat(locked), /leftover state lock blocks Jouzu operations/u);
		assert.match(flat(locked), /Result: action required/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor maps every updater install channel to user-facing text", () => {
	const cases = [
		["global-npm", "global npm install"],
		["local-npm", "local npm install"],
		["ephemeral-npx", "npx install"],
		["source", "source checkout"],
		["other", "other"],
	];
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-channel-"));
	rmSync(root, { recursive: true, force: true });
	for (const [channel, expected] of cases) {
		const report = createDoctorReport({
			metadata: metadata(),
			paths: paths(root),
			profile: { id: "core", source: "default" },
			piRuntimeVersion: "0.84.2",
			executable: "/any/executable",
			env: { HOME: "/home/user" },
			platform: "linux",
			commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
			updateStatus: {
				policy: "off",
				installChannel: channel,
				startupEligible: false,
				state: {
					schemaVersion: 1,
					policy: "off",
					channel: "latest",
					lastCheckedAt: null,
					nextCheckAt: null,
					lastResult: "never",
					installedVersion: "0.1.0",
					latestVersion: null,
					latestIntegrity: null,
					previousVersion: null,
					lastUpdatedAt: null,
					lastErrorCode: null,
				},
			},
		});
		assertField(render(report), "Install channel", expected);
	}
	assert.equal(rmSync(root, { recursive: true, force: true }), undefined);
});

function healthyContext(root) {
	return {
		metadata: metadata(),
		paths: paths(root),
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "0.84.2",
		executable: "/opt/jouzu/dist/cli.js",
		env: { HOME: root },
		platform: "linux",
		architecture: "x64",
		nodeVersion: "v22.19.0",
		locale: "en-US",
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
	};
}

test("doctor exposes a structured report whose text rendering matches it", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-report-"));
	try {
		const result = createDoctorReport(healthyContext(root));
		const report = result.report;

		assert.equal(report.schemaVersion, 1);
		assert.equal(report.experimental, true);
		assert.equal(report.healthy, result.healthy);
		assert.ok(report.fields.length > 30, "the report carries every observed field");

		// Experimental schema 1 still requires unique machine keys within one report.
		const ids = report.fields.map((field) => field.id);
		assert.equal(new Set(ids).size, ids.length, "field identifiers are unique");
		for (const required of [
			"jouzu.version",
			"pi.runtime",
			"camoufox.runtime",
			"node",
			"git",
			"paths.stateDir",
			"packages.count",
		]) {
			assert.ok(ids.includes(required), `expected a ${required} field`);
		}
		const issueIds = report.issues.map((issue) => issue.id);
		assert.equal(new Set(issueIds).size, issueIds.length, "issue identifiers are unique");

		// The text output is a pure rendering of the report, not a second source of truth.
		assert.equal(formatDoctorReport(report), result.text);

		// Every field appears in the text as its label followed by its value.
		const text = formatDoctorReport(report, RENDER);
		const flattened = flat(text);
		for (const field of report.fields) {
			assert.ok(
				flattened.includes(flat(`${field.label} ${field.value}`)),
				`${field.id} must appear in the text report`,
			);
		}
		assert.match(text, /^Jouzu doctor /u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor issues drive health and the rendered notes block", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-doctor-issues-"));
	try {
		const result = createDoctorReport({
			...healthyContext(root),
			piRuntimeVersion: "0.84.1",
			commandPaths: { git: null, bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
		});

		const problems = result.report.issues.filter((issue) => issue.severity === "problem");
		assert.ok(
			problems.some((issue) => issue.id === "git.missing"),
			"a missing Git is reported as a problem",
		);
		assert.ok(
			problems.some((issue) => issue.id === "pi.versionMismatch"),
			"a Pi pin mismatch is reported as a problem",
		);
		assert.equal(result.healthy, false, "any problem makes the report unhealthy");
		const text = formatDoctorReport(result.report, RENDER);
		const flattened = flat(text);
		assert.match(text, /^Notes$/mu);
		assert.match(text, /Result: action required/u);
		assert.match(text, /^ {3}✗ /mu, "a problem carries the problem marker");
		for (const issue of problems) {
			assert.ok(flattened.includes(flat(issue.message)), `${issue.id} must be listed`);
		}

		const warnings = result.report.issues.filter((issue) => issue.severity === "warning");
		assert.ok(
			warnings.some((issue) => issue.id === "profile.notApplied"),
			"an unapplied profile is a warning, not a problem",
		);
		assert.match(text, /^ {3}⚠ /mu, "a warning carries the warning marker");
		for (const issue of warnings) {
			assert.ok(flattened.includes(flat(issue.message)), `${issue.id} must be listed`);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

const MINIMAL_REPORT = {
	schemaVersion: 1,
	experimental: true,
	healthy: true,
	fields: [{ id: "a", section: "runtime", label: "A", value: "1" }],
	issues: [],
	notes: ["Note text."],
};

test("a report without issues omits the notes block", () => {
	assert.equal(
		formatDoctorReport(MINIMAL_REPORT, { colorEnabled: false, columns: 40 }),
		[
			"Jouzu doctor",
			"",
			"Runtime",
			"   A  1",
			"",
			"   Note text.",
			"",
			"─".repeat(40),
			"✓ Result: ready for Jouzu v0.1 preview",
		].join("\n"),
	);
});

test("doctor styling is opt-in and every marker survives without color", () => {
	const plain = formatDoctorReport(MINIMAL_REPORT, { colorEnabled: false, columns: 40 });
	assert.ok(!plain.includes(ESCAPE), "a report without color emits no escape sequences");

	const colored = formatDoctorReport(MINIMAL_REPORT, { colorEnabled: true, colorMode: "16", columns: 40 });
	assert.ok(colored.includes(`${ESCAPE}[1mJouzu doctor${ESCAPE}[22m`), "the command name is bold");
	assert.ok(colored.includes(`${ESCAPE}[32m✓${ESCAPE}[39m Result: ready`), "a healthy result is green");
	// Stripping the styling returns the same report, so color adds no meaning of its own.
	assert.equal(stripAnsi(colored), plain);
});
