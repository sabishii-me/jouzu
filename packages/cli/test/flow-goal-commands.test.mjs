import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assembledSession, capturedNotices, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

test("goal overview and lifecycle commands stay local and recover saved goals", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions({
			freshMultiloop: true,
		}),
	});
	f.ingress.pauseAutomated("Hold goal dispatch during command checks");
	const notices = capturedNotices(f.session);
	await f.session.prompt("/goal");
	assert.match(notices.at(-1).text, /No running or paused goals/);
	assert.match(notices.at(-1).text, /pause\|stop\|resume/);
	await f.session.prompt("/goal Finish 日本語 command testing");
	const target = notices.find((n) => n.text.startsWith("Goal started:"))?.text.match(/Goal started: (\S+)/)?.[1];
	assert.ok(target);
	for (const command of ["", "list", "ls", "status"]) {
		await f.session.prompt(`/goal ${command}`);
		assert.match(notices.at(-1).text, /Finish 日本語 command testing/);
		assert.match(notices.at(-1).text, /\/goal help/);
	}
	await f.session.prompt("/goal pause");
	await f.session.prompt("/goal");
	assert.match(notices.at(-1).text, /paused/);
	await f.session.prompt(`/goal resume ${target}`);
	assert.match(notices.at(-1).text, /Resumed goal/);
	await f.session.prompt("/goal stop");
	await f.session.prompt("/goal");
	assert.match(notices.at(-1).text, /No running or paused goals/);
	assert.match(notices.at(-1).text, /Other runs hidden: 1.*\/multiloop/);
	await f.session.prompt(`/goal resume ${target}`);
	assert.match(notices.at(-1).text, /Resumed goal/);
	await f.session.prompt("/goal clear");
	await f.session.prompt("/goal resume");
	assert.match(notices.at(-1).text, /Resumed goal/);
	await f.session.prompt("/goal stop missing/run");
	assert.match(notices.at(-1).text, /Could not select a goal/);
	assert.equal(f.bodies.length, 0);
	assert.deepEqual(f.errors, []);
});

test("goal commands filter measured runs and hand ambiguous resume requests to the agent", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions({
			freshMultiloop: true,
		}),
	});
	f.ingress.pauseAutomated("Hold dispatch");
	const notices = capturedNotices(f.session);
	await f.session.prompt("/goal Finish the first objective");
	const target = notices.find((n) => n.text.startsWith("Goal started:"))?.text.match(/Goal started: (\S+)/)?.[1];
	await f.session.prompt("/goal clear");
	const registryPath = join(f.root, ".multiloop/registry.json");
	const registry = JSON.parse(await readFile(registryPath, "utf8"));
	const original = JSON.parse(await readFile(join(f.root, ".multiloop/active", target, "state.json"), "utf8"));
	for (const [lane, kind] of [
		["measured", "measured"],
		["second", "goal"],
	]) {
		const dir = join(f.root, ".multiloop/active", lane, original.runTag);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "state.json"), JSON.stringify({ ...original, lane, kind, goal: `${lane} objective` }));
		registry.loops.push({ ...registry.loops[0], lane });
	}
	await writeFile(registryPath, JSON.stringify(registry));
	await f.session.prompt("/goal");
	assert.match(notices.at(-1).text, /second objective/);
	assert.doesNotMatch(notices.at(-1).text, /measured objective/);
	assert.match(notices.at(-1).text, /Other runs hidden: 1/);
	await f.session.prompt("/goal resume");
	assert.match(notices.at(-1).text, /Finding the goal to resume/);
	await f.session.waitForIdle();
	for (const operation of ["resume", "pause", "stop"]) {
		await f.session.prompt(`/goal ${operation} measured/${original.runTag}`);
		assert.match(
			notices.at(-1).text,
			operation === "resume" ? /Finding the goal to resume/ : /Could not select a goal/,
		);
		await f.session.waitForIdle();
	}
	const measured = JSON.parse(
		await readFile(join(f.root, ".multiloop/active/measured", original.runTag, "state.json"), "utf8"),
	);
	assert.equal(measured.status, original.status);
	assert.deepEqual(f.errors, []);
});

for (const multiple of [false, true])
	for (const busy of [false, true])
		test(`goal resume uses normal delivery: multiple=${multiple}, busy=${busy}`, {
			timeout: 15000,
		}, async (t) => {
			const { assistantToolCalls, deferred } = await import("../../../scripts/fixtures/pi-flow-session.mjs");
			const started = deferred();
			const release = deferred();
			const done = deferred();
			let target;
			let request = 0;
			const f = await assembledSession(t, {
				producerExtensions: await installedProducerExtensions({
					freshMultiloop: true,
				}),
				script: async () => {
					if (busy && request++ === 0) {
						started.resolve();
						await release.promise;
						return { text: "Previous work finished" };
					}
					const index = busy ? request - 2 : request++;
					if (multiple && index === 0)
						return assistantToolCalls({
							name: "multiloop_resume",
							arguments: { target },
						});
					if (index === (multiple ? 1 : 0))
						return assistantToolCalls({
							name: "multiloop_stop",
							arguments: { target },
						});
					done.resolve();
					return { text: "Goal handled" };
				},
			});
			let preparing = true;
			const host = f.ingress.branch().host;
			const gate = host.gate.bind(host);
			t.mock.method(host, "gate", () => ({
				...gate(),
				automatedPaused: preparing,
			}));
			const notices = capturedNotices(f.session);
			await f.session.prompt("/goal Finish the intended objective");
			target = notices.find((n) => n.text.startsWith("Goal started:"))?.text.match(/Goal started: (\S+)/)?.[1];
			assert.ok(target);
			await f.session.prompt("/goal pause");
			if (multiple) {
				const registryPath = join(f.root, ".multiloop/registry.json");
				const registry = JSON.parse(await readFile(registryPath, "utf8"));
				const original = JSON.parse(await readFile(join(f.root, ".multiloop/active", target, "state.json"), "utf8"));
				const dir = join(f.root, ".multiloop/active/another", original.runTag);
				await mkdir(dir, { recursive: true });
				await writeFile(
					join(dir, "state.json"),
					JSON.stringify({
						...original,
						lane: "another",
						goal: "Another objective",
					}),
				);
				registry.loops.push({ ...registry.loops[0], lane: "another" });
				await writeFile(registryPath, JSON.stringify(registry));
			}
			preparing = false;
			const previous = busy ? f.session.prompt("Finish this message first") : undefined;
			if (busy) await started.promise;
			await f.session.prompt("/goal resume");
			if (busy) {
				assert.equal(f.bodies.length, 1, "resume waits for the active turn");
				release.resolve();
				await previous;
			}
			await done.promise;
			await f.session.waitForIdle();
			assert.equal(
				notices.some((notice) => /Finding the goal/.test(notice.text)),
				multiple,
			);
			const prompt = JSON.stringify(f.bodies[busy ? 1 : 0]);
			assert.match(prompt, multiple ? /Resume the user.s saved goal/ : /Resume the selected goal/);
			if (multiple) {
				assert.match(prompt, /Another objective/);
				assert.match(prompt, /Finish the intended objective/);
			}
			assert.ok(prompt.includes(target));
			assert.deepEqual(f.errors, []);
		});
