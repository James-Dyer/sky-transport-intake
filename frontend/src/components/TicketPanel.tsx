import { useState } from "react";
import { sampleTicketAttachmentUrl } from "../api";
import type { SampleTicket } from "../types";
import { Modal } from "./Modal";

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
  running,
  onCardDragStart,
  onCardDragEnd,
}: TicketPanelProps) {
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);

  return (
    <>
      <h2 className="panel-heading">Tickets</h2>
      <ul className="ticket-list">
        {sampleTickets.map((ticket) => (
          <li key={ticket.ticket_id}>
            <div
              className="ticket-card"
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
              onClick={() => setOpenTicketId(ticket.ticket_id)}
              onDoubleClick={() => !running && onRunSample(ticket.ticket_id)}
            >
              <div className="ticket-card-head">
                <strong>{ticket.subject}</strong>
                <span className="drag-hint">drag me</span>
              </div>
              <p className="preview">
                #{ticket.ticket_id} · {ticket.priority} · {ticket.attachment_filename}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {openTicketId &&
        (() => {
          const ticket = sampleTickets.find((t) => t.ticket_id === openTicketId);
          if (!ticket) return null;
          return (
            <Modal title={ticket.subject} onClose={() => setOpenTicketId(null)}>
              <pre className="ticket-card-full">
                Priority: {ticket.priority}
                {"\n"}Requester: {ticket.requester ?? "unknown"}
                {"\n"}Attachment:{" "}
                <a
                  href={sampleTicketAttachmentUrl(ticket.ticket_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="attachment-link"
                >
                  {ticket.attachment_filename}
                </a>
                {"\n\n"}
                {ticket.instructions}
              </pre>
            </Modal>
          );
        })()}
    </>
  );
}
