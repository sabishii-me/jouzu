import { packageRootFromConsumer } from "./package-root.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export function assertFlowAgent(agent) {
	if (typeof agent?.inspectQueuedMessages !== "function") {
		throw new Error("Starter contains unpatched Pi agent-core: flow queue checkpoints are missing");
	}
}

/**
 * The web-fetch extension requires a diagnostics sidecar from its patched Defuddle copy.
 * The sidecar lives inside the dependency tree, so a reinstall can drop it without breaking
 * the version check. Fail qualification when the extension needs it and the file is absent.
 */
export function assertDefuddleSidecar(app) {
	let webaio;
	try {
		webaio = packageRootFromConsumer(join(resolve(app), "node_modules", "jouzu"), "pi-webaio");
	} catch {
		return;
	}
	const webfetch = join(webaio, "dist", "src", "webfetch-api.js");
	if (!existsSync(webfetch) || !readFileSync(webfetch, "utf8").includes("jouzu-diagnostics")) return;
	const defuddle = packageRootFromConsumer(webaio, "defuddle");
	const sidecar = join(defuddle, "dist", "jouzu-diagnostics.cjs");
	if (!existsSync(sidecar)) {
		throw new Error("Defuddle diagnostics sidecar is missing from the installed runtime");
	}
}

export async function verifyRuntime(app) {
	const coding = packageRootFromConsumer(join(resolve(app), "node_modules", "jouzu"), "@earendil-works/pi-coding-agent");
    const core = packageRootFromConsumer(coding, "@earendil-works/pi-agent-core");
    const { Agent } = await import(pathToFileURL(join(core, "dist", "index.js")));
    assertFlowAgent(new Agent({ streamFn: () => { throw new Error("Verification must not call a provider"); } }));
    assertDefuddleSidecar(app);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await verifyRuntime(process.argv[2]);
	console.log("Starter flow runtime contract verified");
}
