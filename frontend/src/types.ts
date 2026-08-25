/** Tools the agent can call — the agent decides which to invoke and in
 * what order, so unlike v1's PIPELINE_NODES this is not an execution
 * sequence, just the fixed set of names that can appear in a TraceEntry
 * or an SSE tool_call_* event. */
export const TOOL_IDS = [
  "search_sop",
  "read_pdf",
  "record_classification",
  "record_extraction",
  "validate",
  "persist",
  "notify_human",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export type NodeRunStatus = "pending" | "active" | "done" | "error";

export interface SampleTicket {
  ticket_id: string;
  subject: string;
  instructions: string;
  priority: string;
  requester: string | null;
  attachment_filename: string;
}

export interface TraceEntry {
  kind: "thought" | "tool_call";
  text: string | null;
  tool: ToolId | null;
  args_summary: Record<string, unknown> | null;
  result_summary: { result: string } | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

export interface RunDetail {
  run_id: string;
  filename: string;
  status: "running" | "completed" | "failed";
  created_at: string;
  finished_at: string | null;
  trace: TraceEntry[];
  error: string | null;
  ticket_subject: string | null;
  ticket_instructions: string | null;
}

export interface RecordRow {
  id: number;
  run_id: string;
  filename: string;
  doc_type: string;
  fields: Record<string, unknown>;
  missing_fields: string[];
  needs_review: boolean;
  deadline_flag: boolean;
  urgency_reason: string | null;
  created_at: string;
}

export interface HealthInfo {
  status: string;
  model: string;
  sop_loaded_chars: number;
  sop_chunks: number;
  db_path: string;
}
