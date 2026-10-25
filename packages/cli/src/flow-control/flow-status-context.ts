import { catalogText, defaultCatalog } from "../cli-messages.js";
import type { CatalogBundle } from "../locale-catalog.js";
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

/**
 * The catalog IDs for the flow-status surface. They are local to this module
 * rather than added to the shared `CatalogMessageId` table, so a parallel
 * migration of another surface does not conflict on that file;
 * `scripts/check-locales.mjs` allows a catalog-only ID present in both locales.
 */
export const FlowStatusMessageId = {
	stageContextPreparation: "jouzu.cli.flow.stage.contextPreparation",
	stageModelConversion: "jouzu.cli.flow.stage.modelConversion",
	stageRequestPreparation: "jouzu.cli.flow.status.stageRequestPreparation",
	inputContinueAfterCompaction: "jouzu.cli.flow.input.continueAfterCompaction",
	inputMultiloopResume: "jouzu.cli.flow.input.multiloopResume",
	senderExtension: "jouzu.cli.flow.status.senderExtension",
	customMessage: "jouzu.cli.flow.status.customMessage",
	messageWithNonTextContent: "jouzu.cli.flow.status.messageWithNonTextContent",
	blockedOneRequest: "jouzu.cli.flow.status.blockedOneRequest",
	blockedManyRequests: "jouzu.cli.flow.status.blockedManyRequests",
	requestsNotSentHeading: "jouzu.cli.flow.status.requestsNotSentHeading",
	correctCauseThenClear: "jouzu.cli.flow.status.correctCauseThenClear",
	automationAlsoPaused: "jouzu.cli.flow.status.automationAlsoPaused",
	inputLine: "jouzu.cli.flow.status.inputLine",
	moreRequiredInputs: "jouzu.cli.flow.status.moreRequiredInputs",
	requiredContextUnlinked: "jouzu.cli.flow.status.requiredContextUnlinked",
	reasonLine: "jouzu.cli.flow.status.reasonLine",
	failureLine: "jouzu.cli.flow.status.failureLine",
	destinationLine: "jouzu.cli.flow.status.destinationLine",
	providerFallback: "jouzu.cli.flow.status.providerFallback",
	modelFallback: "jouzu.cli.flow.status.modelFallback",
	requestLine: "jouzu.cli.flow.status.requestLine",
	retryAfterCorrection: "jouzu.cli.flow.status.retryAfterCorrection",
	resetPreservesRecords: "jouzu.cli.flow.status.resetPreservesRecords",
	blockedRecoveryDecision: "jouzu.cli.flow.status.blockedRecoveryDecision",
	turnInProgress: "jouzu.cli.flow.status.turnInProgress",
	furtherAutomationPaused: "jouzu.cli.flow.status.furtherAutomationPaused",
	pausedLine: "jouzu.cli.flow.status.pausedLine",
	resumeAutomation: "jouzu.cli.flow.status.resumeAutomation",
	otherRecoveryBlockersHeading: "jouzu.cli.flow.status.otherRecoveryBlockersHeading",
	statusIncompleteHeading: "jouzu.cli.flow.status.statusIncompleteHeading",
	unreadableState: "jouzu.cli.flow.status.unreadableState",
	sentOutcomeUnknownHeading: "jouzu.cli.flow.status.sentOutcomeUnknownHeading",
	sendAgain: "jouzu.cli.flow.status.sendAgain",
	doNotResend: "jouzu.cli.flow.status.doNotResend",
	waitingOnJobsHeading: "jouzu.cli.flow.status.waitingOnJobsHeading",
	waitingForDependency: "jouzu.cli.flow.status.waitingForDependency",
	moreJobDependencies: "jouzu.cli.flow.status.moreJobDependencies",
	cancelWaitOnly: "jouzu.cli.flow.status.cancelWaitOnly",
	undeliveredInputHeading: "jouzu.cli.flow.status.undeliveredInputHeading",
	workEligibilityHeading: "jouzu.cli.flow.status.workEligibilityHeading",
	workLine: "jouzu.cli.flow.status.workLine",
	pauseLine: "jouzu.cli.flow.status.pauseLine",
	stopLine: "jouzu.cli.flow.status.stopLine",
	notAttachedHeading: "jouzu.cli.flow.status.notAttachedHeading",
	nothingHeld: "jouzu.cli.flow.status.nothingHeld",
	fullIdentifiers: "jouzu.cli.flow.status.fullIdentifiers",
	moreEntries: "jouzu.cli.flow.status.moreEntries",
	previousEntries: "jouzu.cli.flow.status.previousEntries",
	requestEndedDuring: "jouzu.cli.flow.status.requestEndedDuring",
	requestEndedBeforeAdmission: "jouzu.cli.flow.status.requestEndedBeforeAdmission",
	requiredInputRemovedBeforeSending: "jouzu.cli.flow.status.requiredInputRemovedBeforeSending",
	requiredContextRemovedBeforeSending: "jouzu.cli.flow.status.requiredContextRemovedBeforeSending",
	requiredInputRemovedDuring: "jouzu.cli.flow.status.requiredInputRemovedDuring",
	requiredContextRemovedDuring: "jouzu.cli.flow.status.requiredContextRemovedDuring",
	commandNotRun: "jouzu.cli.flow.status.commandNotRun",
	extensionNoticeNotDelivered: "jouzu.cli.flow.status.extensionNoticeNotDelivered",
	notQueuedForReplay: "jouzu.cli.flow.status.notQueuedForReplay",
	savedStateBlocksInput: "jouzu.cli.flow.status.savedStateBlocksInput",
	waitingForRequestBlock: "jouzu.cli.flow.status.waitingForRequestBlock",
	heldBehindBlocker: "jouzu.cli.flow.status.heldBehindBlocker",
	heldInput: "jouzu.cli.flow.status.heldInput",
	inputDetailsUnavailable: "jouzu.cli.flow.status.inputDetailsUnavailable",
	taskDetailsUnavailable: "jouzu.cli.flow.status.taskDetailsUnavailable",
	titleUnavailable: "jouzu.cli.flow.status.titleUnavailable",
	taskLabel: "jouzu.cli.flow.status.taskLabel",
	workFallback: "jouzu.cli.flow.status.workFallback",
	showingEntries: "jouzu.cli.flow.status.showingEntries",
	noEntriesOnPage: "jouzu.cli.flow.status.noEntriesOnPage",
	waitUnmetDeadline: "jouzu.cli.flow.status.waitUnmetDeadline",
	waitUnmetPastDeadline: "jouzu.cli.flow.status.waitUnmetPastDeadline",
	ageJustNow: "jouzu.cli.flow.status.ageJustNow",
	ageMinutes: "jouzu.cli.flow.status.ageMinutes",
	ageHoursMinutes: "jouzu.cli.flow.status.ageHoursMinutes",
	eligibleForAutomation: "jouzu.cli.flow.status.eligibleForAutomation",
	eligibleForAutomationWithStatus: "jouzu.cli.flow.status.eligibleForAutomationWithStatus",
	taskCompleted: "jouzu.cli.flow.status.taskCompleted",
	taskState: "jouzu.cli.flow.status.taskState",
	taskDetailsChanged: "jouzu.cli.flow.status.taskDetailsChanged",
	liveWaitOne: "jouzu.cli.flow.status.liveWaitOne",
	liveWaitMany: "jouzu.cli.flow.status.liveWaitMany",
	noLiveWait: "jouzu.cli.flow.status.noLiveWait",
	deadlineExpiresIn: "jouzu.cli.flow.status.deadlineExpiresIn",
	deadlinePast: "jouzu.cli.flow.status.deadlinePast",
	repairCauseClear: "jouzu.cli.flow.status.repairCauseClear",
	resumeNow: "jouzu.cli.flow.status.resumeNow",
	durationUnderMinute: "jouzu.cli.flow.status.durationUnderMinute",
	durationMinutes: "jouzu.cli.flow.status.durationMinutes",
	durationHours: "jouzu.cli.flow.status.durationHours",
	durationHoursMinutes: "jouzu.cli.flow.status.durationHoursMinutes",
	pauseAfterInterrupt: "jouzu.cli.flow.notice.pauseAfterInterrupt",
	pauseAfterAdmissionFailure: "jouzu.cli.flow.notice.pauseAfterAdmissionFailure",
	pausedAfterReopen: "jouzu.cli.flow.notice.pausedAfterReopen",
	flowOffHeadline: "jouzu.cli.flow.notice.flowOffHeadline",
	flowOnHeadline: "jouzu.cli.flow.notice.flowOnHeadline",
	flowResetHeadline: "jouzu.cli.flow.notice.flowResetHeadline",
	flowOffTail: "jouzu.cli.flow.notice.flowOffTail",
	flowOnTail: "jouzu.cli.flow.notice.flowOnTail",
	withheldRequestNeedsClear: "jouzu.cli.flow.notice.withheldRequestNeedsClear",
	flowOffCommandUnavailable: "jouzu.cli.flow.notice.flowOffCommandUnavailable",
	alreadyPaused: "jouzu.cli.flow.notice.alreadyPaused",
	pausedEveryTurn: "jouzu.cli.flow.notice.pausedEveryTurn",
	resolvedSpent: "jouzu.cli.flow.notice.resolvedSpent",
	resolvedUndelivered: "jouzu.cli.flow.notice.resolvedUndelivered",
	stoppedWork: "jouzu.cli.flow.notice.stoppedWork",
	pausedWork: "jouzu.cli.flow.notice.pausedWork",
	resumedWork: "jouzu.cli.flow.notice.resumedWork",
	flowClearReleasedOne: "jouzu.cli.flow.notice.flowClearReleasedOne",
	flowClearReleasedMany: "jouzu.cli.flow.notice.flowClearReleasedMany",
	flowClearReleasedOneReservation: "jouzu.cli.flow.notice.flowClearReleasedOneReservation",
	flowClearReleasedManyReservation: "jouzu.cli.flow.notice.flowClearReleasedManyReservation",
} as const;

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

function sender(record: RetainedSubmission, catalog: CatalogBundle = defaultCatalog()): string {
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
	return flowDisplayText(path.split("/").at(-1) ?? catalogText(catalog, FlowStatusMessageId.senderExtension), 64);
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

export function describeFlowInput(
	record: RetainedSubmission,
	catalog: CatalogBundle = defaultCatalog(),
): FlowInputDescription {
	const { api, args } = record.submission;
	const first = args[0];
	const base = { sender: sender(record, catalog), acceptedAt: record.acceptedAt };
	if (api === "sendCustomMessage" && first && typeof first === "object") {
		const message = first as { customType?: string; content?: unknown; display?: boolean };
		if (message.customType === "jouzu-compaction-continue")
			return {
				...base,
				kind: "continuation",
				summary: catalogText(catalog, FlowStatusMessageId.inputContinueAfterCompaction),
			};
		if (message.customType === "multiloop-resume")
			return {
				...base,
				kind: "notice",
				summary: catalogText(catalog, FlowStatusMessageId.inputMultiloopResume),
			};
		const content = flowDisplayText(textContent(message.content));
		const type = flowDisplayText(message.customType ?? catalogText(catalog, FlowStatusMessageId.customMessage), 64);
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
		summary: flowDisplayText(content) || catalogText(catalog, FlowStatusMessageId.messageWithNonTextContent),
	};
}

export function captureFlowStatusContext(
	records: RetainedSubmission[],
	requests: NativeRequest[],
	tasks: FlowTask[] = [],
	recovery: string[] = [],
	catalog: CatalogBundle = defaultCatalog(),
): FlowStatusContext {
	const inputs = Object.fromEntries(records.map((record) => [record.id, describeFlowInput(record, catalog)]));
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
							? catalogText(catalog, FlowStatusMessageId.stageContextPreparation)
							: missing.length || projectionFailure
								? catalogText(catalog, FlowStatusMessageId.stageModelConversion)
								: (request.failure?.stage.replaceAll("-", " ") ??
									catalogText(catalog, FlowStatusMessageId.stageRequestPreparation)),
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
