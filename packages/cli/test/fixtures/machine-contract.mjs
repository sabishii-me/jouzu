/**
 * Shared machine-contract pins for the CLI tests.
 *
 * These literals are the contract automation depends on: the `--json` keys,
 * the process exit codes, and the doctor field and issue identifiers. The
 * contract tests import them so a rename or a dropped key fails the build.
 */

export const DOCTOR_REPORT_KEYS = ["schemaVersion", "experimental", "healthy", "fields", "issues", "notes"];

export const DOCTOR_FIELD_KEYS = ["id", "section", "label", "value"];

export const DOCTOR_ISSUE_KEYS = ["id", "severity", "message"];

export const DOCTOR_FIELD_IDS = [
	"jouzu.version",
	"pi.runtime",
	"pi.upstream",
	"pi.qualification",
	"profile.schema",
	"extensions.releaseOwned",
	"skills.packageOwned",
	"extensions.compatibilityDependencies",
	"camoufox.runtime",
	"update.installChannel",
	"executable",
	"catalog.sources",
	"catalog.offerings",
	"catalog.registration",
	"catalog.thinkingLevels",
	"update.policy",
	"update.channel",
	"update.startupEligible",
	"update.lastCheckedAt",
	"update.latestVersion",
	"keybindings.status",
	"keybindings.policy",
	"keybindings.followUpKey",
	"keybindings.dequeueKey",
	"keybindings.configPath",
	"platform",
	"node",
	"locale",
	"git",
	"bash",
	"npm",
	"proxy",
	"extraCaCerts",
	"localization.requested",
	"localization.effective",
	"localization.source",
	"localization.fallback",
	"localization.catalogVersion",
	"localization.catalogDigest",
	"localization.catalogFallback",
	"localization.catalogState",
	"localization.supportStates",
	"language.responseLanguage.requested",
	"language.responseLanguage.effective",
	"language.responseLanguage.source",
	"language.artifactPolicy.requested",
	"language.artifactPolicy.effective",
	"language.artifactPolicy.source",
	"language.projectPolicy",
	"upstream.surfaces.total",
	"upstream.surfaces.translated",
	"upstream.surfaces.upstreamOwned",
	"upstream.surfaces.notInspected",
	"upstream.surfaces.outOfScope",
	"upstream.supportStage",
	"paths.agentDir",
	"paths.stateDir",
	"paths.sessionDir",
	"paths.cacheDir",
	"modelPicker.state",
	"isolation.piAgentDir",
	"isolation.piSessionDir",
	"lock.profile",
	"lock.piImport",
	"lock.keybindings",
	"lock.modelPicker",
	"lock.update",
	"lock.camoufoxRuntime",
	"skills.shared",
	"profile.selected",
	"profile.bundledManifest",
	"profile.appliedManifest",
	"packages.count",
	"provider.authFile",
	"provider.modelsFile",
	"provider.environment",
];

export const DOCTOR_DEFAULT_ISSUE_IDS = ["provider.unconfigured", "profile.notApplied"];

export const DOCTOR_PROBLEM_ISSUE_IDS = [
	"node.unsupported",
	"git.missing",
	"bash.missing",
	"npm.missing",
	"pi.versionMismatch",
	"pi.runtimeUnavailable",
	"pi.lockUnqualified",
	"provider.unconfigured",
	"profile.drift",
	"update.lastFailed",
	"update.statusUnavailable",
	"keybindings.conflict",
	"keybindings.statusUnavailable",
	"extensions.unavailable",
	"extensions.optionalUnavailable",
	"extensions.manifestInvalid",
	"catalog.statusUnavailable",
];

export const KEYBINDING_PLAN_KEYS = [
	"schemaVersion",
	"defaultsVersion",
	"configPath",
	"statePath",
	"configExists",
	"policy",
	"status",
	"portabilityWarnings",
	"actions",
];

export const KEYBINDING_ACTION_KEYS = ["type", "action", "binding", "reason"];

export const CATALOG_STATUS_KEYS = ["schemaVersion", "status", "configured", "active", "sources"];

export const CATALOG_SOURCE_KEYS = [
	"schemaVersion",
	"status",
	"configured",
	"sourceId",
	"label",
	"enabled",
	"endpoint",
	"credentialName",
	"credentialAvailable",
	"credentialEnv",
	"credentialStored",
	"quarantined",
];
