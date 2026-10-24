import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CatalogMessageId, catalogText, defaultCatalog } from "../cli-messages.js";
import type { CatalogBundle } from "../locale-catalog.js";
import type { JouzuPaths } from "../paths.js";
import { deleteShisaLoginCredential, setShisaSignedOut } from "./credentials.js";
import { clearShisaLinkState, readShisaLinkState, shisaLinkStatePath } from "./state.js";

const activeOperations = new Set<string>();

/** Login and logout cannot replace each other's credentials while a remote request is pending. */
export async function withShisaAuthOperation<T>(
	paths: JouzuPaths,
	action: () => Promise<T>,
	catalog: CatalogBundle = defaultCatalog(),
): Promise<T> {
	const root = resolve(paths.agentDir);
	if (activeOperations.has(root)) throw new Error(catalogText(catalog, CatalogMessageId.shisaLogoutBusy));
	activeOperations.add(root);
	try {
		return await action();
	} finally {
		activeOperations.delete(root);
	}
}

export interface ShisaLogoutResult {
	revocation: "confirmed" | "unconfirmed" | "not-linked";
	localCleared: boolean;
}

export function shisaRevocationUrl(gateway: string): string | undefined {
	try {
		const url = new URL(gateway);
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (
			(url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return undefined;
		url.pathname = `${url.pathname.replace(/\/+$/u, "")}/device/link/revoke`;
		return url.href;
	} catch {
		return undefined;
	}
}

export async function logoutShisa(options: {
	paths: JouzuPaths;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** The resolved locale catalog for the busy guard. Defaults to English. */
	catalog?: CatalogBundle;
	/** The Pi menu supplies its native deletion operation so its auth snapshot is refreshed too. */
	clearCredential?: () => Promise<void>;
}): Promise<ShisaLogoutResult> {
	return withShisaAuthOperation(
		options.paths,
		async () => {
			const statePath = shisaLinkStatePath(options.paths);
			const linked = readShisaLinkState(statePath);
			let revocation: ShisaLogoutResult["revocation"] = existsSync(statePath) ? "unconfirmed" : "not-linked";
			// Suppress all Jouzu-owned Shisa auth and stop voice before waiting on the network.
			setShisaSignedOut(options.paths, true);
			const endpoint = linked?.gateway_url ? shisaRevocationUrl(linked.gateway_url) : undefined;
			if (linked && endpoint) {
				try {
					const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
					const response = await (options.fetchImpl ?? fetch)(endpoint, {
						method: "POST",
						headers: { authorization: `Bearer ${linked.link_token}`, accept: "application/json" },
						redirect: "error",
						signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
					});
					if (response.status === 204) revocation = "confirmed";
					await response.body?.cancel();
				} catch {
					// A lost response does not establish whether the server revoked the key.
				}
			}
			let localCleared = true;
			try {
				if (options.clearCredential) await options.clearCredential();
				else deleteShisaLoginCredential(options.paths);
			} catch {
				localCleared = false;
			}
			try {
				clearShisaLinkState(statePath);
			} catch {
				localCleared = false;
			}
			return { revocation, localCleared };
		},
		options.catalog,
	);
}

export function shisaLogoutMessage(
	result: ShisaLogoutResult,
	hasEnvironmentKey: boolean,
	catalog: CatalogBundle = defaultCatalog(),
): string {
	let message = !result.localCleared
		? catalogText(catalog, CatalogMessageId.shisaLogoutCouldNotRemove)
		: result.revocation === "unconfirmed"
			? catalogText(catalog, CatalogMessageId.shisaLogoutSignedOutLocally)
			: catalogText(catalog, CatalogMessageId.shisaLogoutSignedOut);
	if (!result.localCleared && result.revocation === "unconfirmed")
		message += ` ${catalogText(catalog, CatalogMessageId.shisaLogoutServerUnconfirmed)}`;
	return hasEnvironmentKey ? catalogText(catalog, CatalogMessageId.shisaLogoutEnvKeyRemains, { message }) : message;
}
