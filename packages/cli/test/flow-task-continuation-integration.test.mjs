import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { deferred } from "../../../scripts/fixtures/pi-flow-session.mjs";
import { afterFlowCleanup, assembledSession, installedProducerExtensions } from "./fixtures/flow-assembly.mjs";

const checkout = process.env.JOUZU_PI_TASKS_CHECKOUT;

async function loadGuard(t) {
	// Resolve runtime packages through the CLI tree, as installed extensions do.
	const outputDir = await mkdtemp(join(import.meta.dirname, "../node_modules/.task-guard-test-"));
	afterFlowCleanup(t, () => rm(outputDir, { recursive: true, force: true }));
	const outfile = join(outputDir, "guard.mjs");
	await build({
		entryPoints: [join(resolve(checkout), "src/task-continuation.ts")],
		bundle: true,
		platform: "node",
		format: "esm",
		packages: "external",
		outfile,
		logLevel: "silent",
	});
	return import(pathToFileURL(outfile).href);
}

for (const enqueueAt of ["agent_end", "streaming"])
	test(`task continuation integration: stale follow-up queued at ${enqueueAt}`, {
		skip: !checkout && "Set JOUZU_PI_TASKS_CHECKOUT to a pi-tasks source checkout.",
		timeout: 15_000,
	}, async (t) => {
		const { installTaskContinuationGuard, taskContinuation } = await loadGuard(t);
		const task = { id: "1", createdAt: 1, status: "in_progress", subject: "A task" };
		const requested = deferred(),
			releaseResponse = deferred(),
			settled = deferred();
		let pi,
			delivered = false,
			queued = false,
			original;
		const queue = () => {
			assert.equal(queued, false);
			queued = true;
			original = taskContinuation(task, 'Continue by working on task #1: "A task"\n\nDo work');
			pi.sendMessage(original, { deliverAs: "followUp", triggerTurn: true });
			task.status = "completed";
		};
		const f = await assembledSession(t, {
			producerExtensions: [
				...(await installedProducerExtensions()),
				{
					name: "task-guard",
					factory(api) {
						pi = api;
						installTaskContinuationGuard(
							pi,
							() => task,
							() => {
								delivered = true;
							},
						);
						pi.on("agent_end", () => {
							if (enqueueAt === "agent_end" && !queued) queue();
						});
						pi.on("agent_settled", () => {
							if (delivered) settled.resolve();
						});
					},
				},
			],
			script: async (_body, index) => {
				if (index === 0 && enqueueAt === "streaming") {
					requested.resolve();
					await releaseResponse.promise;
				}
				return { text: "Done" };
			},
		});
		// Release a gated response before teardown tries to join the active request.
		afterFlowCleanup(t, () => releaseResponse.resolve());
		const first = f.session.prompt("start");
		if (enqueueAt === "streaming") {
			await requested.promise;
			assert.equal(f.session.agent.state.isStreaming, true);
			queue();
			assert.equal(delivered, false, "follow-up must stay queued during the active request");
			releaseResponse.resolve();
		}
		await first;
		await settled.promise;
		await f.session.waitForIdle();
		assert.equal(f.bodies.length, 1, "stale delivery must not send another HTTP request");
		assert.equal(f.ingress.automatedPause(), undefined);
		const saved = f.sessionManager
			.getBranch()
			.find((entry) => entry.type === "custom_message" && entry.customType === original.customType);
		assert.equal(saved.content, original.content, "cancellation must preserve source bytes");
		await f.session.prompt("Explain the completed result");
		assert.equal(f.bodies.length, 2, JSON.stringify(await f.ingress.inspect()));
		assert.ok(JSON.stringify(f.bodies[1]).includes("is cancelled"));
		assert.ok(JSON.stringify(f.bodies[1]).includes("Explain the completed result"));
		assert.deepEqual(f.errors, []);
	});
