export function transformTaskFlow(source) {
	const replace = (before, after) => {
		if (source.split(before).length !== 2) throw new Error(`Task flow source anchor differs: ${before.slice(0, 70)}`);
		source = source.replace(before, after);
	};
	replace(
		'import { isAbsolute, join, resolve } from "node:path";',
		'import { isAbsolute, join, resolve } from "node:path";\nimport { installTaskFlow } from "./jouzu-flow.js";',
	);
	replace(
		"const widget = new TaskWidget(store, cfg);",
		"const widget = new TaskWidget(store, cfg);\n  const taskFlow = installTaskFlow(pi, () => store.list(), () => storeTarget.key);",
	);
	// All tools report durable mutations; ownership is captured inside the actual tool invocation.
	source = source.replaceAll("pi.registerTool({", "taskFlow.registerTool({");
	source = source.replaceAll(
		't.status === "in_progress" && getOpenBlockers(t).length === 0',
		't.status === "in_progress" && getOpenBlockers(t).length === 0 && taskFlow.runnable(t)',
	);
	replace(
		't.status === "pending" && getOpenBlockers(t).length === 0',
		't.status === "pending" && getOpenBlockers(t).length === 0 && taskFlow.runnable(t)',
	);
	replace(
		"if (queuedTaskIds.has(current.id)) {",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: emitted TypeScript preserves the task interpolation.
		"if (!taskFlow.runnable(current)) return { queued: false, message: `#${current.id}: paused or waiting for user input` };\n\n    if (queuedTaskIds.has(current.id)) {",
	);
	replace(
		'pi.sendUserMessage(prompt, { deliverAs: "followUp" });',
		'if (!taskFlow.send(queuedTask, () => buildTaskPrompt(store.get(current.id)!, options.additionalContext), () => queuedTaskIds.delete(current.id), () => queuedTaskIds.delete(current.id))) {\n        pi.sendUserMessage(prompt, { deliverAs: "followUp" });\n      }',
	);
	replace(
		"if (keepsTasks) autoClear.onRunEnded();",
		'if (keepsTasks) autoClear.onRunEnded();\n    if (await taskFlow.connect(ctx.sessionManager.getSessionId())) queueNextOpenTask("session_start");',
	);
	replace(
		'taskId: Type.String({ description: "The ID of the task to update" }),',
		'taskId: Type.String({ description: "The ID of the task to update" }),\n      waitForUser: Type.Optional(Type.Boolean({ description: "Hold automatic continuation until user input is available. Clear explicitly after receiving it." })),\n      paused: Type.Optional(Type.Boolean({ description: "Pause automatic task continuation. Set false to resume." })),',
	);
	replace(
		"- If you cannot complete it, leave the task open and explain the blocker.",
		"- If user input is required, call TaskUpdate with waitForUser true and explain the question. After receiving the answer, clear waitForUser explicitly. For task dependencies, set blockedBy. Call agent_wait for asynchronous execution.",
	);
	replace("seenUpdatedAt: number", "seenUpdatedAt: number | string");
	replace(
		"prior.seenUpdatedAt === current.updatedAt",
		"prior.seenUpdatedAt === taskFlow.progress(current, current.updatedAt)",
	);
	replace(
		"    try {\n      if (!taskFlow.send(",
		"    let flowManaged = false;\n    try {\n      if (!(flowManaged = taskFlow.send(",
	);
	replace(
		"() => queuedTaskIds.delete(current.id), () => queuedTaskIds.delete(current.id))) {",
		"() => { queuedTaskIds.delete(current.id); if (!options.explicit) { const live = store.get(current.id)!; autoPromptAttempts.set(current.id, { count: attempts + 1, seenUpdatedAt: taskFlow.progress(live, live.updatedAt) }); } }, () => queuedTaskIds.delete(current.id)))) {",
	);
	replace(
		"    if (!options.explicit) {\n      const queued =",
		"    if (!options.explicit && !flowManaged) {\n      const queued =",
	);
	return source;
}
