import type { RecordRow } from "../types";

interface RecordsTableProps {
  records: RecordRow[];
}

function fieldPreview(record: RecordRow): string {
  const entries = Object.entries(record.fields).filter(([, v]) => v != null);
  if (entries.length === 0) return "—";
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

export function RecordsTable({ records }: RecordsTableProps) {
  if (records.length === 0) {
    return (
      <div className="records-strip">
        <p className="empty-state">
          No records yet — submit a document from the left panel to see it land here.
        </p>
      </div>
    );
  }
  return (
    <div className="records-strip">
      <table>
        <thead>
          <tr>
            <th>Doc</th>
            <th>Type</th>
            <th>Fields</th>
            <th>Flags</th>
            <th>Filed</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              className={
                r.needs_review ? "needs-review" : r.deadline_flag ? "deadline-flag" : undefined
              }
            >
              <td>{r.filename}</td>
              <td>{r.doc_type}</td>
              <td>{fieldPreview(r)}</td>
              <td>
                {r.needs_review ? <span className="tag review">Needs review</span> : null}
                {r.deadline_flag ? <span className="tag deadline">Deadline</span> : null}
                {!r.needs_review && !r.deadline_flag ? <span className="tag">Auto-filed</span> : null}
              </td>
              <td>{new Date(r.created_at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
