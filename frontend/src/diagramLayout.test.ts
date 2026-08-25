import { describe, expect, it } from "vitest";
import { deriveDiagramState } from "./diagramLayout";
import { initialPipelineState, pipelineReducer } from "./pipelineReducer";

function started() {
  return pipelineReducer(initialPipelineState, { type: "RUN_STARTED", runId: "r1", filename: "d" });
}

describe("deriveDiagramState", () => {
  it("shows an idle agent before any run starts", () => {
    const state = deriveDiagramState(initialPipelineState);
    expect(state.agent.status).toBe("pending");
    expect(state.agent.statusLine).toContain("waiting");
  });

  it("reflects the active backend node in the agent's status line", () => {
    let pipeline = started();
    pipeline = pipelineReducer(pipeline, { type: "NODE_STARTED", node: "classify_doc" });
    const state = deriveDiagramState(pipeline);
    expect(state.agent.status).toBe("active");
    expect(state.agent.statusLine).toBe("classifying document");
  });

  it("maps receive_ticket and consult_sop status onto their own diagram nodes, not the agent", () => {
    let pipeline = started();
    pipeline = pipelineReducer(pipeline, {
      type: "NODE_FINISHED",
      node: "receive_ticket",
      error: null,
      summary: {},
    });
    const state = deriveDiagramState(pipeline);
    expect(state.ticket.status).toBe("done");
    // sop hasn't started yet
    expect(state.sop.status).toBe("pending");
  });

  it("shows run complete on the agent once persist is done and nothing else is active", () => {
    let pipeline = started();
    pipeline = pipelineReducer(pipeline, {
      type: "NODE_FINISHED",
      node: "persist",
      error: null,
      summary: { record_id: 3 },
    });
    const state = deriveDiagramState(pipeline);
    expect(state.agent.status).toBe("done");
    expect(state.agent.statusLine).toBe("run complete");
    expect(state.database.status).toBe("done");
  });

  it("surfaces an error on the agent when any node fails, using that node's error text", () => {
    let pipeline = started();
    pipeline = pipelineReducer(pipeline, {
      type: "NODE_FINISHED",
      node: "extract_fields",
      error: "LLMError: bad json",
      summary: {},
    });
    const state = deriveDiagramState(pipeline);
    expect(state.agent.status).toBe("error");
    expect(state.agent.statusLine).toBe("LLMError: bad json");
  });
});
