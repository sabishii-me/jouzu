import { lstatSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
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

/** Update only Shisa under the auth-file lock used by Pi 0.85.1. */
function updateShisaCredential(paths: Pick<JouzuPaths, "agentDir">, credential?: OAuthCredentials): void {
	ensurePrivateDirectory(paths.agentDir);
	const authPath = join(paths.agentDir, "auth.json");
	// Pi uses proper-lockfile's adjacent .lock directory. A busy lock is never replaced.
	const lockPath = `${authPath}.lock`;
	mkdirSync(lockPath, { mode: 0o700 });
	try {
		const auth = readAuth(authPath);
		if (credential) auth.shisa = credential;
		else {
			if (!Object.hasOwn(auth, "shisa")) return;
			delete auth.shisa;
		}
		writeFilePrivateAtomic(authPath, `${JSON.stringify(auth, null, 2)}\n`, paths.agentDir);
	} finally {
		rmdirSync(lockPath);
	}
}

/** Save before device acknowledgement, preserving other providers. */
export async function writeShisaLoginCredential(
	paths: Pick<JouzuPaths, "agentDir">,
	credential: OAuthCredentials,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	updateShisaCredential(paths, credential);
}

/** Process-local sign-out state. Never changes the caller's environment or saved catalog settings. */
const signedOutRoots = new Set<string>();
const authListeners = new Map<string, Set<() => void>>();
export function isShisaSignedOut(paths: Pick<JouzuPaths, "agentDir">): boolean {
	return signedOutRoots.has(resolve(paths.agentDir));
}
export function setShisaSignedOut(paths: Pick<JouzuPaths, "agentDir">, signedOut: boolean): void {
	const root = resolve(paths.agentDir);
	if (signedOut) signedOutRoots.add(root);
	else signedOutRoots.delete(root);
	for (const listener of authListeners.get(root) ?? []) {
		try {
			listener();
		} catch {
			/* A failed view refresh must not block credential cleanup. */
		}
	}
}
export function onShisaAuthChange(paths: Pick<JouzuPaths, "agentDir">, listener: () => void): () => void {
	const root = resolve(paths.agentDir);
	const listeners = authListeners.get(root) ?? new Set();
	listeners.add(listener);
	authListeners.set(root, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) authListeners.delete(root);
	};
}

/** Remove only Shisa's saved credential, preserving the host's auth-file locking boundary. */
export function deleteShisaLoginCredential(paths: Pick<JouzuPaths, "agentDir">): void {
	updateShisaCredential(paths);
}
