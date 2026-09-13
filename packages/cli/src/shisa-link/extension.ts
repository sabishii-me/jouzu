import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { JouzuPaths } from "../paths.js";
import { isShisaSignedOut, setShisaSignedOut, writeShisaLoginCredential } from "./credentials.js";
import { loginShisaDeviceFlow, resolveShisaGatewayUrl, type ShisaLoginDeps } from "./device-flow.js";
import { logoutShisa, shisaLogoutMessage, withShisaAuthOperation } from "./logout.js";
import { installShisaLogoutHook } from "./logout-hook.js";
import { newShisaInstallId, readShisaLinkState, shisaLinkStatePath, writeShisaLinkState } from "./state.js";

export const SHISA_PROVIDER_ID = "shisa";

export interface ShisaExtensionOptions {
	paths: JouzuPaths;
	jouzuVersion: string;
	env?: NodeJS.ProcessEnv;
	gatewayUrl?: string;
	/** Test seams forwarded to device login and revocation. */
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	openBrowser?: (url: string) => void;
	logoutTimeoutMs?: number;
}

export function createShisaExtension(options: ShisaExtensionOptions): InlineExtension {
	const env = options.env ?? process.env;
	const gatewayUrl = options.gatewayUrl ?? resolveShisaGatewayUrl(env);
	const statePath = shisaLinkStatePath(options.paths);
	return {
		name: "jouzu-shisa",
		factory: async (pi) => {
			// Load only when Pi instantiates extensions, so offline doctor can still run
			// when the interactive runtime is unavailable.
			const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
			let activeCtx: ExtensionContext | undefined;
			const oauth = {
				name: "Shisa",
				login: (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> =>
					withShisaAuthOperation(options.paths, async () => {
						const existing = readShisaLinkState(statePath);
						const credential = await loginShisaDeviceFlow(callbacks, {
							gatewayUrl,
							clientVersion: options.jouzuVersion,
							installId: existing?.install_id ?? newShisaInstallId(),
							writeLinkState: (state) => writeShisaLinkState(statePath, state, options.paths.stateDir),
							writeCredential: (credential) => writeShisaLoginCredential(options.paths, credential, callbacks.signal),
							...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
							...(options.sleep ? { sleep: options.sleep } : {}),
							...(options.openBrowser ? { openBrowser: options.openBrowser } : {}),
						} satisfies ShisaLoginDeps);
						pi.registerProvider(SHISA_PROVIDER_ID, providerConfig());
						setShisaSignedOut(options.paths, false);
						return credential;
					}),
				async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
					return credentials;
				},
				getApiKey(credentials: OAuthCredentials): string {
					if (isShisaSignedOut(options.paths)) throw new Error("Signed out of Shisa. Run /login shisa to reconnect.");
					return credentials.access;
				},
			};
			const providerConfig = () => ({
				name: "Shisa",
				baseUrl: readShisaLinkState(statePath)?.endpoints.openai_base_url ?? gatewayUrl,
				api: "openai-completions" as const,
				oauth,
			});
			const signOut = async (clearCredential?: () => Promise<void>, signal?: AbortSignal) => {
				const result = await logoutShisa({
					paths: options.paths,
					fetchImpl: options.fetchImpl,
					timeoutMs: options.logoutTimeoutMs,
					clearCredential,
					signal,
				});
				let refreshFailed = false;
				try {
					await activeCtx?.modelRegistry.refresh({ allowNetwork: false });
				} catch {
					refreshFailed = true;
				}
				const message = shisaLogoutMessage(result, Boolean(env.SHISA_API_KEY?.trim()));
				activeCtx?.ui.notify(
					message,
					!result.localCleared ? "error" : result.revocation === "unconfirmed" ? "warning" : "info",
				);
				if (refreshFailed) activeCtx?.ui.notify("Shisa model availability could not refresh. Run /reload.", "warning");
				if (!result.localCleared && clearCredential) throw new Error(message);
			};
			let removeHook: (() => void) | undefined = installShisaLogoutHook(ModelRuntime, oauth, signOut);
			pi.registerProvider(SHISA_PROVIDER_ID, providerConfig());
			pi.registerCommand("logout", {
				description: "Use /logout shisa to disconnect Shisa; /logout opens the provider list",
				getArgumentCompletions: (prefix) => ("shisa".startsWith(prefix) ? [{ value: "shisa", label: "shisa" }] : []),
				handler: async (args, ctx) => {
					if (args.trim() !== "shisa") {
						ctx.ui.notify("Use /logout shisa to disconnect Shisa, or /logout to select another provider.", "info");
						return;
					}
					activeCtx = ctx;
					try {
						await signOut();
					} catch {
						ctx.ui.notify(
							"Shisa sign-out could not complete. Wait for any sign-in or sign-out to finish, then retry /logout shisa.",
							"error",
						);
					}
				},
			});
			pi.on("session_start", (_event, ctx) => {
				activeCtx = ctx;
				removeHook ??= installShisaLogoutHook(ModelRuntime, oauth, signOut);
			});
			pi.on("session_shutdown", () => {
				removeHook?.();
				removeHook = undefined;
				activeCtx = undefined;
			});
		},
	};
}
