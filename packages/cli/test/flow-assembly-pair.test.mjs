import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantToolCalls } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";
import { controlledBackground } from "./fixtures/flow-background-gate.mjs";
import { waitDependencyFrom } from "./fixtures/flow-wait-dependency.mjs";

const idle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));
const toolResults = (manager) =>
	manager
		.getEntries()
		.filter((entry) => entry.type === "message" && entry.message.role === "toolResult")
		.map((entry) => entry.message.content.map((part) => part.text ?? "").join("\n"));

test("the installed producer pair completes its handshakes inside the assembly", async (t) => {
	const f = await assembledSession(t, { producerExtensions: await installedProducerExtensions(t) });
	assert.deepEqual(f.errors, [], "no adapter reports an unavailable source when the real pair is loaded");
	const tools = f.session.getActiveToolNames();
	for (const name of ["multiloop_start", "bg_task", "agent_wait", "agent_wait_cancel", "agent_results"])
		assert.ok(tools.includes(name), `${name} is active`);
});

async function waitForSettledWake(f, blocked) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		const { attempts } = await f.ingress.branch().attachment.ledger.snapshot();
		if (f.bodies.length > blocked && attempts.some((attempt) => attempt.admission && attempt.phase === "settled"))
			return;
		await idle(25);
	}
	assert.fail("the released dependency did not produce a settled wake");
}

function blockedLaneScript(seen, command) {
	return (body, index) => {
		seen.push(index);
		if (index === 0)
			return assistantToolCalls({
				name: "multiloop_start",
				arguments: { lane: "sweep", runTag: "run", mode: "research", goal: "Wait for the sweep to finish" },
			});
		if (index === 1)
			return assistantToolCalls({
				name: "bg_task",
				arguments: { action: "spawn", command },
			});
		if (index === 2) {
			const dependency = waitDependencyFrom(body);
			assert.ok(dependency, "the task tool result carries exact wait evidence");
			return assistantToolCalls({
				name: "agent_wait",
				arguments: {
					work: dependency.work.id,
					reason: "the sweep must finish before the next measurement",
					deadline: "30m",
					on: [
						{
							producer: dependency.producer,
							handle: dependency.handle,
							execution: dependency.execution,
							until: dependency.until,
						},
					],
				},
			});
		}
		return { text: `turn ${index}` };
	};
}

test("a live wait blocks lane continuations and delivers its decision once", async (t) => {
	const background = await controlledBackground(t);
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(t),
		script: blockedLaneScript([], background.command),
	});
	await f.session.prompt("start the sweep and wait for it");
	const blocked = f.bodies.length;
	const [wait] = await f.ingress.branch().attachment.waits.snapshot();
	const waitResult = toolResults(f.sessionManager).find((text) => text.includes(`agent_wait waiting [${wait.token}]`));
	assert.ok(waitResult, "agent_wait returned a live wait with a reusable token");

	// The running lane would otherwise auto-continue at agent_end; the live wait must suppress it.
	await idle(250);
	assert.equal(f.bodies.length, blocked, "a blocked lane sends no continuation while its wait is live");

	await background.release();
	await waitForSettledWake(f, blocked);
	const wake = f.bodies.slice(blocked);
	assert.ok(wake.length >= 1, "the resolved dependency wakes the session");
	// Later requests replay the whole conversation, so only a newly appended message counts.
	const decisions = wake.filter((body) => JSON.stringify(body.messages.at(-1)).includes('kind\\":\\"wait'));
	assert.equal(decisions.length, 1, "the wait decision is delivered exactly once");
	assert.deepEqual(f.errors, []);

	const settled = f.bodies.length;
	await idle(600);
	assert.equal(f.bodies.length, settled, "a settled wait is not replayed");
});

test("wait resolution, the lane continuation, and the result compose one logical wake", async (t) => {
	const background = await controlledBackground(t);
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: blockedLaneScript([], background.command),
	});
	await f.session.prompt("start the sweep and wait for it");
	const blocked = f.bodies.length;
	await background.release();
	await waitForSettledWake(f, blocked);
	assert.equal(f.bodies.length - blocked, 1, "one composed wake, not a decision turn plus a continuation");
	const { attempts } = await f.ingress.branch().attachment.ledger.snapshot();
	const composed = attempts.filter((attempt) => attempt.admission);
	assert.equal(composed.length, 1, "one controller attempt carries the wake");
	assert.equal(composed[0].admission.choice.intent.producer, "multiloop", "the lane instruction is the selected work");
	assert.deepEqual(
		[...new Set(composed[0].members.map((member) => member.kind))].sort(),
		["result", "wait", "work"],
		"the decision, the lane instruction, and the background result share one turn",
	);
	assert.deepEqual(f.errors, []);
});

test("the assembly rejects a transport replaced after sealing", async (t) => {
	const f = await assembledSession(t, { producerExtensions: await installedProducerExtensions(t) });
	await f.session.prompt("first");
	assert.equal(f.bodies.length, 1);
	f.session.agent.streamFunction = async () => {
		throw new Error("must not be invoked");
	};
	await f.session.prompt("second");
	assert.equal(f.bodies.length, 1, "the replaced transport sends nothing");
	const held = f.sessionManager
		.getEntries()
		.some((entry) => entry.type === "message" && /transport changed/.test(entry.message.errorMessage ?? ""));
	assert.ok(held, "the request is held with a visible reason");
});

test("a running background task offers its liveness policy and a wait can use it", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: (body, index) => {
			if (index === 0)
				return assistantToolCalls({
					name: "multiloop_start",
					arguments: { lane: "sweep", runTag: "run", mode: "research", goal: "Watch liveness" },
				});
			if (index === 1)
				return assistantToolCalls({ name: "bg_task", arguments: { action: "spawn", command: "sleep 20" } });
			if (index === 2) {
				const dependency = waitDependencyFrom(body);
				assert.ok(dependency, "the task tool result carries wait evidence");
				assert.equal(dependency.health, "bg-process-alive-v1", "the result names the policy the model may request");
				return assistantToolCalls({
					name: "agent_wait",
					arguments: {
						work: dependency.work.id,
						reason: "the sweep must stay alive",
						deadline: "30m",
						// The policy the producer registers for a live process, requested by name.
						on: [
							{
								producer: dependency.producer,
								handle: dependency.handle,
								execution: dependency.execution,
								until: dependency.until,
								health: dependency.health,
							},
						],
					},
				});
			}
			return { text: `turn ${index}` };
		},
	});
	await f.session.prompt("start the sweep and watch it");

	const [wait] = (await f.ingress.branch().attachment.waits.snapshot()).filter((item) => item.state === "waiting");
	assert.ok(wait, "the monitored wait was accepted rather than refused");
	assert.equal(wait.on[0].health, "bg-process-alive-v1");
	// The producer reported liveness for the real spawned process alongside its predicates.
	const [execution] = (await f.ingress.branch().attachment.waits.authoritySnapshot()).executions;
	assert.equal(execution.healthEvidence?.policy, "bg-process-alive-v1");
	assert.equal(execution.healthEvidence?.state, "healthy");
	assert.match(execution.healthEvidence?.marker ?? "", /^[0-9]+$/, "the marker names the process it checked");
	assert.deepEqual(f.errors, []);
});

test("a policy the background producer does not register is refused", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: (body, index) => {
			if (index === 0)
				return assistantToolCalls({
					name: "multiloop_start",
					arguments: { lane: "sweep", runTag: "run", mode: "research", goal: "Refuse an invented policy" },
				});
			if (index === 1)
				return assistantToolCalls({ name: "bg_task", arguments: { action: "spawn", command: "sleep 20" } });
			if (index === 2) {
				const dependency = waitDependencyFrom(body);
				return assistantToolCalls({
					name: "agent_wait",
					arguments: {
						work: dependency.work.id,
						reason: "invented policy",
						deadline: "30m",
						on: [
							{
								producer: dependency.producer,
								handle: dependency.handle,
								execution: dependency.execution,
								until: dependency.until,
								health: "sweep-progress-v1",
							},
						],
					},
				});
			}
			return { text: `turn ${index}` };
		},
	});
	await f.session.prompt("start the sweep and invent a policy");
	// The model cannot install liveness semantics by naming them; no wait is parked.
	assert.deepEqual(
		(await f.ingress.branch().attachment.waits.snapshot()).filter((item) => item.state === "waiting"),
		[],
	);
});

test("a standalone wait decision owns its work for background and wait tools", async (t) => {
	const background = await controlledBackground(t);
	const nextBackground = await controlledBackground(t);
	let phase = 0,
		originalWork,
		token,
		nextToken;
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions(),
		script: (body) => {
			if (phase++ === 0)
				return assistantToolCalls({ name: "bg_task", arguments: { action: "spawn", command: background.command } });
			if (phase === 2) {
				const dependency = waitDependencyFrom(body);
				originalWork = dependency.work.id;
				return assistantToolCalls({
					name: "agent_wait",
					arguments: {
						work: originalWork,
						reason: "Wait for job",
						deadline: "30m",
						on: [
							{
								producer: dependency.producer,
								handle: dependency.handle,
								execution: dependency.execution,
								until: dependency.until,
							},
						],
					},
				});
			}
			if (phase === 3) return { text: "Waiting" };
			if (phase === 4)
				return assistantToolCalls({ name: "bg_task", arguments: { action: "spawn", command: nextBackground.command } });
			if (phase === 5) {
				const dependency = waitDependencyFrom(body);
				assert.equal(dependency.work.id, originalWork);
				return assistantToolCalls({
					name: "agent_wait",
					arguments: {
						work: originalWork,
						reason: "Inspect next job",
						deadline: "30m",
						on: [
							{
								producer: dependency.producer,
								handle: dependency.handle,
								execution: dependency.execution,
								until: dependency.until,
							},
						],
					},
				});
			}
			if (phase === 6) {
				const result = body.messages.findLast(
					(message) => message.role === "tool" && message.content.includes("agent_wait"),
				);
				nextToken = result.content.match(/agent_wait \w+ \[([^\]]+)\]/)?.[1];
				assert.ok(nextToken);
				return assistantToolCalls({
					name: "agent_wait_cancel",
					arguments: { token: nextToken, reason: "Decision complete" },
				});
			}
			return { text: "Decision complete" };
		},
	});
	await f.session.prompt("Run and wait for a job");
	const waits = await f.ingress.branch().attachment.waits.snapshot();
	token = waits[0].token;
	const before = f.bodies.length;
	await background.release();
	await waitForSettledWake(f, before);
	await f.session.waitForIdle();
	assert.equal(phase, 7);
	assert.notEqual(nextToken, token);
	assert.equal(
		(await f.ingress.branch().attachment.ledger.snapshot()).attempts.find((attempt) => attempt.admission)?.admission
			.choice.intent.rank,
		3,
	);
	assert.deepEqual(f.errors, []);
	assert.ok(
		!toolResults(f.sessionManager).some(
			(text) => text.includes("does not belong") || text.includes("requires current owning work"),
		),
	);
});
