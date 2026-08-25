import type { NodeTrace, PipelineNodeId } from "../types";

interface DebugPanelProps {
  trace: NodeTrace[];
  selectedNode: PipelineNodeId | null;
}

/** The "go back and assess success" surface: for a completed run, shows
 * exactly what each node did — timing, the SOP-derived decision, and (for
 * the LLM-backed nodes) the raw prompt/response the model actually saw.
 * This mirrors what's persisted server-side in SQLite per run_id, so
 * nothing shown here is reconstructed or approximated. */
export function DebugPanel({ trace, selectedNode }: DebugPanelProps) {
  const entries = selectedNode ? trace.filter((t) => t.node === selectedNode) : trace;

  if (entries.length === 0) {
    return (
      <>
        <p className="eyebrow">Diagnostics</p>
        <p className="empty-state">
          Run a document to see per-node timing, SOP-driven decisions, and raw model
          calls here.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">Diagnostics{selectedNode ? ` — ${selectedNode}` : ""}</p>
      {entries.map((entry, i) => (
        <div className={`trace-entry${entry.error ? " has-error" : ""}`} key={`${entry.node}-${i}`}>
          <h4>{entry.node}</h4>
          <div className="meta">
            {entry.duration_ms}ms · {new Date(entry.started_at).toLocaleTimeString()}
          </div>
          {entry.error ? <pre>{entry.error}</pre> : null}
          {!entry.error && Object.keys(entry.output_summary).length > 0 ? (
            <pre>{JSON.stringify(entry.output_summary, null, 2)}</pre>
          ) : null}
          {entry.raw_llm_call ? (
            <details>
              <summary style={{ fontSize: 10, cursor: "pointer", marginTop: 4 }}>
                raw model call ({entry.raw_llm_call.model})
              </summary>
              <pre>{entry.raw_llm_call.response_text}</pre>
            </details>
          ) : null}
        </div>
      ))}
    </>
  );
}
