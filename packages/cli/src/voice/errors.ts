import { type CatalogMessageRef, catalogMessageText, defaultCatalog } from "../cli-messages.js";

/**
 * A reviewed user-facing diagnostic, safe to display without a remote error body.
 *
 * `message` is the English text so a generic catch still prints English, and
 * `catalogMessage` is the catalog identity the voice surface resolves in the
 * active locale. An internal control-flow error carries no identity and keeps
 * its English text; a reviewed diagnostic is built with {@link voiceError}, so
 * its English text comes from the `en` catalog instead of a second copy.
 */
export class VoiceError extends Error {
	readonly catalogMessage?: CatalogMessageRef;

	constructor(message: string, catalogMessage?: CatalogMessageRef) {
		super(message);
		this.name = "VoiceError";
		this.catalogMessage = catalogMessage;
	}
}

/** Build a reviewed diagnostic from its catalog identity. */
export function voiceError(message: CatalogMessageRef): VoiceError {
	return new VoiceError(catalogMessageText(defaultCatalog(), message), message);
}
