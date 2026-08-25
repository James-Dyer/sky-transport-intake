export const PIPELINE_NODES = [
  "receive_ticket",
  "consult_sop",
  "classify_doc",
  "extract_fields",
  "validate",
  "persist",
] as const;

export type PipelineNodeId = (typeof PIPELINE_NODES)[number];

export type NodeRunStatus = "pending" | "active" | "done" | "error";

export interface SampleDoc {
  filename: string;
  preview: string;
}

export interface NodeTrace {
  node: PipelineNodeId;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  raw_llm_call: { model?: string; prompt?: string; response_text?: string; usage?: unknown } | null;
  error: string | null;
}

export interface RunDetail {
  run_id: string;
  filename: string;
  status: "running" | "completed" | "failed";
  created_at: string;
  finished_at: string | null;
  trace: NodeTrace[];
  error: string | null;
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
  llm_client: string;
  sop_loaded_chars: number;
  db_path: string;
}
