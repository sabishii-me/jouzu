import { flowDiagnosticText as flowDisplayText } from "./diagnostic-text.js";

export { flowDiagnosticText as flowDisplayText } from "./diagnostic-text.js";

import { nativeProjectionDelivered } from "./native-inclusion.js";
import {
	type NativeRequest,
	type NativeRequestFailure,
	nativeHoldHash,
	nativeHoldPending,
} from "./native-request-store.js";
import type { RetainedSubmission } from "./submission-store.js";
import type { FlowTask } from "./task-producer.js";

export interface FlowInputDescription {
	sender: string;
	summary: string;
	kind: "command" | "message" | "continuation" | "notice" | "context";
	acceptedAt: number;
}
export interface FlowRequestDescription {
	inputIds: string[];
	stage: string;
	provider?: string;
	model?: string;
	hash?: string;
	reason?: "required-input" | "required-context";
	problem?: "input-changed" | "context-changed" | "not-admitted";
	failure?: NativeRequestFailure;
}
export interface FlowStatusContext {
	inputs: Record<string, FlowInputDescription>;
	requests: Record<string, FlowRequestDescription>;
	tasks: FlowTask[];
	recovery?: string[];
	warnings?: string[];
	turnActive?: boolean;
}

function sender(record: RetainedSubmission): string {
	const origin = record.submission.origin;
	if (origin.kind === "host") return "You";
	if (origin.kind === "sdk") return "SDK";
	if (origin.id === "<inline:jouzu>") return "Jouzu";
	const path = origin.id.replaceAll("\\", "/");
	const packagePath = path.split("/node_modules/").at(-1);
	if (packagePath && packagePath !== path) {
		const parts = packagePath.split("/");
		return flowDisplayText(parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0], 64);
	}
	return flowDisplayText(path.split("/").at(-1) ?? "Extension", 64);
}

function textContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.flatMap((part) =>
				part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
			)
			.join(" ");
	return "";
}

export function describeFlowInput(record: RetainedSubmission): FlowInputDescription {
	const { api, args } = record.submission;
	const first = args[0];
	const base = { sender: sender(record), acceptedAt: record.acceptedAt };
	if (api === "sendCustomMessage" && first && typeof first === "object") {
		const message = first as { customType?: string; content?: unknown; display?: boolean };
		if (message.customType === "jouzu-compaction-continue")
			return { ...base, kind: "continuation", summary: "Continue after compaction" };
		if (message.customType === "multiloop-resume")
			return { ...base, kind: "notice", summary: "Resume notice for a detached goal" };
		const content = flowDisplayText(textContent(message.content));
		const type = flowDisplayText(message.customType ?? "Custom message", 64);
		const options = args[1] as { triggerTurn?: boolean } | undefined;
		return {
			...base,
			kind: options?.triggerTurn ? "continuation" : "context",
			summary: content ? `${type}: ${content}` : type,
		};
	}
	const content = textContent(first);
	return {
		...base,
		kind: typeof first === "string" && /^\/\S+/.test(first.trim()) ? "command" : "message",
		summary: flowDisplayText(content) || "Message with non-text content",
	};
}

export function captureFlowStatusContext(
	records: RetainedSubmission[],
	requests: NativeRequest[],
	tasks: FlowTask[] = [],
	recovery: string[] = [],
): FlowStatusContext {
	const inputs = Object.fromEntries(records.map((record) => [record.id, describeFlowInput(record)]));
	const operations = new Map(
		records.flatMap((record) => (record.dispatch ? [[record.dispatch.operationId, record.id] as const] : [])),
	);
	const blocked = requests.filter((request) => nativeHoldPending(request) && !request.retryAuthorization?.requestId);
	return {
		inputs,
		tasks,
		recovery,
		requests: Object.fromEntries(
			blocked.map((request) => {
				const sources =
					request.sourceCapture?.members.filter(
						(source) =>
							request.requiredSources?.includes(source.index) && !request.cancelledSources?.includes(source.index),
					) ?? [];
				const missing = sources.filter((source) => {
					const model = request.sourceCapture?.model?.members.find((item) => item.sourceIndex === source.index);
					return !model || model.status === "changed" || model.status === "unresolved";
				});
				const contextFailure = missing.some((source) => {
					const context = request.sourceCapture?.context?.members.find((item) => item.sourceIndex === source.index);
					return !context || context.status === "changed" || context.status === "unresolved";
				});
				const projectionFailure =
					request.requiredProjections?.some((index) => !nativeProjectionDelivered(request, index)) ?? false;
				const payload = request.withheldPayload ?? request.failure;
				return [
					request.id,
					{
						inputIds: [
							...new Set(
								(missing.length ? missing : sources).flatMap((source) => {
									const id = operations.get(source.operationId);
									return id ? [id] : [];
								}),
							),
						],
						stage: contextFailure
							? "context preparation"
							: missing.length || projectionFailure
								? "model conversion"
								: (request.failure?.stage.replaceAll("-", " ") ?? "request preparation"),
						...(payload ? { provider: payload.provider, model: payload.model } : {}),
						hash: nativeHoldHash(request),
						reason: projectionFailure ? "required-context" : "required-input",
						problem: projectionFailure ? "context-changed" : missing.length ? "input-changed" : "not-admitted",
						...(request.failure ? { failure: structuredClone(request.failure) } : {}),
					} satisfies FlowRequestDescription,
				];
			}),
		),
	};
}
