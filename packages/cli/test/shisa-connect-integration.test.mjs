import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
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
import { CatalogSettingsComponent } from "../dist/catalog-settings.js";
import { MODEL_CATALOG_MEDIA_TYPE } from "../dist/model-catalog.js";
import { loadActiveModelCatalogs } from "../dist/model-catalog-sync.js";
import { createJouzuModelPicker } from "../dist/model-picker.js";
import { resolveJouzuPaths } from "../dist/paths.js";
import { createSessionUiStyles } from "../dist/session-ui/index.js";
import { readShisaLoginToken, setShisaSignedOut } from "../dist/shisa-link/credentials.js";
import { createShisaExtension, SHISA_PROVIDER_ID } from "../dist/shisa-link/extension.js";
import { loginShisa } from "../dist/shisa-link/login.js";

const fixtureRaw = JSON.parse(
	readFileSync(join(import.meta.dirname, "..", "catalog", "fixtures", "account-snapshot-v1.json"), "utf8"),
);

const identityTheme = {
	fg: (_role, value) => value,
	bg: (_role, value) => value,
	bold: (value) => value,
};

function fakeKeybindings() {
	const keys = {
		"tui.select.cancel": ["escape", "ctrl+c"],
		"tui.select.confirm": ["enter"],
		"tui.select.up": ["up"],
		"tui.select.down": ["down"],
		"tui.select.pageUp": ["pageUp"],
		"tui.select.pageDown": ["pageDown"],
	};
	return {
		matches(data, action) {
			return keys[action]?.includes(data) ?? false;
		},
		getKeys(action) {
			return [...(keys[action] ?? [])];
		},
	};
}

function paletteContext() {
	const renders = [];
	return {
		tui: {
			requestRender() {
				renders.push(true);
			},
			terminal: { rows: 32, columns: 100 },
		},
		theme: identityTheme,
		keybindings: fakeKeybindings(),
		styles: createSessionUiStyles(identityTheme),
		close() {},
	};
}

/** The session UI surface these extensions touch; notifications are recorded for assertions. */
function sessionUiContext(notifications) {
	const noop = () => undefined;
	return {
		notify: (message, level) => notifications.push({ message, level }),
		select: noop,
		confirm: noop,
		input: noop,
		onTerminalInput: () => noop,
		setStatus: noop,
		setWorkingMessage: noop,
		setWorkingVisible: noop,
		setWorkingIndicator: noop,
		setHiddenThinkingLabel: noop,
		setWidget: noop,
		setFooter: noop,
		setHeader: noop,
		setTitle: noop,
		custom: async () => undefined,
		pasteToEditor: noop,
		setEditorText: noop,
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: noop,
		setEditorComponent: noop,
		getEditorComponent: () => undefined,
		theme: identityTheme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "UI not available" }),
		getToolsExpanded: () => false,
		setToolsExpanded: noop,
	};
}

async function waitFor(condition, timeoutMs = 5000) {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) throw new Error("condition not met before timeout");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function readBody(request) {
	return new Promise((resolve) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => resolve(body));
	});
}

/**
 * Real Settings account flow against a loopback Shisa gateway and a real Pi
 * session: the component drives the production device flow, saves the
 * credential, and refreshes the authenticated catalog through the same
 * `refreshShisaAccount` hook the model picker installs. Only the network
 * transport is substituted; no model callbacks are mocked.
 */
async function harness(t, behavior = {}) {
	const home = mkdtempSync(join(tmpdir(), "jouzu-connect-"));
	const paths = resolveJouzuPaths({ homeOverride: home });
	t.after(() => {
		setShisaSignedOut(paths, false);
		rmSync(home, { recursive: true, force: true });
	});
	mkdirSync(paths.agentDir, { recursive: true });

	const requests = [];
	const tokenMode = behavior.token ?? "approve";
	const server = createServer(async (request, response) => {
		const body = await readBody(request);
		requests.push({
			method: request.method,
			url: request.url,
			authorization: request.headers.authorization,
			body,
		});
		const json = (status, payload) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(payload));
		};
		if (request.url === "/device/code" && request.method === "POST") {
			json(201, {
				device_code: "loopback-device-code",
				user_code: "JOUZU-LOOP-0001",
				verification_uri: `${origin}/connect`,
				verification_uri_complete: `${origin}/connect?code=JOUZU-LOOP-0001`,
				authorization_id: "auth-loopback",
				expires_in: 900,
				interval: 5,
			});
			return;
		}
		if (request.url === "/device/token" && request.method === "POST") {
			if (tokenMode === "deny") {
				json(400, { error: "access_denied" });
				return;
			}
			if (tokenMode === "pending") {
				json(400, { error: "authorization_pending" });
				return;
			}
			json(200, {
				api_key: { uuid: "key-loopback", secret: "shsk:loopback-secret", label: "jouzu integration" },
				org: { id: "org-loopback", name: "Loopback Org", slug: "loopback" },
				user: { email: "person@example.test" },
				endpoints: {
					openai_base_url: `${origin}/v1`,
					model_catalog_url: `${origin}/v1/jouzu/model-catalog`,
					asr_realtime_url: `${origin}/asr`,
				},
				link_token: "link-token-secret",
				authorization_id: "auth-loopback",
				bonus: { status: "available", amount_usd: 10 },
			});
			return;
		}
		if (request.url === "/device/link/ack" && request.method === "POST") {
			if (behavior.ackStatus && behavior.ackStatus !== 204) {
				json(behavior.ackStatus, { error: "unavailable" });
				return;
			}
			response.writeHead(204);
			response.end();
			return;
		}
		if (request.url === "/v1/jouzu/model-catalog" && request.method === "GET") {
			if (behavior.catalogStatus && behavior.catalogStatus !== 200) {
				json(behavior.catalogStatus, { error: "unavailable" });
				return;
			}
			response.writeHead(200, { "content-type": MODEL_CATALOG_MEDIA_TYPE, etag: '"loopback"' });
			response.end(JSON.stringify(behavior.catalogDocument ?? fixtureRaw));
			return;
		}
		json(404, { error: "not_found" });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	t.after(() => new Promise((resolve) => server.close(resolve)));

	const env = { JOUZU_SHISA_PLATFORM_URL: origin };
	// The built-in Shisa source keeps its production URL; substitute only the
	// transport so the test never reaches the real platform.
	const catalogFetch = (input, init) => {
		const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const url = new URL(raw);
		if (url.origin === "https://api.shisa.ai") return fetch(new URL(`${url.pathname}${url.search}`, origin), init);
		return fetch(input, init);
	};
	const fastSleep = async (ms) => {
		await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10)));
	};

	const runtime = await ModelRuntime.create({
		authPath: join(paths.agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(home, "models-store.json"),
		refreshOnCreate: false,
	});
	const picker = createJouzuModelPicker(paths, {
		palette: { env },
		catalogFetch,
		jouzuVersion: "0.1.13",
	});
	const notifications = [];
	const loader = new DefaultResourceLoader({
		cwd: home,
		agentDir: paths.agentDir,
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
		noPromptTemplates: true,
		extensionFactories: [
			createShisaExtension({
				paths,
				jouzuVersion: "0.1.13",
				env,
				fetchImpl: fetch,
				// Production wiring: Pi's OAuth login refreshes the same account state
				// the Settings account row refreshes after saving a credential.
				onSignedIn: () => picker.refreshShisaAccount({ signedIn: true }),
			}),
			picker.extension,
		],
	});
	await loader.reload();
	const { session, extensionsResult } = await createAgentSession({
		cwd: home,
		agentDir: paths.agentDir,
		modelRuntime: runtime,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(home),
		settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
		tools: [],
	});
	t.after(() => session.dispose());
	assert.deepEqual(extensionsResult.errors, []);
	await session.bindExtensions({
		mode: "rpc",
		uiContext: sessionUiContext(notifications),
		onError: (error) => assert.fail(error.message),
	});

	const component = new CatalogSettingsComponent({
		context: paletteContext(),
		paths,
		env,
		jouzuVersion: "0.1.13",
		login: (callbacks, options) => loginShisa(callbacks, { ...options, fetchImpl: fetch, sleep: fastSleep }),
		onCatalogsChanged: picker.reloadCatalogs,
		onAccountChanged: (change) => picker.refreshShisaAccount(change),
	});
	return { home, paths, env, origin, requests, runtime, picker, session, component, notifications };
}

function focusAccount(component) {
	component.route({ view: "settings", query: "language" });
	for (let row = 0; row < 3; row++) component.handleInput("down");
	assert.equal(component.accountFocused, true, "the account row takes focus");
}

const isCatalogModel = (model) => model.id === "example-model" && model.provider !== "ai.example.gateway";

test("Settings connect saves the credential and makes authenticated catalog models usable without restart", async (t) => {
	const h = await harness(t);
	assert.equal(readShisaLoginToken(h.paths), undefined, "starts signed out");
	assert.equal(h.runtime.getModels().some(isCatalogModel), false, "no catalog model before sign-in");

	focusAccount(h.component);
	h.component.handleInput("enter");
	await waitFor(() => h.component.busy === false);

	assert.equal(readShisaLoginToken(h.paths), "shsk:loopback-secret", "the device-flow credential is saved");
	const catalogRequest = h.requests.find((request) => request.url === "/v1/jouzu/model-catalog");
	assert.ok(catalogRequest, "the authenticated catalog is fetched after sign-in");
	assert.equal(
		catalogRequest.authorization,
		"Bearer shsk:loopback-secret",
		"the login token authenticates the refresh",
	);
	assert.match(h.component.render(100).join("\n"), /Connected to Shisa AI\./u, "the panel reports success");

	const model = h.runtime.getModels().find(isCatalogModel);
	assert.ok(model, "the projected catalog model is registered in the live runtime");
	assert.ok((await h.runtime.getAvailable()).some(isCatalogModel), "the model is available for selection");
	assert.ok(await h.runtime.getAuth(model), "request auth resolves for the projected model");
	assert.equal(
		h.runtime.getRegisteredProviderConfig(SHISA_PROVIDER_ID)?.baseUrl,
		`${h.origin}/v1`,
		"the provider base URL follows the gateway that issued the sign-in",
	);
});

test("a denied device approval leaves the session signed out and unrefreshed", async (t) => {
	const h = await harness(t, { token: "deny" });
	focusAccount(h.component);
	h.component.handleInput("enter");
	await waitFor(() => h.component.busy === false);

	assert.equal(readShisaLoginToken(h.paths), undefined, "no credential is saved");
	assert.equal(
		h.requests.some((request) => request.url === "/v1/jouzu/model-catalog"),
		false,
	);
	assert.equal(h.runtime.getModels().some(isCatalogModel), false);
	assert.match(h.component.render(100).join("\n"), /could not complete/u, "the panel keeps the recovery message");
});

test("cancelling before approval leaves the session signed out and unrefreshed", async (t) => {
	const h = await harness(t, { token: "pending" });
	focusAccount(h.component);
	h.component.handleInput("enter");
	await waitFor(() => h.requests.some((request) => request.url === "/device/token"));
	assert.match(h.component.render(100).join("\n"), /JOUZU-LOOP-0001/u, "the device code is visible while polling");
	h.component.handleInput("escape");
	await waitFor(() => h.component.busy === false);

	assert.equal(readShisaLoginToken(h.paths), undefined, "cancelling never saves a credential");
	assert.equal(
		h.requests.some((request) => request.url === "/v1/jouzu/model-catalog"),
		false,
	);
	assert.equal(h.runtime.getModels().some(isCatalogModel), false);
	assert.match(h.component.render(100).join("\n"), /Shisa sign-in cancelled/u);
});

test("an unconfirmed acknowledgement warns but keeps the signed-in catalog available", async (t) => {
	const h = await harness(t, { ackStatus: 503 });
	focusAccount(h.component);
	h.component.handleInput("enter");
	await waitFor(() => h.component.busy === false);

	const text = h.component.render(100).join("\n");
	assert.match(text, /confirmation failed/u, "the acknowledgement warning survives the resolution");
	assert.match(text, /Sign in again/u);
	assert.doesNotMatch(text, /Connected to Shisa AI\./u, "an unacknowledged sign-in never reports plain success");
	assert.equal(
		readShisaLoginToken(h.paths),
		"shsk:loopback-secret",
		"the credential is saved regardless of acknowledgement",
	);
	assert.ok(
		h.requests.some((request) => request.url === "/device/link/ack"),
		"the acknowledgement was attempted",
	);
	assert.ok((await h.runtime.getAvailable()).some(isCatalogModel), "the saved credential still unlocks the catalog");
});

test("OAuth login fetches and projects the authenticated catalog without a restart", async (t) => {
	const h = await harness(t);
	assert.equal(readShisaLoginToken(h.paths), undefined, "starts signed out");
	assert.equal(h.runtime.getModels().some(isCatalogModel), false, "no catalog model before sign-in");
	assert.equal(
		h.requests.some((request) => request.url === "/v1/jouzu/model-catalog"),
		false,
		"no catalog request before sign-in",
	);

	const events = [];
	await h.runtime.login(SHISA_PROVIDER_ID, "oauth", {
		prompt: async () => assert.fail("OAuth login must not prompt"),
		notify: (event) => events.push(event),
	});

	assert.equal(readShisaLoginToken(h.paths), "shsk:loopback-secret", "the device-flow credential is saved");
	assert.ok(
		events.some((event) => event.type === "device_code"),
		"the login interaction receives the device code",
	);
	const catalogRequest = h.requests.find((request) => request.url === "/v1/jouzu/model-catalog");
	assert.ok(catalogRequest, "the authenticated catalog is fetched during login");
	assert.equal(
		catalogRequest.authorization,
		"Bearer shsk:loopback-secret",
		"the login token authenticates the refresh",
	);
	assert.equal(
		loadActiveModelCatalogs(h.paths, h.env)[0]?.document.revision,
		"fixture-1",
		"the refreshed catalog is cached for later sessions",
	);

	const model = h.runtime.getModels().find(isCatalogModel);
	assert.ok(model, "the projected catalog model is registered in the live runtime");
	assert.ok((await h.runtime.getAvailable()).some(isCatalogModel), "the model is available for selection");
	assert.ok(await h.runtime.getAuth(model), "request auth resolves for the projected model");
	assert.equal(
		h.runtime.getRegisteredProviderConfig(SHISA_PROVIDER_ID)?.baseUrl,
		`${h.origin}/v1`,
		"the provider base URL follows the gateway that issued the sign-in",
	);
});

test("OAuth reconnect fetches a new catalog even when an activated revision exists", async (t) => {
	const behavior = {};
	const h = await harness(t, behavior);
	const interaction = { prompt: async () => assert.fail("OAuth login must not prompt"), notify: () => {} };
	await h.runtime.login(SHISA_PROVIDER_ID, "oauth", interaction);
	assert.equal(loadActiveModelCatalogs(h.paths, h.env)[0]?.document.revision, "fixture-1");
	behavior.catalogDocument = structuredClone(fixtureRaw);
	behavior.catalogDocument.revision = "fixture-2";
	behavior.catalogDocument.sequence = String(BigInt(fixtureRaw.sequence) + 1n);
	behavior.catalogDocument.modelOfferings[0].name = "Updated catalog model";
	await h.runtime.login(SHISA_PROVIDER_ID, "oauth", interaction);
	assert.equal(h.requests.filter((request) => request.url === "/v1/jouzu/model-catalog").length, 2);
	assert.equal(loadActiveModelCatalogs(h.paths, h.env)[0]?.document.revision, "fixture-2");
	assert.equal(h.runtime.getModels().find(isCatalogModel)?.name, "Updated catalog model");
});

test("OAuth login keeps the saved credential when the catalog refresh fails", async (t) => {
	const h = await harness(t, { catalogStatus: 503 });
	await h.runtime.login(SHISA_PROVIDER_ID, "oauth", {
		prompt: async () => assert.fail("OAuth login must not prompt"),
		notify: () => {},
	});

	assert.equal(
		readShisaLoginToken(h.paths),
		"shsk:loopback-secret",
		"a failed catalog refresh never loses the credential",
	);
	assert.ok(
		h.requests.some((request) => request.url === "/v1/jouzu/model-catalog"),
		"the catalog refresh was attempted",
	);
	assert.equal(loadActiveModelCatalogs(h.paths, h.env).length, 0, "the failed catalog is not activated");
	assert.equal(h.runtime.getModels().some(isCatalogModel), false, "no catalog model is projected");
	const warning = h.notifications.find(
		(notification) => notification.level === "warning" && /Catalogs not refreshed/u.test(notification.message),
	);
	assert.ok(warning, "the failed refresh warns without failing sign-in");
});
