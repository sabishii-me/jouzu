import assert from "node:assert/strict";
import { test } from "node:test";
import { createTextGuardDesktopExtension } from "../dist/textguard-desktop.js";

const review = {
	id: "review-1",
	source: "raw",
	displaySource: "source.md",
	contentDigest: "a".repeat(64),
	scannerIdentity: "scanner",
	policy: "admission",
	evidence: { status: "findings", severityCounts: { error: 1, warn: 0, info: 0 }, findings: [] },
};

function setup() {
	const messages = [];
	let approved = 0;
	let reloads = 0;
	const policy = {
		currentMode: () => "strict",
		reviews: () => [review],
		scanReports: () => [],
		scanNotices: () => [],
		contentSnapshot: () => ({ source: "raw", body: "body" }),
		dismissReport() {},
	};
	const runtime = {
		forSession: id => id === "session" ? policy : undefined,
		setMode: () => false,
		approve: () => { approved++; return true; },
	};
	const commands = new Map();
	createTextGuardDesktopExtension(runtime, { enabled: true })({
		registerCommand: (name, command) => commands.set(name, command),
	});
	const ctx = {
		mode: "rpc",
		hasUI: true,
		sessionManager: { getSessionId: () => "session" },
		ui: { notify: (message, kind) => messages.push({ message, kind }) },
		reload: async () => { reloads++; },
	};
	return { handler: commands.get("textguard-desktop").handler, ctx, messages, approved: () => approved, reloads: () => reloads };
}
const payload = message => JSON.parse(message.replace(/^JOUZU_TEXTGUARD /u, ""));

test("desktop inspect issues a one-use ticket for real review state", async () => {
	const f = setup();
	await f.handler('{"action":"inspect"}', f.ctx);
	const data = payload(f.messages.at(-1).message);
	assert.equal(data.ok, true);
	assert.equal(data.sessionId, "session");
	assert.equal(data.mode, "strict");
	assert.equal(data.items.length, 1);
	assert.equal(data.items[0].snapshot.body, "body");
	assert.equal(typeof data.items[0].ticket, "string");
	assert.equal(f.approved(), 0);
});

test("desktop approval requires the issued ticket and consumes it", async () => {
	const f = setup();
	await f.handler('{"action":"approve","id":"review-1"}', f.ctx);
	assert.equal(payload(f.messages.at(-1).message).ok, false);
	assert.equal(f.approved(), 0);

	await f.handler('{"action":"inspect"}', f.ctx);
	const data = payload(f.messages.at(-1).message);
	const ticket = data.items[0].ticket;
	await f.handler(JSON.stringify({ action: "approve", id: "review-1", ticket, persist: false }), f.ctx);
	assert.equal(payload(f.messages.at(-1).message).ok, true);
	assert.equal(f.approved(), 1);
	assert.equal(f.reloads(), 1);

	await f.handler(JSON.stringify({ action: "approve", id: "review-1", ticket, persist: false }), f.ctx);
	assert.equal(payload(f.messages.at(-1).message).ok, false);
	assert.equal(f.approved(), 1);
});

test("desktop control is inert when disabled", () => {
	const commands = new Map();
	createTextGuardDesktopExtension({ forSession: () => undefined }, { enabled: false })({
		registerCommand: (name, command) => commands.set(name, command),
	});
	assert.equal(commands.size, 0);
});
