import { CatalogMessageId, catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { wasShisaLoginSaved } from "./shisa-link/login-completion.js";

interface AuthModel {
	provider: string;
	id: string;
	api: string;
}

interface AuthHost {
	session: { model?: AuthModel };
	updateAvailableProviderCount(): Promise<void>;
	updateEditorBorderColor(): void;
	footer: { invalidate(): void };
	showStatus(message: string): void;
}

type CompleteAuthentication = (
	this: AuthHost,
	providerId: string,
	providerName: string,
	authType: string,
	previousModel: AuthModel | undefined,
) => Promise<void>;

type LoginProvider = (
	this: AuthHost,
	dialog: { signal: AbortSignal },
	providerId: string,
	providerName: string,
	method: string,
) => Promise<void>;

interface AuthPrototype {
	completeProviderAuthentication?: CompleteAuthentication;
	loginProvider?: LoginProvider;
}

const isUnknown = (model: AuthModel | undefined): boolean =>
	model?.provider === "unknown" && model.id === "unknown" && model.api === "unknown";

/** Keep Pi's login feedback consistent with Shisa's saved credential and selected model. */
export async function withPiAuthCompletion<T>(
	run: () => Promise<T>,
	runtime?: { InteractiveMode?: unknown },
	catalog: () => CatalogBundle = defaultCatalog,
): Promise<T> {
	// These private prototype methods are covered against the pinned runtime by dialog tests.
	const pi = runtime ?? (await import("@earendil-works/pi-coding-agent"));
	const prototype = (pi.InteractiveMode as { prototype?: AuthPrototype } | undefined)?.prototype;
	const original = prototype?.completeProviderAuthentication;
	const loginProvider = prototype?.loginProvider;
	if (!prototype || !original || !loginProvider) return run();
	const cancelledRefresh = new WeakSet<AuthHost>();
	const login: LoginProvider = async function (dialog, providerId, providerName, method) {
		try {
			await loginProvider.call(this, dialog, providerId, providerName, method);
		} catch (error) {
			if (providerId !== "shisa" || method !== "oauth" || !dialog.signal.aborted || !wasShisaLoginSaved(dialog.signal))
				throw error;
			// Authorization completed. Let the dialog close normally, then report only
			// the cancelled refresh instead of Pi's generic login-cancelled outcome.
			cancelledRefresh.add(this);
		}
	};
	const wrapped: CompleteAuthentication = async function (providerId, providerName, authType, previousModel) {
		if (cancelledRefresh.delete(this)) {
			await this.updateAvailableProviderCount();
			this.footer.invalidate();
			this.updateEditorBorderColor();
			this.showStatus(catalogText(catalog(), CatalogMessageId.shisaSignedInRefreshCancelled));
			return;
		}
		const current = this.session.model;
		await original.call(
			this,
			providerId,
			providerName,
			authType,
			providerId === "shisa" && authType === "oauth" && isUnknown(previousModel) && current && !isUnknown(current)
				? current
				: previousModel,
		);
	};
	prototype.loginProvider = login;
	prototype.completeProviderAuthentication = wrapped;
	try {
		return await run();
	} finally {
		if (prototype.completeProviderAuthentication === wrapped) prototype.completeProviderAuthentication = original;
		if (prototype.loginProvider === login) prototype.loginProvider = loginProvider;
	}
}
