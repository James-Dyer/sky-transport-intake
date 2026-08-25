import type { ToolId } from "./types";

export type LogTone = "info" | "success" | "error" | "muted";

export interface LogLine {
  id: string;
  text: string;
  tone: LogTone;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `log-${counter}`;
}

export function line(text: string, tone: LogTone = "info"): LogLine {
  return { id: nextId(), text, tone };
}

function truncate(text: string, limit = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit)}…` : oneLine;
}

/** One line per agent_thought — this is the "watch it think" surface: the
 * agent's own `Thought: ...` line, stripped of the prefix, streamed as it
 * decides what to do next. Pure function so it's testable without mounting
 * the component or opening an SSE connection. */
export function formatAgentThought(text: string): LogLine {
  return line(`> ${text.replace(/^Thought:\s*/, "")}`, "info");
}

export function formatToolCallStarted(tool: ToolId): LogLine {
  return line(`[${tool}] running…`, "muted");
}

export function formatToolCallFinished(
  tool: ToolId,
  resultSummary: { result: string } | null,
  durationMs: number | null,
  error: string | null
): LogLine {
  if (error) {
    return line(`[${tool}] ✗ ${truncate(error)}`, "error");
  }
  const detail = truncate(resultSummary?.result ?? "done");
  const suffix = durationMs != null ? ` (${durationMs}ms)` : "";
  return line(`[${tool}] ✓ ${detail}${suffix}`, "success");
}

export function formatRunStarted(subject: string): LogLine {
  return line(`> new ticket: ${subject}`, "info");
}

export function formatRunCompleted(): LogLine {
  return line(`✓ run complete`, "success");
}

export function formatRunFailed(error: string): LogLine {
  return line(`✗ run failed: ${error}`, "error");
}
