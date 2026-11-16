import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** Built-in tools that create or change a file named by their `path` argument. */
const FILE_WRITING_TOOLS = new Set(["write", "edit"]);

const comparable = (path: string, platform: NodeJS.Platform) =>
	platform === "win32" ? win32.resolve(path).toLowerCase() : posix.resolve(path);

/** Resolve symlinks through the nearest existing ancestor, so a link cannot lead a write into a protected folder. */
function canonical(path: string): string {
	let current = path;
	const rest: string[] = [];
	for (;;) {
		try {
			return rest.length ? join(realpathSync.native(current), ...rest.reverse()) : realpathSync.native(current);
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			rest.push(current.slice(parent.length).replace(/^[\\/]+/, ""));
			current = parent;
		}
	}
}

/** The file a write or edit call names, resolved the way the tool resolves it. */
function targetPath(input: unknown, cwd: string): string | undefined {
	const raw = input && typeof input === "object" ? (input as { path?: unknown }).path : undefined;
	if (typeof raw !== "string" || !raw.trim()) return undefined;
	let path = raw.startsWith("@") ? raw.slice(1) : raw;
	if (path === "~" || path.startsWith("~/") || path.startsWith("~\\")) path = join(homedir(), path.slice(1));
	return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

/**
 * Jouzu's own state and cache folders hold what protects the user from the agent: TextGuard
 * approvals, flow-control journals and holds, and profile state. The agent's file tools may read
 * them but never write them, even when they lie inside the workspace. Shell commands run with the
 * user's own OS access and are not contained here; that needs process-level isolation.
 */
export function createProtectedStateExtension(
	roots: string[],
	platform: NodeJS.Platform = process.platform,
): InlineExtension {
	const protectedRoots = roots.map((root) => comparable(canonical(resolve(root)), platform));
	const separator = platform === "win32" ? "\\" : "/";
	const isProtected = (path: string) => {
		const key = comparable(canonical(path), platform);
		return protectedRoots.some(
			(root) => key === root || key.startsWith(root.endsWith(separator) ? root : root + separator),
		);
	};
	return {
		name: "jouzu-protected-state",
		factory(pi) {
			pi.on("tool_call", (event, ctx) => {
				if (!FILE_WRITING_TOOLS.has(event.toolName)) return;
				const path = targetPath(event.input, ctx.cwd);
				if (path && isProtected(path))
					return {
						block: true,
						reason: "Access denied: Jouzu's state and cache folders are read-only for tools.",
					};
			});
		},
	};
}
