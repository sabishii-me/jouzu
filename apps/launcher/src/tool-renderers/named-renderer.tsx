import { ActivityRow } from "./activity-row";
import { ToolOutput } from "./tool-output";
import { record, toolText, type ToolRendererProps } from "./types";

const named = {
  compact_context: { title: "Context compaction", summary: "Requested for the next turn" },
  subagent: { title: "Subagent", summary: "Delegated work" },
  schedule_prompt: { title: "Scheduled prompt", summary: "Queued for a later time" },
  agent_no_reply: { title: "No reply", summary: "Notification-only turn" },
} as const;
export type NamedTool = keyof typeof named;
export function isNamedTool(name: string): name is NamedTool { return name in named; }
export function NamedRenderer({ tool }: ToolRendererProps) {
  const definition = named[tool.name as NamedTool];
  const args = record(tool.args) ?? {};
  const detail = tool.name === "subagent"
    ? [args.op, args.role, args.task].filter(value => typeof value === "string").join(" · ")
    : tool.name === "schedule_prompt" && typeof args.prompt === "string" ? args.prompt : undefined;
  const text = toolText(tool.result);
  return <ActivityRow title={definition.title} summary={detail || definition.summary} state={tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done"} defaultOpen={!!text}>
    {text && <ToolOutput tool={tool} />}
  </ActivityRow>;
}
