import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { type KeyId, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CatalogMessageId, catalogMessageText, catalogText, defaultCatalog } from "../cli-messages.js";
import { createJouzuKeybindingsManager, effectiveJouzuKeys, isPrintableKeyId } from "../jouzu-keybindings.js";
import type { CatalogBundle } from "../locale-catalog.js";
import type { JouzuPaths } from "../paths.js";
import { isShisaSignedOut, onShisaAuthChange, readShisaLoginToken } from "../shisa-link/credentials.js";
import { readShisaLinkState, shisaLinkStatePath } from "../shisa-link/state.js";
import { fitTerminalText, sanitizeTerminalText } from "../terminal-layout.js";
import type { CaptureOptions, VoiceCapture } from "./capture.js";
import { VoiceError } from "./errors.js";
import type { VoiceConnection, VoiceConnectionOptions, VoiceLanguage } from "./realtime.js";
import { VoiceReviewRequired, type VoiceSegmentState, type VoiceSnapshot } from "./transcript.js";

export type VoiceState = "starting" | "recording" | "finishing";
export interface VoiceDependencies {
	connect(options: VoiceConnectionOptions): Promise<VoiceConnection>;
	capture(options: CaptureOptions): Promise<VoiceCapture>;
	devices(signal: AbortSignal): Promise<string[]>;
	env: NodeJS.ProcessEnv;
	maxRecordingMs: number;
}

const defaults: VoiceDependencies = {
	connect: async (options) => (await import("./realtime.js")).connectVoice(options),
	capture: async (options) => (await import("./capture.js")).startVoiceCapture(options),
	devices: async (signal) => (await import("./capture.js")).listVoiceDevices(signal),
	env: process.env,
	maxRecordingMs: 10 * 60_000,
};

/** The catalog ID of each segment state's display word; the state value itself is internal. */
const SEGMENT_LABEL_IDS: Readonly<Record<VoiceSegmentState, CatalogMessageId>> = {
	final: CatalogMessageId.voiceSegmentFinal,
	pending: CatalogMessageId.voiceSegmentPending,
	live: CatalogMessageId.voiceSegmentLive,
	failed: CatalogMessageId.voiceSegmentFailed,
};

export function renderVoiceWidget(
	state: VoiceState,
	preview: string,
	width: number,
	snapshot?: VoiceSnapshot,
	catalog: CatalogBundle = defaultCatalog(),
): string[] {
	if (width < 12) return [fitTerminalText(catalogText(catalog, CatalogMessageId.voiceLabel), width)];
	const status =
		state === "starting"
			? CatalogMessageId.voiceStateConnecting
			: state === "recording"
				? CatalogMessageId.voiceStateRecording
				: CatalogMessageId.voiceStateFinishing;
	const hint = state === "recording" ? CatalogMessageId.voiceHintRecording : CatalogMessageId.voiceHintIdle;
	return [
		...wrapTextWithAnsi(catalogText(catalog, status), width),
		...wrapTextWithAnsi(catalogText(catalog, hint), width),
		...(snapshot?.segments.length
			? [
					...wrapTextWithAnsi(
						catalogText(catalog, CatalogMessageId.voiceSegmentProgress, {
							finalized: snapshot.segments.filter((segment) => segment.state === "final").length,
							pending: snapshot.segments.filter((segment) => segment.state === "pending").length,
							failed: snapshot.segments.filter((segment) => segment.state === "failed").length,
						}),
						width,
					),
					...(snapshot.segments.length > 6
						? [
								fitTerminalText(
									catalogText(catalog, CatalogMessageId.voiceSegmentRetained, {
										count: snapshot.segments.length - 6,
									}),
									width,
								),
							]
						: []),
					...snapshot.segments
						.slice(-6)
						.map((segment, index) =>
							fitTerminalText(
								`${catalogText(catalog, SEGMENT_LABEL_IDS[segment.state])} ${Math.max(0, snapshot.segments.length - 6) + index + 1}: ${sanitizeTerminalText(segment.text) || "…"}`,
								width,
							),
						),
				]
			: preview
				? [fitTerminalText(sanitizeTerminalText(preview).slice(-240), width)]
				: []),
	];
}

export interface VoiceExtensionOptions extends Partial<VoiceDependencies> {
	/** The resolved catalog the voice surface renders its text from. */
	catalog?: CatalogBundle;
}

export function createVoiceExtension(paths: JouzuPaths, options: VoiceExtensionOptions = {}): InlineExtension {
	const { catalog: resolvedCatalog, ...overrides } = options;
	const deps: VoiceDependencies = { ...defaults, ...overrides };
	// A caller without a resolved catalog (a unit test, for example) renders from
	// the English bundle rather than resolving the locale again.
	const catalog = resolvedCatalog ?? defaultCatalog();
	return {
		name: "jouzu-voice",
		factory(pi) {
			let device = -1;
			let language: VoiceLanguage = "auto";
			let deviceQuery: AbortController | undefined;
			type ActiveRecording = {
				controller: AbortController;
				ctx: ExtensionContext;
				state: VoiceState;
				preview: string;
				snapshot?: VoiceSnapshot;
				connection?: VoiceConnection;
				capture?: VoiceCapture;
				timer?: ReturnType<typeof setTimeout>;
			};
			let run: ActiveRecording | undefined;

			const cancel = () => {
				const old = run;
				run = undefined;
				if (!old) return;
				clearTimeout(old.timer);
				old.controller.abort();
				old.capture?.cancel();
				old.connection?.cancel();
				old.ctx.ui.setWidget("jouzu-voice", undefined);
				old.ctx.ui.setStatus("jouzu-voice", undefined);
			};
			const refresh = () => {
				if (!run) return;
				const active = run;
				active.ctx.ui.setStatus(
					"jouzu-voice",
					catalogText(catalog, CatalogMessageId.voiceStatus, { state: active.state }),
				);
				active.ctx.ui.setWidget("jouzu-voice", () => ({
					render: (width) => renderVoiceWidget(active.state, active.preview, width, active.snapshot, catalog),
					invalidate() {},
				}));
			};
			const insertIncomplete = (active: ActiveRecording, snapshot: VoiceSnapshot) => {
				const chunks = snapshot.segments.map((segment) => (segment.state === "final" ? segment.text : "[garbled]"));
				// A disconnected tail may have no segment in the last snapshot.
				if (!snapshot.segments.some((segment) => segment.state !== "final")) chunks.push("[garbled]");
				const text = chunks.filter(Boolean).join("\n");
				cancel();
				active.ctx.ui.pasteToEditor(`${active.ctx.ui.getEditorText() ? "\n" : ""}${text}`);
				active.ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceInsertedGarbled), "warning");
			};
			const stop = async () => {
				const active = run;
				if (!active) return;
				if (active.state !== "recording") {
					active.ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceStillFinishing), "info");
					return;
				}
				active.state = "finishing";
				clearTimeout(active.timer);
				refresh();
				try {
					await active.capture?.stop();
					if (run !== active) return;
					const text = await active.connection?.finish();
					if (run !== active) return;
					cancel();
					if (text) {
						// Read the live draft only at insertion time; never restore a stale snapshot.
						active.ctx.ui.pasteToEditor(`${active.ctx.ui.getEditorText() ? "\n" : ""}${text}`);
						active.ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceInserted), "info");
					} else active.ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceNoSpeech), "info");
				} catch (error) {
					if (run !== active) return;
					if (error instanceof VoiceReviewRequired) {
						insertIncomplete(active, error.snapshot);
						return;
					}
					if (active.snapshot?.segments.length) {
						insertIncomplete(active, active.snapshot);
						return;
					}
					cancel();
					active.ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceFinishFailed), "error");
				}
			};
			const start = async (ctx: ExtensionContext) => {
				if (run || deviceQuery) {
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceAlreadyActive), "info");
					return;
				}
				if (isShisaSignedOut(paths)) {
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceSignedOut), "error");
					return;
				}
				const envKey = deps.env.SHISA_API_KEY?.trim();
				const apiKey = envKey || readShisaLoginToken(paths);
				if (!apiKey) {
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceRequiresLogin), "error");
					return;
				}
				// An explicit environment key uses the public endpoint, independently of
				// a saved login's account or staging endpoint.
				const endpoint = envKey ? undefined : readShisaLinkState(shisaLinkStatePath(paths))?.endpoints.asr_realtime_url;
				if (endpoint) {
					try {
						const url = new URL(endpoint);
						const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
						if (
							(url.protocol !== "wss:" && !(url.protocol === "ws:" && local)) ||
							url.username ||
							url.password ||
							url.hash
						) {
							throw new Error("Invalid voice endpoint");
						}
					} catch {
						ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceEndpointInvalid), "error");
						return;
					}
				}
				const active: ActiveRecording = { controller: new AbortController(), ctx, state: "starting", preview: "" };
				run = active;
				refresh();
				const onError = (error: Error) => {
					if (run !== active) return;
					if (active.snapshot?.segments.length) {
						insertIncomplete(active, active.snapshot);
						return;
					}
					cancel();
					// Only our capture/transport diagnostics reach this callback, never raw remote/native errors.
					ctx.ui.notify(
						error instanceof VoiceError
							? error.catalogMessage
								? catalogMessageText(catalog, error.catalogMessage)
								: error.message
							: catalogText(catalog, CatalogMessageId.voiceStartFailed),
						"error",
					);
				};
				try {
					active.connection = await deps.connect({
						apiKey,
						...(endpoint ? { endpoint } : {}),
						language,
						signal: active.controller.signal,
						onPreview(text) {
							if (run === active) {
								active.preview = text;
								refresh();
							}
						},
						onSnapshot(snapshot) {
							if (run === active) {
								active.snapshot = snapshot;
								refresh();
							}
						},
						onError,
					});
					if (run !== active) {
						active.connection.cancel();
						return;
					}
					active.capture = await deps.capture({
						device,
						signal: active.controller.signal,
						onAudio(pcm) {
							if (run === active) active.connection?.sendAudio(pcm);
						},
						onError,
					});
					if (run !== active) {
						active.capture.cancel();
						return;
					}
					active.state = "recording";
					active.timer = setTimeout(() => {
						void stop();
					}, deps.maxRecordingMs);
					refresh();
				} catch (error) {
					if (run !== active) return;
					onError(error instanceof Error ? error : new Error(catalogText(catalog, CatalogMessageId.voiceStartFailed)));
				}
			};
			const command = async (args: string, ctx: ExtensionContext) => {
				if (ctx.mode !== "tui" || deps.env.TERM === "dumb") {
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceNonInteractive), "error");
					return;
				}
				const action = args.trim();
				if (action === "cancel") {
					deviceQuery?.abort();
					deviceQuery = undefined;
					cancel();
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceCancelled), "info");
				} else if (action === "stop" || (!action && run)) {
					await stop();
				} else if (!action || action === "start") {
					await start(ctx);
				} else if (action === "devices") {
					if (run || deviceQuery) {
						ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceDevicesBusy), "info");
						return;
					}
					const controller = new AbortController();
					deviceQuery = controller;
					try {
						const devices = await deps.devices(controller.signal);
						if (controller.signal.aborted) return;
						const labels = [
							catalogText(catalog, CatalogMessageId.voiceDevicesDefault),
							...devices.map((name, i) => `${i}: ${sanitizeTerminalText(name)}`),
						];
						const choice = await ctx.ui.select(catalogText(catalog, CatalogMessageId.voiceDevicesTitle), labels, {
							signal: controller.signal,
						});
						if (!controller.signal.aborted && choice !== undefined) device = labels.indexOf(choice) - 1;
					} catch {
						if (!controller.signal.aborted)
							ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceDevicesFailed), "error");
					} finally {
						if (deviceQuery === controller) deviceQuery = undefined;
					}
				} else if (/^language (auto|ja|en|zh)$/.test(action)) {
					if (run) {
						ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceLanguageBusy), "info");
						return;
					}
					language = action.slice(9) as VoiceLanguage;
					ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceLanguageSet, { language }), "info");
				} else ctx.ui.notify(catalogText(catalog, CatalogMessageId.voiceUsage), "info");
			};
			pi.registerCommand("voice", {
				description: catalogText(catalog, CatalogMessageId.voiceCommandDescription),
				getArgumentCompletions: (prefix) =>
					["start", "stop", "cancel", "devices", "language auto", "language ja", "language en", "language zh"]
						.filter((value) => value.startsWith(prefix))
						.map((value) => ({ value, label: value })),
				handler: command,
			});
			const keybindings = createJouzuKeybindingsManager(paths);
			for (const key of effectiveJouzuKeys(keybindings, "jouzu.voice.toggle")) {
				// Bare keys remain editor input; only modified keys become shortcuts.
				if (!isPrintableKeyId(key))
					pi.registerShortcut(key as KeyId, {
						description: catalogText(catalog, CatalogMessageId.voiceShortcutDescription),
						handler: (ctx) => command("", ctx),
					});
			}
			const onAuthChange = () => {
				if (isShisaSignedOut(paths)) {
					deviceQuery?.abort();
					deviceQuery = undefined;
					cancel();
				}
			};
			let removeAuthListener: (() => void) | undefined = onShisaAuthChange(paths, onAuthChange);
			pi.on("session_start", () => {
				removeAuthListener ??= onShisaAuthChange(paths, onAuthChange);
			});
			pi.on("session_shutdown", () => {
				removeAuthListener?.();
				removeAuthListener = undefined;
				deviceQuery?.abort();
				deviceQuery = undefined;
				cancel();
			});
		},
	};
}
