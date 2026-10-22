function replace(source, from, to) {
	if (source.split(from).length !== 2) throw new Error("Background widget source anchor changed.");
	return source.replace(from, to);
}

/** Keep upstream widget claims scoped to an attached UI session. */
export function claimBackgroundWidget(source) {
	source = replace(
		source,
		"\tconst widgetClaims = createBackgroundWidgetClaims(() => {\n\t\tif (activeCtx) syncWidget(activeCtx);\n\t});",
		"\tconst widgetClaims = createBackgroundWidgetClaims(() => {\n\t\tif (activeCtx && !shuttingDown) syncWidget(activeCtx);\n\t}, () => !!activeCtx?.hasUI && !shuttingDown);",
	);
	source = replace(
		source,
		"\t\tshuttingDown = false;\n\t\twidgetClaims.releaseAll();",
		"\t\tactiveCtx = null;\n\t\twidgetClaims.releaseAll();\n\t\tshuttingDown = false;",
	);
	return replace(
		source,
		"\t\tsyncWidget(ctx);\n\t\tpi.events?.emit?.(BACKGROUND_WIDGET_READY, { version: 1 });",
		"\t\tpi.events?.emit?.(BACKGROUND_WIDGET_READY, { version: 1 });\n\t\tsyncWidget(ctx);",
	);
}

/** A failed render or claim handoff must release the claim and report the error. */
export function guardBackgroundWidgetClaims(source) {
	source = replace(
		source,
		"export function createBackgroundWidgetClaims(changed: () => void) {",
		"export function createBackgroundWidgetClaims(changed: () => void, canClaim: () => boolean = () => true) {",
	);
	source = replace(
		source,
		"\tconst notify = () => {\n\t\ttry {\n\t\t\tchanged();\n\t\t} catch {\n\t\t\t/* A render failure must not strand other claims. */\n\t\t}\n\t};",
		"\tconst notify = changed;",
	);
	source = replace(
		source,
		'\t\t\t\tif (request.version !== 1 || typeof request.respond !== "function") return;',
		'\t\t\t\tif (request.version !== 1 || typeof request.respond !== "function" || !canClaim()) return;',
	);
	return replace(
		source,
		"\t\t\t\treleases.add(release);\n\t\t\t\tnotify();\n\t\t\t\ttry {\n\t\t\t\t\trequest.respond(release);\n\t\t\t\t} catch {\n\t\t\t\t\trelease();\n\t\t\t\t}",
		"\t\t\t\treleases.add(release);\n\t\t\t\ttry {\n\t\t\t\t\tnotify();\n\t\t\t\t\trequest.respond(release);\n\t\t\t\t} catch (error) {\n\t\t\t\t\trelease();\n\t\t\t\t\tthrow error;\n\t\t\t\t}",
	);
}
