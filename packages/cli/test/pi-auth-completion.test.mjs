import assert from "node:assert/strict";
import { test } from "node:test";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { withPiAuthCompletion } from "../dist/pi-auth-completion.js";
import { interactiveLoginHost } from "./fixtures/interactive-login.mjs";

const unknown = { provider: "unknown", id: "unknown", api: "unknown" };
const selected = { provider: "catalog:shisa", id: "flash-next", api: "openai-completions" };
function session(before, after = before) {
	const result = {
		model: before,
		setModel: async () => assert.fail("completion must not replace a selected model"),
		modelRuntime: {
			login: async () => {
				result.model = after;
			},
			getAvailableSnapshot: () => [selected],
		},
	};
	return result;
}

test("interactive Shisa login keeps an already selected catalog model and success feedback", async () => {
	const s = session(unknown, selected);
	const h = interactiveLoginHost(s);
	const original = InteractiveMode.prototype.completeProviderAuthentication;
	await withPiAuthCompletion(() => h.login());
	assert.equal(s.model, selected);
	assert.deepEqual(h.errors, []);
	assert.match(h.statuses[0], /Logged in to Shisa.*Credentials saved/);
	assert.equal(h.refreshes.length, 1);
	assert.equal(InteractiveMode.prototype.completeProviderAuthentication, original);
});

test("unchanged unknown models retain Pi's default-selection guidance", async () => {
	const h = interactiveLoginHost(session(unknown));
	await withPiAuthCompletion(() => h.login());
	assert.match(h.errors[0], /no default model is configured/);
});

test("an existing real model and refresh warnings keep native behavior", async () => {
	const h = interactiveLoginHost(session(selected), {
		refresh: () => ({ aborted: false, errors: new Map([["shisa", new Error("offline")]]) }),
	});
	await withPiAuthCompletion(() => h.login());
	assert.deepEqual(h.errors, []);
	assert.match(h.warnings[0], /model catalog could not be refreshed/);
});

test("other providers and API-key authentication are passed through", async () => {
	for (const [provider, auth] of [
		["other", "oauth"],
		["shisa", "api_key"],
	]) {
		const h = interactiveLoginHost(session(selected));
		await withPiAuthCompletion(async () => {
			await h.completeProviderAuthentication(provider, provider, auth, unknown);
			await new Promise((resolve) => setImmediate(resolve));
		});
		assert.match(h.errors[0], /no default model is configured/);
	}
});

test("completion adapter restores ownership after nested calls and exceptions", async () => {
	const prototype = InteractiveMode.prototype;
	const original = prototype.completeProviderAuthentication;
	await assert.rejects(
		withPiAuthCompletion(async () => {
			const outer = prototype.completeProviderAuthentication;
			await withPiAuthCompletion(async () => {});
			assert.equal(prototype.completeProviderAuthentication, outer);
			throw new Error("fixture failure");
		}),
		/fixture failure/,
	);
	assert.equal(prototype.completeProviderAuthentication, original);
});
