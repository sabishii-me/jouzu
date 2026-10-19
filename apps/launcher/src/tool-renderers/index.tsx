import { BackgroundRenderer } from "./background-renderer";
import { FlowReportRenderer, flowReport } from "./flow-report";
import { GenericRenderer } from "./generic-renderer";
import { TaskRenderer } from "./task-renderer";
import { WaitRenderer } from "./wait-renderer";
import { toolText, type ToolRendererProps } from "./types";

const taskTools = /^Task(CreateMany|Create|Update|List|Get|Execute|Output|Stop|Reorder)$/u;
const waitTools = /^(agent_wait|agent_wait_cancel)$/u;
const backgroundTools = /^bg_/u;

/** One dispatch point for every tool card. New native tools add a renderer here,
 * not another branch inside the conversation component. */
export function ToolRenderer(props: ToolRendererProps) {
  if (flowReport(toolText(props.tool.result))) return <FlowReportRenderer {...props} />;
  if (taskTools.test(props.tool.name)) return <TaskRenderer {...props} />;
  if (waitTools.test(props.tool.name)) return <WaitRenderer {...props} />;
  if (backgroundTools.test(props.tool.name)) return <BackgroundRenderer {...props} />;
  return <GenericRenderer {...props} />;
}
export { ActivityRow, StateDot } from "./activity-row";
export { FlowPanel } from "./flow-panel";
export { deriveFlow, flowWidgetEntries, hasFlow, parseTaskLines, widgetLabel } from "./flow-state";
export type { FlowState, FlowTask, FlowWait, FlowBackground, TaskStatus } from "./flow-state";
