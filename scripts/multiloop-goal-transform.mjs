export function transformGoalCommands(source) {
	const anchor = "      const command = parseGoalCommand(args);";
	if (source.split(anchor).length !== 2) throw new Error("Multiloop goal command source anchor differs.");
	return source
		.replace(
			anchor,
			String.raw`
      const trimmed = args.trim();
      const registry = readRegistry(ctx.cwd);
      const goals = registry.loops.filter((loop) => {
        const state = activeStates.get(stateKey(loop)) ?? loadState(ctx.cwd, loop);
        return state && isQuickGoal(state);
      });
      const visible = goals.filter((loop) => loop.status === "active" || loop.status === "paused");
      const hints = [
        "/goal <objective> — start a goal",
        "/goal pause|stop|resume [lane/run-tag]",
        "Without a target, use the attached goal or the only matching goal.",
        "/goal list — running and paused goals",
        "/goal help — token caps, clearing, and completion options",
      ];
      if (/^(?:list|ls|status)?$/i.test(trimmed)) {
        const lines = visible.map((loop) => {
          const state = activeStates.get(stateKey(loop)) ?? loadState(ctx.cwd, loop)!;
          return formatGoalStatus(state);
        });
        if (lines.length === 0) lines.push("No running or paused goals.");
        const others = registry.loops.length - visible.length;
        if (others > 0) lines.push(others + " other runs are hidden; use /multiloop for the full list.");
        ctx.ui.notify([...lines, "", ...hints].join("\n"), "info");
        return;
      }
      const control = /^(pause|stop|resume)(?:\s+(.+))?$/i.exec(trimmed);
      if (control) {
        const operation = control[1].toLowerCase();
        const target = control[2]?.trim() ?? "";
        const eligible = operation === "resume" ? goals.filter((loop) => loop.status !== "archived")
          : visible.filter((loop) => operation === "stop" || loop.status === "active");
        const attached = attachedQuickGoal();
        const implicit = (attached && eligible.find((loop) => stateKey(loop) === stateKey(attached)))
          || (eligible.length === 1 ? eligible[0] : undefined);
        const resolution = resolveLoopTarget(eligible, target || (implicit ? formatLaneId(implicit) : ""), {});
        if (resolution.status !== "resolved") {
          ctx.ui.notify([
            "Could not select a goal. Use /goal " + operation + " <lane/run-tag>.",
            ...eligible.map((loop) => "  " + formatLaneId(loop)),
            "Use /goal to list goals or /multiloop for all runs.",
          ].join("\n"), "error");
          return;
        }
        if (operation === "pause" || operation === "stop") {
          ctx.ui.notify(await (operation === "pause" ? pauseLoop(ctx, resolution.id) : stopLoop(ctx, resolution.id)), "info");
          return;
        }
        const resumed = await resumeLoop(ctx, resolution.id);
        if (!resumed) { ctx.ui.notify("Goal state could not be loaded. Use /goal to list goals.", "error"); return; }
        ctx.ui.notify("Resumed goal " + formatLaneId(resolution.id) + ".", "info");
        markLoopTurn("goal-resume");
        queueExplicitFlow(pi, ctx, resumed, "goal-resume", () => buildAutoContinuePrompt([resumed], taskSnapshotFor(ctx)));
        return;
      }
` + anchor,
		)
		.replace(
			'"  /goal pause | resume         Hold the goal, or pick it back up.",',
			'"  /goal pause|stop|resume [lane/run-tag]   Control the attached goal or select a saved goal.",\n              "  /goal list                   List running and paused goals, with command hints.",',
		)
		.replace("/multiloop stop ${state.lane}/${state.runTag} to end it.", "/goal stop to end it.");
}
