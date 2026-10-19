import { ActivityRow } from "./activity-row";
import { object } from "../chat-projection";
import { toolText, type ToolRendererProps } from "./types";

export function GenericRenderer({ tool }: ToolRendererProps) {
  const result = tool.result;
  const blocks = object(result) && Array.isArray(result.content) ? result.content : [];
  const text = toolText(result);
  return <ActivityRow title={tool.name} summary={tool.phase === "running" ? "Running" : tool.phase === "error" ? "Failed" : "Completed"} state={tool.phase === "running" ? "running" : tool.phase === "error" ? "error" : "done"} defaultOpen={tool.phase === "error"}>
    <div className="space-y-2">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{JSON.stringify(tool.args, null, 2)}</pre>
      {text && <pre className="max-h-96 overflow-auto whitespace-pre-wrap select-text text-[11px]">{text}</pre>}
      {!text && blocks.map((block, index) => object(block) && block.type === "text" && typeof block.text === "string" ? <pre key={index} className="max-h-96 overflow-auto whitespace-pre-wrap select-text text-[11px]">{block.text}</pre> : <p key={index} className="text-[11px] text-muted-foreground">Non-text tool output</p>)}
    </div>
  </ActivityRow>;
}
