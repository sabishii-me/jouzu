import assert from "node:assert/strict";
import { test } from "node:test";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { assistant } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { validateFlowToolOrder } from "../dist/flow-control/model-input.js";
import { prepareSummaryToolHistory, prepareToolHistory } from "../dist/flow-control/tool-history.js";

const user = (content = "Continue") => ({ role: "user", content, timestamp: 3 });
const call = (...ids) => ({
	...assistant(),
	timestamp: 1,
	stopReason: "toolUse",
	content: ids.map((id) => ({ type: "toolCall", id, name: "write", arguments: { path: "output" } })),
});
const result = (id) => ({
	role: "toolResult",
	toolCallId: id,
	toolName: "write",
	content: [{ type: "text", text: "Written" }],
	isError: false,
	timestamp: 2,
});

function checkProviderReplay(messages) {
	for (const model of [
		{ provider: assistant().provider, api: assistant().api, id: assistant().model, input: ["text", "image"] },
		{ provider: "other", api: "anthropic-messages", id: "other", input: ["text"] },
	]) {
		const converted = transformMessages(messages, model, (id) => `normalized_${id}`);
		validateFlowToolOrder(converted);
	}
}

function check(input) {
	const snapshot = structuredClone(input);
	const output = prepareToolHistory(input);
	assert.deepEqual(input, snapshot, "never mutate the selected branch");
	assert.doesNotThrow(() => validateFlowToolOrder(output));
	checkProviderReplay(output);
	assert.equal(prepareToolHistory(output), output, "preparation is idempotent");
	assert.deepEqual(prepareToolHistory(structuredClone(input)), output, "reopening produces the same projection");
	for (const message of input) assert.ok(output.includes(message), "preserve original objects and signatures");
	for (const message of output.filter((message) => !input.includes(message))) {
		assert.equal(message.role, "toolResult");
		assert.equal(message.isError, true);
		assert.match(message.content[0].text, /outcome is unknown/);
		assert.match(message.content[0].text, /before deciding whether to repeat/);
		assert.equal(message.timestamp, 1);
	}
	return output;
}

test("every prefix of parallel-tool history remains usable after rewind or fork", () => {
	for (const results of [
		["a", "b", "c"],
		["c", "a", "b"],
		["b", "c", "a"],
	]) {
		const history = [user("Start"), call("a", "b", "c"), ...results.map(result), assistant()];
		for (let end = 0; end <= history.length; end++) {
			const prefix = history.slice(0, end);
			check(prefix);
			check([...prefix, user()]);
			check([...prefix, assistant()]);
		}
	}
});

test("partial batches retain actual results and fill only missing results before unrelated input", () => {
	const existing = result("b");
	const input = [call("a", "b", "c"), existing, user()];
	const output = check(input);
	assert.deepEqual(
		output.map((message) => message.toolCallId ?? message.role),
		["assistant", "b", "a", "c", "user"],
	);
	assert.equal(output[1], existing);
	assert.equal(output[1].isError, false);
});

test("multiple historical gaps are repaired without touching later completed exchanges", () => {
	const input = [call("a"), user(), call("b"), user(), call("c"), result("c"), assistant()];
	assert.equal(check(input).length, input.length + 2);
});

test("complete exchanges and empty histories are returned unchanged", () => {
	for (const input of [
		[],
		[user()],
		[call("a"), result("a"), user()],
		[call("a"), result("a"), call("a"), result("a")],
	]) {
		assert.equal(check(input), input);
	}
});

test("signed reasoning, text, tool arguments and images are preserved for replayable turns", () => {
	for (const stopReason of ["toolUse", "length"]) {
		const message = call("a", "b");
		message.stopReason = stopReason;
		message.content.unshift(
			{ type: "thinking", thinking: "", thinkingSignature: "opaque", redacted: true },
			{ type: "text", text: "Writing", textSignature: "signed" },
		);
		const existing = result("a");
		existing.content.push({ type: "image", data: "YQ==", mimeType: "image/png" });
		const output = check([message, existing, user()]);
		assert.equal(output[0], message);
		assert.equal(output[1], existing);
	}
});

test("failed partial turns are not replayed or given orphan placeholders", () => {
	for (const stopReason of ["aborted", "error"]) {
		for (const id of ["a", ""]) {
			const failed = { ...call(id), stopReason };
			for (const tail of [[], [result(id)]]) {
				const next = user();
				const input = [failed, ...tail, next];
				const snapshot = structuredClone(input);
				const output = prepareToolHistory(input);
				assert.deepEqual(output, [next]);
				assert.deepEqual(input, snapshot);
				assert.equal(prepareToolHistory(output), output);
				validateFlowToolOrder(output);
				checkProviderReplay(output);
			}
		}
		const input = [call("previous"), { ...assistant(), stopReason }, user()];
		const output = prepareToolHistory(input);
		assert.deepEqual(
			output.map((message) => message.toolCallId ?? message.role),
			["assistant", "previous", "user"],
		);
		validateFlowToolOrder(output);
	}
});

test("failed turns discard only demonstrably associated results", () => {
	for (const stopReason of ["aborted", "error"]) {
		const failed = { ...call("a"), stopReason };
		for (const input of [
			[{ ...assistant(), stopReason }, result("a")],
			[failed, result("other")],
			[failed, { ...result("a"), toolName: "read" }],
			[failed, result("a"), result("a")],
			[{ ...call("a", "a"), stopReason }, result("a")],
		]) {
			const snapshot = structuredClone(input);
			assert.throws(() => prepareToolHistory(input), { code: "schema" });
			assert.deepEqual(input, snapshot);
		}
	}
});

test("summary excerpts preserve leading results without inventing missing calls", () => {
	const image = { type: "image", data: "YQ==", mimeType: "image/png" };
	const leading = result("outside-excerpt");
	leading.content.push(image);
	const input = [leading, user(), call("missing")];
	const snapshot = structuredClone(input);
	const output = prepareSummaryToolHistory(input);
	assert.deepEqual(input, snapshot);
	assert.equal(output[0].toolCallId, leading.toolCallId);
	assert.match(output[0].content[0].text, /not included in this summary excerpt/);
	assert.deepEqual(output[0].content.slice(1), leading.content);
	assert.equal(output[1], input[1]);
	assert.equal(output[2], input[2]);
	assert.equal(output[3].toolCallId, "missing");
	assert.equal(output[3].isError, true);
	assert.deepEqual(prepareSummaryToolHistory(output), output);
	assert.throws(() => prepareToolHistory(input), { code: "schema" });
});

test("ambiguous or corrupt identities still fail instead of inventing tool ancestry", () => {
	for (const input of [
		[result("a")],
		[call("a"), result("a"), result("a")],
		[call("a"), { ...result("a"), toolName: "read" }],
		[call("a", "a")],
		[call("")],
		[call("x".repeat(513))],
		[call("a"), user(), result("a")],
	]) {
		const snapshot = structuredClone(input);
		assert.throws(() => prepareToolHistory(input), { code: "schema" });
		assert.deepEqual(input, snapshot);
	}
});
