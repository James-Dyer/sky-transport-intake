import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Background, ReactFlow, type Edge } from "@xyflow/react";
import {
  fetchRecords,
  fetchSampleTickets,
  resetStore,
  streamRun,
  submitSampleTicket,
  submitUpload,
} from "./api";
import { agentReducer, initialAgentState } from "./agentReducer";
import { IntakeEdge, type IntakeEdgeType } from "./components/IntakeEdge";
import { HubNode, type HubNodeType } from "./components/HubNode";
import { ResultSummary } from "./components/ResultSummary";
import { TerminalLog } from "./components/TerminalLog";
import { TicketPanel } from "./components/TicketPanel";
import { DIAGRAM_EDGES, DIAGRAM_NODES, deriveDiagramState } from "./diagramLayout";
import {
  formatAgentThought,
  formatRunCompleted,
  formatRunFailed,
  formatRunStarted,
  formatToolCallFinished,
  formatToolCallStarted,
  type LogLine,
} from "./terminalLog";
import { remainingDelay } from "./timing";
import type { RecordRow, SampleTicket, ToolId } from "./types";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const NODE_TYPES = { hub: HubNode };
const EDGE_TYPES = { intake: IntakeEdge };

function App() {
  const [sampleTickets, setSampleTickets] = useState<SampleTicket[]>([]);
  const [agent, dispatch] = useReducer(agentReducer, initialAgentState);
  const [lastResult, setLastResult] = useState<RecordRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isDraggingTicket, setIsDraggingTicket] = useState(false);
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());
  const toolStartedAtRef = useRef<Map<ToolId, number>>(new Map());

  /** Runs `fn` after every previously enqueued event has finished, so a
   * TOOL_CALL_FINISHED that's artificially delayed (see timing.ts) can't be
   * overtaken by the next event, agent_thought, or the final "done"
   * dispatch — everything the UI shows stays in true event order even
   * though some dispatches are deliberately slowed down. */
  const enqueue = useCallback((fn: () => void | Promise<void>) => {
    eventChainRef.current = eventChainRef.current.then(fn);
  }, []);

  const appendLog = useCallback((l: LogLine) => {
    setLogLines((prev) => [...prev, l]);
  }, []);

  const refreshRecordsAndFindRun = useCallback(async (runId: string) => {
    try {
      const rows = await fetchRecords();
      const match = rows.find((r) => r.run_id === runId);
      if (match) setLastResult(match);
    } catch (err) {
      setBanner(String(err));
    }
  }, []);

  useEffect(() => {
    fetchSampleTickets().then(setSampleTickets).catch((err) => setBanner(String(err)));
  }, []);

  const runTicket = useCallback(
    async (subject: string, submit: () => Promise<{ run_id: string; filename: string }>) => {
      setBanner(null);
      setLastResult(null);
      try {
        const { run_id } = await submit();
        dispatch({ type: "RUN_STARTED", runId: run_id, subject });
        setLogLines([formatRunStarted(subject)]);

        eventChainRef.current = Promise.resolve();
        toolStartedAtRef.current.clear();

        const stopStreaming = streamRun(run_id, {
          onAgentThought: (payload) => {
            enqueue(() => {
              dispatch({ type: "AGENT_THOUGHT", text: payload.text });
              appendLog(formatAgentThought(payload.text));
            });
          },
          onToolCallStarted: (payload) => {
            const tool = payload.tool as ToolId;
            enqueue(() => {
              toolStartedAtRef.current.set(tool, Date.now());
              dispatch({ type: "TOOL_CALL_STARTED", tool });
              appendLog(formatToolCallStarted(tool));
            });
          },
          onToolCallFinished: (payload) => {
            const tool = payload.tool as ToolId;
            enqueue(async () => {
              const startedAt = toolStartedAtRef.current.get(tool) ?? Date.now();
              const delay = remainingDelay(Date.now() - startedAt);
              if (delay > 0) await sleep(delay);
              dispatch({
                type: "TOOL_CALL_FINISHED",
                tool,
                resultSummary: payload.result_summary,
                error: payload.error,
              });
              appendLog(
                formatToolCallFinished(tool, payload.result_summary, payload.duration_ms, payload.error)
              );
            });
          },
          onRunCompleted: () => {
            enqueue(() => {
              void refreshRecordsAndFindRun(run_id);
              appendLog(formatRunCompleted());
            });
          },
          onRunFailed: (payload) => {
            enqueue(() => {
              setBanner(`Run failed: ${payload.error}`);
              appendLog(formatRunFailed(payload.error));
            });
          },
          onDone: () => {
            enqueue(() => {
              dispatch({ type: "RUN_DONE" });
            });
          },
          onError: () => {
            setBanner("Lost connection to the live event stream.");
          },
        });
        return stopStreaming;
      } catch (err) {
        dispatch({ type: "RUN_ERROR", message: String(err) });
        setBanner(String(err));
        return undefined;
      }
    },
    [refreshRecordsAndFindRun, appendLog, enqueue]
  );

  const handleRunSample = useCallback(
    (ticketId: string) => {
      const ticket = sampleTickets.find((t) => t.ticket_id === ticketId);
      void runTicket(ticket?.subject ?? `ticket #${ticketId}`, () => submitSampleTicket(ticketId));
    },
    [runTicket, sampleTickets]
  );

  const handleUpload = useCallback(
    (file: File, instructions: string, subject: string) => {
      const displaySubject = subject || `Uploaded ticket: ${file.name}`;
      void runTicket(displaySubject, () => submitUpload(file, instructions, subject));
    },
    [runTicket]
  );

  const handleReset = useCallback(() => {
    resetStore()
      .then(() => {
        setLastResult(null);
        setLogLines([]);
        dispatch({ type: "RESET" });
      })
      .catch((err) => setBanner(String(err)));
  }, []);

  const handleCardDragStart = useCallback(() => {
    setIsDraggingTicket(true);
  }, []);

  const handleCardDragEnd = useCallback(() => {
    setIsDraggingTicket(false);
    setIsDropTarget(false);
  }, []);

  const handleTicketNodeDragOver = useCallback(
    (e: React.DragEvent) => {
      if (agent.running) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    },
    [agent.running]
  );

  const handleTicketNodeDragLeave = useCallback(() => {
    setIsDropTarget(false);
  }, []);

  const handleTicketNodeDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);
      if (agent.running) return;
      const ticketId = e.dataTransfer.getData("text/plain");
      if (ticketId) handleRunSample(ticketId);
    },
    [agent.running, handleRunSample]
  );

  const diagramState = useMemo(() => deriveDiagramState(agent), [agent]);

  const nodes: HubNodeType[] = useMemo(
    () =>
      DIAGRAM_NODES.map((spec) => {
        const isTicketNode = spec.id === "ticket";
        return {
          id: spec.id,
          type: "hub",
          position: { x: spec.x, y: spec.y },
          data: {
            diagramId: spec.id,
            label: spec.label,
            statusLine: diagramState[spec.id].statusLine,
            status: diagramState[spec.id].status,
            size: spec.size,
            isDropZone: isTicketNode,
            isDropArmed: isTicketNode && isDraggingTicket,
            isDropActive: isTicketNode && isDropTarget,
            onDropZoneDragOver: isTicketNode ? handleTicketNodeDragOver : undefined,
            onDropZoneDragLeave: isTicketNode ? handleTicketNodeDragLeave : undefined,
            onDropZoneDrop: isTicketNode ? handleTicketNodeDrop : undefined,
          },
          draggable: false,
          selectable: true,
        };
      }),
    [
      diagramState,
      isDraggingTicket,
      isDropTarget,
      handleTicketNodeDragOver,
      handleTicketNodeDragLeave,
      handleTicketNodeDrop,
    ]
  );

  const edges: IntakeEdgeType[] = useMemo(
    () =>
      DIAGRAM_EDGES.map((spec) => {
        const isPulsing = agent.activeEdgeId === spec.id;
        return {
          id: spec.id,
          source: spec.source,
          target: spec.target,
          type: "intake",
          data: {
            active: diagramState[spec.target].status !== "pending",
            pulses: isPulsing
              ? [
                  {
                    key: `pulse-${agent.runId}-${agent.pulseSeq}`,
                    durationMs: 900,
                    reverse: agent.activeEdgeReverse,
                  },
                ]
              : [],
          },
        } satisfies IntakeEdgeType;
      }),
    [agent.activeEdgeId, agent.activeEdgeReverse, agent.pulseSeq, agent.runId, diagramState]
  );

  return (
    <div className="app-root">
      <div className="controls-panel">
        <TicketPanel
          sampleTickets={sampleTickets}
          onRunSample={handleRunSample}
          onUpload={handleUpload}
          onReset={handleReset}
          running={agent.running}
          onCardDragStart={handleCardDragStart}
          onCardDragEnd={handleCardDragEnd}
        />
      </div>

      <div className="flow-surface">
        {banner ? (
          <div
            className="error-banner"
            style={{ position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 }}
          >
            {banner}
          </div>
        ) : null}
        <ReactFlow<HubNodeType, Edge>
          nodes={nodes}
          edges={edges}
          edgeTypes={EDGE_TYPES}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#eee" gap={24} />
        </ReactFlow>
      </div>

      <div className="debug-panel">
        <ResultSummary record={lastResult} processingSubject={agent.running ? agent.ticketSubject : null} />
        <TerminalLog lines={logLines} />
      </div>
    </div>
  );
}

export default App;
