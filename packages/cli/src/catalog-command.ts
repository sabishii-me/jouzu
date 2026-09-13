import { existsSync, lstatSync, readFileSync } from "node:fs";
import { catalogInsecureTransportWarning, resolveCatalogSources } from "./catalog-sources.js";
import {
	CommandReport,
	type CommandReportEntry,
	type CommandReportField,
	type CommandReportOptions,
	type CommandReportStatus,
} from "./command-report.js";
import { type CatalogConformanceResult, checkCatalogConformance } from "./model-catalog.js";
import {
	type CatalogStatuses,
	type CatalogSyncStatus,
	getCatalogSourceStatus,
	getCatalogStatuses,
} from "./model-catalog-sync.js";
import type { JouzuPaths } from "./paths.js";

export type CatalogStatus = CatalogStatuses;

type ConfiguredCatalogStatus = Extract<CatalogSyncStatus, { configured: true }>;

const UNCONFIGURED_MESSAGE =
	"No model catalog endpoint is configured. Jouzu continues using Pi and local model configuration.";

export function catalogStatus(
	paths: JouzuPaths,
	env: NodeJS.ProcessEnv = process.env,
	sourceId?: string,
): CatalogStatus | CatalogSyncStatus {
	if (!sourceId) return getCatalogStatuses(paths, env);
	const source = resolveCatalogSources(paths, env, { includeDisabled: true }).find(
		(candidate) => candidate.id === sourceId,
	);
	if (!source) throw new Error(`catalog source not found: ${sourceId}`);
	return getCatalogSourceStatus(paths, source, new Date(), env);
}

function sourceStatusWord(status: ConfiguredCatalogStatus): string {
	return status.enabled ? status.status : "disabled";
}

function sourceMarker(status: ConfiguredCatalogStatus): CommandReportStatus {
	if (!status.enabled) return "idle";
	if (status.lastError) return "problem";
	if (status.status === "active") return "ok";
	if (status.status === "stale") return "warning";
	return "idle";
}

function describeCredential(status: ConfiguredCatalogStatus): string | undefined {
	if (!status.credentialName) return undefined;
	if (status.credentialAvailable && status.credentialEnv) return `environment variable ${status.credentialName} (set)`;
	if (status.credentialAvailable) return `saved token (environment variable ${status.credentialName} not set)`;
	return `environment variable ${status.credentialName} (not set)`;
}

/** Hoist every condition a user may need to act on, keyed by the source it came from. */
function sourceNotes(status: CatalogSyncStatus): CommandReportEntry[] {
	if (!status.configured) return [];
	const key = status.sourceId;
	const notes: CommandReportEntry[] = [];
	const transportWarning = catalogInsecureTransportWarning(status.endpoint);
	if (transportWarning) notes.push({ status: "warning", key, message: transportWarning });
	if (status.credentialName && !status.credentialAvailable) {
		notes.push({
			status: "warning",
			key,
			message: `token variable ${status.credentialName} is not set and no token is saved for this source; refreshes are skipped until one is available.`,
		});
	}
	if (status.thinkingLevelGaps?.length) {
		notes.push({
			status: "warning",
			key,
			message: `${status.thinkingLevelGaps.length} of ${status.offeringCount ?? "?"} offerings have no declared levels, so Jouzu cannot control their reasoning effort.`,
		});
	}
	if (status.conflict) notes.push({ status: "warning", key, message: status.conflict });
	if (status.quarantined > 0) {
		notes.push({ status: "warning", key, message: `${status.quarantined} candidate revisions are quarantined.` });
	}
	if (status.lastError) {
		notes.push({ status: "problem", key, message: `${status.lastError.code}: ${status.lastError.message}` });
	}
	return notes;
}

function sourceFields(status: ConfiguredCatalogStatus): CommandReportField[] {
	const fields: CommandReportField[] = [{ label: "Endpoint", value: status.endpoint }];
	if (status.catalogId) fields.push({ label: "Catalog", value: status.catalogId });
	if (status.offeringCount !== undefined) fields.push({ label: "Models", value: String(status.offeringCount) });
	if (status.thinkingLevelGaps?.length) {
		fields.push({
			label: "Thinking levels",
			value: `${status.thinkingLevelGaps.length} of ${status.offeringCount ?? "?"} offerings have no declared levels`,
			details: status.thinkingLevelGaps.map((gap) => `${gap.providerId}/${gap.modelId}`),
		});
	}
	if (status.revision) fields.push({ label: "Revision", value: status.revision });
	if (status.sequence) fields.push({ label: "Sequence", value: status.sequence });
	if (status.validatedAt) fields.push({ label: "Validated", value: status.validatedAt });
	const credential = describeCredential(status);
	if (credential) fields.push({ label: "Credential", value: credential });
	if (status.quarantined > 0) fields.push({ label: "Quarantined candidates", value: String(status.quarantined) });
	if (status.lastError) {
		fields.push({ label: "Last error", value: `${status.lastError.code}: ${status.lastError.message}` });
	}
	return fields;
}

function renderSource(out: CommandReport, status: ConfiguredCatalogStatus): void {
	const word = sourceStatusWord(status);
	out.section(status.label, sourceFields(status), {
		status: sourceMarker(status),
		detail: status.label === status.sourceId ? word : `[${status.sourceId}] · ${word}`,
	});
}

export function formatCatalogStatus(
	status: CatalogStatus | CatalogSyncStatus,
	options: CommandReportOptions = {},
): string {
	const out = new CommandReport(options);
	if (!("sources" in status)) {
		if (!status.configured) return out.title("Jouzu model catalog", status.status).paragraph(status.message).toString();
		out.title("Jouzu model catalog");
		const notes = sourceNotes(status);
		out.entries("Notes", notes);
		if (notes.length > 0) out.rule();
		renderSource(out, status);
		return out.toString();
	}
	out.title("Jouzu model catalogs", status.status, `${status.active} of ${status.configured} sources active`);
	if (status.status === "unconfigured") return out.paragraph(UNCONFIGURED_MESSAGE).toString();
	const notes = status.sources.flatMap(sourceNotes);
	out.entries("Notes", notes);
	if (notes.length > 0) out.rule();
	for (const source of status.sources) {
		if (source.configured) renderSource(out, source);
	}
	return out.toString();
}

export function validateCatalogFile(path: string, remote: boolean): CatalogConformanceResult {
	if (!existsSync(path)) {
		return {
			valid: false,
			error: { code: "invalid_json", path: "$", message: `catalog file does not exist: ${path}` },
		};
	}
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		return {
			valid: false,
			error: { code: "invalid_json", path: "$", message: `catalog path must be a regular file: ${path}` },
		};
	}
	return checkCatalogConformance(readFileSync(path, "utf8"), { remote });
}
