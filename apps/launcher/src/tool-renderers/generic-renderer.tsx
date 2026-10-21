import { ActivityRow } from "./activity-row";
import { object } from "../chat-projection";
import { ToolOutput } from "./tool-output";
import type { ToolRendererProps } from "./types";

export function GenericRenderer({ tool }: ToolRendererProps) {
  const result = tool.result;
  const blocks = object(result) && Array.isArray(result.content) ? result.content : [];
  return <ActivityRow title={tool.name} summary={tool.phase === "running" ? "Running" : tool.phase === "error" ? "Failed" : "Completed"} state={tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done"} defaultOpen={tool.phase === "error"}>
    <div className="space-y-2">
      <ToolOutput tool={tool} />
      {!blocks.length && !object(result) && <p className="text-[11px] text-muted-foreground">No structured result.</p>}
      <details className="rounded border border-border/60 bg-muted/20 px-2 py-1"><summary className="cursor-pointer text-[10px] text-muted-foreground">Arguments</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{JSON.stringify(tool.args, null, 2)}</pre></details>
    </div>
  </ActivityRow>;
}
