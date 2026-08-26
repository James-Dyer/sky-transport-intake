import { useEffect } from "react";
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Generic overlay dialog: closes on the close button, backdrop click, or
 * Escape. No ticket-specific logic here so it can be reused elsewhere. */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            close
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
