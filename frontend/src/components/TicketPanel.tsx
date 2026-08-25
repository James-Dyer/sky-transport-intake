import { useRef, useState } from "react";
import type { SampleTicket } from "../types";

interface TicketPanelProps {
  sampleTickets: SampleTicket[];
  onRunSample: (ticketId: string) => void;
  onUpload: (file: File, instructions: string, subject: string) => void;
  onReset: () => void;
  running: boolean;
  onCardDragStart: () => void;
  onCardDragEnd: () => void;
}

/** Each ticket is a card you can either click (expand to see the full
 * instructions) or drag onto the flowchart to feed it to the agent —
 * dragging is what starts a run, matching how a real intake queue would
 * work. Uses native HTML5 drag-and-drop (dataTransfer carries the
 * ticket_id); the drop target lives in App.tsx on the flow canvas. */
export function TicketPanel({
  sampleTickets,
  onRunSample,
  onUpload,
  onReset,
  running,
  onCardDragStart,
  onCardDragEnd,
}: TicketPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploadInstructions, setUploadInstructions] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const submitUpload = () => {
    if (pendingFile && uploadInstructions.trim()) {
      onUpload(pendingFile, uploadInstructions.trim(), uploadSubject.trim());
      setPendingFile(null);
      setUploadInstructions("");
      setUploadSubject("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <>
      <p className="eyebrow">Tickets — drag onto the agent to submit</p>
      <ul className="ticket-list">
        {sampleTickets.map((ticket) => {
          const isExpanded = expanded === ticket.ticket_id;
          return (
            <li key={ticket.ticket_id}>
              <div
                className={`ticket-card${isExpanded ? " is-expanded" : ""}`}
                draggable={!running}
                aria-disabled={running}
                onDragStart={(e) => {
                  if (running) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData("text/plain", ticket.ticket_id);
                  e.dataTransfer.effectAllowed = "copy";
                  onCardDragStart();
                }}
                onDragEnd={onCardDragEnd}
                onClick={() => setExpanded(isExpanded ? null : ticket.ticket_id)}
                onDoubleClick={() => !running && onRunSample(ticket.ticket_id)}
              >
                <div className="ticket-card-head">
                  <strong>{ticket.subject}</strong>
                  <span className="drag-hint">{isExpanded ? "click to close" : "drag me"}</span>
                </div>
                {!isExpanded ? (
                  <p className="preview">
                    #{ticket.ticket_id} · {ticket.priority} · {ticket.attachment_filename}
                  </p>
                ) : (
                  <pre className="ticket-card-full">
                    Priority: {ticket.priority}
                    {"\n"}Requester: {ticket.requester ?? "unknown"}
                    {"\n"}Attachment: {ticket.attachment_filename}
                    {"\n\n"}
                    {ticket.instructions}
                  </pre>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="eyebrow">Or submit a new ticket</p>
      <div className="upload-zone">
        <textarea
          placeholder="Ticket instructions…"
          value={uploadInstructions}
          disabled={running}
          onChange={(e) => setUploadInstructions(e.target.value)}
        />
        <input
          type="text"
          placeholder="Subject (optional)"
          value={uploadSubject}
          disabled={running}
          onChange={(e) => setUploadSubject(e.target.value)}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".pdf"
          disabled={running}
          onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
        />
        <button
          className="submit-ticket-button"
          disabled={running || !pendingFile || !uploadInstructions.trim()}
          onClick={submitUpload}
        >
          Submit ticket
        </button>
      </div>

      <button className="reset-button" onClick={onReset} disabled={running}>
        Reset demo data
      </button>
    </>
  );
}
