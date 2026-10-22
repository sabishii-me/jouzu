import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDoctorReport, formatDoctorReport } from "../dist/doctor.js";
import { CATALOG_LOCALES, CATALOG_VERSION, loadCatalog } from "../dist/locale-catalog.js";
import {
	CATALOG_SUPPORT_STATES,
	catalogSupportState,
	catalogSupportStates,
	reviewedCatalogLocales,
} from "../dist/locale-status.js";

/**
 * The support states a user reads in `jz doctor`.
 *
 * The state tokens are protected identifiers and stay in English in every
 * locale. These tests pin that each state is displayed, that a stale catalog is
 * never displayed as complete, and that the support stage claims only a locale
 * whose human review is recorded.
 */

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceLocales = join(cliRoot, "locales");
const RENDER = { colorEnabled: false, columns: 100 };

/** Collapse the renderer's alignment and wrapping so message assertions stay readable. */
function flat(text) {
	return text.replace(/\s+/gu, " ");
}

function metadata() {
	return {
		jouzuVersion: "0.1.19",
		displayVersion: "0.1.19",
		build: undefined,
		piVersion: "1.0.0",
		profileSchemaVersion: 1,
		lock: {
			schemaVersion: 2,
			repository: "https://github.com/earendil-works/pi",
			tag: "v1.0.0",
			tagCommit: "a13d35a742c6ef8462812a28fbe1d8c8b7431c32",
			commit: "a13d35a742c6ef8462812a28fbe1d8c8b7431c32",
			packages: {},
			reviewedAt: "2026-10-02",
			compatibilityStatus: "qualified",
			deviations: [],
		},
	};
}

function context(root, overrides = {}) {
	return {
		metadata: metadata(),
		paths: {
			agentDir: join(root, "agent"),
			stateDir: join(root, "state"),
			cacheDir: join(root, "cache"),
			sessionDir: join(root, "state", "sessions"),
			profileStatePath: join(root, "state", "profile-state.json"),
			backupDir: join(root, "state", "backups"),
		},
		profile: { id: "core", source: "default" },
		piRuntimeVersion: "1.0.0",
		executable: "/opt/jouzu/dist/cli.js",
		env: { HOME: root },
		platform: "linux",
		architecture: "x64",
		nodeVersion: "v22.19.0",
		locale: "en-US",
		uiLocale: { requested: "auto", effective: "en", source: "builtin" },
		commandPaths: { git: "/usr/bin/git", bash: "/usr/bin/bash", npm: "/usr/bin/npm" },
		...overrides,
	};
}

/** The plain `CatalogSummary` shape the doctor context carries. */
function summary(requested, effective, fallbackReason) {
	return {
		requested,
		effective,
		version: CATALOG_VERSION,
		digest: "a".repeat(64),
		...(fallbackReason ? { fallbackReason } : {}),
	};
}

/** Run a callback against a writable copy of the committed locales root. */
function withLocalesCopy(callback) {
	const dir = mkdtempSync(join(tmpdir(), "jouzu-support-state-"));
	try {
		const localesRoot = join(dir, "locales");
		cpSync(sourceLocales, localesRoot, { recursive: true });
		return callback(localesRoot);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Move the English source and refresh the lock, leaving the recorded digest behind. */
function moveEnglishSource(localesRoot) {
	const enPath = join(localesRoot, "en", "cli.ftl");
	writeFileSync(enPath, `${readFileSync(enPath, "utf8")}\n# source changed after translation\n`);
	const lockPath = join(localesRoot, "catalog.lock.json");
	const lock = JSON.parse(readFileSync(lockPath, "utf8"));
	lock.locales.en = createHash("sha256").update(readFileSync(enPath)).digest("hex");
	writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

function fieldValue(report, id) {
	return report.fields.find((field) => field.id === id)?.value;
}

function render(root, overrides, options = RENDER) {
	return flat(formatDoctorReport(createDoctorReport(context(root, overrides)).report, options));
}

test("the four states are distinct identifiers and each is displayed", () => {
	assert.deepEqual(
		[...CATALOG_SUPPORT_STATES],
		["complete", "partial", "stale", "fallback", "unsupported", "upstream-owned"],
	);
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-states-"));
	try {
		const text = render(root, {
			catalog: summary("en", "en"),
			catalogSupport: catalogSupportStates({ localesRoot: sourceLocales }),
		});
		// complete, unsupported, and upstream-owned are displayed in one report.
		assert.match(text, /UI catalog support state complete/u);
		assert.match(
			text,
			/Recorded UI catalog states en=complete; ja=complete; zh-Hans=unsupported; zh-Hant=unsupported/u,
		);
		assert.match(text, /Upstream-owned surfaces 42/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a request that fell back to English is displayed as fallback", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-fallback-"));
	try {
		const reason = 'no catalog for "zh-Hant" (canonical locale "zh-Hant"); using English';
		const overrides = {
			catalog: summary("zh-Hant", "en", reason),
			catalogSupport: catalogSupportStates({ localesRoot: sourceLocales }),
		};
		const report = createDoctorReport(context(root, overrides)).report;
		assert.equal(fieldValue(report, "localization.catalogState"), "fallback");
		assert.notEqual(fieldValue(report, "localization.catalogState"), "complete");
		assert.equal(fieldValue(report, "localization.catalogFallback"), reason);
		const text = render(root, overrides);
		assert.match(text, /UI catalog support state fallback/u);
		assert.doesNotMatch(text, /UI catalog support state complete/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an unreviewed locale is displayed as unsupported and never as complete", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-unsupported-"));
	try {
		const overrides = {
			catalog: summary("en", "en"),
			catalogSupport: catalogSupportStates({ localesRoot: sourceLocales }),
		};
		const report = createDoctorReport(context(root, overrides)).report;
		const states = fieldValue(report, "localization.supportStates");
		assert.match(states, /zh-Hans=unsupported/u);
		assert.match(states, /zh-Hant=unsupported/u);
		assert.doesNotMatch(states, /zh-Hans=complete|zh-Hant=complete/u);
		assert.equal(catalogSupportState("zh-Hans", { localesRoot: sourceLocales }), "unsupported");
		assert.equal(catalogSupportState("zh-Hant", { localesRoot: sourceLocales }), "unsupported");

		// The support stage claims only the reviewed, offered locales.
		const stage = loadCatalog("en").format("jouzu.cli.doctor.value.upstreamSupportStage");
		assert.match(stage, /English and Japanese/u);
		assert.doesNotMatch(stage, /Chinese|zh-Hans|zh-Hant/u);
		const reviewed = new Set(reviewedCatalogLocales({ localesRoot: sourceLocales }));
		for (const locale of CATALOG_LOCALES) assert.ok(reviewed.has(locale), `${locale} is offered without a review`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a stale catalog is displayed as stale and never as complete", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-stale-"));
	try {
		const states = withLocalesCopy((localesRoot) => {
			moveEnglishSource(localesRoot);
			return catalogSupportStates({ localesRoot });
		});
		assert.deepEqual(states, [
			{ locale: "en", state: "stale" },
			{ locale: "ja", state: "stale" },
			{ locale: "zh-Hans", state: "unsupported" },
			{ locale: "zh-Hant", state: "unsupported" },
		]);

		const overrides = { catalog: summary("ja", "ja"), catalogSupport: states };
		const report = createDoctorReport(context(root, overrides)).report;
		assert.equal(fieldValue(report, "localization.catalogState"), "stale");
		assert.notEqual(fieldValue(report, "localization.catalogState"), "complete");
		const supportStates = fieldValue(report, "localization.supportStates");
		assert.match(supportStates, /ja=stale/u);
		assert.doesNotMatch(supportStates, /ja=complete/u);
		const text = render(root, overrides);
		assert.match(text, /UI catalog support state stale/u);
		assert.doesNotMatch(text, /UI catalog support state complete/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the state tokens stay untranslated in the ja render", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-ja-"));
	try {
		const overrides = {
			catalog: summary("ja", "ja"),
			catalogSupport: catalogSupportStates({ localesRoot: sourceLocales }),
		};
		const report = createDoctorReport(context(root, overrides)).report;
		const text = flat(formatDoctorReport(report, { ...RENDER, locale: "ja", catalog: loadCatalog("ja") }));
		assert.match(text, /UI カタログの対応状態 complete/u);
		assert.match(text, /en=complete; ja=complete; zh-Hans=unsupported; zh-Hant=unsupported/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the support-state fields report unavailable without the status record", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-support-absent-"));
	try {
		const report = createDoctorReport(context(root, { catalog: summary("en", "en") })).report;
		assert.equal(fieldValue(report, "localization.catalogState"), "unavailable");
		assert.equal(fieldValue(report, "localization.supportStates"), "unavailable");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
