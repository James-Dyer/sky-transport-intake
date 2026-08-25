import { describe, expect, it } from "vitest";
import {
  formatAgentThought,
  formatRunCompleted,
  formatRunFailed,
  formatRunStarted,
  formatToolCallFinished,
  formatToolCallStarted,
} from "./terminalLog";

describe("terminalLog formatting", () => {
  it("formats a run start line", () => {
    expect(formatRunStarted("Process IFTA filing").text).toBe("> new ticket: Process IFTA filing");
  });

  it("strips the Thought: prefix from an agent_thought line", () => {
    const l = formatAgentThought("Thought: reading the attached document.");
    expect(l.text).toBe("> reading the attached document.");
    expect(l.tone).toBe("info");
  });

  it("formats a tool_call_started line as muted", () => {
    const l = formatToolCallStarted("search_sop");
    expect(l.text).toBe("[search_sop] running…");
    expect(l.tone).toBe("muted");
  });

  it("formats a successful tool_call_finished line with its result and duration", () => {
    const l = formatToolCallFinished("persist", { result: '{"record_id": 3}' }, 42, null);
    expect(l.text).toBe('[persist] ✓ {"record_id": 3} (42ms)');
    expect(l.tone).toBe("success");
  });

  it("truncates a long result to keep the terminal line readable", () => {
    const longResult = "x".repeat(300);
    const l = formatToolCallFinished("search_sop", { result: longResult }, 10, null);
    expect(l.text.length).toBeLessThan(200);
    expect(l.text).toContain("…");
  });

  it("formats an error line distinctly from a success line", () => {
    const l = formatToolCallFinished("read_pdf", null, 50, "could not read PDF");
    expect(l.text).toBe("[read_pdf] ✗ could not read PDF");
    expect(l.tone).toBe("error");
  });

  it("formats run completion and failure lines", () => {
    expect(formatRunCompleted().tone).toBe("success");
    expect(formatRunFailed("boom").text).toBe("✗ run failed: boom");
  });

  it("assigns each formatted line a unique id", () => {
    const a = formatRunStarted("a");
    const b = formatRunStarted("b");
    expect(a.id).not.toBe(b.id);
  });
});
