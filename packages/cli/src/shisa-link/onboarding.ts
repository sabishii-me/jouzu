import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { catalogSourceCredentialAvailable, SHISA_API_CATALOG_SOURCE } from "../catalog-sources.js";
import { CatalogMessageId, catalogText, defaultCatalog } from "../cli-messages.js";
import type { CatalogBundle } from "../locale-catalog.js";
import type { JouzuPaths } from "../paths.js";
import { writeFilePrivateExclusive } from "../private-fs.js";
import { detectTerminalColorMode, sanitizeTerminalText } from "../terminal-layout.js";
import { setShisaSignedOut } from "./credentials.js";
import { resolveShisaGatewayUrl } from "./device-flow.js";
import { loginShisa, type ShisaLoginOptions } from "./login.js";
import { fetchShisaPromotions, type ShisaPromotions } from "./promotions.js";

/**
 * Keep account messaging separate from the first-launch decision and login
 * protocol. Each entry is a catalog message ID; the renderer resolves it with
 * the active bundle, so the same code renders English or Japanese.
 */
export const SHISA_ONBOARDING_COPY = {
	points: [CatalogMessageId.shisaOnboardingPointConnect, CatalogMessageId.shisaOnboardingPointCredits],
	question: CatalogMessageId.shisaOnboardingQuestion,
	hint: CatalogMessageId.shisaOnboardingHint,
	later: CatalogMessageId.shisaOnboardingLater,
} as const;

/** Marks each offer line without relying on color, so a pipe or NO_COLOR keeps the shape. */
const POINT_MARKER = "\u25c6";
const POINT_PREFIX_WIDTH = 4;

export function shisaOnboardingPath(paths: JouzuPaths): string {
	return join(paths.stateDir, "shisa-onboarding.json");
}

export interface ShisaOnboardingOptions extends Omit<ShisaLoginOptions, "gatewayUrl"> {
	/** The resolved locale catalog for the offer text. Defaults to English. */
	catalog?: CatalogBundle;
	interactive: boolean;
	env?: NodeJS.ProcessEnv;
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream & { columns?: number; isTTY?: boolean };
	signal?: AbortSignal;
	colorEnabled?: boolean;
	/** May shorten the offer lookup budget for tests; login keeps its own deadline. */
	promotionsTimeoutMs?: number;
	ask?: (question: string, signal: AbortSignal) => Promise<string>;
}

/** All prose is bundled; only validated numeric amounts choose and fill offer templates. */
export function shisaOnboardingPoints(catalog: CatalogBundle, promotions?: ShisaPromotions): string[] {
	const points = [catalogText(catalog, SHISA_ONBOARDING_COPY.points[0])];
	const amount = (usd: number) => usd.toFixed(Number.isInteger(usd) ? 0 : 2);
	if (promotions && promotions.signupCreditsUsd > 0)
		points.push(
			catalogText(
				catalog,
				promotions.signupRequiresBilling
					? CatalogMessageId.shisaOnboardingSignupBilling
					: CatalogMessageId.shisaOnboardingSignup,
				{ amount: amount(promotions.signupCreditsUsd) },
			),
		);
	if (promotions && promotions.connectBonusUsd > 0)
		points.push(
			catalogText(catalog, CatalogMessageId.shisaOnboardingConnectBonus, {
				amount: amount(promotions.connectBonusUsd),
			}),
		);
	points.push(catalogText(catalog, SHISA_ONBOARDING_COPY.points[1]));
	return points;
}

/** Offer only in an interactive launcher, before Pi builds its credential/model snapshot. */
export async function offerShisaOnboarding(options: ShisaOnboardingOptions): Promise<void> {
	const env = options.env ?? process.env;
	if (
		!options.interactive ||
		existsSync(shisaOnboardingPath(options.paths)) ||
		catalogSourceCredentialAvailable(SHISA_API_CATALOG_SOURCE, env, options.paths)
	)
		return;

	const catalog = options.catalog ?? defaultCatalog();
	const output = options.output ?? process.stdout;
	const columns = () => Math.max(12, output.columns || 80);
	const write = (message: string) => {
		output.write(`${wrapTextWithAnsi(sanitizeTerminalText(message), columns()).join("\n")}\n`);
	};
	// Styling wraps sanitized text: `sanitizeTerminalText` removes escape sequences, so
	// color applied before it would be stripped along with anything the copy inherited.
	const colorEnabled =
		options.colorEnabled ?? (output.isTTY === true && detectTerminalColorMode({ env, stdoutIsTTY: true }) !== "none");
	const style = (value: string, code: string) => (colorEnabled ? `\u001b[${code}m${value}\u001b[0m` : value);
	const writePoint = (message: string) => {
		const width = Math.max(8, columns() - POINT_PREFIX_WIDTH);
		const lines = wrapTextWithAnsi(sanitizeTerminalText(message), width);
		for (const [index, line] of lines.entries())
			output.write(index === 0 ? `  ${style(POINT_MARKER, "36")} ${line}\n` : `    ${line}\n`);
	};
	const controller = new AbortController();
	const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
	const readline = options.ask ? undefined : createInterface({ input: options.input ?? process.stdin, output });
	const cancel = () => controller.abort();
	readline?.on("SIGINT", cancel);
	readline?.on("close", cancel);
	process.on("SIGINT", cancel);
	try {
		const promotions = await fetchShisaPromotions({
			gatewayUrl: resolveShisaGatewayUrl(env),
			fetchImpl: options.fetchImpl,
			signal,
			timeoutMs: options.promotionsTimeoutMs,
		});
		signal.throwIfAborted();
		output.write("\n");
		for (const point of shisaOnboardingPoints(catalog, promotions)) writePoint(point);
		output.write("\n");
		const question = `  ${catalogText(catalog, SHISA_ONBOARDING_COPY.question)} ${style(catalogText(catalog, SHISA_ONBOARDING_COPY.hint), "2")} `;
		const answer = options.ask ? await options.ask(question, signal) : await readline?.question(question, { signal });
		signal.throwIfAborted();
		const connect = /^(?:y|yes)$/iu.test((answer ?? "").trim());
		try {
			writeFilePrivateExclusive(
				shisaOnboardingPath(options.paths),
				`${JSON.stringify({ schemaVersion: 1, choice: connect ? "connect" : "skip", decidedAt: new Date().toISOString() })}\n`,
				options.paths.stateDir,
			);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST") return;
			write(catalogText(catalog, CatalogMessageId.shisaOnboardingSetupChoiceFailed));
			write(catalogText(catalog, SHISA_ONBOARDING_COPY.later));
			return;
		}
		if (!connect) {
			write(catalogText(catalog, SHISA_ONBOARDING_COPY.later));
			return;
		}
		write(catalogText(catalog, CatalogMessageId.shisaOnboardingOpenLink));
		await loginShisa(
			{
				signal,
				onDeviceCode: ({ verificationUri, userCode }) => {
					// Keep the link intact for copying; the terminal handles its visual wrapping.
					output.write(`${sanitizeTerminalText(verificationUri)}\n`);
					write(catalogText(catalog, CatalogMessageId.shisaOnboardingDeviceCode, { code: userCode }));
				},
				onAuth: ({ url }) => output.write(`${sanitizeTerminalText(url)}\n`),
				onPrompt: async () => {
					throw new Error("Unexpected Shisa sign-in prompt.");
				},
				onSelect: async () => undefined,
				onProgress: write,
			},
			{ ...options, gatewayUrl: resolveShisaGatewayUrl(env) },
		);
		setShisaSignedOut(options.paths, false);
		write(catalogText(catalog, CatalogMessageId.shisaOnboardingSignedIn));
	} catch (error) {
		// Remote errors can contain credentials; keep startup recovery messages local.
		// The device flow renders the storage failure with this same bundle, so the
		// identity comparison below still matches in every locale.
		const storageError = catalogText(catalog, CatalogMessageId.shisaSignInStorageFailed);
		write(
			signal.aborted
				? catalogText(catalog, CatalogMessageId.shisaOnboardingCancelled)
				: error instanceof Error && error.message === storageError
					? storageError
					: catalogText(catalog, CatalogMessageId.shisaOnboardingCouldNotComplete),
		);
		write(catalogText(catalog, SHISA_ONBOARDING_COPY.later));
	} finally {
		process.off("SIGINT", cancel);
		readline?.close();
	}
}
