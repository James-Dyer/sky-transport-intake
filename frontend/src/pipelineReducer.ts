import { PIPELINE_NODES, type NodeRunStatus, type PipelineNodeId } from "./types";

export interface PipelineState {
  runId: string | null;
  filename: string | null;
  running: boolean;
  statuses: Record<PipelineNodeId, { status: NodeRunStatus; label: string }>;
  pulseSeq: number;
  activeEdgeId: string | null; // diagram edge id (see diagramLayout.ts) that should pulse right now
  error: string | null;
}

/** Which diagram edge lights up when a given backend node finishes. Not
 * every node maps to a visible edge: classify_doc and extract_fields happen
 * "inside" the agent (see diagramLayout's AGENT_ACTION_LABELS) rather than
 * being a separate hub-and-spoke node, so only their entry/exit edges pulse. */
const NODE_TO_EDGE: Partial<Record<PipelineNodeId, string>> = {
  receive_ticket: "ticket-agent",
  consult_sop: "sop-agent",
  extract_fields: "agent-validate",
  validate: "validate-database",
};

const IDLE_STATUSES = Object.fromEntries(
  PIPELINE_NODES.map((n) => [n, { status: "pending" as NodeRunStatus, label: "" }])
) as PipelineState["statuses"];

export const initialPipelineState: PipelineState = {
  runId: null,
  filename: null,
  running: false,
  statuses: IDLE_STATUSES,
  pulseSeq: 0,
  activeEdgeId: null,
  error: null,
};

export type PipelineAction =
  | { type: "RUN_STARTED"; runId: string; filename: string }
  | { type: "NODE_STARTED"; node: PipelineNodeId }
  | { type: "NODE_FINISHED"; node: PipelineNodeId; error: string | null; summary: Record<string, unknown> }
  | { type: "RUN_DONE" }
  | { type: "RUN_ERROR"; message: string }
  | { type: "RESET" };

function summarize(node: PipelineNodeId, summary: Record<string, unknown>): string {
  switch (node) {
    case "receive_ticket":
      return "logged";
    case "consult_sop":
      return "SOP loaded";
    case "classify_doc":
      return typeof summary.doc_type === "string" ? summary.doc_type : "classified";
    case "extract_fields": {
      const extracted = summary.extracted as Record<string, unknown> | undefined;
      const count = extracted ? Object.values(extracted).filter((v) => v != null).length : 0;
      return `${count} field(s)`;
    }
    case "validate":
      return summary.needs_review ? "needs review" : summary.deadline_flag ? "urgent" : "ok";
    case "persist":
      return `record #${summary.record_id ?? "?"}`;
    default:
      return "done";
  }
}

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case "RUN_STARTED":
      return {
        ...initialPipelineState,
        runId: action.runId,
        filename: action.filename,
        running: true,
      };
    case "NODE_STARTED":
      return {
        ...state,
        statuses: {
          ...state.statuses,
          [action.node]: { status: "active", label: "running…" },
        },
      };
    case "NODE_FINISHED": {
      return {
        ...state,
        statuses: {
          ...state.statuses,
          [action.node]: {
            status: action.error ? "error" : "done",
            label: action.error ?? summarize(action.node, action.summary),
          },
        },
        pulseSeq: state.pulseSeq + 1,
        activeEdgeId: action.error ? null : (NODE_TO_EDGE[action.node] ?? null),
      };
    }
    case "RUN_DONE":
      return { ...state, running: false };
    case "RUN_ERROR":
      return { ...state, running: false, error: action.message };
    case "RESET":
      return initialPipelineState;
    default:
      return state;
  }
}
