import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCatalogFailure, safeCatalogMessage } from "../dist/catalog-failure.js";
import { loadCatalog } from "../dist/locale-catalog.js";

for (const [code, expected] of [
	["ENOTFOUND", "dns_error"],
	["EAI_AGAIN", "dns_error"],
	["ECONNREFUSED", "connection_refused"],
	["ECONNRESET", "connection_reset"],
	["ENETUNREACH", "network_unreachable"],
	["UND_ERR_CONNECT_TIMEOUT", "timeout"],
	["UND_ERR_BODY_TIMEOUT", "timeout"],
	["CERT_HAS_EXPIRED", "tls_certificate_error"],
	["SELF_SIGNED_CERT_IN_CHAIN", "tls_certificate_error"],
	["ERR_TLS_CERT_ALTNAME_INVALID", "tls_certificate_error"],
	["EACCES", "network_permission"],
]) {
	test(`catalog nested ${code} produces a safe actionable diagnostic`, () => {
		const cause = Object.assign(new Error("https://user:secret@host/path?token=secret"), { code });
		const failure = describeCatalogFailure(new TypeError("fetch failed secret", { cause }), "network");
		assert.equal(failure.code, expected);
		assert.match(failure.message, new RegExp(code));
		assert.doesNotMatch(failure.message, /secret|user:|https:/u);
		assert.ok(failure.message.length <= 512);
	});
}

test("filesystem errors stay distinct from network permission failures", () => {
	for (const code of ["EACCES", "EPERM", "ENOSPC", "ENOTDIR", "ENOENT"]) {
		const error = Object.assign(new Error("private path"), { code });
		const failure = describeCatalogFailure(error, "filesystem");
		assert.equal(failure.code, "filesystem_error");
		assert.match(failure.message, new RegExp(code));
		assert.doesNotMatch(failure.message, /private path/u);
	}
	assert.equal(describeCatalogFailure(new Error("local failure"), "filesystem").code, "cache_error");
});

test("aggregate, cyclic, unknown and oversized causes are bounded and do not expose details", () => {
	const cycle = Object.assign(new Error("secret"), { code: "constructor" });
	cycle.cause = cycle;
	const aggregate = new AggregateError([cycle, Object.assign(new Error("secret"), { code: "ECONNREFUSED" })]);
	assert.equal(
		describeCatalogFailure(new Error("fetch failed", { cause: aggregate }), "network").code,
		"connection_refused",
	);
	assert.equal(describeCatalogFailure(cycle, "network").code, "network_error");
	assert.doesNotMatch(describeCatalogFailure(cycle, "network").message, /secret|constructor/u);
	let deep = Object.assign(new Error("secret"), { code: "ENOTFOUND" });
	for (let i = 0; i < 100; i++) deep = new Error("secret", { cause: deep });
	assert.equal(describeCatalogFailure(deep, "network").code, "network_error");
});

test("timeouts and redirect rejection have specific guidance without weakening transport", () => {
	assert.equal(describeCatalogFailure(new DOMException("secret", "AbortError"), "network").code, "timeout");
	assert.equal(describeCatalogFailure(new DOMException("secret", "TimeoutError"), "network").code, "timeout");
	const error = new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
	assert.equal(describeCatalogFailure(error, "network").code, "redirect_blocked");
	assert.match(describeCatalogFailure(error, "network").message, /does not forward/u);
});

test("validation messages redact the bearer, strip terminal escapes and stay bounded", () => {
	const message = safeCatalogMessage(`invalid secret \x1b[31mvalue ${"x".repeat(1000)}`, "secret");
	assert.match(message, /\[redacted\]/u);
	assert.doesNotMatch(message, /secret/u);
	assert.equal(message.includes("\x1b"), false);
	assert.equal(message.length, 512);
});

// Pins the exact English bytes a caller that passes no catalog receives, so the
// migration cannot silently change the machine-readable message, and proves the
// same failure renders from a resolved catalog in the active locale.
for (const [code, expectedCode, expectedMessage] of [
	["ENOTFOUND", "dns_error", "Catalog hostname could not be resolved. Check the endpoint, DNS, and VPN connection."],
	["EAI_AGAIN", "dns_error", "Catalog DNS lookup temporarily failed. Check the network connection and retry."],
	["ECONNREFUSED", "connection_refused", "The catalog connection was refused. Check the endpoint and proxy address."],
	[
		"ECONNRESET",
		"connection_reset",
		"The catalog connection was reset. Check the connection and any proxy or security software.",
	],
	[
		"ENETUNREACH",
		"network_unreachable",
		"The catalog network is unreachable. Check the network, VPN, and proxy configuration.",
	],
	[
		"EHOSTUNREACH",
		"network_unreachable",
		"The catalog host is unreachable. Check the network, VPN, and proxy configuration.",
	],
	["ETIMEDOUT", "timeout", "The catalog request timed out. Check connectivity and proxy configuration, then retry."],
	[
		"UND_ERR_CONNECT_TIMEOUT",
		"timeout",
		"Connecting to the catalog timed out. Check connectivity and proxy configuration.",
	],
	[
		"UND_ERR_HEADERS_TIMEOUT",
		"timeout",
		"The catalog did not send response headers in time. Retry or check the catalog service.",
	],
	["UND_ERR_BODY_TIMEOUT", "timeout", "The catalog response stalled. Retry or check the catalog service."],
	[
		"UND_ERR_SOCKET",
		"connection_reset",
		"The catalog connection closed unexpectedly. Check the connection and proxy configuration.",
	],
	[
		"EACCES",
		"network_permission",
		"Permission to connect to the catalog was denied. Check the machine's outbound network policy.",
	],
]) {
	test(`catalog failure ${code} keeps its English bytes and its code`, () => {
		const cause = Object.assign(new Error("secret"), { code });
		const failure = describeCatalogFailure(new TypeError("fetch failed", { cause }), "network");
		assert.equal(failure.code, expectedCode);
		assert.equal(failure.message, `${expectedMessage} (${code})`);
	});
}

test("a resolved catalog renders the same failure in the active locale", () => {
	const ja = loadCatalog("ja");
	const cause = Object.assign(new Error("secret"), { code: "ENOTFOUND" });
	const failure = describeCatalogFailure(new TypeError("fetch failed", { cause }), "network", ja);
	assert.equal(failure.code, "dns_error");
	assert.equal(
		failure.message,
		"カタログのホスト名を解決できませんでした。エンドポイント、DNS、VPN 接続を確認してください。 (ENOTFOUND)",
	);
});

test("filesystem, certificate, and fallback explanations render from the catalog", () => {
	const ja = loadCatalog("ja");
	const filesystem = describeCatalogFailure(Object.assign(new Error("x"), { code: "EACCES" }), "filesystem", ja);
	assert.equal(filesystem.code, "filesystem_error");
	assert.match(filesystem.message, /ローカルのカタログデータ/u);
	const certificate = describeCatalogFailure(
		Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" }),
		"network",
		ja,
	);
	assert.equal(certificate.code, "tls_certificate_error");
	assert.match(certificate.message, /証明書検証を無効にしないでください/u);
	assert.equal(describeCatalogFailure(new Error("local"), "filesystem").code, "cache_error");
});
