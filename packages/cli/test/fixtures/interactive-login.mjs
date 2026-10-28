import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";

// Real Pi dialog/login/completion methods; only terminal drawing and background refresh are stubbed.
export function interactiveLoginHost(session, options = {}) {
	initTheme("dark");
	const errors = [],
		statuses = [],
		warnings = [],
		refreshes = [];
	const host = {
		errors,
		statuses,
		warnings,
		refreshes,
		session: {
			get model() {
				return session.model;
			},
			setModel: (...args) => session.setModel(...args),
			modelRuntime: {
				login: (...args) => session.modelRuntime.login(...args),
				getAvailableSnapshot: () => session.modelRuntime.getAvailableSnapshot(),
				refresh: async (request) => {
					refreshes.push(request);
					return options.refresh ? options.refresh(request) : { aborted: false, errors: new Map() };
				},
			},
		},
		settingsManager: { getOrCreateDeviceId: () => "fixture-device" },
		editor: {},
		editorContainer: {
			clear() {},
			addChild(child) {
				host.focused = child;
			},
		},
		ui: { setFocus() {}, requestRender() {} },
		programStatus: { setBlocked() {} },
		footer: { invalidate() {} },
		showStatus: (message) => statuses.push(message),
		showError: (message) => errors.push(message),
		showWarning: (message) => warnings.push(message),
		updateAvailableProviderCount: async () => {},
		updateEditorBorderColor() {},
		maybeWarnAboutAnthropicSubscriptionAuth: async () => {},
	};
	for (const method of ["loginProvider", "showAuthPrompt", "notifyAuthDialog", "completeProviderAuthentication"])
		host[method] = (...args) => InteractiveMode.prototype[method].apply(host, args);
	host.login = async (provider = "shisa", name = "Shisa") => {
		await InteractiveMode.prototype.showLoginDialog.call(host, provider, name);
		// Drain the resolved refresh's completion/finally chain before teardown.
		await new Promise((resolve) => setImmediate(resolve));
	};
	return host;
}
