import { lstatSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import { parseStrictJson } from "../model-catalog.js";
import type { JouzuPaths } from "../paths.js";
import { ensurePrivateDirectory, writeFilePrivateAtomic } from "../private-fs.js";

const AUTH_MAX_BYTES = 1024 * 1024;

function readAuth(path: string): Record<string, unknown> {
	let metadata: ReturnType<typeof lstatSync>;
	try {
		metadata = lstatSync(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
		throw error;
	}
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > AUTH_MAX_BYTES) {
		throw new Error("Shisa credentials require a regular auth file smaller than 1 MiB.");
	}
	const auth = parseStrictJson(readFileSync(path, "utf8").replace(/^\uFEFF/u, ""));
	if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error("Invalid auth file.");
	return auth as Record<string, unknown>;
}

/** Read a literal login token without loading Pi or resolving commands from auth.json. */
export function readShisaLoginToken(paths: Pick<JouzuPaths, "agentDir">): string | undefined {
	try {
		const value = readAuth(join(paths.agentDir, "auth.json")).shisa;
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const credential = value as Record<string, unknown>;
		if (
			credential.type !== "oauth" ||
			typeof credential.access !== "string" ||
			typeof credential.expires !== "number" ||
			credential.expires <= Date.now()
		)
			return undefined;
		const token = credential.access.trim();
		if (!token || Buffer.byteLength(token, "utf8") > 8192 || /\p{Cc}/u.test(token)) return undefined;
		return token;
	} catch {
		return undefined;
	}
}

/** Save before device acknowledgement, preserving other providers under Pi's auth-file lock. */
export async function writeShisaLoginCredential(
	paths: Pick<JouzuPaths, "agentDir">,
	credential: OAuthCredentials,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	ensurePrivateDirectory(paths.agentDir);
	const authPath = join(paths.agentDir, "auth.json");
	// Pi 0.85.1 uses proper-lockfile's adjacent .lock directory. Fail on a busy
	// lock; never replace it or acknowledge before an exclusive write succeeds.
	const lockPath = `${authPath}.lock`;
	mkdirSync(lockPath, { mode: 0o700 });
	try {
		const auth = readAuth(authPath);
		auth.shisa = credential;
		writeFilePrivateAtomic(authPath, `${JSON.stringify(auth, null, 2)}\n`, paths.agentDir);
	} finally {
		rmdirSync(lockPath);
	}
}
