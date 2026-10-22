import { constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import {
	CAMOUFOX_INSTALL_LOCK_STALE_MS,
	inspectJouzuCamoufoxRuntime,
	resolveCamoufoxRuntimePaths,
} from "./camoufox-adapter.js";
import {
	CatalogMessageId,
	type CatalogMessageRef,
	type CatalogRenderOptions,
	catalogFieldLabel,
	catalogMessage,
	catalogMessageText,
	catalogText,
	defaultCatalog,
} from "./cli-messages.js";
import { CommandReport, commandReportKey, pluralize } from "./command-report.js";
import type { HumanMessageValue } from "./human-messages.js";
import type { KeybindingPlan } from "./keybindings.js";
import { keybindingPolicyMessage, keybindingStatusMessage } from "./keybindings.js";
import {
	formatArtifactPolicy,
	type ProjectPolicyState,
	type ResolvedArtifactPolicy,
	type ResolvedResponseLanguage,
} from "./language-settings.js";
import type { CatalogBundle, CatalogSummary } from "./locale-catalog.js";
import type { CatalogSupportEntry } from "./locale-status.js";
import type { JouzuMetadata } from "./metadata.js";
import {
	type CatalogRegistrationGap,
	type CatalogThinkingLevelGap,
	describeCatalogRegistrationEffect,
	describeCatalogRegistrationGaps,
} from "./model-catalog.js";
import { loadModelPickerState } from "./model-picker-state.js";
import type { JouzuPaths } from "./paths.js";
import type { ReleaseExtensionStatus } from "./release-extensions.js";
import { RELEASE_SURFACE_PI_PROVENANCE, summarizeReleaseSurfaces } from "./release-extensions.js";
import type { ProfileSelection } from "./runtime.js";
import {
	ageText,
	inspectStateLock,
	STATE_LOCK_STALE_MS,
	type StateLockInspection,
	type StateLockStatus,
} from "./state-lock.js";
import type { ResolvedUiLocale } from "./ui-locale.js";
import {
	type UpdateInstallChannel,
	type UpdateStatus,
	updateInstallChannelMessage,
	updatePolicyMessage,
} from "./updater.js";

const PROVIDER_ENVIRONMENT_KEYS = [
	"ANTHROPIC_API_KEY",
	"ANT_LING_API_KEY",
	"OPENAI_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"DEEPSEEK_API_KEY",
	"NVIDIA_API_KEY",
	"GEMINI_API_KEY",
	"AWS_BEARER_TOKEN_BEDROCK",
	"AWS_PROFILE",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"OPENROUTER_API_KEY",
	"AI_GATEWAY_API_KEY",
	"ZAI_API_KEY",
	"HF_TOKEN",
	"KIMI_API_KEY",
	"MINIMAX_API_KEY",
] as const;

/** What one active catalog describes. Doctor names the source so a gap points somewhere. */
export interface DoctorCatalogSource {
	sourceId: string;
	label: string;
	offerings: number;
	thinkingLevelGaps: readonly CatalogThinkingLevelGap[];
	registrationGaps: readonly CatalogRegistrationGap[];
}

export interface DoctorContext {
	metadata: JouzuMetadata;
	paths: JouzuPaths;
	profile: ProfileSelection;
	piRuntimeVersion: string;
	piRuntimeDiagnostic?: string;
	executable: string;
	env?: NodeJS.ProcessEnv;
	inheritedPiAgentDir?: string;
	inheritedPiSessionDir?: string;
	platform?: NodeJS.Platform;
	architecture?: string;
	nodeVersion?: string;
	locale?: string;
	/**
	 * The startup-resolved UI locale, read from the option, `JOUZU_UI_LOCALE`,
	 * and `<configDir>/localization.json`. Carried here so the diagnostics issue
	 * can render requested, effective, source, and fallback without re-reading.
	 */
	uiLocale?: ResolvedUiLocale;
	/**
	 * The startup-resolved response language and artifact policy, and the trusted
	 * project policy state. Carried here so `doctor` renders the requested value,
	 * the effective value, and the source for both settings without re-resolving.
	 */
	responseLanguage?: ResolvedResponseLanguage;
	artifactPolicy?: ResolvedArtifactPolicy;
	projectPolicy?: ProjectPolicyState;
	/**
	 * The startup-resolved UI locale catalog, loaded on demand by the `doctor`
	 * branch. Carried as plain values so `doctor` never imports the Fluent
	 * loader at module scope. When absent, the catalog fields report
	 * `unavailable`.
	 */
	catalog?: CatalogSummary;
	/**
	 * The per-locale support states read from the shipped status record. Carried
	 * as plain values so the renderer never re-reads the record. When absent, the
	 * two support-state fields report `unavailable`.
	 */
	catalogSupport?: readonly CatalogSupportEntry[];
	commandPaths?: { git: string | null; bash: string | null; npm: string | null };
	desiredProfileManifestSha256?: string;
	updateStatus?: UpdateStatus;
	updateDiagnostic?: string;
	keybindingPlan?: KeybindingPlan;
	keybindingDiagnostic?: string;
	releaseExtensionStatus?: ReleaseExtensionStatus;
	releaseExtensionDiagnostic?: string;
	catalogSources?: readonly DoctorCatalogSource[];
	catalogDiagnostic?: string;
	/** Terminal capabilities for the rendered text report; the JSON report is unaffected. */
	render?: CatalogRenderOptions;
}

export type DoctorSeverity = "warning" | "problem";

export type DoctorSectionId = "runtime" | "catalog" | "platform" | "localization" | "upstream" | "roots" | "profile";

/** One observed fact. Schema 1 IDs are machine keys, but remain experimental through v0.1.x. */
export interface DoctorField {
	id: string;
	section: DoctorSectionId;
	label: string;
	value: string;
}

/** One diagnosis. Several issues may attach to the same observed field. */
export interface DoctorIssue {
	id: string;
	severity: DoctorSeverity;
	message: string;
	/** What the diagnosis is about, such as a catalog source. Defaults to the identifier's first segment. */
	subject?: string;
}

/**
 * A field value is either a protected value rendered as-is, or a catalog
 * message. The report stores the English text either way, so `--json` is
 * unchanged; the human renderer resolves the catalog ID in the active locale.
 */
type DoctorFieldValue = string | CatalogMessageRef;

export interface DoctorReport {
	schemaVersion: 1;
	experimental: true;
	healthy: boolean;
	fields: DoctorField[];
	issues: DoctorIssue[];
	notes: string[];
}

export interface DoctorResult {
	text: string;
	healthy: boolean;
	report: DoctorReport;
}

/**
 * The catalog identity of one diagnosis. It is kept in a side table rather than
 * on `DoctorIssue`, so the `--json` report keeps the English machine text it has
 * always had while the text renderer rebuilds the message in the resolved
 * locale. A function argument is used by the catalog warnings, whose embedded
 * gap and effect fragments are themselves catalog messages.
 */
type DoctorIssueArgs =
	| Readonly<Record<string, HumanMessageValue>>
	| ((catalog: CatalogBundle) => Readonly<Record<string, HumanMessageValue>>);

interface DoctorIssueCatalogMessage {
	readonly messageId: CatalogMessageId;
	readonly args?: DoctorIssueArgs;
}

const ISSUE_CATALOG_MESSAGES = new WeakMap<DoctorIssue, DoctorIssueCatalogMessage>();

/** The catalog identity of one field value, kept beside the English report value. */
const FIELD_CATALOG_MESSAGES = new WeakMap<DoctorField, CatalogMessageRef>();

/** The catalog identity of each note, keyed by the notes array the report carries. */
const NOTE_CATALOG_MESSAGES = new WeakMap<readonly string[], readonly CatalogMessageRef[]>();

function resolveIssueArgs(
	args: DoctorIssueArgs | undefined,
	catalog: CatalogBundle,
): Readonly<Record<string, HumanMessageValue>> | undefined {
	return typeof args === "function" ? args(catalog) : args;
}

/**
 * The English label for one observed-value row.
 *
 * The catalog holds the same English string under the row's stable id, so the
 * literal is not repeated here. The report keeps that English text for `--json`,
 * and `catalogFieldLabel` re-resolves the id in the active locale for the human
 * renderer. An id with no mapping keeps the id itself, so an unmapped row stays
 * identifiable instead of rendering an empty label.
 */
function doctorFieldLabel(id: string): string {
	return catalogFieldLabel(defaultCatalog(), id, id);
}

const DOCTOR_SECTION_ORDER: readonly DoctorSectionId[] = [
	"runtime",
	"catalog",
	"platform",
	"localization",
	"upstream",
	"roots",
	"profile",
];

const DOCTOR_SECTION_HEADING_IDS: Readonly<Record<DoctorSectionId, CatalogMessageId>> = Object.freeze({
	runtime: CatalogMessageId.doctorSectionRuntime,
	catalog: CatalogMessageId.doctorSectionCatalog,
	platform: CatalogMessageId.doctorSectionPlatform,
	localization: CatalogMessageId.doctorSectionLocalization,
	upstream: CatalogMessageId.doctorSectionUpstream,
	roots: CatalogMessageId.doctorSectionRoots,
	profile: CatalogMessageId.doctorSectionProfile,
});

/**
 * The catalog ID for the residual upstream-English constraint.
 *
 * It is catalog-only rather than a `CatalogMessageId` member so this constraint
 * does not widen the shared message table; `check-locales.mjs` accepts an ID
 * that is present in both locales without a table entry. The message is human
 * text only: it is rendered beside the report and never stored on it, so the
 * `--json` keys and values stay unchanged.
 */
const UPSTREAM_CONSTRAINT_MESSAGE_ID = "jouzu.cli.doctor.upstreamConstraint";

/**
 * Render the human report. Diagnoses are hoisted above the observed values so a user
 * sees what needs attention first; sections then follow in a fixed order, so adding a
 * field never changes unrelated output.
 */
export function formatDoctorReport(report: DoctorReport, options: CatalogRenderOptions = {}): string {
	const catalog = options.catalog ?? defaultCatalog();
	const text = (id: CatalogMessageId): string => catalogText(catalog, id);
	const out = new CommandReport(options);
	const fieldValue = (id: string): string | undefined => report.fields.find((field) => field.id === id)?.value;
	const piRuntime = fieldValue("pi.runtime");
	out.title(
		text(CatalogMessageId.doctorTitle),
		fieldValue("jouzu.version"),
		piRuntime && `pi ${piRuntime}`,
		fieldValue("platform"),
	);
	out.entries(
		text(CatalogMessageId.doctorNotes),
		report.issues.map((issue) => {
			const catalogMessage = ISSUE_CATALOG_MESSAGES.get(issue);
			return {
				status: issue.severity === "problem" ? ("problem" as const) : ("warning" as const),
				key: issue.subject ?? commandReportKey(issue.id),
				message:
					catalogMessage === undefined
						? issue.message
						: catalogText(catalog, catalogMessage.messageId, resolveIssueArgs(catalogMessage.args, catalog)),
			};
		}),
	);
	if (report.issues.length > 0) out.rule();
	for (const section of DOCTOR_SECTION_ORDER) {
		out.section(
			text(DOCTOR_SECTION_HEADING_IDS[section]),
			report.fields
				.filter((field) => field.section === section)
				.map((field) => {
					const valueRef = FIELD_CATALOG_MESSAGES.get(field);
					return {
						label: catalogFieldLabel(catalog, field.id, field.label),
						value: valueRef === undefined ? field.value : catalogMessageText(catalog, valueRef),
					};
				}),
		);
	}
	const noteRefs = NOTE_CATALOG_MESSAGES.get(report.notes);
	report.notes.forEach((note, index) => {
		const noteRef = noteRefs?.[index];
		out.paragraph(noteRef === undefined ? note : catalogMessageText(catalog, noteRef));
	});
	// The residual upstream English is a user-facing constraint, not a report
	// value: the constraint is rendered only in the human text, so the `--json`
	// report keeps its keys and values. A real doctor report carries the
	// `pi.upstream` field, which is what ties the constraint to the observed
	// upstream pin; the minimal report used by the renderer tests has none.
	if (report.fields.some((field) => field.id === "pi.upstream")) {
		out.blank().paragraph(catalogText(catalog, UPSTREAM_CONSTRAINT_MESSAGE_ID));
		if (piRuntime && piRuntime !== RELEASE_SURFACE_PI_PROVENANCE.version) {
			out.paragraph(
				catalogText(catalog, "jouzu.cli.doctor.surfaceRecheck", {
					recorded: RELEASE_SURFACE_PI_PROVENANCE.version,
					current: piRuntime,
				}),
			);
		}
	}
	const problems = report.issues.filter((issue) => issue.severity === "problem").length;
	const warnings = report.issues.length - problems;
	out.blank().rule();
	out.tally([
		{
			status: problems > 0 ? "problem" : "ok",
			text: pluralize(problems, text(CatalogMessageId.reportProblem), text(CatalogMessageId.reportProblems)),
		},
		{
			status: warnings > 0 ? "warning" : "ok",
			text: pluralize(warnings, text(CatalogMessageId.reportWarning), text(CatalogMessageId.reportWarnings)),
		},
	]);
	out.paragraph(text(CatalogMessageId.doctorHint));
	return out.toString();
}

function parseNodeVersion(version: string): [number, number, number] {
	const [major = "0", minor = "0", patch = "0"] = version.replace(/^v/, "").split(".");
	return [Number(major), Number(minor), Number(patch)];
}

function nodeIsSupported(version: string): boolean {
	const [major, minor, patch] = parseNodeVersion(version);
	return major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0)));
}

function executableExists(path: string, platform: NodeJS.Platform): boolean {
	try {
		return statSync(path).isFile() && (platform === "win32" || (statSync(path).mode & constants.S_IXUSR) !== 0);
	} catch {
		return false;
	}
}

function findExecutable(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
	const pathApi = platform === "win32" ? win32 : posix;
	const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
	const candidates = (env.PATH ?? "")
		.split(pathApi.delimiter)
		.filter(Boolean)
		.flatMap((directory) => extensions.map((extension) => pathApi.join(directory, `${name}${extension}`)));
	if (platform === "win32" && name === "bash") {
		for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
			if (root) candidates.push(pathApi.join(root, "Git", "bin", "bash.exe"));
		}
	}
	return candidates.find((candidate) => executableExists(candidate, platform));
}

function readPackageCount(settingsPath: string): { count: number; warning?: CatalogMessageId } {
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown };
		if (settings.packages === undefined) return { count: 0 };
		if (!Array.isArray(settings.packages)) return { count: 0, warning: CatalogMessageId.doctorWarningPackagesNotArray };
		return { count: settings.packages.length };
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return { count: 0 };
		return { count: 0, warning: CatalogMessageId.doctorWarningPackagesUnparseable };
	}
}

function describeInstallChannel(channel: UpdateInstallChannel | undefined): CatalogMessageRef {
	switch (channel) {
		case "global-npm":
			return catalogMessage(CatalogMessageId.doctorValueGlobalNpmInstall);
		case "local-npm":
			return catalogMessage(CatalogMessageId.doctorValueLocalNpmInstall);
		case "ephemeral-npx":
			return catalogMessage(CatalogMessageId.doctorValueNpxInstall);
		case "source":
			return catalogMessage(CatalogMessageId.doctorValueSourceCheckout);
		case "other":
			return catalogMessage(CatalogMessageId.doctorValueOther);
		default:
			return catalogMessage(CatalogMessageId.doctorValueUnavailable);
	}
}

/**
 * The lock description a reader sees. The report keeps the English text as its
 * field value, so the message travels as a catalog reference and the renderer
 * resolves it for the selected locale.
 */
export function stateLockValue(inspection: StateLockInspection, staleMs: number): CatalogMessageRef {
	const id = STATE_LOCK_VALUE_IDS[inspection.status];
	if (inspection.status === "free" || inspection.status === "unreadable" || inspection.status === "invalid") {
		return catalogMessage(id);
	}
	const age = ageText(inspection.ageMs ?? 0);
	if (inspection.status === "held-live") return catalogMessage(id, { age });
	return catalogMessage(id, { age, recover: ageText(staleMs) });
}

const STATE_LOCK_VALUE_IDS: Record<StateLockStatus, CatalogMessageId> = {
	free: CatalogMessageId.doctorValueLockFree,
	"held-live": CatalogMessageId.doctorValueLockHeldLive,
	"held-dead": CatalogMessageId.doctorValueLockHeldDead,
	"owner-unknown": CatalogMessageId.doctorValueLockOwnerUnknown,
	unreadable: CatalogMessageId.doctorValueLockUnreadable,
	invalid: CatalogMessageId.doctorValueLockInvalid,
};

function userHome(env: NodeJS.ProcessEnv): string {
	return env.HOME ?? env.USERPROFILE ?? homedir();
}

/**
 * Render the trusted project-policy state for the diagnostics row.
 *
 * An untrusted or absent repository keeps its status token; a trusted policy
 * renders its fields; an invalid file renders the catalog reason it carries.
 */
function describeProjectPolicy(state: ProjectPolicyState | undefined): DoctorFieldValue {
	if (state === undefined) return catalogMessage(CatalogMessageId.doctorValueUnavailable);
	if (state.status === "ok") {
		const text = formatArtifactPolicy(state.artifactPolicy);
		return text.length > 0 ? text : catalogMessage(CatalogMessageId.doctorValueNone);
	}
	if (state.status === "invalid") return state.reason;
	return state.status;
}

/**
 * The support state of the UI catalog this run uses.
 *
 * `fallback` describes the request rather than the catalog: it is reported when
 * the requested locale was not served by its own catalog and English was used
 * instead. The state token is a protected identifier and is never translated.
 */
function describeCatalogState(context: DoctorContext): DoctorFieldValue {
	const catalog = context.catalog;
	const support = context.catalogSupport;
	if (catalog === undefined || support === undefined) {
		return catalogMessage(CatalogMessageId.doctorValueUnavailable);
	}
	if (catalog.effective !== catalog.requested) return "fallback";
	const effective = catalog.effective;
	return support.find((entry) => entry.locale === effective)?.state ?? "unsupported";
}

/** One `locale=state` row per recorded catalog, in record order. */
function describeCatalogSupportStates(entries: readonly CatalogSupportEntry[]): DoctorFieldValue {
	if (entries.length === 0) return catalogMessage(CatalogMessageId.doctorValueUnavailable);
	return entries.map((entry) => `${entry.locale}=${entry.state}`).join("; ");
}

export function createDoctorReport(context: DoctorContext): DoctorResult {
	const env = context.env ?? process.env;
	const platform = context.platform ?? process.platform;
	const architecture = context.architecture ?? process.arch;
	const nodeVersion = context.nodeVersion ?? process.version;
	const locale = context.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
	const pathApi = platform === "win32" ? win32 : posix;

	const fields: DoctorField[] = [];
	const issues: DoctorIssue[] = [];
	const notes: string[] = [];
	const field = (section: DoctorSectionId, id: string, label: string, value: DoctorFieldValue): void => {
		const doctorField: DoctorField = {
			id,
			section,
			label,
			value: typeof value === "string" ? value : catalogMessageText(defaultCatalog(), value),
		};
		if (typeof value !== "string") FIELD_CATALOG_MESSAGES.set(doctorField, value);
		fields.push(doctorField);
	};
	const recordIssue = (
		id: string,
		severity: DoctorSeverity,
		messageId: CatalogMessageId,
		args?: DoctorIssueArgs,
		subject?: string,
	): void => {
		const issue: DoctorIssue = {
			id,
			severity,
			message: catalogText(defaultCatalog(), messageId, resolveIssueArgs(args, defaultCatalog())),
			...(subject ? { subject } : {}),
		};
		ISSUE_CATALOG_MESSAGES.set(issue, args === undefined ? { messageId } : { messageId, args });
		issues.push(issue);
	};
	const problem = (id: string, messageId: CatalogMessageId, args?: DoctorIssueArgs, subject?: string): void =>
		recordIssue(id, "problem", messageId, args, subject);
	const warning = (id: string, messageId: CatalogMessageId, args?: DoctorIssueArgs, subject?: string): void =>
		recordIssue(id, "warning", messageId, args, subject);

	const settingsPath = pathApi.join(context.paths.agentDir, "settings.json");
	const authPath = pathApi.join(context.paths.agentDir, "auth.json");
	const modelsPath = pathApi.join(context.paths.agentDir, "models.json");
	const modelPickerStatePath = pathApi.join(context.paths.stateDir, "model-picker.json");
	const sharedSkillsPath = pathApi.resolve(userHome(env), ".agents", "skills");
	const packageState = readPackageCount(settingsPath);
	const gitPath = context.commandPaths ? (context.commandPaths.git ?? undefined) : findExecutable("git", env, platform);
	const bashPath = context.commandPaths
		? (context.commandPaths.bash ?? undefined)
		: findExecutable("bash", env, platform);
	const npmPath = context.commandPaths ? (context.commandPaths.npm ?? undefined) : findExecutable("npm", env, platform);
	const providerEnvironment = PROVIDER_ENVIRONMENT_KEYS.some((key) => Boolean(env[key]));
	const nodeSupported = nodeIsSupported(nodeVersion);
	const camoufoxRuntime = inspectJouzuCamoufoxRuntime(context.paths.stateDir);

	if (!nodeSupported) {
		problem("node.unsupported", CatalogMessageId.doctorProblemNodeUnsupported, { version: nodeVersion });
	}
	if (!gitPath) problem("git.missing", CatalogMessageId.doctorProblemGitMissing);
	if (!bashPath) problem("bash.missing", CatalogMessageId.doctorProblemBashMissing);
	if (!npmPath) problem("npm.missing", CatalogMessageId.doctorProblemNpmMissing);
	if (context.metadata.piVersion !== context.piRuntimeVersion) {
		problem("pi.versionMismatch", CatalogMessageId.doctorProblemPiVersionMismatch, {
			pinned: context.metadata.piVersion,
			loaded: context.piRuntimeVersion,
		});
	}
	if (context.piRuntimeDiagnostic) {
		problem("pi.runtimeUnavailable", CatalogMessageId.doctorProblemPiRuntimeUnavailable, {
			diagnostic: context.piRuntimeDiagnostic,
		});
	}
	if (context.metadata.lock.compatibilityStatus !== "qualified") {
		problem("pi.lockUnqualified", CatalogMessageId.doctorProblemPiLockUnqualified, {
			status: context.metadata.lock.compatibilityStatus,
		});
	}
	if (!existsSync(authPath) && !providerEnvironment && !existsSync(modelsPath)) {
		warning("provider.unconfigured", CatalogMessageId.doctorWarningProviderUnconfigured);
	}
	if (!context.profile.appliedManifestSha256) {
		warning("profile.notApplied", CatalogMessageId.doctorWarningProfileNotApplied);
	} else if (
		context.desiredProfileManifestSha256 &&
		context.profile.appliedManifestSha256 !== context.desiredProfileManifestSha256
	) {
		warning("profile.drift", CatalogMessageId.doctorWarningProfileDrift);
	}
	if (packageState.warning) warning("packages.invalid", packageState.warning);
	if (context.updateStatus?.state.lastResult === "failed") {
		warning("update.lastFailed", CatalogMessageId.doctorWarningUpdateLastFailed, {
			code: context.updateStatus.state.lastErrorCode ?? "unknown",
		});
	}
	if (context.updateDiagnostic) {
		warning("update.statusUnavailable", CatalogMessageId.doctorWarningUpdateStatusUnavailable, {
			diagnostic: context.updateDiagnostic,
		});
	}
	if (context.keybindingPlan?.actions.some((action) => action.type === "conflict")) {
		warning("keybindings.conflict", CatalogMessageId.doctorWarningKeybindingsConflict);
	}
	if (context.keybindingDiagnostic) {
		warning("keybindings.statusUnavailable", CatalogMessageId.doctorWarningKeybindingsStatusUnavailable, {
			diagnostic: context.keybindingDiagnostic,
		});
	}
	if (context.releaseExtensionStatus?.errors.length) {
		problem("extensions.unavailable", CatalogMessageId.doctorProblemExtensionsUnavailable, {
			errors: context.releaseExtensionStatus.errors.join("; "),
		});
	}
	if (context.releaseExtensionStatus?.degradedExtensions.length) {
		const degradedExtensions = context.releaseExtensionStatus.degradedExtensions;
		// A function argument rebuilds the failures from the active catalog, so the
		// "disabled tools" fragment localizes while the package names, versions, and
		// upstream error text stay protected values.
		problem(
			"extensions.optionalUnavailable",
			CatalogMessageId.doctorProblemExtensionsOptionalUnavailable,
			(catalog) => ({
				failures: degradedExtensions
					.map((failure) => {
						const tools =
							failure.tools.length > 0
								? catalogText(catalog, CatalogMessageId.doctorProblemExtensionsDisabledTools, {
										tools: failure.tools.join(", "),
									})
								: "";
						const error = failure.error.trim().replace(/\.+$/u, "");
						return `${failure.packageName}@${failure.packageVersion}${tools}: ${error}`;
					})
					.join("; "),
			}),
		);
	}
	if (context.releaseExtensionDiagnostic) {
		problem("extensions.manifestInvalid", CatalogMessageId.doctorProblemExtensionsManifestInvalid, {
			diagnostic: context.releaseExtensionDiagnostic,
		});
	}
	const catalogSources = context.catalogSources ?? [];
	const catalogOfferings = catalogSources.reduce((total, source) => total + source.offerings, 0);
	const registrationGapCount = catalogSources.reduce((total, source) => total + source.registrationGaps.length, 0);
	const thinkingLevelGapCount = catalogSources.reduce((total, source) => total + source.thinkingLevelGaps.length, 0);
	if (context.catalogDiagnostic) {
		warning("catalog.statusUnavailable", CatalogMessageId.doctorWarningCatalogStatusUnavailable, {
			diagnostic: context.catalogDiagnostic,
		});
	} else {
		// One diagnosis per source, so a count of zero usable offerings names the catalog to fix.
		for (const source of catalogSources) {
			if (source.registrationGaps.length === 0) continue;
			warning(
				`catalog.registration.${source.sourceId}`,
				CatalogMessageId.doctorWarningCatalogRegistration,
				(catalog) => ({
					complete: source.offerings - source.registrationGaps.length,
					total: source.offerings,
					gaps: describeCatalogRegistrationGaps(source.registrationGaps, catalog),
					effect: describeCatalogRegistrationEffect(catalog),
					sourceId: source.sourceId,
				}),
				source.sourceId,
			);
		}
		for (const source of catalogSources) {
			if (source.thinkingLevelGaps.length === 0) continue;
			warning(
				`catalog.thinkingLevels.${source.sourceId}`,
				CatalogMessageId.doctorWarningCatalogThinkingLevels,
				{
					count: source.thinkingLevelGaps.length,
					total: source.offerings,
					sourceId: source.sourceId,
				},
				source.sourceId,
			);
		}
	}
	if (camoufoxRuntime.status === "invalid") {
		problem("camoufox.runtimeInvalid", CatalogMessageId.doctorProblemCamoufoxRuntimeInvalid, {
			path: camoufoxRuntime.installRoot,
		});
	}
	let modelPickerState: DoctorFieldValue = catalogMessage(CatalogMessageId.doctorValueAbsent);
	if (existsSync(modelPickerStatePath)) {
		try {
			const state = loadModelPickerState(context.paths, { recover: false }).state;
			modelPickerState = catalogMessage(CatalogMessageId.doctorValueModelPicker, {
				defaults: Object.keys(state.defaults.projects).length,
				favorites: state.favorites.length,
				recents: state.recents.global.length,
				scopes: Object.keys(state.recents.projects).length,
			});
		} catch (error) {
			modelPickerState = catalogMessage(CatalogMessageId.doctorValueUnreadable);
			warning("modelPicker.unreadable", CatalogMessageId.doctorWarningModelPickerUnreadable, {
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	field("runtime", "jouzu.version", doctorFieldLabel("jouzu.version"), context.metadata.displayVersion);
	field("runtime", "pi.runtime", doctorFieldLabel("pi.runtime"), context.piRuntimeVersion);
	field(
		"runtime",
		"pi.upstream",
		doctorFieldLabel("pi.upstream"),
		`${context.metadata.lock.tag} (${context.metadata.lock.tagCommit})`,
	);
	if (context.metadata.lock.commit !== context.metadata.lock.tagCommit) {
		field("runtime", "pi.packageSource", doctorFieldLabel("pi.packageSource"), context.metadata.lock.commit);
	}
	field(
		"runtime",
		"pi.qualification",
		doctorFieldLabel("pi.qualification"),
		`${context.metadata.lock.compatibilityStatus}; deviations=${context.metadata.lock.deviations.length}`,
	);
	field("runtime", "profile.schema", doctorFieldLabel("profile.schema"), String(context.metadata.profileSchemaVersion));
	field(
		"runtime",
		"extensions.releaseOwned",
		doctorFieldLabel("extensions.releaseOwned"),
		context.releaseExtensionStatus
			? catalogMessage(
					context.releaseExtensionStatus.errors.length > 0
						? CatalogMessageId.doctorValueExtensionsReleaseOwnedRequired
						: CatalogMessageId.doctorValueExtensionsReleaseOwned,
					{
						selected: context.releaseExtensionStatus.extensionCount,
						ready: context.releaseExtensionStatus.resolvedExtensionPaths.length,
						optional: context.releaseExtensionStatus.degradedExtensions.length,
					},
				)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"skills.packageOwned",
		doctorFieldLabel("skills.packageOwned"),
		context.releaseExtensionStatus
			? catalogMessage(CatalogMessageId.doctorValueSkillsPackageOwned, {
					selected: context.releaseExtensionStatus.skillCount,
					ready: context.releaseExtensionStatus.resolvedSkillPaths.length,
				})
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"extensions.compatibilityDependencies",
		doctorFieldLabel("extensions.compatibilityDependencies"),
		context.releaseExtensionStatus
			? catalogMessage(CatalogMessageId.doctorValueCompatibilityDependencies, {
					selected: context.releaseExtensionStatus.manifest.compatibilityDependencies.length,
				})
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"camoufox.runtime",
		doctorFieldLabel("camoufox.runtime"),
		camoufoxRuntime.status === "not-installed"
			? catalogMessage(CatalogMessageId.doctorValueCamoufoxNotInstalled)
			: camoufoxRuntime.status === "invalid"
				? catalogMessage(CatalogMessageId.doctorValueInvalid)
				: catalogMessage(CatalogMessageId.doctorValueReady),
	);
	field(
		"runtime",
		"update.installChannel",
		doctorFieldLabel("update.installChannel"),
		describeInstallChannel(context.updateStatus?.installChannel),
	);
	field("runtime", "executable", doctorFieldLabel("executable"), context.executable);
	const catalogField = (gaps: number, describe: (gaps: number) => DoctorFieldValue): DoctorFieldValue => {
		if (context.catalogDiagnostic) return catalogMessage(CatalogMessageId.doctorValueUnavailable);
		if (catalogSources.length === 0) return catalogMessage(CatalogMessageId.doctorValueNoActiveCatalog);
		return gaps > 0 ? describe(gaps) : catalogMessage(CatalogMessageId.doctorValueComplete);
	};
	field(
		"catalog",
		"catalog.sources",
		doctorFieldLabel("catalog.sources"),
		context.catalogDiagnostic ? catalogMessage(CatalogMessageId.doctorValueUnavailable) : String(catalogSources.length),
	);
	field(
		"catalog",
		"catalog.offerings",
		doctorFieldLabel("catalog.offerings"),
		context.catalogDiagnostic ? catalogMessage(CatalogMessageId.doctorValueUnavailable) : String(catalogOfferings),
	);
	field(
		"catalog",
		"catalog.registration",
		doctorFieldLabel("catalog.registration"),
		catalogField(registrationGapCount, (gaps) =>
			catalogMessage(CatalogMessageId.doctorValueCatalogRegistration, {
				complete: catalogOfferings - gaps,
				total: catalogOfferings,
			}),
		),
	);
	field(
		"catalog",
		"catalog.thinkingLevels",
		doctorFieldLabel("catalog.thinkingLevels"),
		catalogField(thinkingLevelGapCount, (gaps) =>
			catalogMessage(CatalogMessageId.doctorValueCatalogThinkingLevels, { count: gaps, total: catalogOfferings }),
		),
	);
	for (const source of catalogSources) {
		field(
			"catalog",
			`catalog.source.${source.sourceId}`,
			source.label,
			catalogMessage(CatalogMessageId.doctorValueCatalogSource, {
				offerings: source.offerings,
				complete: source.offerings - source.registrationGaps.length,
				levels: source.thinkingLevelGaps.length,
			}),
		);
	}
	field(
		"runtime",
		"update.policy",
		doctorFieldLabel("update.policy"),
		context.updateStatus
			? updatePolicyMessage(context.updateStatus.policy)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"update.channel",
		doctorFieldLabel("update.channel"),
		context.updateStatus
			? updateInstallChannelMessage(context.updateStatus.installChannel)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"update.startupEligible",
		doctorFieldLabel("update.startupEligible"),
		context.updateStatus
			? catalogMessage(
					context.updateStatus.startupEligible
						? CatalogMessageId.doctorValueEligible
						: CatalogMessageId.doctorValueNotEligible,
				)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"update.lastCheckedAt",
		doctorFieldLabel("update.lastCheckedAt"),
		context.updateStatus?.state.lastCheckedAt ?? catalogMessage(CatalogMessageId.doctorValueNever),
	);
	field(
		"runtime",
		"update.latestVersion",
		doctorFieldLabel("update.latestVersion"),
		context.updateStatus?.state.latestVersion ?? catalogMessage(CatalogMessageId.doctorValueNotChecked),
	);
	field(
		"runtime",
		"keybindings.status",
		doctorFieldLabel("keybindings.status"),
		context.keybindingPlan
			? keybindingStatusMessage(context.keybindingPlan.status)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"runtime",
		"keybindings.policy",
		doctorFieldLabel("keybindings.policy"),
		context.keybindingPlan
			? keybindingPolicyMessage(context.keybindingPlan.policy)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field("runtime", "keybindings.followUpKey", doctorFieldLabel("keybindings.followUpKey"), "ctrl+enter");
	field("runtime", "keybindings.dequeueKey", doctorFieldLabel("keybindings.dequeueKey"), "ctrl+up");
	field(
		"runtime",
		"keybindings.configPath",
		doctorFieldLabel("keybindings.configPath"),
		context.keybindingPlan?.configPath ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);

	field("platform", "platform", doctorFieldLabel("platform"), `${platform} ${architecture}`);
	field(
		"platform",
		"node",
		doctorFieldLabel("node"),
		catalogMessage(
			nodeSupported ? CatalogMessageId.doctorValueNodeSupported : CatalogMessageId.doctorValueNodeUnsupported,
			{ version: nodeVersion },
		),
	);
	field("platform", "locale", doctorFieldLabel("locale"), locale);
	field("platform", "git", doctorFieldLabel("git"), gitPath ?? catalogMessage(CatalogMessageId.doctorValueNotFound));
	field("platform", "bash", doctorFieldLabel("bash"), bashPath ?? catalogMessage(CatalogMessageId.doctorValueNotFound));
	field("platform", "npm", doctorFieldLabel("npm"), npmPath ?? catalogMessage(CatalogMessageId.doctorValueNotFound));
	field(
		"platform",
		"proxy",
		doctorFieldLabel("proxy"),
		env.HTTP_PROXY || env.HTTPS_PROXY
			? catalogMessage(CatalogMessageId.doctorValueYes)
			: catalogMessage(CatalogMessageId.doctorValueNo),
	);
	field(
		"platform",
		"extraCaCerts",
		doctorFieldLabel("extraCaCerts"),
		env.NODE_EXTRA_CA_CERTS
			? catalogMessage(CatalogMessageId.doctorValueYes)
			: catalogMessage(CatalogMessageId.doctorValueNo),
	);

	// The UI locale is independent of `platform.locale`: the latter stays the OS
	// locale. Requested, effective, source, and the fallback reason are separate
	// fields so a reader can tell an explicit choice from an OS-derived value and
	// from a rejected raw value that fell back to English.
	field(
		"localization",
		"localization.requested",
		doctorFieldLabel("localization.requested"),
		context.uiLocale?.requested ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.effective",
		doctorFieldLabel("localization.effective"),
		context.uiLocale?.effective ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.source",
		doctorFieldLabel("localization.source"),
		context.uiLocale?.source ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.fallback",
		doctorFieldLabel("localization.fallback"),
		context.uiLocale
			? (context.uiLocale.fallback?.reason ?? catalogMessage(CatalogMessageId.doctorValueNone))
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.catalogVersion",
		doctorFieldLabel("localization.catalogVersion"),
		context.catalog?.version ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.catalogDigest",
		doctorFieldLabel("localization.catalogDigest"),
		context.catalog?.digest ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.catalogFallback",
		doctorFieldLabel("localization.catalogFallback"),
		context.catalog
			? (context.catalog.fallbackReason ?? catalogMessage(CatalogMessageId.doctorValueNone))
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"localization.catalogState",
		doctorFieldLabel("localization.catalogState"),
		describeCatalogState(context),
	);
	field(
		"localization",
		"localization.supportStates",
		doctorFieldLabel("localization.supportStates"),
		context.catalogSupport === undefined
			? catalogMessage(CatalogMessageId.doctorValueUnavailable)
			: describeCatalogSupportStates(context.catalogSupport),
	);

	// The response language and artifact policy are independent of the UI locale.
	// Requested, effective, and source are separate fields for each, so a reader
	// can tell an explicit choice from a saved or built-in value.
	field(
		"localization",
		"language.responseLanguage.requested",
		doctorFieldLabel("language.responseLanguage.requested"),
		context.responseLanguage?.requested ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.responseLanguage.effective",
		doctorFieldLabel("language.responseLanguage.effective"),
		context.responseLanguage?.effective ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.responseLanguage.source",
		doctorFieldLabel("language.responseLanguage.source"),
		context.responseLanguage?.source ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.artifactPolicy.requested",
		doctorFieldLabel("language.artifactPolicy.requested"),
		context.artifactPolicy
			? formatArtifactPolicy(context.artifactPolicy.requested) || catalogMessage(CatalogMessageId.doctorValueNone)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.artifactPolicy.effective",
		doctorFieldLabel("language.artifactPolicy.effective"),
		context.artifactPolicy
			? formatArtifactPolicy(context.artifactPolicy.effective) || catalogMessage(CatalogMessageId.doctorValueNone)
			: catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.artifactPolicy.source",
		doctorFieldLabel("language.artifactPolicy.source"),
		context.artifactPolicy?.source ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"localization",
		"language.projectPolicy",
		doctorFieldLabel("language.projectPolicy"),
		describeProjectPolicy(context.projectPolicy),
	);

	// The upstream boundary record counts the display surfaces owned by the
	// pinned Pi, the third-party bundled extensions, the Jouzu-owned adapter,
	// and the external service. It is a bounded record of those surfaces, not
	// the product's overall translation state: the Jouzu-owned UI is
	// translated, and the labels name the record so the counts cannot be read
	// as the whole product.
	const upstreamSurfaces = summarizeReleaseSurfaces();
	field(
		"upstream",
		"upstream.surfaces.total",
		doctorFieldLabel("upstream.surfaces.total"),
		String(upstreamSurfaces.total),
	);
	field(
		"upstream",
		"upstream.surfaces.translated",
		doctorFieldLabel("upstream.surfaces.translated"),
		String(upstreamSurfaces.translated),
	);
	field(
		"upstream",
		"upstream.surfaces.upstreamOwned",
		doctorFieldLabel("upstream.surfaces.upstreamOwned"),
		String(upstreamSurfaces.upstreamOwned),
	);
	field(
		"upstream",
		"upstream.surfaces.notInspected",
		doctorFieldLabel("upstream.surfaces.notInspected"),
		String(upstreamSurfaces.notInspected),
	);
	field(
		"upstream",
		"upstream.surfaces.outOfScope",
		doctorFieldLabel("upstream.surfaces.outOfScope"),
		String(upstreamSurfaces.outOfScope),
	);
	field(
		"upstream",
		"upstream.supportStage",
		doctorFieldLabel("upstream.supportStage"),
		catalogMessage(CatalogMessageId.doctorValueUpstreamSupportStage),
	);

	field("roots", "paths.agentDir", doctorFieldLabel("paths.agentDir"), context.paths.agentDir);
	field("roots", "paths.stateDir", doctorFieldLabel("paths.stateDir"), context.paths.stateDir);
	field("roots", "paths.sessionDir", doctorFieldLabel("paths.sessionDir"), context.paths.sessionDir);
	field("roots", "paths.cacheDir", doctorFieldLabel("paths.cacheDir"), context.paths.cacheDir);
	field("roots", "modelPicker.state", doctorFieldLabel("modelPicker.state"), modelPickerState);
	field(
		"roots",
		"isolation.piAgentDir",
		doctorFieldLabel("isolation.piAgentDir"),
		context.inheritedPiAgentDir
			? catalogMessage(CatalogMessageId.doctorValueYes)
			: catalogMessage(CatalogMessageId.doctorValueNotSet),
	);
	field(
		"roots",
		"isolation.piSessionDir",
		doctorFieldLabel("isolation.piSessionDir"),
		context.inheritedPiSessionDir
			? catalogMessage(CatalogMessageId.doctorValueYes)
			: catalogMessage(CatalogMessageId.doctorValueNotSet),
	);
	const now = new Date();
	const stateLocks = [
		{ id: "lock.profile", file: "profile.lock", staleMs: STATE_LOCK_STALE_MS },
		{ id: "lock.piImport", file: "pi-import.lock", staleMs: STATE_LOCK_STALE_MS },
		{ id: "lock.keybindings", file: "keybindings.lock", staleMs: STATE_LOCK_STALE_MS },
		{ id: "lock.modelPicker", file: "model-picker.lock", staleMs: STATE_LOCK_STALE_MS },
		{ id: "lock.update", file: "self-update.lock", staleMs: STATE_LOCK_STALE_MS },
		{
			id: "lock.camoufoxRuntime",
			file: pathApi.relative(context.paths.stateDir, resolveCamoufoxRuntimePaths(context.paths.stateDir).installLock),
			staleMs: CAMOUFOX_INSTALL_LOCK_STALE_MS,
		},
	];
	for (const { id, file, staleMs } of stateLocks) {
		const path = pathApi.join(context.paths.stateDir, file);
		const inspection = inspectStateLock(path, now);
		field("roots", id, doctorFieldLabel(id), stateLockValue(inspection, staleMs));
		const status = inspection.status;
		if (status === "unreadable") {
			problem(`${id}.unreadable`, CatalogMessageId.doctorProblemLockUnreadable, { path });
		} else if (status === "held-dead" || status === "owner-unknown" || status === "invalid") {
			problem(`${id}.stale`, CatalogMessageId.doctorProblemLockStale, { path, status });
		}
	}
	field(
		"roots",
		"skills.shared",
		doctorFieldLabel("skills.shared"),
		catalogMessage(
			existsSync(sharedSkillsPath)
				? CatalogMessageId.doctorValueSkillsSharedPresent
				: CatalogMessageId.doctorValueSkillsSharedAbsent,
			{ path: sharedSkillsPath },
		),
	);

	field(
		"profile",
		"profile.selected",
		doctorFieldLabel("profile.selected"),
		`${context.profile.id} (${context.profile.source})`,
	);
	field(
		"profile",
		"profile.bundledManifest",
		doctorFieldLabel("profile.bundledManifest"),
		context.desiredProfileManifestSha256 ?? catalogMessage(CatalogMessageId.doctorValueUnavailable),
	);
	field(
		"profile",
		"profile.appliedManifest",
		doctorFieldLabel("profile.appliedManifest"),
		context.profile.appliedManifestSha256 ?? catalogMessage(CatalogMessageId.doctorValueNotApplied),
	);
	field("profile", "packages.count", doctorFieldLabel("packages.count"), String(packageState.count));
	field(
		"profile",
		"provider.authFile",
		doctorFieldLabel("provider.authFile"),
		existsSync(authPath)
			? catalogMessage(CatalogMessageId.doctorValuePresent)
			: catalogMessage(CatalogMessageId.doctorValueAbsent),
	);
	field(
		"profile",
		"provider.modelsFile",
		doctorFieldLabel("provider.modelsFile"),
		existsSync(modelsPath)
			? catalogMessage(CatalogMessageId.doctorValuePresent)
			: catalogMessage(CatalogMessageId.doctorValueAbsent),
	);
	field(
		"profile",
		"provider.environment",
		doctorFieldLabel("provider.environment"),
		providerEnvironment
			? catalogMessage(CatalogMessageId.doctorValuePresent)
			: catalogMessage(CatalogMessageId.doctorValueNotDetected),
	);

	const isolationNote = catalogMessageText(defaultCatalog(), catalogMessage(CatalogMessageId.doctorNoteIsolation));
	notes.push(isolationNote);
	NOTE_CATALOG_MESSAGES.set(notes, [catalogMessage(CatalogMessageId.doctorNoteIsolation)]);

	const report: DoctorReport = {
		schemaVersion: 1,
		experimental: true,
		healthy: !issues.some((issue) => issue.severity === "problem"),
		fields,
		issues,
		notes,
	};
	return { text: formatDoctorReport(report, context.render ?? {}), healthy: report.healthy, report };
}
