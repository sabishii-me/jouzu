import { ActivityRow } from "./activity-row";
import { object } from "../chat-projection";
import { toolText, type ToolRendererProps } from "./types";

const labeled: Record<string, { title: string; summary: (args: Record<string, unknown>) => string | undefined }> = {
  bash: { title: "Command", summary: args => typeof args.command === "string" ? args.command : undefined },
  read: { title: "Read", summary: args => typeof args.path === "string" ? args.path : undefined },
  grep: { title: "Search", summary: args => [args.pattern, args.path].filter(value => typeof value === "string").join(" · ") || undefined },
  get_goal: { title: "Goal", summary: args => typeof args.status === "string" ? args.status : undefined },
  vcc_recall: { title: "Recall", summary: args => typeof args.query === "string" ? args.query : undefined },
};
export function isSimpleTool(name: string) { return name in labeled; }
export function SimpleToolRenderer({ tool }: ToolRendererProps) {
  const definition = labeled[tool.name]!;
  const args = object(tool.args) ? tool.args : {};
  const text = toolText(tool.result);
  return <ActivityRow title={definition.title} summary={definition.summary(args)} state={tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done"} defaultOpen={tool.phase === "error"}>
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{JSON.stringify(tool.args, null, 2)}</pre>
    {text && <pre className="max-h-96 overflow-auto whitespace-pre-wrap select-text text-[11px]">{text}</pre>}
  </ActivityRow>;
}
