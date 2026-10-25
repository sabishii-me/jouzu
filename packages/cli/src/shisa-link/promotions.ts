import { readBoundedResponseText } from "../bounded-response.js";

const REQUEST_TIMEOUT_MS = 1_500;
const MAX_RESPONSE_BYTES = 16_384;
// GET /promotions is public and served with max-age=60. Never persist offers.
const MAX_AGE_MS = 60_000;

export interface ShisaPromotions {
	signupCreditsUsd: number;
	signupRequiresBilling: boolean;
	connectBonusUsd: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept only the structured campaign fields, never service-supplied copy or links. */
export function parseShisaPromotions(body: unknown): ShisaPromotions | undefined {
	if (!isRecord(body) || body.success !== true || !isRecord(body.data)) return undefined;
	const data = body.data;
	const microCents = data.signup_starter_credits_micro_cents;
	const cents = data.signup_starter_credits_cents;
	const dollars = data.signup_starter_credits_dollars;
	const bonus = data.connect_bonus_jouzu_usd;
	if (
		typeof microCents !== "number" ||
		!Number.isSafeInteger(microCents) ||
		microCents < 0 ||
		typeof cents !== "number" ||
		cents !== Math.floor(microCents / 1_000_000) ||
		typeof dollars !== "string" ||
		dollars !== (cents / 100).toFixed(2) ||
		typeof data.signup_requires_billing !== "boolean" ||
		typeof bonus !== "number" ||
		!Number.isFinite(bonus) ||
		bonus < 0 ||
		bonus > Number.MAX_SAFE_INTEGER / 100_000_000 ||
		// Sub-cent bonuses cannot be advertised as whole cents without changing the amount.
		Number(bonus.toFixed(2)) !== bonus
	)
		return undefined;
	return {
		signupCreditsUsd: cents / 100,
		signupRequiresBilling: data.signup_requires_billing,
		connectBonusUsd: bonus,
	};
}

/** Match the account gateway transport policy without changing device-login behavior. */
export function shisaPromotionsUrl(gateway: string): string | undefined {
	try {
		const url = new URL(gateway);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return undefined;
		url.pathname = `${url.pathname.replace(/\/+$/u, "")}/promotions`;
		return url.href;
	} catch {
		return undefined;
	}
}

function freshResponse(response: Response, elapsedMs = 0): boolean {
	const age = response.headers.get("age");
	if (age !== null && (!/^\d+$/u.test(age) || Number(age) * 1000 + elapsedMs >= MAX_AGE_MS)) return false;
	const date = response.headers.get("date");
	if (date !== null && (!Number.isFinite(Date.parse(date)) || Date.now() - Date.parse(date) >= MAX_AGE_MS))
		return false;
	return true;
}

/** One anonymous, bounded request. Failure has no money-bearing fallback or remote diagnostic. */
export async function fetchShisaPromotions(options: {
	gatewayUrl: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	/** May shorten the startup budget for deterministic tests. */
	timeoutMs?: number;
}): Promise<ShisaPromotions | undefined> {
	const endpoint = shisaPromotionsUrl(options.gatewayUrl);
	if (!endpoint || options.signal?.aborted) return undefined;
	const controller = new AbortController();
	const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
	const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS));
	const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : REQUEST_TIMEOUT_MS);
	let onAbort: () => void = () => {};
	const aborted = new Promise<undefined>((resolve) => {
		onAbort = () => resolve(undefined);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	let response: Response | undefined;
	try {
		return await Promise.race([
			aborted,
			(async () => {
				response = await (options.fetchImpl ?? fetch)(endpoint, {
					method: "GET",
					headers: { accept: "application/json" },
					credentials: "omit",
					redirect: "error",
					cache: "no-store",
					signal,
				});
				const receivedAt = Date.now();
				if (signal.aborted || !response.ok || !freshResponse(response)) return undefined;
				const text = await readBoundedResponseText(response, {
					maxBytes: MAX_RESPONSE_BYTES,
					tooLargeError: () => new Error("Promotions response exceeds the byte limit."),
				});
				if (signal.aborted || !freshResponse(response, Date.now() - receivedAt)) return undefined;
				return parseShisaPromotions(JSON.parse(text));
			})(),
		]);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
		controller.abort();
		if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
	}
}
