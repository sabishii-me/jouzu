import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Pass JouzuConsole.exe for native acceptance, or a built cli.js for a local check.
const [target, workingFolder] = process.argv.slice(2);
assert.ok(target && workingFolder, "Usage: node network.test.mjs <JouzuConsole.exe|cli.js> <working-folder>");
const home = mkdtempSync(join(tmpdir(), "jouzu network 日本語 "));
const token = "local-acceptance-token";
const marker = "windows-network-fixture-ok";
const fixture = JSON.parse(readFileSync(new URL("../../packages/cli/catalog/fixtures/account-snapshot-v1.json", import.meta.url), "utf8"));
fixture.generatedAt = new Date().toISOString();
let catalogStatus = 401;
let modelStatus = 200;
let catalogs = 0;
let completions = 0;
let authorizedCatalogs = 0;
let authorizedCompletions = 0;
const server = createServer(async (request, response) => {
	if (request.url === "/v1/jouzu/model-catalog") {
		catalogs++;
		if (request.headers.authorization === `Bearer ${token}`) authorizedCatalogs++;
		response.writeHead(catalogStatus, { "Content-Type": "application/vnd.jouzu.model-catalog+json; version=1" });
		response.end(catalogStatus === 200 ? JSON.stringify(fixture) : '{"error":"fixture rejection"}');
		return;
	}
	if (request.url === "/v1/chat/completions" && request.method === "POST") {
		completions++;
		if (request.headers.authorization === `Bearer ${token}`) authorizedCompletions++;
		let body = "";
		for await (const chunk of request) {
			body += chunk;
			if (body.length > 1024 * 1024) { response.writeHead(413).end(); return; }
		}
		const parsed = JSON.parse(body);
		if (parsed.model !== "example-model" || parsed.stream !== true) { response.writeHead(400).end(); return; }
		if (modelStatus !== 200) {
			response.writeHead(modelStatus, { "Content-Type": "application/json" });
			response.end('{"error":{"message":"fixture model access denied","type":"authentication_error"}}');
			return;
		}
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const event = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "example-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
		response.end(event({ role: "assistant", content: marker }) + event({}, "stop") + "data: [DONE]\n\n");
		return;
	}
	response.writeHead(404).end();
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const endpoint = `http://127.0.0.1:${server.address().port}/v1/jouzu/model-catalog`;
const env = { ...process.env, JOUZU_HOME: home, JOUZU_MODEL_CATALOG_URL: endpoint, JOUZU_MODEL_CATALOG_TOKEN: token,
	SHISA_API_KEY: "", NODE_OPTIONS: "", NO_PROXY: "*", no_proxy: "*", HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "",
	http_proxy: "", https_proxy: "", all_proxy: "", JOUZU_NO_UPDATE: "1" };
const command = target.endsWith(".js") ? process.execPath : resolve(target);
const prefix = target.endsWith(".js") ? [resolve(target)] : [];

async function run(args, success = true) {
	const output = await new Promise((resolveResult, reject) => {
		const child = spawn(command, [...prefix, ...args], { cwd: resolve(workingFolder), env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "", stderr = "", failure;
		const stop = (reason) => {
			failure = new Error(reason);
			if (process.platform === "win32" && child.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
			else child.kill("SIGKILL");
		};
		const timer = setTimeout(() => stop("Fixture CLI command timed out"), 60_000);
		child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 1024 * 1024) stop("Fixture stdout exceeded limit"); });
		child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 1024 * 1024) stop("Fixture stderr exceeded limit"); });
		child.on("error", (error) => { clearTimeout(timer); reject(error); });
		child.on("close", (code) => { clearTimeout(timer); if (failure) reject(failure); else resolveResult({ code, stdout, stderr }); });
	});
	assert.equal(output.code === 0, success, `Unexpected fixture command exit ${output.code}: ${output.stdout}\n${output.stderr}`);
	assert.ok(!output.stdout.includes(token) && !output.stderr.includes(token), "Fixture token leaked to command output");
	return output;
}

try {
	await run(["catalog", "refresh"], false);
	let status = JSON.parse((await run(["catalog", "status", "--json"])).stdout);
	assert.equal(status.sources.find((source) => source.endpoint === endpoint).lastError.code, "auth_rejected");
	catalogStatus = 200;
	await run(["catalog", "refresh"]);
	status = JSON.parse((await run(["catalog", "status", "--json"])).stdout);
	const active = status.sources.find((source) => source.endpoint === endpoint);
	assert.equal(active.status, "active");
	assert.equal(active.lastError, undefined);
	const provider = `catalog:${encodeURIComponent(fixture.catalogId)}:${encodeURIComponent(fixture.providers[0].id)}:${createHash("sha256").update(endpoint).digest("hex").slice(0, 16)}`;
	const promptArgs = ["--no-session", "--no-extensions", "--no-skills", "--no-tools", "--provider", provider, "--model", "example-model", "--thinking", "off", "-p", "Reply with the fixture marker."];
	const reply = await run(promptArgs);
	assert.match(reply.stdout, new RegExp(marker));
	assert.ok(completions >= 1, "The model endpoint was not called");
	modelStatus = 401;
	const rejection = await run(promptArgs, false);
	assert.match(rejection.stdout + rejection.stderr, /fixture model access denied/u);
	assert.ok(completions >= 2, "The model rejection was not exercised");
	assert.ok(catalogs >= 2, "The catalog endpoint was not called");
	assert.equal(authorizedCatalogs, catalogs, "Catalog request omitted the bearer");
	assert.equal(authorizedCompletions, completions, "Model request omitted the bearer");
	console.log("Local catalog authentication, first-error persistence, recovery, streamed inference and model rejection passed");
} finally {
	server.closeAllConnections();
	await new Promise((done) => server.close(done));
	rmSync(home, { recursive: true, force: true });
}
