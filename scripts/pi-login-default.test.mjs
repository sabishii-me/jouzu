import assert from "node:assert/strict";
import { test } from "node:test";
import { OAuthSelectorComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/oauth-selector.js";
import { InteractiveMode } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark");

function options(providers, authType) {
	return InteractiveMode.prototype.getLoginProviderOptions.call(
		{
			session: {
				modelRuntime: {
					getProviders: () => providers,
					getProviderAuthStatus: () => ({ configured: false }),
					isUsingOAuth: () => false,
				},
			},
		},
		authType,
	);
}
const provider = (id, name) => ({ id, name, auth: { oauth: { name }, apiKey: { name } } });

test("Shisa is the first login provider and Enter selects it", () => {
	const providers = [provider("zeta", "Zeta"), provider("anthropic", "Anthropic"), provider("shisa", "Shisa")];
	const before = structuredClone(providers);
	const choices = options(providers, "oauth");
	assert.deepEqual(
		choices.map((item) => item.id),
		["shisa", "anthropic", "zeta"],
	);
	assert.deepEqual(providers, before);
	let selected;
	const selector = new OAuthSelectorComponent(
		"login",
		choices,
		(id) => {
			selected = id;
		},
		() => {},
	);
	selector.handleInput("\r");
	assert.equal(selected, "shisa");
	const filtered = new OAuthSelectorComponent(
		"login",
		choices,
		(id) => {
			selected = id;
		},
		() => {},
		"anthropic",
	);
	filtered.handleInput("\r");
	assert.equal(selected, "anthropic");
});

test("login keeps auth filtering and alphabetical order when Shisa is absent", () => {
	const providers = [provider("zeta", "Zeta"), provider("anthropic", "Anthropic")];
	assert.deepEqual(
		options(providers, "oauth").map((item) => item.id),
		["anthropic", "zeta"],
	);
	providers.push(provider("shisa", "Shisa"));
	assert.deepEqual(
		options(providers, "api_key").map((item) => item.id),
		["shisa", "anthropic", "zeta"],
	);
	assert.ok(options(providers, "api_key").every((item) => item.authType === "api_key"));
	assert.deepEqual(options([]), []);
});

test("logout retains alphabetical ordering", async () => {
	const choices = await InteractiveMode.prototype.getLogoutProviderOptions.call({
		session: {
			modelRuntime: {
				listCredentials: async () => [
					{ providerId: "shisa", type: "oauth" },
					{ providerId: "anthropic", type: "oauth" },
				],
				getProvider: (id) => provider(id, id === "shisa" ? "Shisa" : "Anthropic"),
			},
		},
	});
	assert.deepEqual(
		choices.map((item) => item.id),
		["anthropic", "shisa"],
	);
});
