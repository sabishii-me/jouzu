import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Qualification must fail rather than silently skip a missing source checkout.
if (!process.env.JOUZU_PI_TASKS_CHECKOUT?.trim()) {
	console.error("Set JOUZU_PI_TASKS_CHECKOUT to the pi-tasks source checkout to test.");
	process.exitCode = 1;
} else {
	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("./run-tests.mjs", import.meta.url)),
			fileURLToPath(new URL("../packages/cli/test/flow-task-continuation-integration.test.mjs", import.meta.url)),
		],
		{ stdio: "inherit", env: process.env },
	);
	if (result.error) console.error(result.error.message);
	process.exitCode = result.status ?? 1;
}
