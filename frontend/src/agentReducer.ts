import type { NodeRunStatus, ToolId } from "./types";

/** Tool calls that get their own diagram spoke. record_classification/
 * record_extraction don't (they're the agent's own reasoning, logged for
 * the trace but not a separate system boundary) — those two only update
 * agentStatusLine, mirroring how v1 folded classify_doc/extract_fields
 * into the hub's status line instead of giving them their own box. */
const SPOKE_TOOLS: ToolId[] = ["search_sop", "read_pdf", "validate", "persist"];

export interface AgentState {
  runId: string | null;
  ticketSubject: string | null;
  running: boolean;
  toolStatuses: Record<ToolId, { status: NodeRunStatus; label: string }>;
  agentStatusLine: string;
  agentStatus: NodeRunStatus;
  pulseSeq: number;
  activeEdgeId: string | null;
  activeEdgeReverse: boolean;
  error: string | null;
}

const IDLE_TOOL_STATUSES = Object.fromEntries(
  SPOKE_TOOLS.map((t) => [t, { status: "pending" as NodeRunStatus, label: "" }])
) as AgentState["toolStatuses"];

export const initialAgentState: AgentState = {
  runId: null,
  ticketSubject: null,
  running: false,
  toolStatuses: IDLE_TOOL_STATUSES,
  agentStatusLine: "waiting for a ticket…",
  agentStatus: "pending",
  pulseSeq: 0,
  activeEdgeId: null,
  activeEdgeReverse: false,
  error: null,
};

/** Diagram edge id (see diagramLayout.ts) linking the agent hub to each
 * spoke tool. A "started" event pulses it forward (agent -> tool); a
 * "finished" event pulses it backward (tool -> agent) — same edge, two
 * directions, see IntakeEdge's `reverse` pulse option. */
const TOOL_TO_EDGE: Partial<Record<ToolId, string>> = {
  search_sop: "agent-sop_search",
  read_pdf: "agent-pdf_reader",
  validate: "agent-validate",
  persist: "agent-database",
};

function shortResult(result: string, limit = 80): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine;
}

function summarizeToolFinish(tool: ToolId, resultSummary: { result: string } | null): string {
  const result = resultSummary?.result ?? "";
  switch (tool) {
    case "read_pdf":
      return "document read";
    case "search_sop":
      return "SOP consulted";
    case "record_classification":
      return shortResult(result, 70);
    case "record_extraction":
      return shortResult(result, 70);
    case "validate":
      try {
        const parsed = JSON.parse(result) as { needs_review?: boolean; deadline_flag?: boolean };
        if (parsed.needs_review) return "needs review";
        if (parsed.deadline_flag) return "urgent";
        return "ok";
      } catch {
        return "validated";
      }
    case "persist":
      try {
        const parsed = JSON.parse(result) as { record_id?: number; error?: string };
        if (parsed.error) return parsed.error;
        return `record #${parsed.record_id ?? "?"}`;
      } catch {
        return "persisted";
      }
    default:
      return "done";
  }
}

export type AgentAction =
  | { type: "RUN_STARTED"; runId: string; subject: string }
  | { type: "AGENT_THOUGHT"; text: string }
  | { type: "TOOL_CALL_STARTED"; tool: ToolId }
  | {
      type: "TOOL_CALL_FINISHED";
      tool: ToolId;
      resultSummary: { result: string } | null;
      error: string | null;
    }
  | { type: "RUN_DONE" }
  | { type: "RUN_ERROR"; message: string }
  | { type: "RESET" };

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "RUN_STARTED":
      return {
        ...initialAgentState,
        runId: action.runId,
        ticketSubject: action.subject,
        running: true,
        agentStatusLine: "reading the ticket…",
        agentStatus: "active",
        activeEdgeId: "ticket-agent",
        pulseSeq: state.pulseSeq + 1,
      };
    case "AGENT_THOUGHT":
      return {
        ...state,
        agentStatus: "active",
        agentStatusLine: action.text.replace(/^Thought:\s*/, ""),
      };
    case "TOOL_CALL_STARTED": {
      const edge = TOOL_TO_EDGE[action.tool];
      const isSpoke = SPOKE_TOOLS.includes(action.tool);
      return {
        ...state,
        toolStatuses: isSpoke
          ? {
              ...state.toolStatuses,
              [action.tool]: { status: "active", label: "running…" },
            }
          : state.toolStatuses,
        pulseSeq: edge ? state.pulseSeq + 1 : state.pulseSeq,
        activeEdgeId: edge ?? state.activeEdgeId,
        activeEdgeReverse: false,
      };
    }
    case "TOOL_CALL_FINISHED": {
      const edge = TOOL_TO_EDGE[action.tool];
      const isSpoke = SPOKE_TOOLS.includes(action.tool);
      const label = action.error ?? summarizeToolFinish(action.tool, action.resultSummary);
      return {
        ...state,
        toolStatuses: isSpoke
          ? {
              ...state.toolStatuses,
              [action.tool]: { status: action.error ? "error" : "done", label },
            }
          : state.toolStatuses,
        agentStatusLine: !isSpoke ? label : state.agentStatusLine,
        pulseSeq: edge ? state.pulseSeq + 1 : state.pulseSeq,
        activeEdgeId: edge ?? state.activeEdgeId,
        activeEdgeReverse: action.tool !== "persist",
      };
    }
    case "RUN_DONE":
      return { ...state, running: false, agentStatus: "done", agentStatusLine: "run complete" };
    case "RUN_ERROR":
      return {
        ...state,
        running: false,
        agentStatus: "error",
        agentStatusLine: action.message,
        error: action.message,
      };
    case "RESET":
      return initialAgentState;
    default:
      return state;
  }
}
