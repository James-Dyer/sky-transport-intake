import type { PipelineNodeId } from "./types";

export type LogTone = "info" | "success" | "error" | "muted";

export interface LogLine {
  id: string;
  text: string;
  tone: LogTone;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `log-${counter}`;
}

export function line(text: string, tone: LogTone = "info"): LogLine {
  return { id: nextId(), text, tone };
}

const NODE_LABEL: Record<PipelineNodeId, string> = {
  receive_ticket: "receive_ticket",
  consult_sop: "consult_sop",
  classify_doc: "classify_doc",
  extract_fields: "extract_fields",
  validate: "validate",
  persist: "persist",
};

/** One line per node_finished summarizing what actually happened, not just
 * "done" — this is what makes the live terminal read as a real trace
 * instead of a generic progress bar. Pure function so it's testable without
 * mounting the component or opening an SSE connection. */
export function formatNodeFinished(
  node: PipelineNodeId,
  durationMs: number,
  error: string | null,
  summary: Record<string, unknown>
): LogLine {
  const label = NODE_LABEL[node];
  if (error) {
    return line(`[${label}] ✗ ${error}`, "error");
  }
  const detail = describeSummary(node, summary);
  return line(`[${label}] ✓ ${detail} (${durationMs}ms)`, "success");
}

function describeSummary(node: PipelineNodeId, summary: Record<string, unknown>): string {
  switch (node) {
    case "receive_ticket":
      return "ticket logged";
    case "consult_sop":
      return "SOP loaded";
    case "classify_doc":
      return `classified as ${summary.doc_type ?? "?"}`;
    case "extract_fields": {
      const extracted = summary.extracted as Record<string, unknown> | undefined;
      const count = extracted ? Object.values(extracted).filter((v) => v != null).length : 0;
      return `extracted ${count} field(s)`;
    }
    case "validate":
      if (summary.needs_review) return "flagged for human review";
      if (summary.deadline_flag) return "urgent — auto-filed with deadline flag";
      return "auto-filed, no flags";
    case "persist":
      return `record #${summary.record_id ?? "?"} written`;
    default:
      return "done";
  }
}

export function formatNodeStarted(node: PipelineNodeId): LogLine {
  return line(`[${NODE_LABEL[node]}] running…`, "muted");
}

export function formatRunStarted(filename: string): LogLine {
  return line(`> submitting ${filename}`, "info");
}

export function formatRunCompleted(): LogLine {
  return line(`✓ run complete`, "success");
}

export function formatRunFailed(error: string): LogLine {
  return line(`✗ run failed: ${error}`, "error");
}
