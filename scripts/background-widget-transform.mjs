function replace(source, from, to) {
	if (source.split(from).length !== 2) throw new Error("Background widget source anchor changed.");
	return source.replace(from, to);
}

/** Suppress only the inline widget while a dashboard holds a session-scoped claim. */
export function claimBackgroundWidget(source) {
	source = replace(
		source,
		"\tlet requestWidgetRender: (() => void) | null = null;",
		"\tconst widgetClaims = new Set<symbol>();\n\tlet requestWidgetRender: (() => void) | null = null;",
	);
	source = replace(
		source,
		"\t\twidgetExpiry.clear();\n\t\tconst now = Date.now();",
		"\t\twidgetExpiry.clear();\n\t\tif (widgetClaims.size) { clearWidget(); return; }\n\t\tconst now = Date.now();",
	);
	source = replace(
		source,
		'\tpi.on("session_start", (_event, ctx) => {',
		`\tpi.events.on("background-tasks:widget:claim", (data) => {
		const request = data as { version?: number; respond?: (release: () => void) => void } | undefined;
		if (request?.version !== 1 || typeof request.respond !== "function" || !activeCtx?.hasUI || shuttingDown) return;
		const token = Symbol();
		widgetClaims.add(token);
		const release = () => {
			if (!widgetClaims.delete(token)) return;
			if (activeCtx && !shuttingDown) syncWidget(activeCtx);
		};
		try {
			clearWidget();
			request.respond(release);
		} catch (error) {
			release();
			throw error;
		}
	});
	pi.on("session_start", (_event, ctx) => {
		widgetClaims.clear();`,
	);
	source = replace(
		source,
		"\t\torphanWatcher?.checkOnce();\n\t\tsyncWidget(ctx);",
		'\t\torphanWatcher?.checkOnce();\n\t\tpi.events.emit("background-tasks:widget:ready", { version: 1 });\n\t\tsyncWidget(ctx);',
	);
	return replace(
		source,
		'\tpi.on("session_shutdown", () => {\n\t\tshuttingDown = true;',
		'\tpi.on("session_shutdown", () => {\n\t\tshuttingDown = true;\n\t\twidgetClaims.clear();',
	);
}
