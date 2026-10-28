import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createQualifiedFlowSession } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { createFlowControlRuntime } from "../dist/flow-control/flow-runtime.js";
import { wrapModelSelectionIngress } from "../dist/model-selection-ingress.js";

const selection = () => ({ enteringAutomaticSelection: () => false, beforeSelection: async () => {} });

test("selection ingress preserves delegate receivers, arguments and dispatch ownership", async () => {
	const calls = [];
	const delegate = {
		version: 1,
		async attach(session) {
			assert.equal(this, delegate);
			calls.push(["attach", session]);
		},
		async dispose() {
			assert.equal(this, delegate);
			calls.push(["dispose"]);
		},
		async beforeBranchChange(value) {
			assert.equal(this, delegate);
			calls.push(["before", value]);
		},
		async branchChanged(value) {
			assert.equal(this, delegate);
			calls.push(["after", value]);
		},
		async submit(value) {
			assert.equal(this, delegate);
			calls.push(["submit", value]);
		},
		async runCommand(value, run) {
			assert.equal(this, delegate);
			calls.push(["command", value]);
			await run();
		},
		registerUserInputAdapter(value) {
			assert.equal(this, delegate);
			return value;
		},
		authorizeExternal(value) {
			assert.equal(this, delegate);
			return value;
		},
	};
	const host = { setModel: async () => {}, cycleModel: async () => {} };
	const wrapped = wrapModelSelectionIngress(delegate, selection());
	await wrapped.attach(host);
	await wrapped.beforeBranchChange("old");
	await wrapped.branchChanged("new");
	await wrapped.submit("input", () => assert.fail("delegate owns dispatch"));
	await wrapped.runCommand("command", async () => calls.push(["ran"]));
	assert.equal(wrapped.registerUserInputAdapter("adapter"), "adapter");
	assert.equal(wrapped.authorizeExternal("authorization"), "authorization");
	await wrapped.dispose();
	assert.deepEqual(calls, [
		["attach", host],
		["before", "old"],
		["after", "new"],
		["submit", "input"],
		["command", "command"],
		["ran"],
		["dispose"],
	]);
});

test("selection ingress works without flow control and restores only its own hooks", async () => {
	const calls = [];
	const original = async (...args) => calls.push(args);
	const host = { setModel: original, cycleModel: original };
	const barrier = selection();
	let checks = 0;
	barrier.beforeSelection = async () => {
		checks++;
	};
	const wrapped = wrapModelSelectionIngress(undefined, barrier);
	await wrapped.attach(host);
	await host.setModel("model", { persist: true });
	await host.cycleModel("backward");
	assert.equal(checks, 2);
	assert.deepEqual(calls, [["model", { persist: true }], ["backward"]]);
	let dispatches = 0;
	await wrapped.submit({}, async () => {
		dispatches++;
	});
	await wrapped.runCommand({}, async () => {
		dispatches++;
	});
	assert.equal(dispatches, 2);
	const laterHook = async () => {};
	host.cycleModel = laterHook;
	await wrapped.dispose();
	assert.equal(host.setModel, original);
	assert.equal(host.cycleModel, laterHook);
});

test("selection hooks survive real flow-controlled branch navigation", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-model-selection-flow-"));
	const flow = createFlowControlRuntime({ root, onError: () => {} });
	t.after(() => flow.dispose());
	const sessionManager = SessionManager.inMemory(root);
	const target = sessionManager.appendMessage({ role: "user", content: "first", timestamp: 1 });
	sessionManager.appendMessage({ role: "user", content: "second", timestamp: 2 });
	const delegate = await flow.flowIngressFactory({ cwd: root, sessionManager });
	const { session } = await createQualifiedFlowSession(t, {
		root,
		sessionManager,
		extensions: flow.extensions,
		ingress: wrapModelSelectionIngress(delegate, selection()),
	});
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const model = session.model;
	const previous = delegate.branch().scope.branchId;
	await session.navigateTree(target, { summarize: false });
	assert.notEqual(delegate.branch().scope.branchId, previous);
	await session.setModel(model);
	assert.equal(session.model.id, model.id);
	const cycled = await session.cycleModel("forward");
	assert.equal(session.model.id, cycled?.model.id ?? model.id);
});

test("failed attachment and disposal restore owned selection hooks", async () => {
	for (const failure of ["attach", "dispose"]) {
		const original = async () => {};
		const host = { setModel: original, cycleModel: original };
		const delegate = {
			version: 1,
			submit() {},
			[failure]() {
				throw new Error("fixture failure");
			},
		};
		const wrapped = wrapModelSelectionIngress(delegate, selection());
		if (failure === "attach") await assert.rejects(wrapped.attach(host), /fixture failure/);
		else {
			await wrapped.attach(host);
			await assert.rejects(wrapped.dispose(), /fixture failure/);
		}
		assert.equal(host.setModel, original);
		assert.equal(host.cycleModel, original);
	}
});

test("only automatic selection bypasses the barrier", async () => {
	const calls = [];
	const release = Promise.withResolvers();
	let entering = true;
	let checks = 0;
	const host = {
		setModel: async (model) => {
			calls.push(model);
		},
		cycleModel: async () => {},
	};
	const wrapped = wrapModelSelectionIngress(undefined, {
		enteringAutomaticSelection: () => entering,
		beforeSelection: async () => {
			checks++;
			await release.promise;
		},
	});
	await wrapped.attach(host);
	await host.setModel("automatic");
	entering = false;
	const manual = host.setModel("manual");
	assert.deepEqual(calls, ["automatic"]);
	release.resolve();
	await manual;
	assert.deepEqual(calls, ["automatic", "manual"]);
	assert.equal(checks, 1);
	await wrapped.dispose();
});
