import {
	CatalogMessageId,
	type CatalogMessageRef,
	catalogMessageText,
	catalogText,
	defaultCatalog,
} from "./cli-messages.js";
import {
	CliMessageId,
	type HumanMessage,
	humanMessage,
	isCliMessageId,
	protectedCommand,
	resolveHumanMessage,
} from "./human-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { UI_LOCALE_PREFERENCES, type UiLocalePreference } from "./ui-locale.js";

export const PROFILE_IDS = ["core", "ja"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export class UsageError extends Error {
	readonly exitCode = 2;
	/** The stable ID and protected values when the message came from the parser or the catalog. */
	declare readonly descriptor?: HumanMessage | CatalogMessageRef;

	constructor(message: HumanMessage | CatalogMessageRef) {
		const raw: unknown = message;
		if (typeof raw === "string") {
			// A runtime-only path for JavaScript callers that predate the typed
			// descriptor; a TypeScript caller cannot pass a literal sentence.
			super(raw);
		} else if (isHumanMessage(message)) {
			super(resolveHumanMessage(message));
			Object.defineProperty(this, "descriptor", { value: message, enumerable: false });
		} else {
			super(catalogMessageText(defaultCatalog(), message));
			Object.defineProperty(this, "descriptor", { value: message, enumerable: false });
		}
		this.name = "UsageError";
	}
}

/** Whether a descriptor is a pre-runtime `CliMessageId` message. */
function isHumanMessage(message: HumanMessage | CatalogMessageRef): message is HumanMessage {
	return isCliMessageId(message.id);
}

/**
 * The inner text a `UsageError` renders inside the outer usage message.
 *
 * A parser error keeps the descriptor it was built from, so its ID and values
 * stay localizable; a `UsageError` built from a plain string falls back to that
 * string. The locale is threaded to the descriptor resolution, so the catalog
 * milestone localizes the inner text without touching the call sites.
 */
export function usageErrorMessage(error: UsageError, catalog: CatalogBundle = defaultCatalog()): string {
	return error.descriptor ? catalogText(catalog, error.descriptor.id, error.descriptor.args) : error.message;
}

export interface JouzuOptions {
	home?: string;
	profile?: ProfileId;
	uiLocale?: UiLocalePreference;
	textguardFiles?: boolean;
	textguardStrict?: boolean;
	textguardOff?: boolean;
}

export type ParsedCommand =
	| { kind: "pi"; options: JouzuOptions; args: string[] }
	| { kind: "doctor"; options: JouzuOptions; json: boolean }
	| { kind: "version"; options: JouzuOptions }
	| { kind: "help"; options: JouzuOptions }
	| {
			kind: "catalog";
			options: JouzuOptions;
			operation: "status" | "refresh" | "accept" | "validate" | "conformance";
			json: boolean;
			sourceId?: string;
			path?: string;
			revision?: string;
			digest?: string;
	  }
	| {
			kind: "self-update";
			options: JouzuOptions;
			operation: "status" | "check" | "apply" | "policy";
			json: boolean;
			policy?: "auto-restart" | "notify" | "off";
	  }
	| {
			kind: "keybindings";
			options: JouzuOptions;
			operation: "status" | "plan" | "apply" | "reset";
			json: boolean;
	  }
	| {
			kind: "profile";
			options: JouzuOptions;
			operation: "plan" | "apply";
			profile?: ProfileId;
			json: boolean;
	  }
	| {
			kind: "profile-migration";
			options: JouzuOptions;
			operation: "plan" | "apply" | "rollback";
			json: boolean;
			yes: boolean;
	  };

function readOptionValue(args: string[], index: number, option: string): { value: string; next: number } {
	const token = args[index];
	const equalsPrefix = `${option}=`;
	if (token.startsWith(equalsPrefix)) {
		const value = token.slice(equalsPrefix.length);
		if (!value)
			throw new UsageError(humanMessage(CliMessageId.optionValueRequired, { option: protectedCommand(option) }));
		return { value, next: index + 1 };
	}
	if (token !== option)
		throw new UsageError(humanMessage(CliMessageId.internalParserError, { option: protectedCommand(option) }));
	const value = args[index + 1];
	if (value === undefined || value.length === 0)
		throw new UsageError(humanMessage(CliMessageId.optionValueRequired, { option: protectedCommand(option) }));
	return { value, next: index + 2 };
}

function parseCatalogCommand(options: JouzuOptions, args: string[]): ParsedCommand {
	const [operation = "status", ...remaining] = args;
	if (
		operation !== "status" &&
		operation !== "refresh" &&
		operation !== "accept" &&
		operation !== "validate" &&
		operation !== "conformance"
	) {
		throw new UsageError(humanMessage(CliMessageId.catalogOperationRequired));
	}
	if (operation === "accept") {
		const [revision, ...tokens] = remaining;
		let digest: string | undefined;
		let sourceId: string | undefined;
		for (let index = 0; index < tokens.length; index += 2) {
			const option = tokens[index];
			const value = tokens[index + 1];
			if (!value) throw new UsageError(humanMessage(CliMessageId.catalogAcceptOptionsRequireValues));
			if (option === "--digest" && digest === undefined) digest = value;
			else if (option === "--source" && sourceId === undefined) sourceId = value;
			else
				throw new UsageError(
					humanMessage(CliMessageId.catalogUnknownAcceptOption, { option: protectedCommand(option) }),
				);
		}
		if (!revision || !digest || !/^[0-9a-f]{64}$/u.test(digest)) {
			throw new UsageError(humanMessage(CliMessageId.catalogAcceptUsage));
		}
		return { kind: "catalog", options, operation, json: false, revision, digest, ...(sourceId ? { sourceId } : {}) };
	}
	if (operation === "validate" || operation === "conformance") {
		const [path, ...extra] = remaining;
		if (!path || extra.some((token) => token !== "--json") || extra.filter((token) => token === "--json").length > 1) {
			throw new UsageError(humanMessage(CliMessageId.catalogFileRequired, { operation: protectedCommand(operation) }));
		}
		return { kind: "catalog", options, operation, json: extra.includes("--json"), path };
	}
	let json = false;
	let sourceId: string | undefined;
	for (const token of remaining) {
		if (token === "--json" && !json) {
			json = true;
			continue;
		}
		if (!token.startsWith("-") && sourceId === undefined) {
			sourceId = token;
			continue;
		}
		throw new UsageError(
			humanMessage(CliMessageId.catalogUnknownOption, {
				operation: protectedCommand(operation),
				token: protectedCommand(token),
			}),
		);
	}
	return { kind: "catalog", options, operation, json, ...(sourceId ? { sourceId } : {}) };
}

function parseSelfUpdateCommand(options: JouzuOptions, args: string[]): ParsedCommand {
	const [operation = "status", ...remaining] = args;
	if (operation !== "status" && operation !== "check" && operation !== "apply" && operation !== "policy") {
		throw new UsageError(humanMessage(CliMessageId.selfUpdateOperationRequired));
	}
	if (operation === "policy") {
		const [policy, ...extra] = remaining;
		if (policy !== "auto-restart" && policy !== "notify" && policy !== "off") {
			throw new UsageError(humanMessage(CliMessageId.selfUpdatePolicyRequired));
		}
		if (extra.length > 0) throw new UsageError(humanMessage(CliMessageId.selfUpdatePolicySingleValue));
		return { kind: "self-update", options, operation, json: false, policy };
	}
	let json = false;
	for (const token of remaining) {
		if (token !== "--json" || json || operation === "apply") {
			throw new UsageError(
				humanMessage(CliMessageId.selfUpdateUnknownOption, {
					operation: protectedCommand(operation),
					token: protectedCommand(token),
				}),
			);
		}
		json = true;
	}
	return { kind: "self-update", options, operation, json };
}

function parseKeybindingsCommand(options: JouzuOptions, args: string[]): ParsedCommand {
	const [operation = "status", ...remaining] = args;
	if (operation !== "status" && operation !== "plan" && operation !== "apply" && operation !== "reset") {
		throw new UsageError(humanMessage(CliMessageId.keybindingsOperationRequired));
	}
	let json = false;
	for (const token of remaining) {
		if (token !== "--json" || json || operation === "apply" || operation === "reset") {
			throw new UsageError(
				humanMessage(CliMessageId.keybindingsUnknownOption, {
					operation: protectedCommand(operation),
					token: protectedCommand(token),
				}),
			);
		}
		json = true;
	}
	return { kind: "keybindings", options, operation, json };
}

function parseProfileCommand(options: JouzuOptions, args: string[]): ParsedCommand {
	if (options.profile !== undefined) {
		throw new UsageError(humanMessage(CliMessageId.profileMixedSelection));
	}
	const [operation, ...remaining] = args;
	if (operation !== "plan" && operation !== "apply") {
		throw new UsageError(humanMessage(CliMessageId.profileOperationRequired));
	}
	let profile: ProfileId | undefined;
	let json = false;
	for (let index = 0; index < remaining.length; index += 1) {
		const token = remaining[index];
		if (token === "--profile" || token.startsWith("--profile=")) {
			if (profile !== undefined) throw new UsageError(humanMessage(CliMessageId.profileRepeatedOption));
			const parsed = readOptionValue(remaining, index, "--profile");
			if (!PROFILE_IDS.includes(parsed.value as ProfileId)) {
				throw new UsageError(humanMessage(CliMessageId.profileInvalidId, { values: PROFILE_IDS.join(", ") }));
			}
			profile = parsed.value as ProfileId;
			index = parsed.next - 1;
			continue;
		}
		if (token === "--json" && operation === "plan") {
			if (json) throw new UsageError(humanMessage(CliMessageId.profileRepeatedJson));
			json = true;
			continue;
		}
		throw new UsageError(
			humanMessage(CliMessageId.profileUnknownOption, {
				operation: protectedCommand(operation),
				token: protectedCommand(token),
			}),
		);
	}
	return { kind: "profile", options, operation, ...(profile ? { profile } : {}), json };
}

function parseProfileMigrationCommand(options: JouzuOptions, args: string[]): ParsedCommand {
	const [operation = "plan", ...remaining] = args;
	if (operation !== "plan" && operation !== "apply" && operation !== "rollback") {
		throw new UsageError(humanMessage(CliMessageId.profileMigrationOperationRequired));
	}
	let json = false;
	let yes = false;
	for (const token of remaining) {
		if (token === "--json" && operation === "plan" && !json) {
			json = true;
			continue;
		}
		if (token === "--yes" && operation === "apply" && !yes) {
			yes = true;
			continue;
		}
		throw new UsageError(
			humanMessage(CliMessageId.profileMigrationUnknownOption, {
				operation: protectedCommand(operation),
				token: protectedCommand(token),
			}),
		);
	}
	return { kind: "profile-migration", options, operation, json, yes };
}

export function parseJouzuArgs(args: string[]): ParsedCommand {
	const options: JouzuOptions = {};
	let index = 0;

	while (index < args.length) {
		const token = args[index];
		if (token === "--jouzu-home" || token.startsWith("--jouzu-home=")) {
			if (options.home !== undefined) throw new UsageError(humanMessage(CliMessageId.homeRepeated));
			const parsed = readOptionValue(args, index, "--jouzu-home");
			options.home = parsed.value;
			index = parsed.next;
			continue;
		}
		if (token === "--jouzu-profile" || token.startsWith("--jouzu-profile=")) {
			if (options.profile !== undefined) throw new UsageError(humanMessage(CliMessageId.launchProfileRepeated));
			const parsed = readOptionValue(args, index, "--jouzu-profile");
			if (!PROFILE_IDS.includes(parsed.value as ProfileId)) {
				throw new UsageError(humanMessage(CliMessageId.launchProfileInvalidId, { values: PROFILE_IDS.join(", ") }));
			}
			options.profile = parsed.value as ProfileId;
			index = parsed.next;
			continue;
		}
		if (token === "--jouzu-ui-locale" || token.startsWith("--jouzu-ui-locale=")) {
			if (options.uiLocale !== undefined) throw new UsageError(humanMessage(CliMessageId.uiLocaleRepeated));
			const parsed = readOptionValue(args, index, "--jouzu-ui-locale");
			if (!UI_LOCALE_PREFERENCES.includes(parsed.value as UiLocalePreference)) {
				throw new UsageError(humanMessage(CliMessageId.uiLocaleInvalid, { values: UI_LOCALE_PREFERENCES.join(", ") }));
			}
			options.uiLocale = parsed.value as UiLocalePreference;
			index = parsed.next;
			continue;
		}
		if (
			token === "--jouzu-textguard-files" ||
			token === "--jouzu-textguard-strict" ||
			token === "--jouzu-textguard-off"
		) {
			const key = {
				"--jouzu-textguard-files": "textguardFiles",
				"--jouzu-textguard-strict": "textguardStrict",
				"--jouzu-textguard-off": "textguardOff",
			}[token] as "textguardFiles" | "textguardStrict" | "textguardOff";
			if (options[key])
				throw new UsageError(humanMessage(CliMessageId.textguardRepeated, { option: protectedCommand(token) }));
			options[key] = true;
			index += 1;
			continue;
		}
		if (token.startsWith("--jouzu-"))
			throw new UsageError(humanMessage(CliMessageId.unknownJouzuOption, { token: protectedCommand(token) }));
		break;
	}

	if (options.textguardOff && options.textguardStrict) {
		throw new UsageError(humanMessage(CliMessageId.textguardOffStrict));
	}
	if (options.textguardOff && options.textguardFiles) {
		throw new UsageError(humanMessage(CliMessageId.textguardOffFiles));
	}
	const remaining = args.slice(index);
	const [command, ...rest] = remaining;
	if (command === "pi" || command === "--") return { kind: "pi", options, args: rest };
	if (command === "doctor") {
		let json = false;
		for (const token of rest) {
			if (token !== "--json" || json)
				throw new UsageError(humanMessage(CliMessageId.doctorUnexpectedToken, { token: protectedCommand(token) }));
			json = true;
		}
		return { kind: "doctor", options, json };
	}
	if (command === "profile") return parseProfileCommand(options, rest);
	if (command === "profile-migration") return parseProfileMigrationCommand(options, rest);
	if (command === "catalog") return parseCatalogCommand(options, rest);
	if (command === "keybindings") return parseKeybindingsCommand(options, rest);
	if (command === "self-update") return parseSelfUpdateCommand(options, rest);
	if (command === "--version" || command === "-v") {
		if (rest.length > 0)
			throw new UsageError(humanMessage(CliMessageId.versionHelpArguments, { command: protectedCommand(command) }));
		return { kind: "version", options };
	}
	if (command === "--help" || command === "-h") {
		if (rest.length > 0)
			throw new UsageError(humanMessage(CliMessageId.versionHelpArguments, { command: protectedCommand(command) }));
		return { kind: "help", options };
	}
	return { kind: "pi", options, args: remaining };
}

export function isBlockedPiSelfUpdate(args: string[]): boolean {
	if (args[0] !== "update") return false;
	const updateArgs = args.slice(1);
	if (updateArgs.length === 0) return true;
	if (updateArgs.some((arg) => arg === "--all" || arg === "--self")) return true;

	let hasExtensionOrModelTarget = false;
	let positionalTarget: string | undefined;
	for (let index = 0; index < updateArgs.length; index += 1) {
		const arg = updateArgs[index];
		if (arg === "--extensions" || arg === "--models") {
			hasExtensionOrModelTarget = true;
			continue;
		}
		if (arg === "--extension") {
			if (updateArgs[index + 1] !== undefined) {
				hasExtensionOrModelTarget = true;
				index += 1;
			}
			continue;
		}
		if (arg.startsWith("--extension=")) {
			hasExtensionOrModelTarget = arg.length > "--extension=".length;
			continue;
		}
		if (!arg.startsWith("-")) {
			positionalTarget ??= arg;
		}
	}

	if (positionalTarget === "self" || positionalTarget === "pi") return true;
	return !hasExtensionOrModelTarget && positionalTarget === undefined;
}

const HELP_USAGE_LINES = [
	"  jouzu [--jouzu-home <path>] [--jouzu-profile <core|ja>] [Pi arguments...]",
	"  jouzu --session <id> [Pi arguments...]",
	"  jouzu [Jouzu options] pi [Pi arguments...]",
	"  jouzu [Jouzu options] -- [Pi arguments...]",
	"  jouzu [Jouzu options] doctor [--json]",
	"  jouzu catalog status [source-id] [--json]",
	"  jouzu catalog refresh [source-id] [--json]",
	"  jouzu catalog accept <revision> --digest <sha256> [--source <source-id>]",
	"  jouzu catalog validate <file> [--json]",
	"  jouzu catalog conformance <file> [--json]",
	"  jouzu profile plan [--profile <core|ja>] [--json]",
	"  jouzu profile apply [--profile <core|ja>]",
	"  jouzu profile-migration plan [--json]",
	"  jouzu profile-migration apply [--yes]",
	"  jouzu profile-migration rollback",
	"  jouzu keybindings status [--json]",
	"  jouzu keybindings plan [--json]",
	"  jouzu keybindings apply",
	"  jouzu keybindings reset",
	"  jouzu self-update status [--json]",
	"  jouzu self-update check [--json]",
	"  jouzu self-update apply",
	"  jouzu self-update policy <auto-restart|notify|off>",
	"  jouzu [Jouzu options] --version",
];

/** The command table: the protected label and the catalog ID for its description. */
const HELP_COMMANDS: ReadonlyArray<readonly [string, CatalogMessageId]> = [
	["doctor", CatalogMessageId.helpCommandDoctor],
	["catalog", CatalogMessageId.helpCommandCatalog],
	["profile plan", CatalogMessageId.helpCommandProfilePlan],
	["profile apply", CatalogMessageId.helpCommandProfileApply],
	["keybindings", CatalogMessageId.helpCommandKeybindings],
	["self-update", CatalogMessageId.helpCommandSelfUpdate],
	["pi, --", CatalogMessageId.helpCommandPi],
];

/** The TextGuard prose lines, kept one per output line so the bytes do not move. */
const HELP_TEXTGUARD_LINES: readonly CatalogMessageId[] = [
	CatalogMessageId.helpTextguardLine1,
	CatalogMessageId.helpTextguardLine2,
	CatalogMessageId.helpTextguardLine3,
	CatalogMessageId.helpTextguardLine4,
];

/** The TextGuard option table: the protected option text and its description ID. */
const HELP_OPTIONS: ReadonlyArray<readonly [string, CatalogMessageId]> = [
	["--jouzu-textguard-strict", CatalogMessageId.helpOptionTextguardStrict],
	["--jouzu-textguard-off", CatalogMessageId.helpOptionTextguardOff],
	["--jouzu-textguard-files", CatalogMessageId.helpOptionTextguardFiles],
];

/** The closing prose lines, kept one per output line so the bytes do not move. */
const HELP_FOOTER_LINES: readonly CatalogMessageId[] = [
	CatalogMessageId.helpFooterLine1,
	CatalogMessageId.helpFooterLine2,
	CatalogMessageId.helpFooterLine3,
	CatalogMessageId.helpFooterLine4,
	CatalogMessageId.helpFooterLine5,
	CatalogMessageId.helpFooterLine6,
	CatalogMessageId.helpFooterLine7,
];

/**
 * The `--help` text.
 *
 * The protected values (command names, option names, placeholders, and the
 * usage lines they form) stay in code; every natural-language unit is a catalog
 * message. The alignment is owned by the renderer, so a catalog value never
 * carries a hard wrap or a hand-made column.
 */
export function formatHelp(catalog: CatalogBundle = defaultCatalog()): string {
	const text = (id: CatalogMessageId): string => catalogText(catalog, id);
	const commandLines = HELP_COMMANDS.map(([label, id]) => `  ${label.padEnd(14)}${text(id)}`);
	const optionLines = HELP_OPTIONS.map(([option, id]) => `  ${option.padEnd(42)}${text(id)}`);
	const uiLocaleOption = "--jouzu-ui-locale <auto|en|ja|zh-Hans|zh-Hant>";
	const lines = [
		text(CatalogMessageId.helpTitle),
		"",
		text(CatalogMessageId.helpUsageHeading),
		...HELP_USAGE_LINES,
		"",
		text(CatalogMessageId.helpCommandsHeading),
		...commandLines,
		"",
		...HELP_TEXTGUARD_LINES.map((id) => text(id)),
		...optionLines,
		`  ${uiLocaleOption}`,
		`${" ".repeat(44)}${text(CatalogMessageId.helpOptionUiLocale)}`,
		"",
		...HELP_FOOTER_LINES.map((id) => text(id)),
	];
	return lines.join("\n");
}
