import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveJouzuPaths } from "../dist/paths.js";
import { readShisaAccountStatus, shisaDashboardUrl } from "../dist/shisa-link/account.js";
import {
	DEFAULT_SHISA_GATEWAY_URL,
	loginShisaDeviceFlow,
	resolveShisaGatewayUrl,
} from "../dist/shisa-link/device-flow.js";
import { newShisaInstallId } from "../dist/shisa-link/state.js";

/**
 * The UI locale is a Jouzu display setting. The Shisa account,
 * billing, and sign-in surfaces are service-owned, so a UI-locale change must
 * not move the account region, an entitlement, the billing currency, or data
 * retention. The account and device-flow modules take no locale parameter and
 * send no locale field; these tests pin that.
 */

const DEVICE_CODE_BODY = {
	device_code: "dc-value",
	user_code: "JOUZU-ABCD-EFGH",
	verification_uri: "https://platform.shisa.ai/connect",
	verification_uri_complete: "https://platform.shisa.ai/connect?code=JOUZU-ABCD-EFGH",
	authorization_id: "auth-xyz",
	expires_in: 900,
	interval: 5,
};

function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("the UI locale does not move the account region, entitlement, currency, or retention", async (t) => {
	// The service endpoint is chosen from JOUZU_SHISA_PLATFORM_URL alone; a UI
	// locale in the environment never reaches it.
	for (const uiLocale of ["ja", "en"]) {
		assert.equal(resolveShisaGatewayUrl({ JOUZU_UI_LOCALE: uiLocale }), DEFAULT_SHISA_GATEWAY_URL);
		assert.equal(
			resolveShisaGatewayUrl({ JOUZU_UI_LOCALE: uiLocale, JOUZU_SHISA_PLATFORM_URL: "https://gw.test/" }),
			"https://gw.test",
		);
	}
	// The service owns the account language; the dashboard path stays `en`.
	assert.equal(shisaDashboardUrl("https://gateway.shisa.ai"), "https://platform.shisa.ai/en/dashboard");

	// Account state is read from local credentials only, so a UI locale cannot
	// change the organization (region/entitlement) or the dashboard URL.
	const home = mkdtempSync(join(tmpdir(), "jouzu-jz05-independence-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const paths = resolveJouzuPaths({ homeOverride: home });
	const japanese = readShisaAccountStatus(paths, { JOUZU_UI_LOCALE: "ja" });
	const english = readShisaAccountStatus(paths, { JOUZU_UI_LOCALE: "en" });
	assert.deepEqual(japanese, english);
	assert.equal(japanese.signedIn, false);

	// The device-code request carries only client identity and device metadata.
	const calls = [];
	const responses = [jsonResponse(201, DEVICE_CODE_BODY), jsonResponse(400, { error: "access_denied" })];
	const fetchImpl = (url, init) => {
		calls.push({ url: String(url), init });
		return Promise.resolve(responses.shift() ?? jsonResponse(500, {}));
	};
	const callbacks = {
		onAuth: () => {},
		onDeviceCode: () => {},
		onPrompt: async () => {
			throw new Error("no prompts expected");
		},
		onProgress: () => {},
		onSelect: async () => undefined,
	};
	await assert.rejects(
		loginShisaDeviceFlow(callbacks, {
			gatewayUrl: "https://gateway.test",
			clientVersion: "0.1.0",
			installId: newShisaInstallId(),
			writeLinkState: async () => {},
			writeCredential: async () => {},
			fetchImpl,
			sleep: async () => {},
		}),
	);
	const body = JSON.parse(calls[0].init.body);
	assert.deepEqual(Object.keys(body).sort(), ["client_id", "client_version", "device_name", "install_id", "platform"]);
	for (const key of Object.keys(body)) {
		assert.doesNotMatch(key, /locale|region|currency|retention|entitlement|plan|tier/u, key);
	}
});
