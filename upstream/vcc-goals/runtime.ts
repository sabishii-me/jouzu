// Keep extension output in the transcript without treating it as user intent.
export const isNotificationGoal = (text: string): boolean =>
  /^(?:Subagent batch\s+\S+\.|Agent\s+\S+\s+\([0-9a-f-]+\)\s+(?:completed|failed|stopped)\.)$/i.test(text.trim().split("\n")[0]);

export function goalMetadata(message: any): { jouzuGoalEligible: boolean; jouzuGoalText?: string } {
  if (message.role === "user") return { jouzuGoalEligible: true };
  const userFrames: string[] = [];
  if (message.role === "custom" && message.customType === "jouzu-flow" && Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type !== "text") continue;
      try {
        const frame = JSON.parse(part.text);
        if (Array.isArray(frame.flowInput) && frame.flowInput.length === 4 &&
            frame.flowInput[0] === "jouzu-flow" && frame.kind === "user" && typeof frame.content === "string") {
          userFrames.push(frame.content);
        }
      } catch { /* Non-frame text remains in the transcript, not the goals. */ }
    }
  }
  return { jouzuGoalEligible: userFrames.length > 0, jouzuGoalText: userFrames.join("\n") };
}

export const hasGoalIntent = (text: string): boolean =>
  /^(?:(?:please|can you|could you|would you|will you|we need to|i want you to|i need you to|let'?s)\s+)*(?:instead|actually|change of plan|forget that|new task|switch to|now I want|pivot|stop .* and|fix|implement|add|create|build|refactor|debug|investigate|update|remove|delete|migrate|deploy|test|write|set up)\b/i.test(text.trim());

export const mergeSessionGoals = (prev: string, fresh: string): string => {
  const parse = (section: string) => {
    const base: string[] = [];
    let scope: string[] | undefined;
    for (const line of section.replace(/\n[ \t]+(?=\S)/g, " ").split("\n")) {
      if (!line.startsWith("- ") || line.includes("<skill") || line.includes("</skill")) continue;
      const text = line.slice(2).trim();
      if (text === "[Scope change]") { scope = []; continue; }
      if (!text || isNotificationGoal(text)) continue;
      const target = scope ?? base;
      if (!target.includes(text)) target.push(text);
    }
    return { base, scope };
  };
  const old = parse(prev);
  const next = parse(fresh);
  const base = old.base.length ? old.base : next.base;
  const added = next.base.filter((line) => !base.includes(line) && !old.scope?.includes(line));
  // A window's first user block is not necessarily a new instruction.
  const scope = next.scope?.length ? next.scope : added.length && hasGoalIntent(added[0]) ? added : old.scope;
  const changes = scope?.filter((line) => !base.includes(line)).slice(0, 3) ?? [];
  const lines = changes.length
    ? [...base.slice(0, 8), "[Scope change]", ...changes]
    : base.slice(0, 8);
  return lines.length ? `[Session Goal]\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
};
