import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createQualifiedFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { PiSessionFlowIngress } from "../dist/flow-control/pi-session-ingress.js";
import {
	AgentSessionRuntime,
	createAgentSessionFromServices,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import { afterCleanup, cleanupContext } from "./fixtures/cleanup.mjs";

async function replacementFixture(t, { hold = () => false, cancel = () => false } = {}) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-adapter-replacement-"));
	afterCleanup(t, () => rm(root, { recursive: true, force: true }));
	const extensionPath = join(root, "adapter.ts");
	await writeFile(extensionPath, "export default () => {};\n");
	const extensionId = await realpath(extensionPath);
	await writeFile(
		join(root, "user-input-adapters.json"),
		JSON.stringify({
			schemaVersion: 1,
			grants: [{ extensionPath: extensionId, adapterId: "fixture" }],
		}),
	);
	const ingresses = [],
		outcomes = [];
	let runtime, destination, ended, latest;
	const ingress = () => {
		const value = new PiSessionFlowIngress({
			root,
			agentDir: root,
			maxInputBytes: 4096,
			maxResultBytes: 4096,
			host: { maxPayloadBytes: 100000, containsUserInput: () => true },
			policy: () => ({ userPending: hold(), recoveryBlocked: false, waitingWorkIds: [] }),
			admit: async () => !hold(),
		});
		ingresses.push(value);
		return value;
	};
	const first = await createQualifiedFlowSession(cleanupContext(t), {
		root,
		persist: true,
		ingress: ingress(),
		extensions: [
			(pi) => {
				pi.on("session_before_switch", () => ({ cancel: cancel() }));
				// A reload replaces this runtime. Record what the prepared callback can still do while Pi
				// emits the old runtime's shutdown, which is the boundary the ingress must precede.
				pi.on("session_shutdown", async (event) => {
					if (event.reason !== "reload" || !latest) return;
					ended = await latest.adapter.bind().then(
						() => "live",
						(error) => error.code,
					);
				});
				pi.registerCommand("replace", {
					handler: async (kind, ctx) => {
						try {
							if (kind === "new") outcomes.push(await ctx.newSession());
							if (kind === "switch") outcomes.push(await ctx.switchSession(destination));
							if (kind === "fork") outcomes.push(await ctx.fork(destination));
							if (kind === "reload") {
								// The reservation is taken synchronously, so a replacement started while reload
								// runs is refused instead of tearing the session down twice.
								const reloading = ctx.reload();
								outcomes.push(
									await ctx.newSession().then(
										() => "allowed",
										(error) => error.code,
									),
								);
								await reloading;
								outcomes.push("reloaded");
							}
						} catch (error) {
							outcomes.push(error);
						}
					},
				});
			},
		],
	});
	const services = {
		cwd: root,
		agentDir: root,
		modelRuntime: first.session.modelRuntime,
		resourceLoader: first.session.resourceLoader,
		settingsManager: first.session.settingsManager,
		diagnostics: [],
	};
	runtime = new AgentSessionRuntime(first.session, services, async ({ sessionManager, sessionStartEvent }) => ({
		...(await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
			model: first.session.model,
			flowIngress: ingress(),
		})),
		services,
		diagnostics: [],
	}));
	afterCleanup(t, () => runtime.dispose());
	const bindCommands = () =>
		runtime.session.bindExtensions({
			commandContextActions: {
				newSession: (options) => runtime.newSession(options),
				switchSession: (path, options) => runtime.switchSession(path, options),
				fork: (id, options) => runtime.fork(id, options),
				reload: (options) => runtime.session.reload(options),
			},
		});
	await bindCommands();
	return {
		outcomes,
		requests: first.bodies,
		get ended() {
			return ended;
		},
		get session() {
			return runtime.session;
		},
		get ingress() {
			return ingresses.at(-1);
		},
		async change(kind, target) {
			destination = target;
			await runtime.session.prompt(`/replace ${kind}`);
			await bindCommands();
		},
		async register() {
			const adapter = await runtime.session._flowBinding.registerUserInputAdapter(extensionId, {
				id: "fixture",
				label: "Fixture",
			});
			latest = { adapter, binding: await adapter.bind() };
			return latest;
		},
	};
}

const message = (binding, messageId) => ({ binding, messageId, text: `external ${messageId}`, deliverAs: "followUp" });

async function deliverOnce(f, current, id) {
	const before = f.requests.length;
	const submitted = message(current.binding, id);
	await current.adapter.submit(submitted);
	await f.ingress.joinPendingOperations();
	assert.equal((await current.adapter.lookup({ target: current.binding.target, messageId: id })).state, "consumed");
	assert.equal(f.requests.length, before + 1);
	assert.equal((await current.adapter.submit(submitted)).state, "consumed");
	await f.ingress.joinPendingOperations();
	assert.equal(f.requests.length, before + 1);
}

for (const operation of ["new", "switch", "fork"]) {
	test(`adapter authority follows command session ${operation} without duplicate delivery`, async (t) => {
		const f = await replacementFixture(t);
		const originalFile = f.session.sessionManager.getSessionFile();
		const original = await f.register();
		await deliverOnce(f, original, "original");
		let old = original;
		if (operation === "switch") {
			await f.change("new");
			assert.equal(f.outcomes.at(-1).cancelled, false, String(f.outcomes.at(-1)));
			old = await f.register();
			await deliverOnce(f, old, "temporary");
		}
		const userId = f.session.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.message.role === "user").id;
		const beforeSession = f.session.sessionId,
			beforeRequests = f.requests.length;
		await f.change(operation, operation === "switch" ? originalFile : userId);
		assert.equal(f.outcomes.at(-1).cancelled, false, String(f.outcomes.at(-1)));
		assert.notEqual(f.session.sessionId, beforeSession);
		assert.equal(f.requests.length, beforeRequests, "session control called the provider");
		await assert.rejects(old.adapter.submit(message(old.binding, "stale")), { code: "stale-target" });
		const fresh = await f.register();
		assert.notEqual(fresh.binding.generation, old.binding.generation);
		assert.notEqual(fresh.binding.target, old.binding.target);
		if (operation === "switch") {
			assert.equal(fresh.binding.target, original.binding.target);
			await assert.rejects(fresh.adapter.submit(message(original.binding, "original")), { code: "stale-target" });
			assert.equal((await fresh.adapter.submit(message(fresh.binding, "original"))).state, "consumed");
			await f.ingress.joinPendingOperations();
			assert.equal(f.requests.length, beforeRequests);
		}
		await deliverOnce(f, fresh, "fresh");
	});
}

test("cancelled command session replacement preserves adapter authority", async (t) => {
	const f = await replacementFixture(t, { cancel: () => true });
	const current = await f.register();
	const before = f.session.sessionId;
	await f.change("new");
	assert.equal(f.outcomes[0].cancelled, true);
	assert.equal(f.session.sessionId, before);
	assert.deepEqual(await current.adapter.bind(), current.binding);
	await deliverOnce(f, current, "after-cancel");
});

test("command session replacement preserves held external input for explicit retry on return", async (t) => {
	let holding = true;
	const f = await replacementFixture(t, { hold: () => holding });
	const originalFile = f.session.sessionManager.getSessionFile();
	const old = await f.register();
	assert.equal((await old.adapter.submit(message(old.binding, "held"))).state, "held");
	await f.change("new");
	assert.equal(f.outcomes.at(-1).cancelled, false, String(f.outcomes.at(-1)));
	assert.equal(f.requests.length, 0);
	await assert.rejects(old.adapter.submit(message(old.binding, "held")), { code: "stale-target" });
	await f.change("switch", originalFile);
	assert.equal(f.outcomes.at(-1).cancelled, false, String(f.outcomes.at(-1)));
	const fresh = await f.register();
	assert.equal(fresh.binding.target, old.binding.target);
	const receipt = await fresh.adapter.lookup({ target: fresh.binding.target, messageId: "held" });
	assert.equal(receipt.state, "unknown");
	assert.equal(receipt.reason.code, "callback-ended");
	assert.equal(f.requests.length, 0);
	holding = false;
	await deliverOnce(f, fresh, "held");
});

test("extension reload reserves replacement and ends prepared callbacks for one authorized retry", async (t) => {
	let holding = true;
	const f = await replacementFixture(t, { hold: () => holding });
	const old = await f.register();
	const submitted = message(old.binding, "held-reload");
	assert.equal((await old.adapter.submit(submitted)).state, "held");
	// submit starts a release attempt without joining it. Keep admission held until that
	// attempt finishes, so opening admission for the command cannot release the old input.
	await f.ingress.joinPendingOperations();
	assert.equal((await old.adapter.lookup({ target: old.binding.target, messageId: "held-reload" })).state, "held");
	assert.equal(f.requests.length, 0);
	holding = false;
	await f.change("reload");
	// The replacement reservation refused the competing caller, and reload itself finished.
	assert.deepEqual(f.outcomes, ["busy", "reloaded"]);
	// The prepared callback was ended before Pi invalidated the runtime that created it.
	assert.equal(f.ended, "stale-target");
	const [record] = (await f.ingress.branch().attachment.submissions.snapshot()).filter(
		(item) => item.submission.externalUser,
	);
	assert.equal(record.dispatch, undefined);
	assert.equal(record.unavailable, "callback-ended");
	assert.equal(f.requests.length, 0);
	await assert.rejects(old.adapter.submit(submitted), { code: "stale-target" });
	const fresh = await f.register();
	const receipt = await fresh.adapter.lookup({ target: fresh.binding.target, messageId: "held-reload" });
	assert.equal(receipt.state, "unknown");
	assert.equal(receipt.reason.code, "callback-ended");
	// Authority is rechecked, so the retry dispatches once and a repeat submit stays consumed.
	await deliverOnce(f, fresh, "held-reload");
});
