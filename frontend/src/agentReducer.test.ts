import { describe, expect, it } from "vitest";
import { agentReducer, initialAgentState } from "./agentReducer";

function started() {
  return agentReducer(initialAgentState, { type: "RUN_STARTED", runId: "r1", subject: "s" });
}

describe("agentReducer", () => {
  it("resets tool statuses to pending on RUN_STARTED", () => {
    const state = started();
    expect(state.running).toBe(true);
    expect(state.runId).toBe("r1");
    expect(Object.values(state.toolStatuses).every((s) => s.status === "pending")).toBe(true);
    expect(state.activeEdgeId).toBe("ticket-agent");
  });

  it("updates the agent's status line from an agent_thought, stripping the prefix", () => {
    const state = agentReducer(started(), { type: "AGENT_THOUGHT", text: "Thought: reading the PDF." });
    expect(state.agentStatus).toBe("active");
    expect(state.agentStatusLine).toBe("reading the PDF.");
  });

  it("marks a spoke tool active on TOOL_CALL_STARTED and pulses the right edge", () => {
    const state = agentReducer(started(), { type: "TOOL_CALL_STARTED", tool: "search_sop" });
    expect(state.toolStatuses.search_sop.status).toBe("active");
    expect(state.activeEdgeId).toBe("agent-sop_search");
    expect(state.activeEdgeReverse).toBe(false);
  });

  it("marks a spoke tool done with a summarized label on TOOL_CALL_FINISHED, pulsing the edge in reverse", () => {
    let state = started();
    state = agentReducer(state, { type: "TOOL_CALL_STARTED", tool: "validate" });
    state = agentReducer(state, {
      type: "TOOL_CALL_FINISHED",
      tool: "validate",
      resultSummary: { result: JSON.stringify({ needs_review: false, deadline_flag: true }) },
      error: null,
    });
    expect(state.toolStatuses.validate.status).toBe("done");
    expect(state.toolStatuses.validate.label).toBe("urgent");
    expect(state.activeEdgeId).toBe("agent-validate");
    expect(state.activeEdgeReverse).toBe(true);
  });

  it("does not reverse the persist edge (agent -> database is one-directional)", () => {
    let state = started();
    state = agentReducer(state, { type: "TOOL_CALL_STARTED", tool: "persist" });
    state = agentReducer(state, {
      type: "TOOL_CALL_FINISHED",
      tool: "persist",
      resultSummary: { result: JSON.stringify({ record_id: 7 }) },
      error: null,
    });
    expect(state.toolStatuses.persist.status).toBe("done");
    expect(state.toolStatuses.persist.label).toBe("record #7");
    expect(state.activeEdgeReverse).toBe(false);
  });

  it("marks a spoke tool errored and surfaces the error text as its label", () => {
    let state = started();
    state = agentReducer(state, { type: "TOOL_CALL_STARTED", tool: "read_pdf" });
    state = agentReducer(state, {
      type: "TOOL_CALL_FINISHED",
      tool: "read_pdf",
      resultSummary: null,
      error: "could not read PDF",
    });
    expect(state.toolStatuses.read_pdf.status).toBe("error");
    expect(state.toolStatuses.read_pdf.label).toBe("could not read PDF");
  });

  it("does not give record_classification/record_extraction their own spoke node, only updates agent status", () => {
    let state = started();
    state = agentReducer(state, { type: "TOOL_CALL_STARTED", tool: "record_classification" });
    // no spoke tool changed status
    expect(Object.values(state.toolStatuses).every((s) => s.status === "pending")).toBe(true);
    state = agentReducer(state, {
      type: "TOOL_CALL_FINISHED",
      tool: "record_classification",
      resultSummary: { result: "recorded classification: IFTA_QUARTERLY (confidence=0.9)" },
      error: null,
    });
    expect(state.agentStatusLine).toBe("recorded classification: IFTA_QUARTERLY (confidence=0.9)");
    expect(Object.values(state.toolStatuses).every((s) => s.status === "pending")).toBe(true);
  });

  it("shows run complete on RUN_DONE and surfaces an error message on RUN_ERROR", () => {
    expect(agentReducer(started(), { type: "RUN_DONE" }).agentStatusLine).toBe("run complete");
    const errored = agentReducer(started(), { type: "RUN_ERROR", message: "boom" });
    expect(errored.running).toBe(false);
    expect(errored.agentStatus).toBe("error");
    expect(errored.error).toBe("boom");
  });

  it("returns to idle state on RESET", () => {
    const state = agentReducer(started(), { type: "TOOL_CALL_STARTED", tool: "search_sop" });
    expect(agentReducer(state, { type: "RESET" })).toEqual(initialAgentState);
  });
});
