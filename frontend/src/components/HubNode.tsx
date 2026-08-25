import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { DiagramNodeId } from "../diagramLayout";
import type { NodeRunStatus } from "../types";
import { NodeIcon } from "./NodeIcon";

export interface HubNodeData extends Record<string, unknown> {
  diagramId: DiagramNodeId;
  label: string;
  statusLine: string;
  status: NodeRunStatus;
  size: number;
  isDropZone?: boolean;
  isDropActive?: boolean;
  onDropZoneDragOver?: (e: React.DragEvent) => void;
  onDropZoneDragLeave?: (e: React.DragEvent) => void;
  onDropZoneDrop?: (e: React.DragEvent) => void;
}

export type HubNodeType = Node<HubNodeData, "hub">;

const ICON_BY_DIAGRAM_ID: Record<DiagramNodeId, Parameters<typeof NodeIcon>[0]["node"]> = {
  ticket: "receive_ticket",
  sop: "consult_sop",
  agent: "classify_doc",
  validate: "validate",
  database: "persist",
};

/** The node's box height is set to exactly `size` (the circle's diameter)
 * via inline style, and the label/status text is positioned absolutely
 * below it rather than stacked in normal flow. That's what keeps a
 * Left/Right handle's default 50%-of-box-height position landing exactly
 * on the circle's visual center regardless of label length — the earlier
 * linear-pipeline node stacked the label inside the box, which pushed the
 * box taller than the circle and put every edge a few px below center. */
export function HubNode({ data, selected }: NodeProps<HubNodeType>) {
  const dropZoneClass = data.isDropZone
    ? ` is-drop-zone${data.isDropActive ? " is-drop-active" : ""}`
    : "";
  return (
    <div
      className={`hub-node is-${data.status}${dropZoneClass}`}
      style={{ width: data.size, height: data.size }}
      aria-label={`${data.label}, ${data.statusLine}`}
      onDragOver={data.isDropZone ? data.onDropZoneDragOver : undefined}
      onDragLeave={data.isDropZone ? data.onDropZoneDragLeave : undefined}
      onDrop={data.isDropZone ? data.onDropZoneDrop : undefined}
    >
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <div
        className={`hub-node-circle${selected ? " is-selected" : ""}`}
        style={{ width: data.size, height: data.size }}
      >
        <NodeIcon node={ICON_BY_DIAGRAM_ID[data.diagramId]} />
      </div>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      <div className="hub-node-label" style={{ top: data.size + 8 }}>
        <strong>{data.label}</strong>
        <span className="hub-node-status">{data.statusLine}</span>
      </div>
    </div>
  );
}
