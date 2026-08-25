import type { AgentState } from "./agentReducer";
import type { NodeRunStatus } from "./types";

export type DiagramNodeId = "ticket" | "sop_search" | "pdf_reader" | "agent" | "validate" | "database";

export interface DiagramNodeSpec {
  id: DiagramNodeId;
  label: string;
  size: number;
  x: number;
  y: number;
}

/** Superset layout: every tool the agent can call gets a fixed spoke
 * position, but which spokes light up and in what order is driven purely
 * by the live tool-call event stream (see agentReducer.ts) — the agent
 * decides that at runtime, this file only fixes where each possible spoke
 * sits on screen. record_classification/record_extraction don't get their
 * own spoke (see agentReducer's SPOKE_TOOLS comment); they surface as the
 * hub's status line instead. */
export const DIAGRAM_NODES: DiagramNodeSpec[] = [
  { id: "ticket", label: "Ticket received", size: 76, x: 0, y: -30 },
  { id: "sop_search", label: "SOP search (RAG)", size: 76, x: 0, y: 130 },
  { id: "pdf_reader", label: "Read attached PDF", size: 76, x: 0, y: 290 },
  { id: "agent", label: "AI intake agent", size: 128, x: 300, y: 130 },
  { id: "validate", label: "Validate against SOP rules", size: 76, x: 600, y: 130 },
  { id: "database", label: "Record filed", size: 76, x: 820, y: 130 },
];

export interface DiagramEdgeSpec {
  id: string;
  source: DiagramNodeId;
  target: DiagramNodeId;
}

export const DIAGRAM_EDGES: DiagramEdgeSpec[] = [
  { id: "ticket-agent", source: "ticket", target: "agent" },
  { id: "agent-sop_search", source: "agent", target: "sop_search" },
  { id: "agent-pdf_reader", source: "agent", target: "pdf_reader" },
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
