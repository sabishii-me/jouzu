import { catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { sanitizeTerminalText } from "./terminal-layout.js";

export interface CatalogFailure {
	code: string;
	message: string;
}

/**
 * Catalog IDs for the catalog failure explanations.
 *
 * The failure `code` stays the identity of the result; only the explanation is
 * catalog text. The IDs are local to this module rather than added to the
 * shared `CatalogMessageId` table so a parallel migration of another surface
 * does not conflict on that file; `scripts/check-locales.mjs` allows a
 * catalog-only ID present in both locales.
 */
const FAILURE_MESSAGE_IDS = {
	dnsHostname: "jouzu.cli.catalog.failure.dnsHostname",
	dnsLookup: "jouzu.cli.catalog.failure.dnsLookup",
	connectionRefused: "jouzu.cli.catalog.failure.connectionRefused",
	connectionReset: "jouzu.cli.catalog.failure.connectionReset",
	connectionClosed: "jouzu.cli.catalog.failure.connectionClosed",
	networkUnreachable: "jouzu.cli.catalog.failure.networkUnreachable",
	hostUnreachable: "jouzu.cli.catalog.failure.hostUnreachable",
	timeout: "jouzu.cli.catalog.failure.timeout",
	connectTimeout: "jouzu.cli.catalog.failure.connectTimeout",
	headersTimeout: "jouzu.cli.catalog.failure.headersTimeout",
	bodyTimeout: "jouzu.cli.catalog.failure.bodyTimeout",
	networkPermission: "jouzu.cli.catalog.failure.networkPermission",
	redirectBlocked: "jouzu.cli.catalog.failure.redirectBlocked",
	filesystem: "jouzu.cli.catalog.failure.filesystem",
	certificate: "jouzu.cli.catalog.failure.certificate",
	network: "jouzu.cli.catalog.failure.network",
	cache: "jouzu.cli.catalog.failure.cache",
} as const;

/** The failure code and catalog message ID for one upstream error code. */
interface CatalogFailureExplanation {
	code: string;
	messageId: string;
}

const REQUEST_CODES: Record<string, CatalogFailureExplanation> = {
	ENOTFOUND: { code: "dns_error", messageId: FAILURE_MESSAGE_IDS.dnsHostname },
	EAI_AGAIN: { code: "dns_error", messageId: FAILURE_MESSAGE_IDS.dnsLookup },
	ECONNREFUSED: { code: "connection_refused", messageId: FAILURE_MESSAGE_IDS.connectionRefused },
	ECONNRESET: { code: "connection_reset", messageId: FAILURE_MESSAGE_IDS.connectionReset },
	ENETUNREACH: { code: "network_unreachable", messageId: FAILURE_MESSAGE_IDS.networkUnreachable },
	EHOSTUNREACH: { code: "network_unreachable", messageId: FAILURE_MESSAGE_IDS.hostUnreachable },
	ETIMEDOUT: { code: "timeout", messageId: FAILURE_MESSAGE_IDS.timeout },
	UND_ERR_CONNECT_TIMEOUT: { code: "timeout", messageId: FAILURE_MESSAGE_IDS.connectTimeout },
	UND_ERR_HEADERS_TIMEOUT: { code: "timeout", messageId: FAILURE_MESSAGE_IDS.headersTimeout },
	UND_ERR_BODY_TIMEOUT: { code: "timeout", messageId: FAILURE_MESSAGE_IDS.bodyTimeout },
	UND_ERR_SOCKET: { code: "connection_reset", messageId: FAILURE_MESSAGE_IDS.connectionClosed },
	EACCES: { code: "network_permission", messageId: FAILURE_MESSAGE_IDS.networkPermission },
	EPERM: { code: "network_permission", messageId: FAILURE_MESSAGE_IDS.networkPermission },
	REDIRECT_BLOCKED: { code: "redirect_blocked", messageId: FAILURE_MESSAGE_IDS.redirectBlocked },
};
const CERTIFICATE_CODES = new Set([
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"CERT_REVOKED",
]);
const FILESYSTEM_CODES = new Set([
	"EACCES",
	"EPERM",
	"ENOENT",
	"ENOTDIR",
	"EISDIR",
	"EROFS",
	"ENOSPC",
	"EIO",
	"EBUSY",
	"EMFILE",
	"ENFILE",
]);

/** Keep only recognized codes, never raw nested messages, URLs, headers, or socket details. */
function causeCodes(error: unknown): string[] {
	const queue: unknown[] = [error];
	const seen = new Set<object>();
	const codes: string[] = [];
	for (let index = 0; index < queue.length && index < 12; index++) {
		const item = queue[index];
		if (!item || typeof item !== "object" || seen.has(item)) continue;
		seen.add(item);
		if ("code" in item && typeof item.code === "string") codes.push(item.code);
		if (item instanceof Error && item.message === "unexpected redirect") codes.push("REDIRECT_BLOCKED");
		if ("cause" in item && queue.length < 12) queue.push(item.cause);
		if (item instanceof AggregateError) {
			for (const child of item.errors.slice(0, 4)) if (queue.length < 12) queue.push(child);
		}
	}
	return codes;
}

/**
 * Classify a catalog request or filesystem failure into a code and an
 * explanation resolved from `catalog`.
 *
 * The upstream error code is appended to the catalog explanation in
 * parentheses, so the code stays the identity of the failure and the
 * explanation is the only catalog text. `catalog` defaults to the English
 * bundle, so the returned `message` is the same English bytes as before the
 * migration while a caller with a resolved bundle can render the same ID in
 * the active locale.
 */
export function describeCatalogFailure(
	error: unknown,
	phase: "network" | "filesystem",
	catalog: CatalogBundle = defaultCatalog(),
): CatalogFailure {
	if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
		return { code: "timeout", message: catalogText(catalog, FAILURE_MESSAGE_IDS.timeout) };
	}
	for (const code of causeCodes(error)) {
		if (phase === "filesystem" && FILESYSTEM_CODES.has(code)) {
			return {
				code: "filesystem_error",
				message: catalogText(catalog, FAILURE_MESSAGE_IDS.filesystem, { code }),
			};
		}
		if (phase !== "network") continue;
		if (CERTIFICATE_CODES.has(code)) {
			return {
				code: "tls_certificate_error",
				message: catalogText(catalog, FAILURE_MESSAGE_IDS.certificate, { code }),
			};
		}
		if (Object.hasOwn(REQUEST_CODES, code)) {
			const detail = REQUEST_CODES[code];
			return { code: detail.code, message: `${catalogText(catalog, detail.messageId)} (${code})` };
		}
	}
	return phase === "network"
		? { code: "network_error", message: catalogText(catalog, FAILURE_MESSAGE_IDS.network) }
		: { code: "cache_error", message: catalogText(catalog, FAILURE_MESSAGE_IDS.cache) };
}

/** Bound locally generated validation messages and remove the request's bearer before persistence. */
export function safeCatalogMessage(message: string, token?: string): string {
	return sanitizeTerminalText(token ? message.split(token).join("[redacted]") : message).slice(0, 512);
}
