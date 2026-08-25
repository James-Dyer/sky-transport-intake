import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Background, ReactFlow, type Edge } from "@xyflow/react";
import {
  fetchRecords,
  fetchSampleDocs,
  resetStore,
  streamRun,
  submitSampleDoc,
  submitUpload,
} from "./api";
import { IntakeEdge, type IntakeEdgeType } from "./components/IntakeEdge";
import { HubNode, type HubNodeType } from "./components/HubNode";
import { ResultSummary } from "./components/ResultSummary";
import { TerminalLog } from "./components/TerminalLog";
import { TicketPanel } from "./components/TicketPanel";
import { DIAGRAM_EDGES, DIAGRAM_NODES, deriveDiagramState } from "./diagramLayout";
import { initialPipelineState, pipelineReducer } from "./pipelineReducer";
import {
  formatNodeFinished,
  formatNodeStarted,
  formatRunCompleted,
  formatRunFailed,
  formatRunStarted,
  type LogLine,
} from "./terminalLog";
import { remainingDelay } from "./timing";
import type { PipelineNodeId, RecordRow, SampleDoc } from "./types";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const NODE_TYPES = { hub: HubNode };
const EDGE_TYPES = { intake: IntakeEdge };

function App() {
  const [sampleDocs, setSampleDocs] = useState<SampleDoc[]>([]);
  const [pipeline, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [lastResult, setLastResult] = useState<RecordRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const eventChainRef = useRef<Promise<void>>(Promise.resolve());
  const nodeStartedAtRef = useRef<Map<PipelineNodeId, number>>(new Map());

  /** Runs `fn` after every previously enqueued event has finished, so a
   * NODE_FINISHED that's artificially delayed (see timing.ts) can't be
   * overtaken by the next node's NODE_STARTED, run_completed, or the final
   * "done" dispatch — everything the UI shows stays in true event order
   * even though some dispatches are deliberately slowed down. */
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
    fetchSampleDocs().then(setSampleDocs).catch((err) => setBanner(String(err)));
  }, []);

  const runDocument = useCallback(
    async (submit: () => Promise<{ run_id: string; filename: string }>) => {
      setBanner(null);
      setLastResult(null);
      try {
        const { run_id, filename } = await submit();
        dispatch({ type: "RUN_STARTED", runId: run_id, filename });
        setLogLines([formatRunStarted(filename)]);

        eventChainRef.current = Promise.resolve();
        nodeStartedAtRef.current.clear();

        const stopStreaming = streamRun(run_id, {
          onNodeStarted: (payload) => {
            const node = payload.node as PipelineNodeId;
            enqueue(() => {
              nodeStartedAtRef.current.set(node, Date.now());
              dispatch({ type: "NODE_STARTED", node });
              appendLog(formatNodeStarted(node));
            });
          },
          onNodeFinished: (payload) => {
            const node = payload.node as PipelineNodeId;
            enqueue(async () => {
              const startedAt = nodeStartedAtRef.current.get(node) ?? Date.now();
              const delay = remainingDelay(Date.now() - startedAt);
              if (delay > 0) await sleep(delay);
              dispatch({
                type: "NODE_FINISHED",
                node,
                error: payload.error,
                summary: payload.output_summary,
              });
              appendLog(formatNodeFinished(node, payload.duration_ms, payload.error, payload.output_summary));
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
    (filename: string) => {
      void runDocument(() => submitSampleDoc(filename));
    },
    [runDocument]
  );

  const handleUpload = useCallback(
    (file: File) => {
      void runDocument(() => submitUpload(file));
    },
    [runDocument]
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

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (pipeline.running) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDropTarget(true);
    },
    [pipeline.running]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropTarget(false);
      if (pipeline.running) return;
      const filename = e.dataTransfer.getData("text/plain");
      if (filename) handleRunSample(filename);
    },
    [pipeline.running, handleRunSample]
  );

  const diagramState = useMemo(() => deriveDiagramState(pipeline), [pipeline]);

  const nodes: HubNodeType[] = useMemo(
    () =>
      DIAGRAM_NODES.map((spec) => ({
        id: spec.id,
        type: "hub",
        position: { x: spec.x, y: spec.y },
        data: {
          diagramId: spec.id,
          label: spec.label,
          statusLine: diagramState[spec.id].statusLine,
          status: diagramState[spec.id].status,
          size: spec.size,
        },
        draggable: false,
        selectable: true,
      })),
    [diagramState]
  );

  const edges: IntakeEdgeType[] = useMemo(
    () =>
      DIAGRAM_EDGES.map((spec) => {
        const isPulsing = pipeline.activeEdgeId === spec.id;
        return {
          id: spec.id,
          source: spec.source,
          target: spec.target,
          type: "intake",
          data: {
            active: diagramState[spec.target].status !== "pending",
            pulses: isPulsing
              ? [{ key: `pulse-${pipeline.runId}-${pipeline.pulseSeq}`, durationMs: 900 }]
              : [],
          },
        } satisfies IntakeEdgeType;
      }),
    [pipeline.activeEdgeId, pipeline.pulseSeq, pipeline.runId, diagramState]
  );

  return (
    <div className="app-root">
      <div className="controls-panel">
        <TicketPanel
          sampleDocs={sampleDocs}
          onRunSample={handleRunSample}
          onUpload={handleUpload}
          onReset={handleReset}
          running={pipeline.running}
        />
      </div>

      <div
        className={`flow-surface${isDropTarget ? " is-drop-target" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDropTarget(false)}
        onDrop={handleDrop}
      >
        {banner ? (
          <div
            className="error-banner"
            style={{ position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 }}
          >
            {banner}
          </div>
        ) : null}
        {isDropTarget ? <div className="drop-hint">Drop to feed this ticket to the agent</div> : null}
        <ReactFlow<HubNodeType, Edge>
          nodes={nodes}
          edges={edges}
          edgeTypes={EDGE_TYPES}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.35 }}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#eee" gap={24} />
        </ReactFlow>
      </div>

      <div className="debug-panel">
        <ResultSummary record={lastResult} processingFilename={pipeline.running ? pipeline.filename : null} />
        <TerminalLog lines={logLines} />
      </div>
    </div>
  );
}

export default App;
