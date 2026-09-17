import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export const FLOW_JOURNAL_CHECKPOINT_BYTES = 32 * 1024 * 1024;

/** Flow stores scalar snapshots only. Run under its writer lease, before opening or appending. */
export async function checkpointFlowJournal(
	path: string,
	threshold = FLOW_JOURNAL_CHECKPOINT_BYTES,
): Promise<number | undefined> {
	if ((await stat(path)).size < threshold) return;
	const values = new Map<string, { seq: number; line: string }>();
	let header: Record<string, unknown> | undefined;
	let sequence = 0;
	let pending = "";
	const input = createReadStream(path, { encoding: "utf8" });
	for await (const chunk of input) {
		pending += chunk;
		while (pending.includes("\n")) {
			const end = pending.indexOf("\n");
			const line = pending.slice(0, end);
			pending = pending.slice(end + 1);
			const parsed = JSON.parse(line);
			if (!header) {
				if (
					parsed?.v !== 4 ||
					parsed.kind !== "header" ||
					parsed.id !== "flow" ||
					parsed.storageVersion !== 1 ||
					typeof parsed.cwd !== "string" ||
					!Number.isSafeInteger(parsed.createdAt) ||
					parsed.createdAt < 0 ||
					(parsed.nextSeq !== undefined && (!Number.isSafeInteger(parsed.nextSeq) || parsed.nextSeq < 1))
				)
					throw new Error("Unsupported flow journal header.");
				header = parsed;
				continue;
			}
			for (const write of Array.isArray(parsed) ? parsed : [parsed]) {
				if (
					write?.kind !== "value" ||
					!["set", "delete"].includes(write.op) ||
					typeof write.namespace !== "string" ||
					typeof write.key !== "string" ||
					!Number.isSafeInteger(write.seq) ||
					write.seq <= sequence ||
					write.seq >= Number.MAX_SAFE_INTEGER ||
					(write.op === "set" && !Object.hasOwn(write, "value"))
				)
					throw new Error("Invalid or unsupported flow journal write.");
				sequence = write.seq;
				const key = JSON.stringify([write.namespace, write.key]);
				if (write.op === "delete") values.delete(key);
				else values.set(key, { seq: write.seq, line: JSON.stringify(write) });
			}
		}
	}
	// Like Pi replay, an unterminated final transaction is not committed.
	if (!header) throw new Error("Flow journal is missing its complete header.");
	const temporary = join(dirname(dirname(dirname(path))), `.checkpoint-${randomUUID()}`);
	try {
		const output = await open(temporary, "wx", 0o600);
		try {
			await output.writeFile(
				`${JSON.stringify({ ...header, nextSeq: Math.max(Number(header.nextSeq ?? 1), sequence + 1) })}\n`,
			);
			for (const value of [...values.values()].sort((a, b) => a.seq - b.seq)) await output.writeFile(`${value.line}\n`);
			await output.sync();
		} finally {
			await output.close();
		}
		await rename(temporary, path);
		return (await stat(path)).size;
	} finally {
		await unlink(temporary).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}
