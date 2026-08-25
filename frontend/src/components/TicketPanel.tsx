import { useRef, useState } from "react";
import type { SampleTicket } from "../types";

const DRAG_THUMB_TITLE_LIMIT = 28;

function truncateTitle(title: string, limit = DRAG_THUMB_TITLE_LIMIT) {
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}

/** Native HTML5 drag only lets you swap the drag image once, at dragstart —
 * there's no way to restyle the element being dragged after the fact, so we
 * build a standalone "document" node off-screen and hand it to
 * setDragImage. It's removed on the next tick once the browser has taken
 * its snapshot. */
function buildDragThumbnail(title: string) {
  const el = document.createElement("div");
  el.className = "ticket-drag-thumb";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.innerHTML =
    '<path d="M5 2h9l5 5v15H5z" fill="#fff" stroke="#111" stroke-width="1.2"/>' +
    '<path d="M14 2v5h5" fill="none" stroke="#111" stroke-width="1.2"/>';

  const label = document.createElement("span");
  label.textContent = truncateTitle(title);

  el.appendChild(icon);
  el.appendChild(label);
  document.body.appendChild(el);
  return el;
}

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
      <h2 className="panel-heading">Tickets</h2>
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
                  const thumb = buildDragThumbnail(ticket.subject);
                  e.dataTransfer.setDragImage(thumb, 14, 14);
                  window.setTimeout(() => thumb.remove(), 0);
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
