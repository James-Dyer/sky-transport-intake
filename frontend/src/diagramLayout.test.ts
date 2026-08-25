import { describe, expect, it } from "vitest";
import { agentReducer, initialAgentState } from "./agentReducer";
import { deriveDiagramState } from "./diagramLayout";

function started() {
  return agentReducer(initialAgentState, { type: "RUN_STARTED", runId: "r1", subject: "s" });
}

describe("deriveDiagramState", () => {
  it("shows an idle agent and pending ticket before any run starts", () => {
    const state = deriveDiagramState(initialAgentState);
    expect(state.agent.status).toBe("pending");
    expect(state.agent.statusLine).toContain("waiting");
    expect(state.ticket.status).toBe("pending");
  });

  it("marks the ticket node done as soon as a run starts", () => {
    const state = deriveDiagramState(started());
    expect(state.ticket.status).toBe("done");
  });

  it("reflects a spoke tool's status on its own diagram node, independent of the agent", () => {
    let agent = started();
    agent = agentReducer(agent, { type: "TOOL_CALL_STARTED", tool: "search_sop" });
    const state = deriveDiagramState(agent);
    expect(state.sop_search.status).toBe("active");
    // pdf_reader hasn't been called yet
    expect(state.pdf_reader.status).toBe("pending");
  });

  it("shows run complete on the agent once RUN_DONE fires", () => {
    let agent = started();
    agent = agentReducer(agent, { type: "TOOL_CALL_STARTED", tool: "persist" });
    agent = agentReducer(agent, {
      type: "TOOL_CALL_FINISHED",
      tool: "persist",
      resultSummary: { result: JSON.stringify({ record_id: 3 }) },
      error: null,
    });
    agent = agentReducer(agent, { type: "RUN_DONE" });
    const state = deriveDiagramState(agent);
    expect(state.agent.status).toBe("done");
    expect(state.agent.statusLine).toBe("run complete");
    expect(state.database.status).toBe("done");
  });

  it("reflects notify_human's status on its own diagram node", () => {
    let agent = started();
    agent = agentReducer(agent, { type: "TOOL_CALL_STARTED", tool: "notify_human" });
    expect(deriveDiagramState(agent).notify_human.status).toBe("active");
    agent = agentReducer(agent, {
      type: "TOOL_CALL_FINISHED",
      tool: "notify_human",
      resultSummary: { result: JSON.stringify({ notified: true }) },
      error: null,
    });
    const state = deriveDiagramState(agent);
    expect(state.notify_human.status).toBe("done");
    expect(state.notify_human.statusLine).toBe("human notified");
  });

  it("surfaces an error on the agent when a tool call fails", () => {
    let agent = started();
    agent = agentReducer(agent, { type: "RUN_ERROR", message: "GraphRecursionError: too many steps" });
    const state = deriveDiagramState(agent);
    expect(state.agent.status).toBe("error");
    expect(state.agent.statusLine).toBe("GraphRecursionError: too many steps");
  });
});
