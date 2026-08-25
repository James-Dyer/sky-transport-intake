import type { AgentState } from "./agentReducer";
import type { NodeRunStatus } from "./types";

export type DiagramNodeId = "ticket" | "sop_search" | "pdf_reader" | "agent" | "validate" | "database";

/** Which side of a node's box a handle sits on — matches @xyflow/react's
 * Position enum values so `in-${side}`/`out-${side}` line up with the
 * sourceHandle/targetHandle ids HubNode renders. Kept as plain strings here
 * (rather than importing Position) so this file stays free of any
 * React Flow dependency. */
export type HandleSide = "left" | "right" | "top" | "bottom";

export interface DiagramNodeSpec {
  id: DiagramNodeId;
  label: string;
  size: number;
  x: number;
  y: number;
  /** Sides that render a target ("in-<side>") handle. Defaults to ["left"]
   * when omitted — most nodes only ever receive an edge from their left. */
  targetSides?: HandleSide[];
  /** Sides that render a source ("out-<side>") handle. Defaults to
   * ["right"] when omitted. */
  sourceSides?: HandleSide[];
  /** True if the agent writes to / modifies this resource, as opposed to
   * just reading it. Drives the "blacked out" done styling — read-only
   * nodes (and the agent hub itself) finish in a plain "done" look instead,
   * so black specifically means "this was written to", not just "finished". */
  writesData?: boolean;
}

/** Superset layout: every tool the agent can call gets a fixed spoke
 * position, but which spokes light up and in what order is driven purely
 * by the live tool-call event stream (see agentReducer.ts) — the agent
 * decides that at runtime, this file only fixes where each possible spoke
 * sits on screen. record_classification/record_extraction don't get their
 * own spoke (see agentReducer's SPOKE_TOOLS comment); they surface as the
 * hub's status line instead.
 *
 * Layout: the agent hub stays centered, with its four spokes arranged so
 * every edge leaves from the side of the box that actually faces its
 * target — no edge has to loop back around a node to reach a handle on the
 * wrong side. ticket and pdf_reader sit left of the hub and both connect
 * through its single left-side handle pair, so their edges visually merge
 * into one line approaching the hub. sop_search sits directly above.
 * validate and database sit right of the hub, both through its single
 * right-side handle pair, mirroring the left merge. */
export const DIAGRAM_NODES: DiagramNodeSpec[] = [
  { id: "ticket", label: "Ticket received", size: 76, x: 0, y: 56 },
  { id: "pdf_reader", label: "Read attached PDF", size: 76, x: 0, y: 256, targetSides: ["right"] },
  { id: "sop_search", label: "SOP search (RAG)", size: 76, x: 326, y: -40, targetSides: ["bottom"] },
  {
    id: "agent",
    label: "AI intake agent",
    size: 128,
    x: 300,
    y: 130,
    targetSides: ["left"],
    sourceSides: ["left", "top", "right"],
  },
  { id: "validate", label: "Validate against SOP rules", size: 76, x: 650, y: 56 },
  { id: "database", label: "Record filed", size: 76, x: 650, y: 256, writesData: true },
];

export interface DiagramEdgeSpec {
  id: string;
  source: DiagramNodeId;
  target: DiagramNodeId;
  /** Which of the source node's handles this edge leaves from. Defaults to
   * "right". */
  sourceSide?: HandleSide;
  /** Which of the target node's handles this edge arrives at. Defaults to
   * "left". */
  targetSide?: HandleSide;
}

export const DIAGRAM_EDGES: DiagramEdgeSpec[] = [
  { id: "ticket-agent", source: "ticket", target: "agent" },
  { id: "agent-sop_search", source: "agent", target: "sop_search", sourceSide: "top", targetSide: "bottom" },
  { id: "agent-pdf_reader", source: "agent", target: "pdf_reader", sourceSide: "left", targetSide: "right" },
  { id: "agent-validate", source: "agent", target: "validate" },
  { id: "agent-database", source: "agent", target: "database" },
];

export interface DiagramNodeState {
  status: NodeRunStatus;
  statusLine: string;
}

export type DiagramState = Record<DiagramNodeId, DiagramNodeState>;

/** Derives what each hub-diagram node should show from AgentState — a pure
 * presentation-layer mapping, kept separate from agentReducer so that
 * reducer stays about real agent/tool state and this stays about how we
 * choose to draw it. */
export function deriveDiagramState(agent: AgentState): DiagramState {
  const ticketStatus: NodeRunStatus = agent.runId ? "done" : "pending";
  return {
    ticket: {
      status: ticketStatus,
      statusLine: agent.ticketSubject ?? "",
    },
    sop_search: {
      status: agent.toolStatuses.search_sop.status,
      statusLine: agent.toolStatuses.search_sop.label,
    },
    pdf_reader: {
      status: agent.toolStatuses.read_pdf.status,
      statusLine: agent.toolStatuses.read_pdf.label,
    },
    agent: { status: agent.agentStatus, statusLine: agent.agentStatusLine },
    validate: {
      status: agent.toolStatuses.validate.status,
      statusLine: agent.toolStatuses.validate.label,
    },
    database: {
      status: agent.toolStatuses.persist.status,
      statusLine: agent.toolStatuses.persist.label,
    },
  };
}
