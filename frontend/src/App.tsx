import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Background, ReactFlow, type Edge } from "@xyflow/react";
import {
  fetchHealth,
  fetchRecords,
  fetchRun,
  fetchSampleDocs,
  resetStore,
  streamRun,
  submitSampleDoc,
  submitUpload,
} from "./api";
import { ControlsPanel } from "./components/ControlsPanel";
import { DebugPanel } from "./components/DebugPanel";
import { IntakeEdge, type IntakeEdgeType } from "./components/IntakeEdge";
import { IntakeFlowNode, type IntakeFlowNodeType } from "./components/IntakeFlowNode";
import { RecordsTable } from "./components/RecordsTable";
import { initialPipelineState, pipelineReducer } from "./pipelineReducer";
import { PIPELINE_NODES, type HealthInfo, type NodeTrace, type PipelineNodeId, type RecordRow, type SampleDoc } from "./types";

const NODE_LABELS: Record<PipelineNodeId, string> = {
  receive_ticket: "Ticket",
  consult_sop: "Consult SOP",
  classify_doc: "Classify",
  extract_fields: "Extract",
  validate: "Validate",
  persist: "Record",
};

const NODE_TYPES = { intake: IntakeFlowNode };
const EDGE_TYPES = { intake: IntakeEdge };

const NODE_X_GAP = 190;

function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [sampleDocs, setSampleDocs] = useState<SampleDoc[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [pipeline, dispatch] = useReducer(pipelineReducer, initialPipelineState);
  const [fullTrace, setFullTrace] = useState<NodeTrace[]>([]);
  const [selectedNode, setSelectedNode] = useState<PipelineNodeId | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

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
      setFullTrace([]);
      setSelectedNode(null);
      try {
        const { run_id, filename } = await submit();
        dispatch({ type: "RUN_STARTED", runId: run_id, filename });

        const stopStreaming = streamRun(run_id, {
          onNodeStarted: (payload) => {
            dispatch({ type: "NODE_STARTED", node: payload.node as PipelineNodeId });
          },
          onNodeFinished: (payload) => {
            dispatch({
              type: "NODE_FINISHED",
              node: payload.node as PipelineNodeId,
              error: payload.error,
              summary: payload.output_summary,
            });
          },
          onRunCompleted: () => {
            refreshRecords();
          },
          onRunFailed: (payload) => {
            setBanner(`Run failed: ${payload.error}`);
          },
          onDone: async () => {
            dispatch({ type: "RUN_DONE" });
            try {
              const run = await fetchRun(run_id);
              setFullTrace(run.trace);
            } catch (err) {
              setBanner(String(err));
            }
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
    [refreshRecords]
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
        setFullTrace([]);
        setSelectedNode(null);
        dispatch({ type: "RESET" });
      })
      .catch((err) => setBanner(String(err)));
  }, [refreshRecords]);

  const nodes: IntakeFlowNodeType[] = useMemo(
    () =>
      PIPELINE_NODES.map((node, i) => ({
        id: node,
        type: "intake",
        position: { x: i * NODE_X_GAP, y: 0 },
        data: {
          label: NODE_LABELS[node],
          node,
          status: pipeline.statuses[node].status,
          statusLabel: pipeline.statuses[node].label,
        },
        draggable: false,
        selectable: true,
      })),
    [pipeline.statuses]
  );

  const edges: IntakeEdgeType[] = useMemo(
    () =>
      PIPELINE_NODES.slice(0, -1).map((node, i) => {
        const isPulsing = pipeline.activeEdgeIndex === i;
        return {
          id: `${node}->${PIPELINE_NODES[i + 1]}`,
          source: node,
          target: PIPELINE_NODES[i + 1],
          type: "intake",
          data: {
            active: pipeline.statuses[PIPELINE_NODES[i + 1]].status !== "pending",
            pulses: isPulsing
              ? [{ key: `pulse-${pipeline.runId}-${pipeline.pulseSeq}`, durationMs: 550 }]
              : [],
          },
        } satisfies IntakeEdgeType;
      }),
    [pipeline.activeEdgeIndex, pipeline.pulseSeq, pipeline.runId, pipeline.statuses]
  );

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <h1>Sky Transport — Compliance Document Intake Agent</h1>
          <p className="subtitle">
            LangGraph pipeline: ticket → SOP → classify → extract → validate → record
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
          <ControlsPanel
            sampleDocs={sampleDocs}
            onRunSample={handleRunSample}
            onUpload={handleUpload}
            onReset={handleReset}
            running={pipeline.running}
          />
        </div>

        <div className="flow-surface">
          {banner ? <div className="error-banner" style={{ position: "absolute", top: 10, left: 10, right: 10, zIndex: 10 }}>{banner}</div> : null}
          <ReactFlow<IntakeFlowNodeType, Edge>
            nodes={nodes}
            edges={edges}
            edgeTypes={EDGE_TYPES}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedNode(node.id as PipelineNodeId)}
            onPaneClick={() => setSelectedNode(null)}
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
          <DebugPanel trace={fullTrace} selectedNode={selectedNode} />
        </div>
      </div>

      <RecordsTable records={records} />
    </div>
  );
}

export default App;
