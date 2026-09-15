import { sanitizeTerminalText } from "./terminal-layout.js";

export interface CatalogFailure {
	code: string;
	message: string;
}

const REQUEST_CODES: Record<string, CatalogFailure> = {
	ENOTFOUND: {
		code: "dns_error",
		message: "Catalog hostname could not be resolved. Check the endpoint, DNS, and VPN connection.",
	},
	EAI_AGAIN: {
		code: "dns_error",
		message: "Catalog DNS lookup temporarily failed. Check the network connection and retry.",
	},
	ECONNREFUSED: {
		code: "connection_refused",
		message: "The catalog connection was refused. Check the endpoint and proxy address.",
	},
	ECONNRESET: {
		code: "connection_reset",
		message: "The catalog connection was reset. Check the connection and any proxy or security software.",
	},
	ENETUNREACH: {
		code: "network_unreachable",
		message: "The catalog network is unreachable. Check the network, VPN, and proxy configuration.",
	},
	EHOSTUNREACH: {
		code: "network_unreachable",
		message: "The catalog host is unreachable. Check the network, VPN, and proxy configuration.",
	},
	ETIMEDOUT: {
		code: "timeout",
		message: "The catalog request timed out. Check connectivity and proxy configuration, then retry.",
	},
	UND_ERR_CONNECT_TIMEOUT: {
		code: "timeout",
		message: "Connecting to the catalog timed out. Check connectivity and proxy configuration.",
	},
	UND_ERR_HEADERS_TIMEOUT: {
		code: "timeout",
		message: "The catalog did not send response headers in time. Retry or check the catalog service.",
	},
	UND_ERR_BODY_TIMEOUT: {
		code: "timeout",
		message: "The catalog response stalled. Retry or check the catalog service.",
	},
	UND_ERR_SOCKET: {
		code: "connection_reset",
		message: "The catalog connection closed unexpectedly. Check the connection and proxy configuration.",
	},
	EACCES: {
		code: "network_permission",
		message: "Permission to connect to the catalog was denied. Check the machine's outbound network policy.",
	},
	EPERM: {
		code: "network_permission",
		message: "Permission to connect to the catalog was denied. Check the machine's outbound network policy.",
	},
	REDIRECT_BLOCKED: {
		code: "redirect_blocked",
		message:
			"The catalog redirected the request. Use its final endpoint URL; Jouzu does not forward catalog credentials through redirects.",
	},
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

export function describeCatalogFailure(error: unknown, phase: "network" | "filesystem"): CatalogFailure {
	if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
		return {
			code: "timeout",
			message: "The catalog request timed out. Check connectivity and proxy configuration, then retry.",
		};
	}
	for (const code of causeCodes(error)) {
		if (phase === "filesystem" && FILESYSTEM_CODES.has(code)) {
			return {
				code: "filesystem_error",
				message: `Jouzu could not read or write its local catalog data (${code}). Check the Jouzu data folder's permissions, available space, and whether another program is using it.`,
			};
		}
		if (phase !== "network") continue;
		if (CERTIFICATE_CODES.has(code)) {
			return {
				code: "tls_certificate_error",
				message: `Catalog certificate verification failed (${code}). Check the system clock and trusted certificates, including any organization proxy certificate. Do not disable certificate verification.`,
			};
		}
		if (Object.hasOwn(REQUEST_CODES, code)) {
			const detail = REQUEST_CODES[code];
			return { code: detail.code, message: `${detail.message} (${code})` };
		}
	}
	return phase === "network"
		? {
				code: "network_error",
				message:
					"The catalog request failed. Check the endpoint, network connection, proxy environment variables, and trusted certificates.",
			}
		: {
				code: "cache_error",
				message: "Jouzu could not access its local catalog data. Check the Jouzu data folder and retry.",
			};
}

/** Bound locally generated validation messages and remove the request's bearer before persistence. */
export function safeCatalogMessage(message: string, token?: string): string {
	return sanitizeTerminalText(token ? message.split(token).join("[redacted]") : message).slice(0, 512);
}
