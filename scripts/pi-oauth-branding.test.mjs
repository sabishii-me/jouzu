import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { transformOAuthBranding } from "./pi-oauth-branding-transform.mjs";

const roots = [
	new URL("../node_modules/@earendil-works/pi-ai/", import.meta.url),
	new URL("../packages/cli/node_modules/@earendil-works/pi-ai/", import.meta.url),
];

function assertBrand(html) {
	assert.match(html, /aria-label="Jouzu"/);
	assert.match(html, /--page-bg: #1a1b26;/);
	assert.match(html, /fill="rgb\(34 211 238\)"/);
	assert.match(html, /fill="rgb\(244 114 182\)"/);
	assert.equal((html.match(/<circle /g) ?? []).length, 67);
	assert.match(html, /width: min\(100%, 352px\)/);
	assert.doesNotMatch(html, /<path |<script|<img |https?:\/\/(?!www.w3.org)/);
}

test("OAuth branding transform retains the wordmark and rejects changed source", async () => {
	const map = JSON.parse(await readFile(new URL("dist/utils/oauth-page.js.map", roots[0]), "utf8"));
	const original = map.sourcesContent[0];
	assertBrand(transformOAuthBranding(original));
	assert.throws(() => transformOAuthBranding("unknown"), /source anchor changed/);
	assert.throws(
		() => transformOAuthBranding(original.replace("--page-bg: #09090b;", "--page-bg: black;")),
		/source anchor changed/,
	);
	assert.throws(() => transformOAuthBranding(original + original), /source anchor changed/);
});

for (const [index, root] of roots.entries()) {
	test(`OAuth callback serves Jouzu branding and preserves state checks in package tree ${index}`, async (t) => {
		const { oauthSuccessHtml, oauthErrorHtml } = await import(new URL("dist/utils/oauth-page.js", root));
		for (const html of [oauthSuccessHtml("<unsafe>&"), oauthErrorHtml("<unsafe>&", '"details"')]) {
			assertBrand(html);
			assert.match(html, /&lt;unsafe&gt;&amp;/);
			assert.doesNotMatch(html, /<unsafe>/);
		}
		assert.match(oauthErrorHtml("failed", '"details"'), /&quot;details&quot;/);
		const { startOAuthCallbackServer } = await import(new URL("dist/auth/oauth/callback-server.js", root));
		const codes = [];
		const server = await startOAuthCallbackServer({
			providerName: "Fixture",
			host: "127.0.0.1",
			port: 0,
			path: "/callback",
			state: "expected",
			complete: async (code) => {
				codes.push(code);
				return code;
			},
		});
		t.after(() => server.close());
		const rejected = await fetch(`${server.redirectUri}?state=wrong&code=unused`);
		assert.equal(rejected.status, 400);
		assertBrand(await rejected.text());
		assert.deepEqual(codes, []);
		const accepted = await fetch(`${server.redirectUri}?state=expected&code=fixture`);
		assert.equal(accepted.status, 200);
		assert.equal(accepted.headers.get("cache-control"), "no-store");
		const html = await accepted.text();
		assertBrand(html);
		assert.match(html, /Authentication successful/);
		assert.match(html, /Signed in to Fixture/);
		assert.equal(await server.wait(), "fixture");
		assert.deepEqual(codes, ["fixture"]);
	});
}
