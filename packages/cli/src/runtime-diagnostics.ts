import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { type JouzuMetadata, loadMetadata } from "./metadata.js";

/**
 * The catalog ID for the runtime restart suffix. It stays local rather than
 * joining the shared `CatalogMessageId` table so a parallel surface migration
 * does not conflict on that file; `scripts/check-locales.mjs` allows a
 * catalog-only ID present in both locales.
 */
const RUNTIME_RESTART_AVAILABLE_ID = "jouzu.cli.runtime.restartAvailable";

/**
 * The catalog IDs for the `/flow runtime` report, the About view, and the
 * startup warning. A package name, a path, a version, a start timestamp, and a
 * SHA-256 hash are protected values passed as arguments; the words around them
 * resolve from the session bundle.
 */
const DIAGNOSTICS_MESSAGE_ID = {
	patchDiffers: "jouzu.cli.runtime.patchDiffers",
	patchUnavailable: "jouzu.cli.runtime.patchUnavailable",
	running: "jouzu.cli.runtime.running",
	pi: "jouzu.cli.runtime.pi",
	started: "jouzu.cli.runtime.started",
	installed: "jouzu.cli.runtime.installed",
	versionUnavailable: "jouzu.cli.runtime.versionUnavailable",
	installedDiffers: "jouzu.cli.runtime.installedDiffers",
	summaryLine: "jouzu.cli.runtime.summary",
	reportHeading: "jouzu.cli.runtime.reportHeading",
	buildChanged: "jouzu.cli.runtime.buildChanged",
} as const;

interface Patch {
	package: string;
	files: Record<string, string>;
}
export interface RuntimeDiagnostics {
	report(): string;
	about(): string;
	summary(): string;
	warnings(): string[];
}

/** A startup snapshot, not a claim that rereading disk reloads a running extension. */
export function createRuntimeDiagnostics(
	metadata: JouzuMetadata,
	packageRoots: Record<string, string>,
	options: { readMetadata?: () => JouzuMetadata; readPatches?: () => Patch[] } = {},
	catalog: CatalogBundle = defaultCatalog(),
): RuntimeDiagnostics {
	const readMetadata = options.readMetadata ?? loadMetadata;
	const started = new Date().toISOString();
	const issues: string[] = [];
	const packages: string[] = [];
	try {
		const patches =
			options.readPatches?.() ??
			(JSON.parse(readFileSync(new URL("./flow-patches.json", import.meta.url), "utf8")) as Patch[]);
		for (const patch of patches) {
			const root = packageRoots[patch.package];
			if (!root) continue;
			const files: string[] = [];
			for (const [path, expected] of Object.entries(patch.files)) {
				let actual = "unreadable";
				try {
					actual = createHash("sha256")
						.update(readFileSync(join(root, path)))
						.digest("hex");
				} catch {
					/* Report the missing file without blocking startup. */
				}
				files.push(`  ${path}: ${actual}`);
				if (actual !== expected)
					issues.push(catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.patchDiffers, { package: patch.package, path }));
			}
			packages.push(`${patch.package}: ${root}\n${files.join("\n")}`);
		}
	} catch {
		issues.push(catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.patchUnavailable));
	}
	const installed = () => {
		try {
			return readMetadata();
		} catch {
			return undefined;
		}
	};
	const changed = (current: JouzuMetadata) =>
		JSON.stringify([current.displayVersion, current.build, current.lock]) !==
		JSON.stringify([metadata.displayVersion, metadata.build, metadata.lock]);
	const versionLines = () => {
		const current = installed();
		return [
			catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.running, { version: metadata.displayVersion }),
			catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.pi, { version: metadata.piVersion }),
			catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.started, { started }),
			catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.installed, {
				version: current?.displayVersion ?? catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.versionUnavailable),
			}),
			...(current && changed(current) ? [catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.installedDiffers)] : []),
		];
	};
	return {
		about: () => versionLines().join("\n"),
		summary() {
			const current = installed();
			const restart = current && changed(current) ? ` ${catalogText(catalog, RUNTIME_RESTART_AVAILABLE_ID)}` : "";
			return `${catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.summaryLine, {
				version: metadata.displayVersion,
				pi: metadata.piVersion,
			})}${restart}`;
		},
		report() {
			return [
				...versionLines(),
				catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.reportHeading),
				...packages,
				...issues,
			].join("\n");
		},
		warnings() {
			const current = installed();
			return [
				...issues,
				...(current && changed(current) ? [catalogText(catalog, DIAGNOSTICS_MESSAGE_ID.buildChanged)] : []),
			];
		},
	};
}
