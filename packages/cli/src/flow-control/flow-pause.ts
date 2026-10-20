import { flowDiagnosticText } from "./diagnostic-text.js";

/**
 * Why the session's automated work is held as a whole.
 *
 * One component observes the cause and another explains it, so the reason strings and the tests for
 * them live together. A literal repeated on both sides would let a rename change the advice without
 * changing the cause.
 */
export const INTERRUPTED_PAUSE = "a turn was interrupted";
export const REOPENED_PAUSE = "the session was reopened";
export const COMMAND_PAUSE = "held from /flow";

const ADMISSION_PREFIX = "flow admission failed (";
const PROVIDER_PREFIX = "a provider request failed";

/** A flow invariant refused an input; the code names which one. */
export const admissionPause = (code: string): string => `${ADMISSION_PREFIX}${code})`;
export const isAdmissionPause = (reason: string): boolean => reason.startsWith(ADMISSION_PREFIX);

/**
 * A provider request ended the turn after host recovery stopped. Hold automated work until the
 * user chooses to retry, and include the provider's bounded, redacted message in the pause reason.
 */
export const providerPause = (detail: string): string =>
	detail ? `${PROVIDER_PREFIX} (${flowDiagnosticText(detail)})` : PROVIDER_PREFIX;
export const isProviderPause = (reason: string): boolean => reason.startsWith(PROVIDER_PREFIX);
