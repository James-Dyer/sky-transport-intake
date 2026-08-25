import { describe, expect, it } from "vitest";
import {
  formatNodeFinished,
  formatNodeStarted,
  formatRunCompleted,
  formatRunFailed,
  formatRunStarted,
} from "./terminalLog";

describe("terminalLog formatting", () => {
  it("formats a run start line", () => {
    expect(formatRunStarted("01_ifta_q2.txt").text).toBe("> submitting 01_ifta_q2.txt");
  });

  it("formats a node_started line as muted", () => {
    const l = formatNodeStarted("classify_doc");
    expect(l.text).toBe("[classify_doc] running…");
    expect(l.tone).toBe("muted");
  });

  it("summarizes classify_doc with the resolved doc type", () => {
    const l = formatNodeFinished("classify_doc", 480, null, { doc_type: "IFTA_QUARTERLY" });
    expect(l.text).toBe("[classify_doc] ✓ classified as IFTA_QUARTERLY (480ms)");
    expect(l.tone).toBe("success");
  });

  it("summarizes extract_fields by counting non-null extracted values", () => {
    const l = formatNodeFinished("extract_fields", 900, null, {
      extracted: { carrier_name: "Acme", usdot_number: null, due_date: "2026-09-05" },
    });
    expect(l.text).toContain("extracted 2 field(s)");
  });

  it("distinguishes needs_review vs deadline_flag vs clean in validate", () => {
    expect(
      formatNodeFinished("validate", 1, null, { needs_review: true }).text
    ).toContain("flagged for human review");
    expect(
      formatNodeFinished("validate", 1, null, { needs_review: false, deadline_flag: true }).text
    ).toContain("urgent");
    expect(
      formatNodeFinished("validate", 1, null, { needs_review: false, deadline_flag: false }).text
    ).toContain("no flags");
  });

  it("formats an error line distinctly from a success line", () => {
    const l = formatNodeFinished("extract_fields", 50, "LLMError: bad json", {});
    expect(l.text).toBe("[extract_fields] ✗ LLMError: bad json");
    expect(l.tone).toBe("error");
  });

  it("formats run completion and failure lines", () => {
    expect(formatRunCompleted().tone).toBe("success");
    expect(formatRunFailed("boom").text).toBe("✗ run failed: boom");
  });

  it("assigns each formatted line a unique id", () => {
    const a = formatRunStarted("a.txt");
    const b = formatRunStarted("b.txt");
    expect(a.id).not.toBe(b.id);
  });
});
