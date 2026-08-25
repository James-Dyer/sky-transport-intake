/** How long a node should stay visually "active" before flipping to "done",
 * even when the real backend step (receive_ticket, consult_sop, validate,
 * persist) finishes in a few milliseconds. Without this, only the two LLM
 * calls (classify_doc, extract_fields) are slow enough to actually watch —
 * everything else flashes by before the pulse/token animation registers.
 * Purely a presentation smoothing: real per-node timing is still what's
 * shown in the terminal log and available via the API; this only delays
 * when the UI reflects "finished," not what it reports as having happened. */
export const MIN_ACTIVE_MS = 1500;

export function remainingDelay(elapsedMs: number, minMs: number = MIN_ACTIVE_MS): number {
  return Math.max(0, minMs - elapsedMs);
}
