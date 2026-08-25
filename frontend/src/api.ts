import type { HealthInfo, RecordRow, RunDetail, SampleDoc } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8811";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, init);
  if (!resp.ok) {
    let detail = `request failed (${resp.status})`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // non-JSON error body; the status code is still informative
    }
    throw new Error(detail);
  }
  return resp.json() as Promise<T>;
}

export function fetchHealth(): Promise<HealthInfo> {
  return jsonFetch<HealthInfo>("/api/health");
}

export function fetchSampleDocs(): Promise<SampleDoc[]> {
  return jsonFetch<SampleDoc[]>("/api/sample-docs");
}

export function fetchRecords(): Promise<RecordRow[]> {
  return jsonFetch<RecordRow[]>("/api/records");
}

export function fetchRun(runId: string): Promise<RunDetail> {
  return jsonFetch<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function submitSampleDoc(
  filename: string
): Promise<{ run_id: string; doc_id: string; filename: string }> {
  return jsonFetch(`/api/tickets/sample/${encodeURIComponent(filename)}`, {
    method: "POST",
  });
}

export function submitUpload(
  file: File
): Promise<{ run_id: string; doc_id: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  return jsonFetch(`/api/tickets`, { method: "POST", body: form });
}

export function resetStore(): Promise<{ status: string }> {
  return jsonFetch(`/api/reset`, { method: "POST" });
}

export interface LiveEventHandlers {
  onNodeStarted?: (payload: { node: string; started_at: string; run_id: string }) => void;
  onNodeFinished?: (payload: {
    node: string;
    duration_ms: number;
    error: string | null;
    output_summary: Record<string, unknown>;
    run_id: string;
  }) => void;
  onRunCompleted?: (payload: Record<string, unknown>) => void;
  onRunFailed?: (payload: { error: string; run_id: string }) => void;
  onDone?: () => void;
  onError?: (err: Event) => void;
}

/** Opens an SSE connection to a run's live stream. Returns a cleanup function. */
export function streamRun(runId: string, handlers: LiveEventHandlers): () => void {
  const source = new EventSource(`${BASE}/api/runs/${encodeURIComponent(runId)}/stream`);

  const bind = <T,>(type: string, handler?: (payload: T) => void) => {
    if (!handler) return;
    source.addEventListener(type, (evt) => {
      const messageEvent = evt as MessageEvent<string>;
      handler(JSON.parse(messageEvent.data) as T);
    });
  };

  bind("node_started", handlers.onNodeStarted);
  bind("node_finished", handlers.onNodeFinished);
  bind("run_completed", handlers.onRunCompleted);
  bind("run_failed", handlers.onRunFailed);
  source.addEventListener("done", () => {
    handlers.onDone?.();
    source.close();
  });
  source.onerror = (err) => {
    handlers.onError?.(err);
  };

  return () => source.close();
}
