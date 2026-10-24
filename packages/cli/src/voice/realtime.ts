import WebSocket from "ws";
import { CatalogMessageId, catalogMessage } from "../cli-messages.js";
import { voiceError } from "./errors.js";
import { type VoiceSnapshot, VoiceTranscript } from "./transcript.js";

export const VOICE_ENDPOINT = "wss://api.shisa.ai/ws/asr/realtime";
export const MAX_AUDIO_BUFFER_BYTES = 256_000;
export type VoiceLanguage = "auto" | "ja" | "en" | "zh";

export interface VoiceConnection {
	sendAudio(pcm: Buffer): void;
	finish(): Promise<string>;
	cancel(): void;
}

export interface VoiceConnectionOptions {
	apiKey: string;
	language: VoiceLanguage;
	signal: AbortSignal;
	onPreview(text: string): void;
	onSnapshot?(snapshot: VoiceSnapshot): void;
	onError(error: Error): void;
	/** ASR endpoint from the saved Shisa login; defaults to the public Shisa endpoint. */
	endpoint?: string;
	connectTimeoutMs?: number;
	finishTimeoutMs?: number;
}

export function connectVoice(options: VoiceConnectionOptions): Promise<VoiceConnection> {
	return new Promise((resolve, reject) => {
		if (options.signal.aborted) {
			reject(new Error("Voice recording cancelled."));
			return;
		}
		const socket = new WebSocket(options.endpoint ?? VOICE_ENDPOINT, {
			headers: { Authorization: `Bearer ${options.apiKey}` },
			maxPayload: 128_000,
			perMessageDeflate: false,
			handshakeTimeout: options.connectTimeoutMs ?? 10_000,
			followRedirects: false,
		});
		const transcript = new VoiceTranscript();
		let opened = false;
		let terminal = false;
		let finishing: Promise<string> | undefined;
		let finishResolve: ((text: string) => void) | undefined;
		let finishReject: ((error: Error) => void) | undefined;
		let finishTimer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			clearTimeout(finishTimer);
			options.signal.removeEventListener("abort", cancel);
		};
		const fail = (error: Error) => {
			if (terminal) return;
			terminal = true;
			cleanup();
			socket.terminate();
			if (!opened) reject(error);
			else if (finishReject) finishReject(error);
			else options.onError(error);
		};
		const cancel = () => {
			if (terminal) return;
			terminal = true;
			cleanup();
			socket.terminate();
			const error = new Error("Voice recording cancelled.");
			if (!opened) reject(error);
			finishReject?.(error);
		};
		const send = (value: unknown) => {
			if (terminal || socket.readyState !== WebSocket.OPEN) throw new Error("Voice connection is closed.");
			if (socket.bufferedAmount > MAX_AUDIO_BUFFER_BYTES) {
				const error = voiceError(catalogMessage(CatalogMessageId.voiceUploadSlow));
				fail(error);
				throw error;
			}
			socket.send(JSON.stringify(value), (error) => {
				if (error) fail(voiceError(catalogMessage(CatalogMessageId.voiceUploadFailed)));
			});
		};
		options.signal.addEventListener("abort", cancel, { once: true });
		socket.on("unexpected-response", (_request, response) => {
			response.resume();
			const message =
				response.statusCode === 401
					? catalogMessage(CatalogMessageId.voiceAuthFailed)
					: response.statusCode === 403
						? catalogMessage(CatalogMessageId.voiceAccessDenied)
						: catalogMessage(CatalogMessageId.voiceConnectionRejected);
			fail(voiceError(message));
		});
		socket.on("error", () => fail(voiceError(catalogMessage(CatalogMessageId.voiceConnectionFailed))));
		socket.on("message", (data, binary) => {
			if (terminal) return;
			try {
				if (binary) throw new Error("invalid response");
				const event: unknown = JSON.parse(data.toString());
				if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("invalid response");
				const record = event as Record<string, unknown>;
				if (record.type === "error" && !(record.fatal === false && typeof record.utterance_id === "string")) {
					// Never echo remote error bodies: they may contain credentials or terminal controls.
					fail(voiceError(catalogMessage(CatalogMessageId.voiceTranscriptionFailed)));
					return;
				}
				if (options.apiKey && typeof record.text === "string") {
					record.text = record.text.replaceAll(options.apiKey, "[redacted]");
				}
				transcript.accept(record);
				options.onSnapshot?.(transcript.snapshot);
				if (record.type === "asr.partial_result" || record.type === "asr.final_result") {
					options.onPreview(transcript.preview);
				}
			} catch {
				fail(voiceError(catalogMessage(CatalogMessageId.voiceTranscriptInvalid)));
			}
		});
		socket.on("close", (code) => {
			if (terminal) return;
			if (!finishing || code !== 1000) {
				fail(voiceError(catalogMessage(CatalogMessageId.voiceConnectionEnded)));
				return;
			}
			terminal = true;
			cleanup();
			try {
				finishResolve?.(transcript.finish());
			} catch (error) {
				finishReject?.(error as Error);
			}
		});
		socket.once("open", () => {
			if (terminal) return;
			try {
				send({
					type: "session.update",
					session: {
						input_audio_format: "pcm_s16le",
						sample_rate: 16000,
						channels: 1,
						language: options.language,
					},
				});
				opened = true;
				resolve({
					sendAudio(pcm) {
						if (finishing) return;
						if (pcm.length !== 3200) throw new Error("Voice capture returned an invalid audio frame.");
						send({ type: "input_audio.append", audio: pcm.toString("base64") });
					},
					finish() {
						if (finishing) return finishing;
						transcript.beginFinish();
						options.onSnapshot?.(transcript.snapshot);
						finishing = new Promise<string>((done, failed) => {
							finishResolve = done;
							finishReject = failed;
							finishTimer = setTimeout(
								() => fail(new Error("Voice finalization timed out. Try a shorter recording.")),
								options.finishTimeoutMs ?? 30_000,
							);
							try {
								send({ type: "session.close" });
							} catch (error) {
								failed(error);
								cleanup();
							}
						});
						return finishing;
					},
					cancel,
				});
			} catch {
				fail(voiceError(catalogMessage(CatalogMessageId.voiceConnectionStartFailed)));
			}
		});
	});
}
