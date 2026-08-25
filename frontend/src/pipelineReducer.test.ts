import { describe, expect, it } from "vitest";
import { initialPipelineState, pipelineReducer } from "./pipelineReducer";

describe("pipelineReducer", () => {
  it("resets all node statuses to pending on RUN_STARTED", () => {
    const state = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "doc.txt",
    });
    expect(state.running).toBe(true);
    expect(state.runId).toBe("r1");
    expect(Object.values(state.statuses).every((s) => s.status === "pending")).toBe(true);
  });

  it("marks a node active on NODE_STARTED", () => {
    let state = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "doc.txt",
    });
    state = pipelineReducer(state, { type: "NODE_STARTED", node: "classify_doc" });
    expect(state.statuses.classify_doc.status).toBe("active");
    expect(state.statuses.receive_ticket.status).toBe("pending");
  });

  it("marks a node done with a human-readable summary on NODE_FINISHED", () => {
    let state = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "doc.txt",
    });
    state = pipelineReducer(state, {
      type: "NODE_FINISHED",
      node: "classify_doc",
      error: null,
      summary: { doc_type: "IFTA_QUARTERLY" },
    });
    expect(state.statuses.classify_doc.status).toBe("done");
    expect(state.statuses.classify_doc.label).toBe("IFTA_QUARTERLY");
  });

  it("marks a node error and does not advance the pulsing edge on failure", () => {
    let state = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "doc.txt",
    });
    state = pipelineReducer(state, {
      type: "NODE_FINISHED",
      node: "extract_fields",
      error: "LLMError: bad json",
      summary: {},
    });
    expect(state.statuses.extract_fields.status).toBe("error");
    expect(state.statuses.extract_fields.label).toBe("LLMError: bad json");
    expect(state.activeEdgeIndex).toBeNull();
  });

  it("summarizes validate outcomes distinctly for review vs urgent vs ok", () => {
    const run = () =>
      pipelineReducer(initialPipelineState, { type: "RUN_STARTED", runId: "r1", filename: "d" });

    const review = pipelineReducer(run(), {
      type: "NODE_FINISHED",
      node: "validate",
      error: null,
      summary: { needs_review: true, deadline_flag: false },
    });
    expect(review.statuses.validate.label).toBe("needs review");

    const urgent = pipelineReducer(run(), {
      type: "NODE_FINISHED",
      node: "validate",
      error: null,
      summary: { needs_review: false, deadline_flag: true },
    });
    expect(urgent.statuses.validate.label).toBe("urgent");

    const ok = pipelineReducer(run(), {
      type: "NODE_FINISHED",
      node: "validate",
      error: null,
      summary: { needs_review: false, deadline_flag: false },
    });
    expect(ok.statuses.validate.label).toBe("ok");
  });

  it("returns to idle statuses on RESET", () => {
    let state = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "d",
    });
    state = pipelineReducer(state, {
      type: "NODE_FINISHED",
      node: "persist",
      error: null,
      summary: { record_id: 1 },
    });
    expect(state.statuses.persist.status).toBe("done");
    state = pipelineReducer(state, { type: "RESET" });
    expect(state).toEqual(initialPipelineState);
  });

  it("sets running false on RUN_DONE and RUN_ERROR", () => {
    const started = pipelineReducer(initialPipelineState, {
      type: "RUN_STARTED",
      runId: "r1",
      filename: "d",
    });
    expect(pipelineReducer(started, { type: "RUN_DONE" }).running).toBe(false);
    expect(
      pipelineReducer(started, { type: "RUN_ERROR", message: "boom" }).running
    ).toBe(false);
  });
});
