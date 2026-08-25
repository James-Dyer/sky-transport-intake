import { useEffect, useRef } from "react";
import type { LogLine } from "../terminalLog";

interface TerminalLogProps {
  lines: LogLine[];
}

/** Adapted from agent-gate's .arena-terminal: a small black monospace box
 * with traffic-light dots, streamed line by line as SSE events arrive —
 * this is the live "watch the agent think" surface, distinct from the
 * structured post-run trace in DebugPanel below it. */
export function TerminalLog({ lines }: TerminalLogProps) {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="terminal-log">
      <header>
        <span className="dot dot-red" />
        <span className="dot" />
        <span className="dot" />
        <strong>agent.log</strong>
      </header>
      <div className="terminal-output" ref={outputRef}>
        {lines.length === 0 ? (
          <span className="terminal-line muted">$ waiting for a document…</span>
        ) : (
          lines.map((l) => (
            <span key={l.id} className={`terminal-line ${l.tone}`}>
              {l.text}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
