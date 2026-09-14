import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackgroundControllerExtension } from "../dist/flow-control/background-extension.js";

function fixture() {
	const scope = { sessionId: "session", branchId: "branch" };
	const attachment = { ledger: { scope }, waitProducers: { register() {} } };
	const handlers = new Map();
	const errors = [];
	let notify,
		state = "idle",
		changes = 0,
		action = () => Promise.resolve();
	const controller = {
		view: () => ({ state }),
		register: () => ({
			changed() {
				changes++;
				if (state === "closed") throw new Error("Controller closed");
				return action();
			},
		}),
	};
	const bridge = createBackgroundControllerExtension({
		ingress: () => ({ branch: () => ({ attachment, controller }), requestRelease() {} }),
		currentWork: () => undefined,
		onError: (error) => errors.push(error),
	});
	bridge.factory({
		on: (event, callback) => handlers.set(event, callback),
		registerTool() {},
		events: {
			emit(_name, request) {
				request.accept({
					activate: () => ({ close() {} }),
					activateResults(_scope, changed) {
						notify = changed;
						return { snapshot: () => [] };
					},
					acknowledgeResult() {},
				});
			},
		},
	});
	bridge.attach(attachment, { getSessionId: () => scope.sessionId });
	return {
		start: () => handlers.get("session_start")(),
		notify: () => notify(),
		close: () => {
			state = "closed";
		},
		setAction: (next) => {
			action = next;
		},
		changes: () => changes,
		errors,
	};
}

test("background completion after controller close does not call its registration", async () => {
	const f = fixture();
	await f.start();
	f.notify();
	assert.equal(f.changes(), 1);
	f.close();
	assert.doesNotThrow(f.notify);
	assert.equal(f.changes(), 1);
	assert.deepEqual(f.errors, []);
});

test("background scheduling rejection during close is ignored, active failures are reported", async () => {
	const f = fixture();
	await f.start();
	const failure = new Error("Active scheduling failure");
	f.setAction(() => {
		throw failure;
	});
	assert.doesNotThrow(f.notify);
	assert.deepEqual(f.errors, [failure]);
	let reject;
	f.setAction(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	f.notify();
	f.close();
	reject(new Error("Closed while scheduling"));
	await Promise.resolve();
	assert.deepEqual(f.errors, [failure]);
});
