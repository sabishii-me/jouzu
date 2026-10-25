import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { setCatalogSourceToken } from "../dist/catalog-sources.js";
import { isInteractivePiStartup } from "../dist/interactive-startup.js";
import { resolveCatalog } from "../dist/locale-catalog.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { readShisaLoginToken, writeShisaLoginCredential } from "../dist/shisa-link/credentials.js";
import { offerShisaOnboarding, shisaOnboardingPath } from "../dist/shisa-link/onboarding.js";
import { readShisaLinkState, shisaLinkStatePath } from "../dist/shisa-link/state.js";

const code = {
	device_code: "device-secret",
	user_code: "JOUZU-TEST-1234",
	verification_uri: "https://example.test/connect",
	authorization_id: "authorization",
	expires_in: 900,
	interval: 5,
};
const token = {
	user: { email: "test@example.test" },
	api_key: { uuid: "key", secret: "shsk:test-secret", label: "Jouzu" },
	org: { id: "org", name: "Example", slug: "example" },
	endpoints: {
		openai_base_url: "https://api.example.test/v1",
		model_catalog_url: "https://api.example.test/catalog",
		asr_realtime_url: "wss://api.example.test/asr",
	},
	link_token: "link-secret",
	authorization_id: "authorization",
};
function response(status, body) {
	return new Response(body ? JSON.stringify(body) : null, { status, headers: { "content-type": "application/json" } });
}
function harness(t, extra = {}) {
	const home = mkdtempSync(join(tmpdir(), "jouzu-onboarding-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const paths = resolveJouzuPaths({ homeOverride: home });
	let text = "";
	const output = new PassThrough();
	output.columns = 48;
	output.on("data", (data) => {
		text += data;
	});
	return {
		paths,
		output,
		text: () => text,
		options: {
			paths,
			output,
			interactive: true,
			env: {},
			jouzuVersion: "0.1.9",
			ask: async () => "n",
			fetchImpl: async (url) => {
				assert.fail(`unexpected request before login: ${url}`);
			},
			sleep: async () => {},
			...extra,
		},
	};
}

test("the default English prompt shows the approved generic copy", async (t) => {
	let asked = "";
	const h = harness(t, {
		ask: async (question) => {
			asked = question;
			return "n";
		},
	});
	h.output.columns = 120;
	await offerShisaOnboarding(h.options);
	assert.equal(
		h.text(),
		"\n  \u25c6 Connect to Shisa AI to access hosted models and voice input.\n  \u25c6 Explore bonus credits and other offers, including eligibility: https://platform.shisa.ai/jouzu\n\nYou can connect later with /login shisa.\n",
	);
	assert.equal(asked, "  Connect now? [y/N] (or later with /login shisa) ");
});

test("skip is private, persists across launches, and wraps the generic prompt at 48 columns", async (t) => {
	const h = harness(t);
	await offerShisaOnboarding(h.options);
	const prose = h.text().replace(/\s+/gu, " ");
	assert.match(prose, /Connect to Shisa AI to access hosted models and voice input\./u);
	assert.match(
		prose,
		/Explore bonus credits and other offers, including eligibility: https:\/\/platform\.shisa\.ai\/jouzu/u,
	);
	assert.ok(h.text().includes("https://platform.shisa.ai/jouzu"), h.text());
	assert.doesNotMatch(h.text(), /USD|\$\d|Signup offer|connection offer|Billing verification/u);
	assert.match(h.text(), /\/login shisa/u);
	assert.equal((h.text().match(/\u25c6/gu) ?? []).length, 2);
	for (const line of h.text().split("\n")) assert.ok(visibleWidth(line) <= 48, line);
	const path = shisaOnboardingPath(h.paths);
	assert.equal(JSON.parse(readFileSync(path, "utf8")).choice, "skip");
	if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
	await offerShisaOnboarding({ ...h.options, ask: () => assert.fail("offered twice") });
});

for (const answer of ["", "no", "maybe"]) {
	test(`only affirmative answers connect (${JSON.stringify(answer)})`, async (t) => {
		const h = harness(t, { ask: async () => answer });
		await offerShisaOnboarding(h.options);
		assert.equal(JSON.parse(readFileSync(shisaOnboardingPath(h.paths), "utf8")).choice, "skip");
	});
}

for (const args of [["--print", "hello"], ["--mode", "rpc"], ["--mode=json"], ["--help"]]) {
	test(`noninteractive startup does not offer or write (${args.join(" ")})`, async (t) => {
		const interactive = isInteractivePiStartup(args, { stdinIsTTY: true, stdoutIsTTY: true, env: {} });
		assert.equal(interactive, false);
		const h = harness(t, { interactive, ask: () => assert.fail("prompted") });
		await offerShisaOnboarding(h.options);
		assert.equal(h.text(), "");
		assert.equal(existsSync(shisaOnboardingPath(h.paths)), false);
	});
}

for (const source of ["environment", "login", "catalog token"]) {
	test(`existing ${source} credentials suppress the offer`, async (t) => {
		const h = harness(t, { ask: () => assert.fail("prompted") });
		if (source === "environment") h.options.env = { SHISA_API_KEY: "configured" };
		else if (source === "catalog token") setCatalogSourceToken(h.paths, "shisa-api", "configured");
		else
			await writeShisaLoginCredential(h.paths, {
				type: "oauth",
				access: "configured",
				refresh: "",
				expires: Number.MAX_SAFE_INTEGER,
			});
		await offerShisaOnboarding(h.options);
		assert.equal(h.text(), "");
		assert.equal(existsSync(shisaOnboardingPath(h.paths)), false);
	});
}

test("the prompt makes no network request before login", async (t) => {
	let calls = 0;
	const h = harness(t, {
		fetchImpl: async (url) => {
			calls += 1;
			assert.fail(`unexpected request before login: ${url}`);
		},
	});
	await offerShisaOnboarding(h.options);
	assert.equal(calls, 0);
	assert.equal(JSON.parse(readFileSync(shisaOnboardingPath(h.paths), "utf8")).choice, "skip");
});

test("acceptance runs device login, saves before acknowledgement, and preserves other providers", async (t) => {
	const h = harness(t, { ask: async () => "YES" });
	mkdirSync(h.paths.agentDir, { recursive: true });
	writeFileSync(
		join(h.paths.agentDir, "auth.json"),
		JSON.stringify({ other: { type: "api_key", key: "other-secret" } }),
	);
	const calls = [];
	await offerShisaOnboarding({
		...h.options,
		fetchImpl: async (url) => {
			calls.push(url);
			if (url.endsWith("/code")) return response(201, code);
			if (url.endsWith("/token")) return response(200, token);
			assert.equal(readShisaLoginToken(h.paths), token.api_key.secret);
			assert.equal(readShisaLinkState(shisaLinkStatePath(h.paths)).acked, false);
			return response(204);
		},
	});
	assert.equal(calls.length, 3);
	assert.ok(calls[0].endsWith("/code"), calls.join(", "));
	assert.ok(
		calls.every((url) => !url.includes("promotions")),
		calls.join(", "),
	);
	assert.equal(readShisaLinkState(shisaLinkStatePath(h.paths)).acked, true);
	assert.match(h.text(), /https:\/\/example\.test\/connect/u);
	assert.match(h.text(), /JOUZU-TEST-1234/u);
	assert.match(h.text(), /Signed in to Shisa AI/u);
	assert.doesNotMatch(h.text(), /device-secret|link-secret|shsk:test-secret|other-secret/u);
	assert.equal(JSON.parse(readFileSync(join(h.paths.agentDir, "auth.json"))).other.key, "other-secret");
});

test("network failure allows startup to continue with manual recovery and no repeated offer", async (t) => {
	const h = harness(t, {
		ask: async () => "y",
		fetchImpl: async () => {
			throw new Error("secret-in-error");
		},
	});
	await offerShisaOnboarding(h.options);
	assert.match(h.text(), /could not complete/u);
	assert.match(h.text(), /\/login shisa/u);
	assert.match(h.text(), /Explore bonus credits and other offers/u);
	assert.doesNotMatch(h.text(), /secret-in-error/u);
	await offerShisaOnboarding({ ...h.options, ask: () => assert.fail("prompted twice") });
});

test("cancellation during login aborts the network and removes the process listener", async (t) => {
	const controller = new AbortController();
	const listeners = process.listenerCount("SIGINT");
	const h = harness(t, { ask: async () => "y", signal: controller.signal });
	await offerShisaOnboarding({
		...h.options,
		fetchImpl: async (url, { signal }) => {
			if (!url.endsWith("/code")) assert.fail(`unexpected request: ${url}`);
			controller.abort();
			signal.throwIfAborted();
		},
	});
	assert.match(h.text(), /cancelled/u);
	assert.equal(process.listenerCount("SIGINT"), listeners);
	assert.equal(readShisaLoginToken(h.paths), undefined);
});

test("cancellation before an answer does not record consent", async (t) => {
	const controller = new AbortController();
	const h = harness(t, {
		signal: controller.signal,
		ask: async () => {
			controller.abort();
			return "y";
		},
	});
	await offerShisaOnboarding(h.options);
	assert.equal(existsSync(shisaOnboardingPath(h.paths)), false);
});

test("storage failure does not start login", async (t) => {
	const h = harness(t, { ask: async () => "y" });
	mkdirSync(join(h.paths.stateDir, ".."), { recursive: true });
	writeFileSync(h.paths.stateDir, "not a directory");
	await offerShisaOnboarding(h.options);
	assert.match(h.text(), /storage permissions/u);
	assert.equal(readShisaLoginToken(h.paths), undefined);
});

test("the readline prompt accepts Enter as skip and closes its input listener", async (t) => {
	const h = harness(t);
	const input = new PassThrough();
	h.output.on("data", (data) => {
		if (data.toString().includes("[y/N]")) queueMicrotask(() => input.write("\n"));
	});
	await offerShisaOnboarding({ ...h.options, ask: undefined, input });
	assert.equal(JSON.parse(readFileSync(shisaOnboardingPath(h.paths))).choice, "skip");
	assert.equal(input.listenerCount("data"), 0);
});

test("EOF cancels an unanswered readline prompt without recording a decision", { timeout: 2000 }, async (t) => {
	const h = harness(t);
	const input = new PassThrough();
	h.output.on("data", (data) => {
		if (data.toString().includes("[y/N]")) queueMicrotask(() => input.end());
	});
	await offerShisaOnboarding({ ...h.options, ask: undefined, input });
	assert.equal(existsSync(shisaOnboardingPath(h.paths)), false);
	assert.match(h.text(), /cancelled/u);
});

test("credential storage failure is reported without acknowledgement", async (t) => {
	const h = harness(t, { ask: async () => "y" });
	mkdirSync(join(h.paths.agentDir, "auth.json"), { recursive: true });
	await offerShisaOnboarding({
		...h.options,
		fetchImpl: async (url) => {
			if (url.endsWith("/code")) return response(201, code);
			if (url.endsWith("/token")) return response(200, token);
			assert.fail("must not acknowledge failed storage");
		},
	});
	assert.match(h.text(), /storage permissions/u);
	assert.doesNotMatch(h.text(), /Signed in to Shisa AI/u);
});

test("a Japanese catalog renders the approved generic prompt and hint in Japanese", async (t) => {
	let asked = "";
	const h = harness(t, {
		ask: async (question) => {
			asked = question;
			return "n";
		},
	});
	h.output.columns = 120;
	await offerShisaOnboarding({ ...h.options, catalog: resolveCatalog("ja").bundle });
	assert.equal(
		h.text(),
		"\n  \u25c6 Shisa AI に接続すると、クラウドモデルや音声入力を利用できます。\n  \u25c6 ボーナスクレジットなどの特典や適用条件はこちら: https://platform.shisa.ai/jouzu\n\n後で `/login shisa` からでも接続できます。\n",
	);
	assert.equal(asked, "  今すぐ接続しますか？ [y/N] （後で `/login shisa` でも接続できます） ");
	assert.doesNotMatch(h.text(), /Connect to Shisa AI|connect later/u);
});

test("unknown terminal width uses readable prose wrapping", async (t) => {
	const h = harness(t);
	h.output.columns = 0;
	await offerShisaOnboarding(h.options);
	assert.match(h.text().replace(/\s+/gu, " "), /Connect to Shisa AI to access hosted models and voice input\./u);
});

const ESCAPE = "\u001b";
const MARKER_LINE = "  \u25c6 Connect to Shisa AI";

test("prompt lines carry a marker and stay plain without color", async (t) => {
	const h = harness(t);
	await offerShisaOnboarding(h.options);
	assert.ok(h.text().includes(MARKER_LINE), h.text());
	assert.ok(h.text().includes("  \u25c6 Explore bonus credits and other offers"), h.text());
	assert.ok(!h.text().includes(ESCAPE), h.text());
});

test("color styles the marker and the prompt hint without touching the copy", async (t) => {
	let asked = "";
	const h = harness(t, {
		colorEnabled: true,
		ask: async (question) => {
			asked = question;
			return "n";
		},
	});
	await offerShisaOnboarding(h.options);
	assert.ok(asked.includes("[y/N]"), asked);
	assert.ok(asked.includes(`${ESCAPE}[2m(or later with /login shisa)${ESCAPE}[0m`), asked);
	assert.ok(h.text().includes(`  ${ESCAPE}[36m\u25c6${ESCAPE}[0m Connect to Shisa AI`), h.text());
	for (const line of h.text().split("\n")) assert.ok(visibleWidth(line) <= 48, line);
});

test("onboarding skips without a request for noninteractive, credentialed, or decided launches", async (t) => {
	for (const skip of ["noninteractive", "credential", "decided"]) {
		let calls = 0;
		const h = harness(t, {
			fetchImpl: async (url) => {
				calls += 1;
				assert.fail(`unexpected request: ${url}`);
			},
		});
		if (skip === "noninteractive") h.options.interactive = false;
		if (skip === "credential") h.options.env.SHISA_API_KEY = "configured";
		if (skip === "decided") {
			await offerShisaOnboarding(h.options);
			calls = 0;
		}
		await offerShisaOnboarding({ ...h.options, ask: () => assert.fail("unexpected prompt") });
		assert.equal(calls, 0, skip);
	}
});

test("NO_COLOR and dumb terminals keep the marker and drop the escapes", async (t) => {
	for (const env of [{ NO_COLOR: "1", TERM: "xterm-256color" }, { TERM: "dumb" }]) {
		const h = harness(t, { env });
		h.output.isTTY = true;
		await offerShisaOnboarding(h.options);
		assert.ok(h.text().includes(MARKER_LINE), h.text());
		assert.ok(!h.text().includes(ESCAPE), h.text());
	}
});
