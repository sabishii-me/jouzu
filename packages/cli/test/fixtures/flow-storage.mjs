import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createJournalSession, openJournalSession } from "../../dist/flow-control/journal-storage.js";
import { BACKGROUND_CONTEXT, createMemorySession } from "../../dist/flow-control/scalar-storage.js";

export { BACKGROUND_CONTEXT, deleteValue, setValue, value } from "../../dist/flow-control/scalar-storage.js";

// Test-only factories keep storage setup out of the receipt assertions.
export class MemorySessionRepo {
	closed = false;
	async create(options = {}) {
		if (this.closed) throw new Error("Test storage factory is closed.");
		return createMemorySession({
			id: options.id ?? randomUUID(),
			cwd: options.cwd ?? process.cwd(),
			createdAt: Date.now(),
		});
	}
	async close() {
		this.closed = true;
	}
}

export class NodeExecutionEnv {
	constructor({ cwd }) {
		this.cwd = cwd;
	}
	async appendFile(path, text) {
		await appendFile(path, text, "utf8");
	}
}

export class JsonlSessionRepo {
	closed = false;
	constructor({ fileSystem, sessionsRoot }) {
		this.fileSystem = fileSystem;
		this.root = sessionsRoot;
	}
	options() {
		return { append: (path, text) => this.fileSystem.appendFile(path, text, BACKGROUND_CONTEXT) };
	}
	async create(options = {}) {
		if (this.closed) throw new Error("Test storage factory is closed.");
		const directory = join(this.root, "flow");
		await mkdir(directory, { recursive: true });
		return createJournalSession(
			join(directory, `${randomUUID()}.jsonl`),
			{ id: options.id ?? "flow", cwd: options.cwd ?? this.fileSystem.cwd, createdAt: Date.now() },
			this.options(),
		);
	}
	async open(metadata) {
		if (this.closed) throw new Error("Test storage factory is closed.");
		return openJournalSession(metadata.path, this.options());
	}
	async close() {
		// Sessions own their lifetime; this factory has no file handles.
		this.closed = true;
	}
}
