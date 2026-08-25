import type { DiagramNodeId } from "../diagramLayout";

const ICON_BY_NODE: Record<DiagramNodeId, string> = {
  ticket: "ticket",
  sop_search: "book",
  pdf_reader: "scan",
  agent: "robot",
  validate: "check",
  database: "database",
};

interface NodeIconProps {
  node: DiagramNodeId;
}

/** Same construction as agent-gate's SystemIcon: a fixed 32x32 viewBox,
 * stroke-only paths driven by currentColor so the node wrapper controls
 * color per status (pending/active/done/error) via CSS. */
export function NodeIcon({ node }: NodeIconProps) {
  const kind = ICON_BY_NODE[node];
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {kind === "ticket" ? (
        <>
          <path {...common} d="M5 12a3 3 0 0 0 0 8v4h22v-4a3 3 0 0 1 0-8V8H5z" />
          <path {...common} d="M13 8v16" strokeDasharray="2 3" />
        </>
      ) : null}
      {kind === "book" ? (
        <>
          <path {...common} d="M6 6h11a3 3 0 0 1 3 3v17H9a3 3 0 0 1-3-3z" />
          <path {...common} d="M20 6h6v20h-3a3 3 0 0 0-3 3" />
        </>
      ) : null}
      {kind === "scan" ? (
        <>
          <path {...common} d="M6 11V7a2 2 0 0 1 2-2h4M26 11V7a2 2 0 0 0-2-2h-4M6 21v4a2 2 0 0 0 2 2h4M26 21v4a2 2 0 0 1-2 2h-4" />
          <path {...common} d="M6 16h20" />
        </>
      ) : null}
      {kind === "check" ? (
        <>
          <path {...common} d="M16 4 25 8v7c0 6-3.8 10.1-9 13-5.2-2.9-9-7-9-13V8z" />
          <path {...common} d="m11.5 16 3 3 6-7" />
        </>
      ) : null}
      {kind === "database" ? (
        <>
          <ellipse {...common} cx="16" cy="8" rx="9" ry="4" />
          <path {...common} d="M7 8v8c0 2.2 4 4 9 4s9-1.8 9-4V8M7 16v8c0 2.2 4 4 9 4s9-1.8 9-4v-8" />
        </>
      ) : null}
      {kind === "robot" ? (
        <>
          <rect {...common} x="7" y="9" width="18" height="15" rx="4" />
          <path {...common} d="M16 5v4M11 16h.1M21 16h.1M12 20h8" />
        </>
      ) : null}
    </svg>
  );
}
