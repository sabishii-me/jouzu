import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assembledSession, capturedNotices, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

test("goal overview and lifecycle commands stay local and recover saved goals", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions({ freshMultiloop: true }),
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

test("goal commands filter measured runs and reject ambiguous saved goals", async (t) => {
	const f = await assembledSession(t, {
		producerExtensions: await installedProducerExtensions({ freshMultiloop: true }),
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
	assert.match(notices.at(-1).text, /Could not select a goal/);
	for (const operation of ["resume", "pause", "stop"]) {
		await f.session.prompt(`/goal ${operation} measured/${original.runTag}`);
		assert.match(notices.at(-1).text, /Could not select a goal/);
	}
	const measured = JSON.parse(
		await readFile(join(f.root, ".multiloop/active/measured", original.runTag, "state.json"), "utf8"),
	);
	assert.equal(measured.status, original.status);
	assert.equal(f.bodies.length, 0);
	assert.deepEqual(f.errors, []);
});
