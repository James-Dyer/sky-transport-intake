import type { PipelineState } from "./pipelineReducer";
import type { NodeRunStatus, PipelineNodeId } from "./types";

export type DiagramNodeId = "ticket" | "agent" | "sop" | "validate" | "database";

export interface DiagramNodeSpec {
  id: DiagramNodeId;
  label: string;
  size: number;
  x: number;
  y: number;
}

/** Fixed hub-and-spoke layout: Ticket and SOP both feed the Agent (its
 * reasoning inputs); Validate -> Database is the agent's output chain.
 * classify_doc/extract_fields aren't separate nodes here — they're LLM
 * calls that happen "inside" the agent, surfaced via its live status line
 * (see AGENT_ACTION_LABELS) rather than as extra boxes, per n8n's model of
 * one node per real system boundary, not one box per internal step. */
export const DIAGRAM_NODES: DiagramNodeSpec[] = [
  { id: "ticket", label: "Ticket received", size: 76, x: 0, y: 12 },
  { id: "sop", label: "Agent consults SOP", size: 76, x: 0, y: 232 },
  { id: "agent", label: "AI intake agent", size: 120, x: 240, y: 90 },
  { id: "validate", label: "Validate against SOP rules", size: 76, x: 520, y: 122 },
  { id: "database", label: "Record filed", size: 76, x: 740, y: 122 },
];

export interface DiagramEdgeSpec {
  id: string;
  source: DiagramNodeId;
  target: DiagramNodeId;
}

export const DIAGRAM_EDGES: DiagramEdgeSpec[] = [
  { id: "ticket-agent", source: "ticket", target: "agent" },
  { id: "sop-agent", source: "sop", target: "agent" },
  { id: "agent-validate", source: "agent", target: "validate" },
  { id: "validate-database", source: "validate", target: "database" },
];

/** What the agent's live status line reads while a given backend node is
 * the one currently running — this is what makes the hub self-explanatory
 * without a viewer needing to know the underlying LangGraph node names. */
export const AGENT_ACTION_LABELS: Record<PipelineNodeId, string> = {
  receive_ticket: "reading ticket",
  consult_sop: "consulting SOP",
  classify_doc: "classifying document",
  extract_fields: "extracting fields",
  validate: "handing off for validation",
  persist: "writing record to database",
};

const NODE_ORDER: PipelineNodeId[] = [
  "receive_ticket",
  "consult_sop",
  "classify_doc",
  "extract_fields",
  "validate",
  "persist",
];

export interface DiagramNodeState {
  status: NodeRunStatus;
  statusLine: string;
}

export type DiagramState = Record<DiagramNodeId, DiagramNodeState>;

/** Derives what each hub-diagram node should show from the underlying
 * per-backend-node pipeline state — a pure presentation-layer mapping, kept
 * separate from pipelineReducer so that reducer stays about the real
 * pipeline (used by the terminal log / records) and this stays about how
 * we choose to draw it. */
export function deriveDiagramState(pipeline: PipelineState): DiagramState {
  const s = pipeline.statuses;
  const passthrough = (node: PipelineNodeId): DiagramNodeState => ({
    status: s[node].status,
    statusLine: s[node].label,
  });

  const errored = NODE_ORDER.find((n) => s[n].status === "error");
  const active = NODE_ORDER.find((n) => s[n].status === "active");

  let agentStatus: NodeRunStatus = "pending";
  let agentLine = "waiting for a ticket…";
  if (errored) {
    agentStatus = "error";
    agentLine = s[errored].label;
  } else if (active) {
    agentStatus = "active";
    agentLine = AGENT_ACTION_LABELS[active];
  } else if (s.persist.status === "done") {
    agentStatus = "done";
    agentLine = "run complete";
  } else if (pipeline.runId) {
    // Between two SSE events with nothing currently marked active - keep
    // showing "active" rather than flashing back to pending mid-run.
    agentStatus = "active";
    agentLine = "working…";
  }

  return {
    ticket: passthrough("receive_ticket"),
    sop: passthrough("consult_sop"),
    agent: { status: agentStatus, statusLine: agentLine },
    validate: passthrough("validate"),
    database: passthrough("persist"),
  };
}
