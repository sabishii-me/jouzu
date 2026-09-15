import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCatalogFailure, safeCatalogMessage } from "../dist/catalog-failure.js";

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
