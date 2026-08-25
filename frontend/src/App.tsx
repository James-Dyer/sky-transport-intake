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
import { agentReducer, diagramEdgeForTool, initialAgentState } from "./agentReducer";
import { IntakeEdge, type IntakeEdgeType } from "./components/IntakeEdge";
import { HubNode, type HubNodeType } from "./components/HubNode";
import { ResultSummary } from "./components/ResultSummary";
import { TerminalLog } from "./components/TerminalLog";
import { TicketPanel } from "./components/TicketPanel";
import { DIAGRAM_EDGES, DIAGRAM_NODES, deriveDiagramState, handleSuffix } from "./diagramLayout";
import {
  formatAgentThought,
  formatRunCompleted,
  formatRunFailed,
  formatRunStarted,
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
  /** Wall-clock time the diagram's active edge (activeEdgeId/pulseSeq) was
   * last set. TOOL_CALL_FINISHED already waits out MIN_ACTIVE_MS relative
   * to when its own tool started, so the forward request pulse is always
   * visible — but nothing previously stopped the *next* tool's
   * TOOL_CALL_STARTED from firing immediately afterward, which stole the
   * edge before the reverse "data" pulse it just triggered had a chance to
   * render. Pacing TOOL_CALL_STARTED against this ref too closes that gap. */
  const edgeActivatedAtRef = useRef<number>(0);
  /** run_id of the run currently "owned" by the UI. A dispatch whose
   * closure captured a different (older) run_id is stale — see runTicket's
   * isCurrentRun guard — and must be dropped rather than applied, or a
   * straggling event from a just-finished run can land after the next
   * run's RUN_STARTED and corrupt its state (e.g. pulsing an edge for a
   * tool the new run hasn't called, or racing React Flow's node
   * measurement badly enough that every node gets stuck permanently
   * visibility:hidden). */
  const currentRunIdRef = useRef<string | null>(null);
  /** Cleanup for the in-flight run's EventSource, so a new run can force-
   * close the previous one instead of leaving it streaming stale events
   * (see currentRunIdRef above) until its own "done"/error arrives. */
  const stopStreamingRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopStreamingRef.current?.(), []);

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
      // A run already streaming (its own "done"/error hasn't arrived yet)
      // must be torn down before starting another — otherwise its
      // straggling events keep landing after this run's RUN_STARTED and
      // corrupt shared state (see currentRunIdRef/stopStreamingRef above).
      stopStreamingRef.current?.();
      setBanner(null);
      setLastResult(null);
      try {
        const { run_id } = await submit();
        dispatch({ type: "RUN_STARTED", runId: run_id, subject });
        setLogLines([formatRunStarted(subject)]);

        currentRunIdRef.current = run_id;
        eventChainRef.current = Promise.resolve();
        toolStartedAtRef.current.clear();
        edgeActivatedAtRef.current = Date.now();

        const isCurrentRun = () => currentRunIdRef.current === run_id;

        const stopStreaming = streamRun(run_id, {
          onAgentThought: (payload) => {
            enqueue(() => {
              if (!isCurrentRun()) return;
              dispatch({ type: "AGENT_THOUGHT", text: payload.text });
              appendLog(formatAgentThought(payload.text));
            });
          },
          onToolCallStarted: (payload) => {
            const tool = payload.tool as ToolId;
            enqueue(async () => {
              if (!isCurrentRun()) return;
              // This tool's forward pulse is about to claim the shared
              // active edge — if the previous tool's reverse pulse only
              // just started, give it its own MIN_ACTIVE_MS on screen
              // first instead of yanking the edge out from under it.
              if (diagramEdgeForTool(tool)) {
                const delay = remainingDelay(Date.now() - edgeActivatedAtRef.current);
                if (delay > 0) await sleep(delay);
              }
              if (!isCurrentRun()) return;
              toolStartedAtRef.current.set(tool, Date.now());
              dispatch({ type: "TOOL_CALL_STARTED", tool });
              if (diagramEdgeForTool(tool)) edgeActivatedAtRef.current = Date.now();
            });
          },
          onToolCallFinished: (payload) => {
            const tool = payload.tool as ToolId;
            enqueue(async () => {
              if (!isCurrentRun()) return;
              const startedAt = toolStartedAtRef.current.get(tool) ?? Date.now();
              const delay = remainingDelay(Date.now() - startedAt);
              if (delay > 0) await sleep(delay);
              if (!isCurrentRun()) return;
              dispatch({
                type: "TOOL_CALL_FINISHED",
                tool,
                resultSummary: payload.result_summary,
                error: payload.error,
              });
              if (diagramEdgeForTool(tool)) edgeActivatedAtRef.current = Date.now();
            });
          },
          onRunCompleted: () => {
            enqueue(() => {
              if (!isCurrentRun()) return;
              void refreshRecordsAndFindRun(run_id);
              appendLog(formatRunCompleted());
            });
          },
          onRunFailed: (payload) => {
            enqueue(() => {
              if (!isCurrentRun()) return;
              setBanner(`Run failed: ${payload.error}`);
              appendLog(formatRunFailed(payload.error));
            });
          },
          onDone: () => {
            enqueue(() => {
              if (!isCurrentRun()) return;
              dispatch({ type: "RUN_DONE" });
            });
          },
          onError: () => {
            if (!isCurrentRun()) return;
            setBanner("Lost connection to the live event stream.");
          },
        });
        stopStreamingRef.current = stopStreaming;
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

  const handleTicketNodeDragLeave = useCallback((e: React.DragEvent) => {
    // dragleave fires whenever the pointer crosses ANY element boundary,
    // including moving from this node onto one of its own children (the
    // circle, the label) — without this check, wiggling over the node
    // toggles isDropTarget on/off many times a second, thrashing the whole
    // node list's re-render (see nodes useMemo below).
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
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
            targetSides: spec.targetSides,
            sourceSides: spec.sourceSides,
            writesData: spec.writesData,
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
        // The forward (request/data-out) leg's real duration is whatever
        // the live model/tool actually takes — anywhere from instant to
        // many seconds — so instead of a single pulse timed for a guess,
        // loop a token continuously for as long as the target tool is
        // still "active". Once it flips to done/error the tool call has
        // actually finished: a two-way tool gets an explicit reverse pulse
        // (activeEdgeReverse), a one-way tool (persist) just stops.
        const inFlight = !agent.activeEdgeReverse && diagramState[spec.target].status === "active";
        const pulses = isPulsing
          ? agent.activeEdgeReverse
            ? [
                {
                  key: `pulse-${agent.runId}-${agent.pulseSeq}`,
                  durationMs: 1500,
                  reverse: true,
                  kind: agent.activeEdgeKind,
                },
              ]
            : inFlight
              ? [
                  {
                    key: `pulse-${agent.runId}-${agent.pulseSeq}-loop`,
                    durationMs: 1500,
                    kind: agent.activeEdgeKind,
                    loop: true,
                  },
                ]
              : []
          : [];
        return {
          id: spec.id,
          source: spec.source,
          target: spec.target,
          sourceHandle: `out-${handleSuffix(spec.sourceSide ?? "right")}`,
          targetHandle: `in-${handleSuffix(spec.targetSide ?? "left")}`,
          type: "intake",
          data: {
            active: diagramState[spec.target].status !== "pending",
            pulses,
          },
        } satisfies IntakeEdgeType;
      }),
    [agent.activeEdgeId, agent.activeEdgeReverse, agent.activeEdgeKind, agent.pulseSeq, agent.runId, diagramState]
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
