// Runs the real launcher and Pi initial-model resolver in one process, then reports what
// the first interactive runtime saw. The catalog endpoint is the only network the fixture
// serves, so an unexpected request fails the scenario instead of passing silently.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { setCatalogSourceToken } from "../../dist/catalog-sources.js";
import { runMainCli, STARTUP_CATALOG_TIMEOUT_MS } from "../../dist/main-cli.js";
import { MODEL_CATALOG_MEDIA_TYPE } from "../../dist/model-catalog.js";
import { loadActiveModelCatalogs, refreshModelCatalog } from "../../dist/model-catalog-sync.js";
import { resolveJouzuPaths } from "../../dist/paths.js";
import { configurePiProcess } from "../../dist/runtime.js";

const scenario = JSON.parse(process.argv[2]);
const paths = resolveJouzuPaths();
const document = JSON.parse(
	readFileSync(new URL("../../catalog/fixtures/account-snapshot-v1.json", import.meta.url), "utf8"),
);
const response = (body) =>
	new Response(JSON.stringify(body), { headers: { "content-type": MODEL_CATALOG_MEDIA_TYPE } });
// A stored token is the smallest credential that activates the built-in source, so the
// scenario does not depend on login or environment state.
for (const path of [paths.agentDir, paths.stateDir]) mkdirSync(path, { recursive: true, mode: 0o700 });
if (scenario.credential) setCatalogSourceToken(paths, "shisa-api", "fixture-key");
if (scenario.cache) {
	const seeded = await refreshModelCatalog(paths, {
		fetch: async () => response(document),
		now: new Date("2020-01-01T00:00:00Z"),
	});
	if (seeded.status !== "activated") throw new Error(`fixture cache seed failed: ${seeded.status}`);
}

const writes = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
	if (typeof chunk === "string") writes.push(chunk);
	return originalWrite(chunk, ...args);
};

const requests = [];
globalThis.fetch = async (url, init) => {
	if (String(url) !== "https://api.shisa.ai/v1/jouzu/model-catalog")
		throw new TypeError(`unexpected request: ${String(url)}`);
	const entry = { authorization: new Headers(init.headers).get("authorization"), settledAt: null, abortedAt: null };
	requests.push(entry);
	const startedAt = performance.now();
	init.signal?.addEventListener(
		"abort",
		() => {
			entry.abortedAt = performance.now() - startedAt;
		},
		{ once: true },
	);
	try {
		await delay(scenario.delayMs ?? 1_500, undefined, { signal: init.signal });
		const updated = structuredClone(document);
		updated.revision = "fixture-2";
		updated.sequence = "2";
		updated.modelOfferings[0].name = "Refreshed Model";
		return response(updated);
	} finally {
		entry.settledAt = performance.now();
	}
};

Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stdout, "isTTY", { value: true });
configurePiProcess(paths);
const { InteractiveMode } = await import("@earendil-works/pi-coding-agent");
let observed;
// Replace only the terminal loop: the first runtime is inspected before session_start can
// change the selection that Pi resolved at construction.
InteractiveMode.prototype.run = async function () {
	const model = this.session.model;
	observed = {
		observedAt: performance.now(),
		model: model ? { provider: model.provider, id: model.id, name: model.name } : undefined,
		requests,
		noticeShown: writes.some((chunk) => chunk.includes("Fetching model catalog")),
		startupTimeoutMs: STARTUP_CATALOG_TIMEOUT_MS,
		activeRevisions: loadActiveModelCatalogs(paths).map(({ document }) => document.revision),
	};
	await this.runtimeHost.dispose();
};
await runMainCli(["--no-session", "--no-context-files", "--no-skills"]);
if (!observed) throw new Error("Pi never entered its first interactive runtime");
writeFileSync(join(paths.configDir, "observed.json"), JSON.stringify(observed));
// The real terminal loop owns process lifetime; no terminal was started here.
process.exit(0);
