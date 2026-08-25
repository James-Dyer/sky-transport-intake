import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { DiagramNodeId, HandleSide } from "../diagramLayout";
import type { NodeRunStatus } from "../types";
import { NodeIcon } from "./NodeIcon";

const POSITION_BY_SIDE: Record<HandleSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export interface HubNodeData extends Record<string, unknown> {
  diagramId: DiagramNodeId;
  label: string;
  statusLine: string;
  status: NodeRunStatus;
  size: number;
  /** Sides to render a target handle on, id `in-<side>`. Defaults to ["left"]. */
  targetSides?: HandleSide[];
  /** Sides to render a source handle on, id `out-<side>`. Defaults to ["right"]. */
  sourceSides?: HandleSide[];
  /** True if the agent writes to this resource — see the "is-written" class below. */
  writesData?: boolean;
  isDropZone?: boolean;
  isDropArmed?: boolean;
  isDropActive?: boolean;
  onDropZoneDragOver?: (e: React.DragEvent) => void;
  onDropZoneDragLeave?: (e: React.DragEvent) => void;
  onDropZoneDrop?: (e: React.DragEvent) => void;
}

export type HubNodeType = Node<HubNodeData, "hub">;

/** The node's box height is set to exactly `size` (the circle's diameter)
 * via inline style, and the label/status text is positioned absolutely
 * below it rather than stacked in normal flow. That's what keeps a
 * handle's default 50%-of-box position landing exactly on the circle's
 * visual center regardless of label length — the earlier linear-pipeline
 * node stacked the label inside the box, which pushed the box taller than
 * the circle and put every edge a few px below center.
 *
 * Handle sides are configurable per node (via targetSides/sourceSides)
 * rather than fixed to Left/Right, so an edge can leave from whichever
 * side of the box actually faces its target — e.g. the agent hub exposes
 * source handles on its left, top, and right so spokes above or beside it
 * don't have to loop around to reach a right-side-only handle. */
export function HubNode({ data, selected }: NodeProps<HubNodeType>) {
  const dropZoneClass = data.isDropZone
    ? ` is-drop-zone${data.isDropArmed ? " is-drop-armed" : ""}${data.isDropActive ? " is-drop-active" : ""}`
    : "";
  // "Done" alone just means the step finished — black is reserved for
  // "the agent actually wrote to this", so only writesData nodes (and only
  // once they're done) pick up the darker is-written look.
  const writtenClass = data.writesData && data.status === "done" ? " is-written" : "";
  const targetSides = data.targetSides ?? ["left"];
  const sourceSides = data.sourceSides ?? ["right"];
  return (
    <div
      className={`hub-node is-${data.status}${writtenClass}${dropZoneClass}`}
      style={{ width: data.size, height: data.size }}
      aria-label={`${data.label}, ${data.statusLine}`}
      onDragOver={data.isDropZone ? data.onDropZoneDragOver : undefined}
      onDragLeave={data.isDropZone ? data.onDropZoneDragLeave : undefined}
      onDrop={data.isDropZone ? data.onDropZoneDrop : undefined}
    >
      {targetSides.map((side) => (
        <Handle key={`in-${side}`} id={`in-${side}`} type="target" position={POSITION_BY_SIDE[side]} isConnectable={false} />
      ))}
      <div
        className={`hub-node-circle${selected ? " is-selected" : ""}`}
        style={{ width: data.size, height: data.size }}
      >
        <NodeIcon node={data.diagramId} />
      </div>
      {sourceSides.map((side) => (
        <Handle key={`out-${side}`} id={`out-${side}`} type="source" position={POSITION_BY_SIDE[side]} isConnectable={false} />
      ))}
      <div className="hub-node-label" style={{ top: data.size + 8 }}>
        <strong>{data.label}</strong>
        <span className="hub-node-status">{data.statusLine}</span>
      </div>
    </div>
  );
}
