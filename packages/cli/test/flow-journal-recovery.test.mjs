import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { PiFlowAttachment } from "../dist/flow-control/pi-attachment.js";

const scope = { sessionId: "parent", branchId: "branch" };
const member = { id: "結果", revision: "1", kind: "result", required: false, contentHash: "a".repeat(64) };

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-journal-recovery-"));
	const attachments = [];
	t.after(async () => {
		for (const attachment of attachments) await attachment.close();
		await rm(root, { recursive: true, force: true });
	});
	async function open() {
		const attachment = await PiFlowAttachment.open(root, scope);
		attachments.push(attachment);
		return attachment;
	}
	const attachment = await open();
	const queue = { id: "queue", revision: 1 };
	await attachment.ledger.select("attempt", [member]);
	await attachment.ledger.queued("attempt", queue);
	await attachment.ledger.claim("attempt", queue);
	await attachment.ledger.prepare("attempt", "request", [{ ...member, disposition: "included" }], false);
	await attachment.ledger.handoff("attempt", "request");
	await attachment.close();
	const journals = (await readdir(root, { recursive: true })).filter((path) => path.endsWith(".jsonl"));
	assert.equal(journals.length, 1);
	const journal = join(root, journals[0]);
	const complete = await readFile(journal);
	assert.ok(complete.includes(Buffer.from("結果")), "the committed prefix includes multibyte data");
	await appendFile(journal, '{"kind":"value","op":"set","value":"未完');
	return { root, journal, complete, open };
}

for (const phase of ["before", "after"]) {
	test(`process death during journal suffix repair permits default reattachment: ${phase}`, {
		timeout: 15000,
	}, async (t) => {
		const { root, journal, complete, open } = await fixture(t);
		const marker = join(root, "repair-boundary.json");
		const child = fork(
			new URL("./fixtures/flow-journal-recovery-crash.mjs", import.meta.url),
			[root, journal, marker, phase],
			{ stdio: ["ignore", "ignore", "pipe", "ipc"] },
		);
		t.after(async () => {
			if (child.exitCode === null && child.signalCode === null) {
				const ended = once(child, "exit");
				child.kill("SIGKILL");
				await ended;
			}
		});
		let stderr = "";
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		const [code, signal] = await once(child, "exit");
		// Windows reports a self-inflicted SIGKILL as exit code 1, not a signal.
		assert.equal(code, process.platform === "win32" ? 1 : null, stderr);
		assert.equal(signal, process.platform === "win32" ? null : "SIGKILL", stderr);
		assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), { repair: "truncate", phase });

		// Use production discovery, not an injected opener with a known journal path.
		const reopened = await open();
		const state = await reopened.ledger.snapshot();
		assert.equal(state.attempts[0].phase, "uncertain");
		assert.equal(state.attempts[0].requests[0].handedOff, true);
		assert.deepEqual(state.attempts[0].members, [member]);
		assert.deepEqual(await readdir(dirname(journal)), [basename(journal)]);
		const recovered = await readFile(journal);
		assert.deepEqual(recovered.subarray(0, complete.length), complete);
		await reopened.close();
		const again = await open();
		assert.equal((await again.ledger.snapshot()).attempts[0].phase, "uncertain");
	});
}

test("journal discovery still rejects an unexpected sibling without deleting it", async (t) => {
	const { journal, complete, open } = await fixture(t);
	const unexpected = join(dirname(journal), ".unexpected.tmp");
	const bytes = Buffer.from("unrecognized file");
	await writeFile(unexpected, bytes, { mode: 0o600 });
	const torn = await readFile(journal);
	await assert.rejects(open(), /Unrecognized flow session file/);
	assert.deepEqual(await readFile(unexpected), bytes);
	assert.deepEqual(await readFile(journal), torn);
	assert.deepEqual(torn.subarray(0, complete.length), complete);
});
