// Pure transcript view-mode filter (Task C4). Operates on a message's raw
// content parts BEFORE grouping (ToolGroup.jsx) — a pure, order-preserving
// filter, never a hardcoded assumption about what part types exist beyond the
// three the adapter emits (text / reasoning / tool-call).

export const TRANSCRIPT_VIEWS = ['normal', 'thinking', 'verbose', 'summary'];
export const DEFAULT_TRANSCRIPT_VIEW = 'normal';

/**
 * `parts` (a message's content array) + `mode` → the parts to actually render.
 *   - normal   — text + tool-calls; reasoning hidden (today's default look).
 *   - thinking — everything, including reasoning ("Thinking" disclosures).
 *   - verbose  — everything (same set as thinking); the extra "verbose-ness"
 *                is a RENDER-detail toggle (see transcriptForcesExpand), not a
 *                different part set — tool calls stay visible either way.
 *   - summary  — only the LAST text part (the final answer), nothing else.
 * An unrecognized mode falls back to `normal` rather than showing everything
 * (fail toward less noise, not more).
 */
export function filterTranscriptParts(parts, mode) {
  const list = Array.isArray(parts) ? parts : [];
  if (mode === 'summary') {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.type === 'text') return [list[i]];
    }
    return [];
  }
  if (mode === 'thinking' || mode === 'verbose') return list.slice();
  return list.filter((p) => p?.type !== 'reasoning'); // normal (and any unknown mode)
}

/** Verbose mode auto-expands tool-call detail (groups start open, cards show
 *  raw args/result) instead of requiring a click per card. */
export function transcriptForcesExpand(mode) {
  return mode === 'verbose';
}

/**
 * P8-C6 (03 `ai-working`): the feed shows what AI SAID, never its tool calls — "Edit the canvas" cards sat above the
 * working line and made one run read as four items. The steps live behind the result's "What AI did" fold (and the
 * raw log under Advanced). Only the two views that ask for everything (`thinking`, `verbose`) draw them in the feed.
 */
export function showsToolSteps(mode) {
  return mode === 'thinking' || mode === 'verbose';
}
