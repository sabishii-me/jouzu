import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

type Logout = ModelRuntime["logout"];
type Handler = (remove: () => Promise<void>, signal?: AbortSignal) => Promise<void>;
interface Hook {
	original: Logout;
	wrapped: Logout;
	bindings: Map<object, Handler>;
}
const hooks = new WeakMap<object, Hook>();

/** Intercept Pi's logout menu only for an OAuth registration owned by this Jouzu extension. */
export function installShisaLogoutHook(runtimeClass: typeof ModelRuntime, oauth: object, handler: Handler): () => void {
	const prototype = runtimeClass.prototype;
	let hook = hooks.get(prototype);
	if (!hook) {
		const original = prototype.logout;
		const bindings = new Map<object, Handler>();
		const wrapped: Logout = function (this: ModelRuntime, providerId, options = {}) {
			const registration = providerId === "shisa" ? this.getRegisteredProviderConfig(providerId)?.oauth : undefined;
			const owner = registration ? bindings.get(registration) : undefined;
			if (!owner) return original.call(this, providerId, options);
			// Remote timeout/cancellation must not suppress local credential deletion.
			return owner(() => original.call(this, providerId, { signal: AbortSignal.timeout(5_000) }), options.signal);
		};
		hook = { original, wrapped, bindings };
		prototype.logout = wrapped;
		hooks.set(prototype, hook);
	}
	hook.bindings.set(oauth, handler);
	return () => {
		hook.bindings.delete(oauth);
		if (hook.bindings.size === 0) {
			if (prototype.logout === hook.wrapped) prototype.logout = hook.original;
			hooks.delete(prototype);
		}
	};
}
