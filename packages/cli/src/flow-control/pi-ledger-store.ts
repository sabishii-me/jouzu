import {
	BACKGROUND_CONTEXT,
	deleteValue,
	type Session,
	type SessionReader,
	setValue,
	value,
	type Write,
} from "@earendil-works/pi-agent-core";
import { emptyRetiredAttempts } from "./attempt-retention.js";
import {
	type FlowAttempt,
	FlowLedgerError,
	type FlowLedgerState,
	type FlowLedgerStore,
	type FlowRequest,
} from "./receipt-ledger.js";
import { indexRetiredAttempts, projectRetiredAttempts } from "./retired-attempt-index.js";

type Header = Omit<FlowLedgerState, "attempts"> & { attemptIds: string[]; retirementEpoch?: number };
const headerAddress = value<Header>("jouzu.flow.receipts", "v1");
const attemptAddress = (id: string) => value<FlowAttempt>("jouzu.flow.attempt", id);
const attemptHistoryAddress = (epoch: number, id: string) =>
	value<FlowAttempt>("jouzu.flow.attempt-history", JSON.stringify([epoch, id]));
const requestHistoryAddress = (id: string) =>
	value<{ attemptId: string; request: FlowRequest }>("jouzu.flow.request-history", id);

async function read(reader: SessionReader): Promise<FlowLedgerState | undefined> {
	const header = (await reader.getValue(headerAddress, BACKGROUND_CONTEXT))?.value;
	if (!header) return undefined;
	if (
		!Array.isArray(header.attemptIds) ||
		header.attemptIds.length > 1024 ||
		new Set(header.attemptIds).size !== header.attemptIds.length
	)
		throw new FlowLedgerError("schema", "Invalid flow receipt manifest.");
	const { attemptIds, retirementEpoch = 0, ...state } = header;
	if (!Number.isSafeInteger(retirementEpoch) || retirementEpoch < 0)
		throw new FlowLedgerError("schema", "Invalid flow retirement generation.");
	const attempts = await Promise.all(
		attemptIds.map(async (id) => {
			if (typeof id !== "string" || id.length < 1 || id.length > 512)
				throw new FlowLedgerError("schema", "Invalid flow receipt identity.");
			const attempt = (await reader.getValue(attemptAddress(id), BACKGROUND_CONTEXT))?.value;
			if (!attempt || attempt.id !== id)
				throw new FlowLedgerError("schema", "Flow receipt manifest has missing membership.");
			return attempt;
		}),
	);
	return structuredClone({ ...state, attempts });
}

/** The caller owns the writable Pi Session and its process lock for this adapter's lifetime. */
export function createPiLedgerStore(
	session: Session,
): FlowLedgerStore & Required<Pick<FlowLedgerStore, "archivesRequests" | "retired">> {
	return {
		archivesRequests: true,
		read: () => session.mutate((mutation) => read(mutation), BACKGROUND_CONTEXT),
		retired: (query) =>
			session.mutate(async (mutation) => {
				const header = (await mutation.getValue(headerAddress, BACKGROUND_CONTEXT))?.value;
				return projectRetiredAttempts(mutation, header?.retirementEpoch ?? 0, query, header?.retiredAttempts);
			}, BACKGROUND_CONTEXT),
		transact(update) {
			return session.mutate(async (mutation, context) => {
				const previous = await read(mutation);
				const { state, result } = update(structuredClone(previous));
				const { attempts, ...header } = state;
				const priorHeader = (await mutation.getValue(headerAddress, context))?.value;
				const retirementEpoch =
					(priorHeader?.retirementEpoch ?? 0) +
					(!state.retiredAttempts && (previous?.retiredAttempts || (previous?.attempts.length && !attempts.length))
						? 1
						: 0);
				if (!Number.isSafeInteger(retirementEpoch))
					throw new FlowLedgerError("capacity", "Flow retirement generation exceeds safe integer range.");
				const writes: Write[] = state.retiredAttempts
					? await indexRetiredAttempts(mutation, retirementEpoch, state.retiredAttempts)
					: [];
				writes.push(
					setValue(headerAddress, {
						...header,
						retiredAttempts: state.retiredAttempts
							? { ...emptyRetiredAttempts(), round: state.retiredAttempts.round }
							: undefined,
						retirementEpoch,
						attemptIds: attempts.map((attempt) => attempt.id),
					}),
				);
				const prior = new Map(previous?.attempts.map((attempt) => [attempt.id, attempt]));
				const previousRequests = new Set(
					previous?.attempts.flatMap((attempt) => attempt.requests.map((request) => request.id)),
				);
				const retainedRequests = new Set(attempts.flatMap((attempt) => attempt.requests.map((request) => request.id)));
				// Archived requests fence duplicate identities without growing the operational snapshot.
				for (const id of retainedRequests) {
					if (!previousRequests.has(id) && (await mutation.getValue(requestHistoryAddress(id), context)))
						throw new FlowLedgerError("identity", "Request ID was already used.");
				}
				// The archive and compact summary share one commit, including migration on attachment.
				for (const attempt of previous?.attempts ?? []) {
					for (const request of attempt.requests) {
						if (!retainedRequests.has(request.id))
							writes.push(setValue(requestHistoryAddress(request.id), { attemptId: attempt.id, request }));
					}
				}
				for (const attempt of attempts) {
					if (
						!prior.has(attempt.id) &&
						(await mutation.getValue(attemptHistoryAddress(retirementEpoch, attempt.id), context))
					)
						throw new FlowLedgerError("identity", "Flow attempt ID was already used.");
					if (JSON.stringify(prior.get(attempt.id)) !== JSON.stringify(attempt))
						writes.push(setValue(attemptAddress(attempt.id), structuredClone(attempt)));
					prior.delete(attempt.id);
				}
				for (const [id, attempt] of prior) {
					writes.push(setValue(attemptHistoryAddress(priorHeader?.retirementEpoch ?? 0, id), attempt));
					writes.push(deleteValue(attemptAddress(id)));
				}
				await mutation.commit(writes, context);
				return result;
			}, BACKGROUND_CONTEXT);
		},
	};
}
