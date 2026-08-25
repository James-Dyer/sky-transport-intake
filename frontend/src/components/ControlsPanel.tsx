import { useRef } from "react";
import type { SampleDoc } from "../types";

interface ControlsPanelProps {
  sampleDocs: SampleDoc[];
  onRunSample: (filename: string) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
  running: boolean;
}

export function ControlsPanel({ sampleDocs, onRunSample, onUpload, onReset, running }: ControlsPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <>
      <p className="eyebrow">Sample documents</p>
      <ul className="doc-list">
        {sampleDocs.map((doc) => (
          <li key={doc.filename}>
            <button
              className="doc-item"
              disabled={running}
              onClick={() => onRunSample(doc.filename)}
            >
              <strong>{doc.filename}</strong>
              <span>{doc.preview.split("\n")[0]}</span>
            </button>
          </li>
        ))}
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
