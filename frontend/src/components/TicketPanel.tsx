import { useRef, useState } from "react";
import type { SampleDoc } from "../types";

interface TicketPanelProps {
  sampleDocs: SampleDoc[];
  onRunSample: (filename: string) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
  running: boolean;
}

/** Replaces the old click-a-button doc list: each ticket is a card you can
 * either click (expand to see the full document text) or drag onto the
 * flowchart to feed it to the agent — dragging is what starts a run now,
 * matching how a real intake queue would work. Uses native HTML5 drag-and-
 * drop (dataTransfer carries the filename); the drop target lives in
 * App.tsx on the flow canvas. */
export function TicketPanel({ sampleDocs, onRunSample, onUpload, onReset, running }: TicketPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <p className="eyebrow">Tickets — drag onto the flow to submit</p>
      <ul className="ticket-list">
        {sampleDocs.map((doc) => {
          const isExpanded = expanded === doc.filename;
          return (
            <li key={doc.filename}>
              <div
                className={`ticket-card${isExpanded ? " is-expanded" : ""}`}
                draggable={!running}
                aria-disabled={running}
                onDragStart={(e) => {
                  if (running) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData("text/plain", doc.filename);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => setExpanded(isExpanded ? null : doc.filename)}
                onDoubleClick={() => !running && onRunSample(doc.filename)}
              >
                <div className="ticket-card-head">
                  <strong>{doc.preview.split("\n")[0]}</strong>
                  <span className="drag-hint">{isExpanded ? "click to close" : "drag me"}</span>
                </div>
                {!isExpanded ? <p className="preview">{doc.filename}</p> : null}
                {isExpanded ? <pre className="ticket-card-full">{doc.full_text}</pre> : null}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="eyebrow">Or upload a document</p>
      <div className="upload-zone">
        Plain-text intake only for this demo (simulates OCR'd document text).
        <input
          ref={fileInput}
          type="file"
          accept=".txt"
          disabled={running}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            if (fileInput.current) fileInput.current.value = "";
          }}
        />
      </div>

      <button className="reset-button" onClick={onReset} disabled={running}>
        Reset demo data
      </button>
    </>
  );
}
