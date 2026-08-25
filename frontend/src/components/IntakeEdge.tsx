import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";

export interface DocTokenPulse {
  key: string;
  delayMs?: number;
  durationMs?: number;
  /** Travel target -> source instead of source -> target — used for a
   * tool_call_finished pulse traveling back to the agent hub along the
   * same edge a tool_call_started pulse just traveled out on. */
  reverse?: boolean;
  /** "request" renders as a call/query glyph (the agent asking for
   * something, no data yet); "data" renders as a document glyph (actual
   * information moving). Defaults to "data". */
  kind?: "request" | "data";
  /** Repeat indefinitely instead of playing once and freezing. Used while
   * a tool call is in flight and its actual duration is unknown (a real
   * model/tool can take anywhere from milliseconds to many seconds) — a
   * one-shot pulse timed for the common case either freezes mid-path and
   * sits dead for the remainder of a slow call, or (for a fast call)
   * looks like it's still "sending" after the reply already arrived.
   * Looping keeps a token continuously in transit for exactly as long as
   * the call is actually running, which reads as one smooth "in progress"
   * flow instead of a discrete blip that goes stale. */
  loop?: boolean;
}

export interface IntakeEdgeData extends Record<string, unknown> {
  active?: boolean;
  pulses?: DocTokenPulse[];
}

export type IntakeEdgeType = Edge<IntakeEdgeData, "intake">;

/** Adapted from agent-gate's PayloadEdge: same SMIL animateMotion trick to
 * move a token along the exact rendered edge path with no physics/canvas,
 * but with one glyph (a document) instead of the attack-arena's five. */
export function IntakeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<IntakeEdgeType>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        className={data?.active ? "is-active" : undefined}
        style={style}
      />
      {data?.pulses?.map((pulse) => (
        <g key={pulse.key} className={`token-token token-${pulse.kind ?? "data"}`} opacity="0" aria-hidden="true">
          <g className="token-glyph" transform="scale(1.2)">
            <circle className="token-bg" r="10" />
            {pulse.kind === "request" ? (
              // Call/query glyph: an outbound chevron, standing in for
              // "the agent is asking" rather than any actual data.
              <path d="M-3-5l5 5-5 5" />
            ) : (
              // Document glyph: actual information moving along the edge.
              <>
                <path d="M-4-4h5l3 3v5h-8z" />
                <path d="M-1-4v3h3" />
              </>
            )}
          </g>
          <animateMotion
            path={path}
            begin={`${pulse.delayMs ?? 0}ms`}
            dur={`${pulse.durationMs ?? 1500}ms`}
            fill="freeze"
            repeatCount={pulse.loop ? "indefinite" : 1}
            calcMode="spline"
            keyPoints={pulse.reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            keySplines="0.2 0.75 0.3 1"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.12;0.82;1"
            begin={`${pulse.delayMs ?? 0}ms`}
            dur={`${pulse.durationMs ?? 1500}ms`}
            fill="freeze"
            repeatCount={pulse.loop ? "indefinite" : 1}
          />
        </g>
      ))}
    </>
  );
}
