#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { parseJouzuArgs, UsageError, usageErrorMessage } from "./args.js";
import { CatalogMessageId, catalogMessage, catalogMessageText, catalogText } from "./cli-messages.js";
import { CliMessageId, protectedSourceError } from "./human-messages.js";
import { isInteractivePiStartup, usesMachineReadableStdout } from "./interactive-startup.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { loadMetadata } from "./metadata.js";
import { resolveJouzuPaths } from "./paths.js";
import { buildPreRuntimeContext, type PreRuntimeContext } from "./pre-runtime.js";
import { osLocaleCandidates, readLocalizationConfig, resolveUiLocale, type UiLocalePreference } from "./ui-locale.js";
import { formatUpdateStatus, JouzuUpdater, relaunchUpdatedJouzu, UpdateError, updatePolicyMessage } from "./updater.js";

/** The leading Jouzu options that consume a following value token. */
const VALUE_OPTIONS = new Set(["--jouzu-home", "--jouzu-profile", "--jouzu-ui-locale"]);

/**
 * Read one leading Jouzu option without a full parse, so the error path can
 * resolve the locale even when `parseJouzuArgs` later throws. The scan stops at
 * the first non-`--jouzu-` token, matching where the parser stops.
 */
function leadingOptionValue(args: string[], name: string): string | undefined {
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === name) return args[index + 1];
		if (token.startsWith(`${name}=`)) return token.slice(name.length + 1);
		if (!token.startsWith("--jouzu-")) break;
		if (VALUE_OPTIONS.has(token)) index += 1;
	}
	return undefined;
}

/**
 * Build the pre-runtime context once, before parsing, so every branch below and
 * the error path render from the same resolved catalog and display context.
 */
function contextFromArgs(args: string[]): PreRuntimeContext {
	const home = leadingOptionValue(args, "--jouzu-home");
	const uiLocale = leadingOptionValue(args, "--jouzu-ui-locale");
	const paths = resolveJouzuPaths({ homeOverride: home });
	const localizationConfig = readLocalizationConfig(paths.configDir);
	const resolved = resolveUiLocale({
		...(uiLocale ? { cli: uiLocale as UiLocalePreference } : {}),
		...(process.env.JOUZU_UI_LOCALE ? { env: process.env.JOUZU_UI_LOCALE } : {}),
		config: localizationConfig,
		os: osLocaleCandidates(process.env),
	});
	return buildPreRuntimeContext({
		uiLocale: resolved,
		machineReadable: usesMachineReadableStdout(args),
	});
}

/** The catalog-independent fallback when even reading the settings fails. */
function englishContext(): PreRuntimeContext {
	return buildPreRuntimeContext({
		uiLocale: { requested: "en", effective: "en", source: "builtin" },
		machineReadable: false,
	});
}

function createUpdater(args: ReturnType<typeof parseJouzuArgs>, catalog: CatalogBundle) {
	const paths = resolveJouzuPaths({ homeOverride: args.options.home });
	const metadata = loadMetadata();
	const executable = process.argv[1] ?? fileURLToPath(import.meta.url);
	return {
		metadata,
		executable,
		updater: new JouzuUpdater({
			paths,
			currentVersion: metadata.jouzuVersion,
			executable,
			report: (message) => console.log(catalogMessageText(catalog, message)),
			catalog,
		}),
	};
}

async function runBootstrap(args: string[], preRuntime: PreRuntimeContext): Promise<void> {
	const catalog = preRuntime.catalog.bundle;
	const text = (id: CatalogMessageId, messageArgs?: Readonly<Record<string, string | number>>): string =>
		catalogText(catalog, id, messageArgs);
	const parsed = parseJouzuArgs(args);
	if (parsed.kind === "self-update") {
		const { updater } = createUpdater(parsed, catalog);
		if (parsed.operation === "policy") {
			if (!parsed.policy) throw new UsageError(catalogMessage(CatalogMessageId.usageSelfUpdatePolicyValue));
			const state = updater.setPolicy(parsed.policy);
			console.log(
				text(CatalogMessageId.selfUpdatePolicySet, {
					policy: catalogMessageText(catalog, updatePolicyMessage(state.policy)),
				}),
			);
			return;
		}
		if (parsed.operation === "check") {
			const result = updater.check();
			if (parsed.json) console.log(JSON.stringify(result, null, 2));
			else if (result.status === "available") {
				console.log(
					text(CatalogMessageId.selfUpdateAvailable, {
						version: result.version,
						installed: result.installedVersion,
					}),
				);
			} else {
				console.log(
					text(CatalogMessageId.selfUpdateCurrent, {
						installed: result.installedVersion,
						latest: result.version,
					}),
				);
			}
			return;
		}
		if (parsed.operation === "apply") {
			const result = updater.apply();
			console.log(
				result.changed
					? text(CatalogMessageId.selfUpdateApplied, { version: result.version })
					: text(CatalogMessageId.selfUpdateAlreadyCurrent, { version: result.version }),
			);
			return;
		}
		const status = updater.status();
		console.log(parsed.json ? JSON.stringify(status, null, 2) : formatUpdateStatus(status, catalog));
		return;
	}

	const interactiveStartup = parsed.kind === "pi" && isInteractivePiStartup(parsed.args);
	if (interactiveStartup) {
		const { metadata, executable, updater } = createUpdater(parsed, catalog);
		const startupUpdate = updater.startup();
		delete process.env.JOUZU_INTERNAL_UPDATE_RESTARTED;
		if (startupUpdate.message) console.error(catalogMessageText(catalog, startupUpdate.message));
		if (startupUpdate.action === "restart") {
			console.log(
				text(CatalogMessageId.selfUpdateRestarting, {
					from: metadata.jouzuVersion,
					to: String(startupUpdate.version),
				}),
			);
			process.exitCode = relaunchUpdatedJouzu({ executable, args, env: process.env });
			return;
		}
	}

	const main = await import("./main-cli.js");
	await main.runMainCli(args);
}

async function handleBootstrapError(error: unknown, preRuntime: PreRuntimeContext): Promise<void> {
	const catalog: CatalogBundle = preRuntime.catalog.bundle;
	if (error instanceof UpdateError) {
		console.error(catalogText(catalog, CliMessageId.update, { message: protectedSourceError(error.message) }));
		process.exitCode = error.exitCode;
		return;
	}
	if (error instanceof UsageError) {
		console.error(
			catalogText(catalog, CliMessageId.usage, {
				message: protectedSourceError(usageErrorMessage(error, catalog)),
			}),
		);
		console.error(catalogText(catalog, CliMessageId.usageHint));
		process.exitCode = error.exitCode;
		return;
	}
	try {
		const main = await import("./main-cli.js");
		main.handleMainCliError(error, catalog);
	} catch {
		const message = error instanceof Error ? error.message : String(error);
		console.error(catalogText(catalog, CliMessageId.generic, { message: protectedSourceError(message) }));
		process.exitCode = 1;
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	let preRuntime: PreRuntimeContext;
	try {
		preRuntime = contextFromArgs(args);
	} catch {
		preRuntime = englishContext();
	}
	await runBootstrap(args, preRuntime).catch((error: unknown) => handleBootstrapError(error, preRuntime));
}

void main();
