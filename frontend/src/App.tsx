import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Background, ReactFlow, type Edge } from "@xyflow/react";
import {
  fetchHealth,
  fetchRecords,
  fetchSampleDocs,
  resetStore,
  streamRun,
  submitSampleDoc,
  submitUpload,
} from "./api";
import { IntakeEdge, type IntakeEdgeType } from "./components/IntakeEdge";
import { HubNode, type HubNodeType } from "./components/HubNode";
import { RecordsTable } from "./components/RecordsTable";
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
import type { HealthInfo, PipelineNodeId, RecordRow, SampleDoc } from "./types";

const NODE_TYPES = { hub: HubNode };
const EDGE_TYPES = { intake: IntakeEdge };

function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [sampleDocs, setSampleDocs] = useState<SampleDoc[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [pipeline, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [lastResult, setLastResult] = useState<RecordRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const appendLog = useCallback((l: LogLine) => {
    setLogLines((prev) => [...prev, l]);
  }, []);

  const refreshRecordsAndFindRun = useCallback(async (runId: string) => {
    try {
      const rows = await fetchRecords();
      setRecords(rows);
      const match = rows.find((r) => r.run_id === runId);
      if (match) setLastResult(match);
    } catch (err) {
      setBanner(String(err));
    }
  }, []);

  const refreshRecords = useCallback(() => {
    fetchRecords().then(setRecords).catch((err) => setBanner(String(err)));
  }, []);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => undefined);
    fetchSampleDocs().then(setSampleDocs).catch((err) => setBanner(String(err)));
    refreshRecords();
  }, [refreshRecords]);

  const runDocument = useCallback(
    async (submit: () => Promise<{ run_id: string; filename: string }>) => {
      setBanner(null);
      setLastResult(null);
      try {
        const { run_id, filename } = await submit();
        dispatch({ type: "RUN_STARTED", runId: run_id, filename });
        setLogLines([formatRunStarted(filename)]);

        const stopStreaming = streamRun(run_id, {
          onNodeStarted: (payload) => {
            const node = payload.node as PipelineNodeId;
            dispatch({ type: "NODE_STARTED", node });
            appendLog(formatNodeStarted(node));
          },
          onNodeFinished: (payload) => {
            const node = payload.node as PipelineNodeId;
            dispatch({
              type: "NODE_FINISHED",
              node,
              error: payload.error,
              summary: payload.output_summary,
            });
            appendLog(formatNodeFinished(node, payload.duration_ms, payload.error, payload.output_summary));
          },
          onRunCompleted: () => {
            void refreshRecordsAndFindRun(run_id);
            appendLog(formatRunCompleted());
          },
          onRunFailed: (payload) => {
            setBanner(`Run failed: ${payload.error}`);
            appendLog(formatRunFailed(payload.error));
          },
          onDone: () => {
            dispatch({ type: "RUN_DONE" });
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
    [refreshRecordsAndFindRun, appendLog]
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
        refreshRecords();
        setLastResult(null);
        setLogLines([]);
        dispatch({ type: "RESET" });
      })
      .catch((err) => setBanner(String(err)));
  }, [refreshRecords]);

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
              ? [{ key: `pulse-${pipeline.runId}-${pipeline.pulseSeq}`, durationMs: 550 }]
              : [],
          },
        } satisfies IntakeEdgeType;
      }),
    [pipeline.activeEdgeId, pipeline.pulseSeq, pipeline.runId, diagramState]
  );

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <h1>Sky Transport — Compliance Document Intake Agent</h1>
          <p className="subtitle">
            An AI agent that reads a ticket and the intake SOP, classifies and extracts
            the document, then validates and files it.
          </p>
        </div>
        {health ? (
          <span className={`health-pill ${health.llm_client === "FakeLLMClient" ? "fake" : "real"}`}>
            {health.llm_client === "FakeLLMClient" ? "Offline demo mode" : "Live model"}
          </span>
        ) : null}
      </header>

      <div className="app-body">
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

      <RecordsTable records={records} />
    </div>
  );
}

export default App;
