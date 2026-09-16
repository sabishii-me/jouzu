import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createSubagentObservationExtension,
	SUBAGENT_READ_RECEIPTS,
} from "../dist/flow-control/subagent-observation-extension.js";
import { notificationHash } from "../dist/notifications/inbox.js";

function fixture() {
	const handlers = new Map();
	const entries = [];
	const context = { sessionManager: { getBranch: () => entries } };
	let receive;
	let producer;
	let requests = [];
	let disposed = 0;
	let unsubscribed = false;
	const original = {
		scope: { sessionId: "parent" },
		controller: {
			register(value) {
				producer = value;
				return {
					dispose() {
						disposed++;
					},
				};
			},
		},
		attachment: { nativeRequests: { snapshot: async () => requests } },
	};
	let branch = original;
	const ingress = { branch: () => branch };
	createSubagentObservationExtension({ ingress: () => ingress }).factory({
		on: (event, handler) => handlers.set(event, handler),
		events: {
			on(event, callback) {
				assert.equal(event, SUBAGENT_READ_RECEIPTS);
				receive = callback;
				return () => {
					unsubscribed = true;
				};
			},
		},
	});
	handlers.get("session_start")({}, context);
	return {
		entries,
		context,
		handlers,
		original,
		get producer() {
			return producer;
		},
		get disposed() {
			return disposed;
		},
		get unsubscribed() {
			return unsubscribed;
		},
		setRequests(value) {
			requests = value;
		},
		replaceBranch() {
			branch = { ...original };
		},
		read(sessionId = "parent") {
			let result;
			receive({
				sessionId,
				accept(value) {
					result = value;
				},
			});
			return result;
		},
	};
}

for (const outcome of ["success", "failure", "withheld"]) {
	for (const status of ["converted", "changed", "omitted", "unresolved"]) {
		test(`child read receipt requires success and exact inclusion: ${outcome}/${status}`, async () => {
			const f = fixture();
			const marker = { id: "child", revision: "terminal", start: 0, end: 4, total: 4 };
			const message = {
				role: "toolResult",
				toolCallId: "read",
				toolName: "subagent",
				isError: false,
				content: [{ type: "text", text: "data" }],
				details: { terminalRead: marker },
			};
			f.setRequests([
				{
					outcome,
					projectionCapture: { members: [{ index: 0, message }], model: { members: [{ sourceIndex: 0, status }] } },
				},
			]);
			const expected =
				outcome === "success" && status === "converted"
					? [
							{
								toolCallId: "read",
								contentHash: notificationHash(message.content),
								markerHash: notificationHash(marker),
							},
						]
					: [];
			assert.deepEqual(await f.read(), expected);
			assert.deepEqual(await f.producer.snapshot(), []);
			await assert.rejects(f.producer.build(), /cannot schedule work/);
		});
	}
}

test("child observations reject foreign and replaced branches and detach on shutdown", async () => {
	const f = fixture();
	await assert.rejects(f.read("other"), /another session/);
	let finish;
	f.original.attachment.nativeRequests.snapshot = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const reading = f.read();
	f.replaceBranch();
	finish([]);
	await assert.rejects(reading, /branch changed/);
	f.handlers.get("session_tree")({}, f.context);
	assert.equal(f.disposed, 1);
	f.handlers.get("session_shutdown")();
	assert.equal(f.disposed, 2);
	assert.equal(f.unsubscribed, true);
});

test("only unreceipted terminal reads retain observation projections", () => {
	const f = fixture();
	const content = [{ type: "text", text: "read output" }];
	const marker = { contentHash: notificationHash(content) };
	const message = {
		role: "toolResult",
		toolCallId: "read",
		toolName: "subagent",
		isError: false,
		content,
		details: { terminalRead: marker },
	};
	f.entries.push({ type: "message", message });
	const observations = [
		{
			index: 0,
			kind: "toolResult",
			toolCallId: "launch",
			toolName: "subagent",
			failed: false,
			contentHash: notificationHash(content),
		},
		{
			index: 1,
			kind: "toolResult",
			toolCallId: "read",
			toolName: "subagent",
			failed: false,
			contentHash: notificationHash(content),
		},
	];
	assert.deepEqual(f.producer.observationProjections(observations), [1]);
	f.entries.push({
		type: "custom",
		customType: "jouzu-subagent-read-receipt",
		data: { markerHash: notificationHash(marker), contentHash: notificationHash(content), toolCallId: "read" },
	});
	assert.deepEqual(f.producer.observationProjections(observations), []);
});
