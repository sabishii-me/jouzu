import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	catalogSourceCredentialAvailable,
	resolveCatalogBearer,
	resolveCatalogSources,
	SHISA_API_CATALOG_SOURCE,
} from "../dist/catalog-sources.js";
import { MODEL_CATALOG_MEDIA_TYPE } from "../dist/model-catalog.js";
import { refreshCatalogSource } from "../dist/model-catalog-sync.js";
import { createJouzuModelPicker } from "../dist/model-picker.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { isShisaSignedOut, setShisaSignedOut } from "../dist/shisa-link/credentials.js";
import { createShisaExtension } from "../dist/shisa-link/extension.js";
import {
	logoutShisa,
	shisaLogoutMessage,
	shisaRevocationUrl,
	withShisaAuthOperation,
} from "../dist/shisa-link/logout.js";
import {
	newShisaInstallId,
	readShisaLinkState,
	shisaLinkStatePath,
	writeShisaLinkState,
} from "../dist/shisa-link/state.js";

const credential = { type: "oauth", access: "test-inference-secret", refresh: "", expires: Number.MAX_SAFE_INTEGER };
const other = { type: "api_key", key: "other-provider-secret" };
async function setup(t, overrides = {}) {
	const home = mkdtempSync(join(tmpdir(), "jouzu-logout-"));
	const paths = resolveJouzuPaths({ homeOverride: home });
	t.after(() => {
		setShisaSignedOut(paths, false);
		rmSync(home, { recursive: true, force: true });
	});
	mkdirSync(paths.agentDir, { recursive: true });
	const authPath = join(paths.agentDir, "auth.json");
	writeFileSync(authPath, JSON.stringify({ shisa: credential, other }));
	await writeShisaLinkState(shisaLinkStatePath(paths), {
		install_id: newShisaInstallId(),
		authorization_id: "test-authorization",
		api_key_uuid: "key-id",
		org: { id: "test", name: "Test", slug: "test" },
		endpoints: {
			openai_base_url: "https://api.example.test/v1",
			model_catalog_url: "https://api.example.test/catalog",
			asr_realtime_url: "wss://api.example.test/asr",
		},
		link_token: "test-link-secret",
		gateway_url: "https://issuer.example.test",
		acked: true,
		...overrides,
	});
	return { paths, home, authPath };
}
function assertCleared(h) {
	assert.deepEqual(JSON.parse(readFileSync(h.authPath, "utf8")), { other });
	assert.equal(existsSync(shisaLinkStatePath(h.paths)), false);
	assert.equal(isShisaSignedOut(h.paths), true);
}

for (const outcome of ["success", "server-error", "unauthorized", "network", "timeout"]) {
	test(`logout clears local credentials after ${outcome}`, async (t) => {
		const h = await setup(t);
		// Keep the test alive while the timeout's unref'ed timer fires.
		const keepAlive = setTimeout(() => {}, 1000);
		t.after(() => clearTimeout(keepAlive));
		let calls = 0;
		const result = await logoutShisa({
			paths: h.paths,
			timeoutMs: 10,
			fetchImpl: async (url, options) => {
				calls++;
				assert.equal(url, "https://issuer.example.test/device/link/revoke");
				assert.equal(options.method, "POST");
				assert.equal(options.headers.authorization, "Bearer test-link-secret");
				assert.equal(options.redirect, "error");
				assert.equal(options.body, undefined);
				assert.equal(JSON.parse(readFileSync(h.authPath, "utf8")).shisa.access, credential.access);
				assert.ok(readShisaLinkState(shisaLinkStatePath(h.paths)));
				if (outcome === "network") throw new Error("test-link-secret");
				if (outcome === "timeout")
					return new Promise((_resolve, reject) =>
						options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }),
					);
				return new Response(null, { status: outcome === "success" ? 204 : outcome === "unauthorized" ? 401 : 503 });
			},
		});
		assert.equal(calls, 1);
		assert.equal(result.localCleared, true);
		assert.equal(result.revocation, outcome === "success" ? "confirmed" : "unconfirmed");
		assert.doesNotMatch(shisaLogoutMessage(result, false), /test-link-secret|test-inference-secret/);
		if (outcome !== "success") assert.match(shisaLogoutMessage(result, false), /dashboard/);
		assertCleared(h);
		assert.deepEqual(
			await logoutShisa({ paths: h.paths, fetchImpl: () => assert.fail("repeat must not call server") }),
			{ localCleared: true, revocation: "not-linked" },
		);
	});
}

for (const gateway of [
	undefined,
	"http://untrusted.example.test",
	"https://user:secret@issuer.example.test",
	"bad gateway",
	"https://issuer.example.test/?token=secret",
]) {
	test(`logout does not guess or follow an unsafe issuer (${gateway ?? "legacy state"})`, async (t) => {
		const h = await setup(t, { gateway_url: gateway });
		const result = await logoutShisa({ paths: h.paths, fetchImpl: () => assert.fail("no safe issuing gateway") });
		assert.equal(result.revocation, "unconfirmed");
		assertCleared(h);
	});
}

test("revocation URLs preserve an issuer base path and permit local development", () => {
	assert.equal(
		shisaRevocationUrl("http://127.0.0.1:9000/platform/"),
		"http://127.0.0.1:9000/platform/device/link/revoke",
	);
});

for (const failure of ["auth-locked", "auth-malformed", "state-directory"]) {
	test(`logout reports ${failure} while attempting both local removals`, async (t) => {
		const h = await setup(t);
		if (failure === "auth-locked") mkdirSync(`${h.authPath}.lock`);
		if (failure === "auth-malformed") writeFileSync(h.authPath, "{broken");
		if (failure === "state-directory") {
			rmSync(shisaLinkStatePath(h.paths));
			mkdirSync(shisaLinkStatePath(h.paths));
		}
		const result = await logoutShisa({ paths: h.paths, fetchImpl: async () => new Response(null, { status: 204 }) });
		assert.equal(result.localCleared, false);
		assert.match(shisaLogoutMessage(result, false), /Could not remove saved Shisa credentials/);
		if (result.revocation === "unconfirmed") assert.match(shisaLogoutMessage(result, false), /dashboard/);
		if (failure === "state-directory") assert.deepEqual(JSON.parse(readFileSync(h.authPath, "utf8")), { other });
		else assert.equal(existsSync(shisaLinkStatePath(h.paths)), false);
		if (failure === "auth-locked") assert.equal(existsSync(`${h.authPath}.lock`), true);
	});
}

test("sign-out suppresses Shisa catalog environment auth without changing it or another source", async (t) => {
	const h = await setup(t);
	const env = { SHISA_API_KEY: "environment-secret" };
	assert.equal(resolveCatalogBearer(SHISA_API_CATALOG_SOURCE, env, h.paths), env.SHISA_API_KEY);
	await logoutShisa({ paths: h.paths, fetchImpl: async () => new Response(null, { status: 204 }) });
	assert.equal(env.SHISA_API_KEY, "environment-secret");
	assert.equal(catalogSourceCredentialAvailable(SHISA_API_CATALOG_SOURCE, env, h.paths), false);
	assert.throws(() => resolveCatalogBearer(SHISA_API_CATALOG_SOURCE, env, h.paths), /Signed out/);
	assert.equal(
		resolveCatalogSources(h.paths, env).some((s) => s.id === "shisa-api"),
		false,
	);
	const unrelated = { ...SHISA_API_CATALOG_SOURCE, id: "other", url: "https://other.example.test/catalog" };
	assert.equal(resolveCatalogBearer(unrelated, env, h.paths), env.SHISA_API_KEY);
	setShisaSignedOut(h.paths, false);
	assert.equal(resolveCatalogBearer(SHISA_API_CATALOG_SOURCE, env, h.paths), env.SHISA_API_KEY);
});

test("an in-progress login excludes logout before any destructive work", async (t) => {
	const h = await setup(t);
	await withShisaAuthOperation(h.paths, async () => {
		await assert.rejects(
			logoutShisa({ paths: h.paths, fetchImpl: () => assert.fail("must not revoke") }),
			/already running/,
		);
	});
	assert.ok(readShisaLinkState(shisaLinkStatePath(h.paths)));
	assert.equal(JSON.parse(readFileSync(h.authPath, "utf8")).shisa.access, credential.access);
});

async function extensionHarness(t, h, fetchImpl, env = {}) {
	const runtime = await ModelRuntime.create({
		authPath: h.authPath,
		modelsPath: null,
		modelsStorePath: join(h.home, "models-store.json"),
		refreshOnCreate: false,
	});
	const commands = new Map();
	const handlers = new Map();
	const messages = [];
	const ctx = {
		modelRegistry: { refresh: () => runtime.refresh({ allowNetwork: false }) },
		ui: { notify: (...args) => messages.push(args) },
	};
	await createShisaExtension({
		paths: h.paths,
		jouzuVersion: "0.1.8",
		env: { ...env, JOUZU_SHISA_PLATFORM_URL: "https://changed.example.test" },
		fetchImpl,
	}).factory({
		registerProvider: (id, config) => runtime.registerProvider(id, config),
		registerCommand: (name, command) => commands.set(name, command),
		on: (name, fn) => handlers.set(name, fn),
	});
	await handlers.get("session_start")({}, ctx);
	t.after(() => handlers.get("session_shutdown")());
	return { runtime, commands, handlers, messages, ctx };
}

for (const entry of ["Pi menu", "explicit command"]) {
	test(`${entry} revokes using saved issuer and clears local state`, async (t) => {
		const h = await setup(t);
		let calls = 0;
		const e = await extensionHarness(
			t,
			h,
			async (url) => {
				calls++;
				assert.equal(url, "https://issuer.example.test/device/link/revoke");
				return new Response(null, { status: 204 });
			},
			{ SHISA_API_KEY: "environment-secret" },
		);
		if (entry === "Pi menu") await e.runtime.logout("shisa");
		else await e.commands.get("logout").handler("shisa", e.ctx);
		assert.equal(calls, 1);
		assertCleared(h);
		assert.ok(e.messages.some(([m]) => m.includes("SHISA_API_KEY remains set")));
		assert.equal(e.runtime.hasConfiguredAuth("shisa"), false);
	});
}

test("Pi hook leaves other providers and unowned runtimes untouched, and detaches", async (t) => {
	const original = ModelRuntime.prototype.logout;
	const h = await setup(t);
	let calls = 0;
	const e = await extensionHarness(t, h, async () => {
		calls++;
		return new Response(null, { status: 204 });
	});
	await e.runtime.logout("other");
	assert.equal(calls, 0);
	const otherHome = await setup(t);
	const stock = await ModelRuntime.create({
		authPath: otherHome.authPath,
		modelsPath: null,
		modelsStorePath: join(otherHome.home, "store.json"),
		refreshOnCreate: false,
	});
	await stock.logout("shisa");
	assert.equal(calls, 0);
	assert.ok(readShisaLinkState(shisaLinkStatePath(otherHome.paths)));
	await e.handlers.get("session_shutdown")();
	assert.equal(ModelRuntime.prototype.logout, original);
});

test("real Pi command dispatch removes authenticated catalog models from the picker runtime", async (t) => {
	const h = await setup(t);
	const env = { SHISA_API_KEY: "catalog-env-secret" };
	const document = readFileSync(join(import.meta.dirname, "../catalog/fixtures/account-snapshot-v1.json"), "utf8");
	await refreshCatalogSource(h.paths, SHISA_API_CATALOG_SOURCE, {
		env,
		fetch: async () => new Response(document, { headers: { "content-type": MODEL_CATALOG_MEDIA_TYPE } }),
	});
	const runtime = await ModelRuntime.create({
		authPath: h.authPath,
		modelsPath: null,
		modelsStorePath: join(h.home, "models-store.json"),
		refreshOnCreate: false,
	});
	const picker = createJouzuModelPicker(h.paths, { palette: { env } });
	let revocations = 0;
	const loader = new DefaultResourceLoader({
		cwd: h.home,
		agentDir: h.paths.agentDir,
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
		noPromptTemplates: true,
		extensionFactories: [
			picker.extension,
			createShisaExtension({
				paths: h.paths,
				jouzuVersion: "0.1.8",
				env,
				fetchImpl: async () => {
					revocations++;
					return new Response(null, { status: 204 });
				},
			}),
		],
	});
	await loader.reload();
	const { session, extensionsResult } = await createAgentSession({
		cwd: h.home,
		agentDir: h.paths.agentDir,
		modelRuntime: runtime,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(h.home),
		settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
		tools: [],
	});
	t.after(() => session.dispose());
	assert.deepEqual(extensionsResult.errors, []);
	await session.bindExtensions({ mode: "rpc", onError: (error) => assert.fail(error.message) });
	const isCatalogModel = (m) => m.id === "example-model" && m.provider !== "ai.example.gateway";
	assert.ok(runtime.getModels().some(isCatalogModel), "catalog model is registered before logout");
	await session.prompt("/logout shisa");
	assert.equal(revocations, 1);
	assertCleared(h);
	assert.equal(runtime.getModels().some(isCatalogModel), false, "cached catalog registration is removed");
	assert.equal(session.messages.length, 0, "logout never reaches the model");
	setShisaSignedOut(h.paths, false);
	assert.ok(runtime.getModels().some(isCatalogModel), "sign-in notification restores catalog registration");
});

test("cancelling the remote request still removes local credentials", async (t) => {
	const h = await setup(t);
	const controller = new AbortController();
	const result = await logoutShisa({
		paths: h.paths,
		signal: controller.signal,
		fetchImpl: (_url, options) => {
			return new Promise((_resolve, reject) => {
				options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
				controller.abort();
			});
		},
	});
	assert.equal(result.revocation, "unconfirmed");
	assertCleared(h);
});

test("the Pi logout path surfaces local deletion failure instead of success", async (t) => {
	const h = await setup(t);
	const e = await extensionHarness(t, h, async () => new Response(null, { status: 204 }));
	writeFileSync(h.authPath, "{broken");
	await assert.rejects(e.runtime.logout("shisa"), /Could not remove saved Shisa credentials/);
	assert.equal(readFileSync(h.authPath, "utf8"), "{broken");
	assert.equal(existsSync(shisaLinkStatePath(h.paths)), false);
	assert.ok(e.messages.some(([message, level]) => level === "error" && message.includes("Could not remove")));
});
