import { PIPELINE_NODES, type NodeRunStatus, type PipelineNodeId } from "./types";

export interface PipelineState {
  runId: string | null;
  filename: string | null;
  running: boolean;
  statuses: Record<PipelineNodeId, { status: NodeRunStatus; label: string }>;
  pulseSeq: number;
  activeEdgeIndex: number | null; // index into PIPELINE_NODES marking the edge that should pulse
  error: string | null;
}

const IDLE_STATUSES = Object.fromEntries(
  PIPELINE_NODES.map((n) => [n, { status: "pending" as NodeRunStatus, label: "" }])
) as PipelineState["statuses"];

export const initialPipelineState: PipelineState = {
  runId: null,
  filename: null,
  running: false,
  statuses: IDLE_STATUSES,
  pulseSeq: 0,
  activeEdgeIndex: null,
  error: null,
};

export type PipelineAction =
  | { type: "RUN_STARTED"; runId: string; filename: string }
  | { type: "NODE_STARTED"; node: PipelineNodeId }
  | { type: "NODE_FINISHED"; node: PipelineNodeId; error: string | null; summary: Record<string, unknown> }
  | { type: "RUN_DONE" }
  | { type: "RUN_ERROR"; message: string };

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
      const idx = PIPELINE_NODES.indexOf(action.node);
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
        activeEdgeIndex: action.error ? null : idx,
      };
    }
    case "RUN_DONE":
      return { ...state, running: false };
    case "RUN_ERROR":
      return { ...state, running: false, error: action.message };
    default:
      return state;
  }
}
