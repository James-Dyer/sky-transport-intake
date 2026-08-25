import type { RecordRow } from "../types";

interface ResultSummaryProps {
  record: RecordRow | null;
  processingFilename: string | null;
}

const HEADLINE_FIELD_ORDER = [
  "carrier_name",
  "usdot_number",
  "due_date",
  "response_due_date",
  "tax_owed",
];

/** Compact, human-readable stand-in for the old raw per-node JSON trace
 * panel: doc type, a few headline fields, and the review/deadline flags —
 * everything a viewer actually wants at a glance after a run. The full
 * per-node trace is still available server-side (GET /api/runs/{id}) for
 * anyone who needs it, just not surfaced in this UI anymore. */
export function ResultSummary({ record, processingFilename }: ResultSummaryProps) {
  if (!record && !processingFilename) return null;

  if (!record) {
    return (
      <div className="result-summary">
        <h3>Processing {processingFilename}…</h3>
      </div>
    );
  }

  const headline = HEADLINE_FIELD_ORDER.filter((k) => record.fields[k] != null).slice(0, 4);

  return (
    <div className="result-summary">
      <h3>
        {record.filename} — {record.doc_type}
      </h3>
      {headline.length > 0 ? (
        <dl className="fields">
          {headline.map((k) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(record.fields[k])}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flags">
        {record.needs_review ? <span className="tag review">Needs review</span> : null}
        {record.deadline_flag ? <span className="tag deadline">Deadline</span> : null}
        {!record.needs_review && !record.deadline_flag ? <span className="tag">Auto-filed</span> : null}
        {record.missing_fields.length > 0 ? (
          <span className="tag review">Missing: {record.missing_fields.join(", ")}</span>
        ) : null}
      </div>
    </div>
  );
}
