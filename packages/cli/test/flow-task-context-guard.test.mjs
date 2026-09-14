import assert from "node:assert/strict";
import { test } from "node:test";
import { installTaskContextGuard } from "../dist/flow-control/task-context-guard.js";

for (const variant of ["stale-only", "user-joined", "results-joined", "abort-throws", "valid", "user-text"])
	test(`task context guard preserves input and receipt bytes: ${variant}`, async () => {
		const handlers = new Map(),
			saved = [],
			errors = [];
		let aborted = 0;
		const attempt = {
			id: "attempt",
			admission: { choice: { intent: { producer: "tasks" } } },
			members: [{ kind: "work" }, ...(variant === "results-joined" ? [{ kind: "result" }] : [])],
		};
		installTaskContextGuard(
			{
				on(name, handler) {
					handlers.set(name, handler);
				},
				appendEntry(customType, data) {
					saved.push({ type: "custom", customType, data });
				},
			},
			{
				activeAttempt: async () => attempt,
				valid: async () => variant === "valid",
				onError: (error) => errors.push(error),
			},
		);
		const ctx = {
			sessionManager: { getBranch: () => saved },
			ui: { notify() {} },
			abort() {
				aborted++;
				if (variant === "abort-throws") throw new Error("Cannot abort");
			},
		};
		await handlers.get("session_start")({}, ctx);
		const source = {
			role: "custom",
			customType: "jouzu-flow",
			content: "Exact original task bytes",
			details: { attemptId: "attempt" },
			display: true,
			timestamp: 1,
		};
		const user = { role: "user", content: [{ type: "text", text: JSON.stringify(source) }], timestamp: 2 };
		const messages = variant === "user-text" ? [user] : [source, ...(variant === "user-joined" ? [user] : [])];
		const before = JSON.stringify(messages);
		for (const message of messages) await handlers.get("message_start")({ message }, ctx);
		const result = await handlers.get("context")({ messages }, ctx);
		assert.equal(JSON.stringify(messages), before);
		for (const message of messages) assert.ok(result.messages.includes(message));
		assert.equal(aborted, ["stale-only", "abort-throws"].includes(variant) ? 1 : 0);
		assert.equal(errors.length, variant === "abort-throws" ? 1 : 0);
		if (["valid", "user-text"].includes(variant)) assert.deepEqual(result.messages, messages);
		else {
			assert.ok(result.messages.some((message) => message.customType === "jouzu-task-skipped"));
			assert.equal(saved.length, 1);
			await handlers.get("session_start")({}, ctx);
			const reopened = await handlers.get("context")({ messages }, ctx);
			assert.ok(reopened.messages.some((message) => message.customType === "jouzu-task-skipped"));
		}
	});
