import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { NodeRunStatus, PipelineNodeId } from "../types";
import { NodeIcon } from "./NodeIcon";

export interface IntakeFlowNodeData extends Record<string, unknown> {
  label: string;
  node: PipelineNodeId;
  status: NodeRunStatus;
  statusLabel: string;
}

export type IntakeFlowNodeType = Node<IntakeFlowNodeData, "intake">;

/** Adapted from agent-gate's SystemFlowNode: same circle-in-a-box shape and
 * handle setup, but state is pending/active/done/error instead of
 * compromised/blocked, since this pipeline has no adversarial branching. */
export function IntakeFlowNode({ data, selected }: NodeProps<IntakeFlowNodeType>) {
  return (
    <div
      className={`intake-node is-${data.status}${selected ? " is-selected" : ""}`}
      aria-label={`${data.label}, ${data.statusLabel}`}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <div className="intake-node-circle">
        <NodeIcon node={data.node} />
      </div>
      <strong>{data.label}</strong>
      <span className="node-status">{data.statusLabel}</span>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
