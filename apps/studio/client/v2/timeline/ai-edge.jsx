// client/v2/timeline/ai-edge.jsx — S7.14: the AI cut on the timeline (07 · ve-ai-scrub, ve-ai-proposal).
//
//   · the AI edge — a spark line with an "AI" tag at the end of the last shot placed. It is the run's, not
//     yours: your playhead keeps its place while shots land past it, and scrubbing the placed part moves
//     only your playhead;
//   · the shot that just landed gets the landing animation (the clip block's `is-landing`, timeline.css);
//   · the status chip: "AI is cutting" → "Made by AI · 14 shots", or after Stop "Placed 7 of 14 shots."
//     with Keep going (the same Keep going as the AI chat's — `POST /_api/ai/runs/<id>/keep-going`);
//   · the landing island beside the artboard: "Placing shot 7 · Tackle 2" + clip, source range, beat.
// Everything is read from the run's derived `progress` (ai-edge-model.js); nothing here writes a file.

import { useEffect, useState } from 'react';
import { Spark } from '../ai/icons.jsx';
import { isMadeByAi, useMadeByAi } from '../ai/made-by-ai.js';
import { keepGoingRun } from '../ai/run-api.js';
import { useAiRuns } from '../ai/runs-store.js';
import { aiCutModel, KEEP_GOING, liveRunOn } from './ai-edge-model.js';

/**
 * The AI cut on the open video, re-reading the run list each time the comp changes while a run of yours
 * works on it (a shot landed: its progress moved). `compKey` is anything that changes with the comp's clips.
 */
export function useAiCut({ activePath, artboardId, compKey }) {
  const { view, store } = useAiRuns();
  const made = useMadeByAi();
  const working = liveRunOn(view, { activePath, artboardId });
  // biome-ignore lint/correctness/useExhaustiveDependencies: compKey is the trigger — a shot landed
  useEffect(() => {
    if (working) store?.refresh?.();
  }, [working, compKey, store]);
  return aiCutModel(view, {
    activePath,
    artboardId,
    madeByAi: !!artboardId && isMadeByAi(made, activePath, artboardId),
  });
}

/** The header chip (and Keep going after a Stop). */
export function AiCutStatus({ cut }) {
  const [busy, setBusy] = useState(false);
  if (!cut) return null;
  return (
    <span
      className="tl-ai-status"
      data-testid="timeline-ai-status"
      data-state={cut.state}
      role="status"
    >
      <Spark size={10} />
      <span>{cut.chip}</span>
      {cut.keepGoing ? (
        <button
          type="button"
          className="tl-ai-keep-going"
          data-testid="timeline-ai-keep-going"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await keepGoingRun(cut.runId);
            } finally {
              setBusy(false);
            }
          }}
        >
          {KEEP_GOING}
        </button>
      ) : null}
    </span>
  );
}

/** The AI edge line over the tracks; `left` is in the tracks' own px (the playhead's frame). */
export function AiEdge({ cut, left }) {
  if (!cut || cut.state !== 'cutting' || cut.edge == null || !Number.isFinite(left)) return null;
  return (
    <span
      className="tl-ai-edge"
      data-testid="timeline-ai-edge"
      data-frame={cut.edge}
      style={{ left }}
      aria-hidden="true"
    >
      <span className="tl-ai-edge-tag">
        <Spark size={9} />
        AI
      </span>
    </span>
  );
}

/** "Placing shot 7 · Tackle 2" beside the artboard (`rect` in the canvas frame, `frame` = its box on screen). */
export function AiLandingIsland({ cut, rect, frame }) {
  if (!cut || cut.state !== 'cutting' || !cut.lines || !rect) return null;
  const left = (frame?.left ?? 0) + rect.x + rect.w + 16;
  const top = (frame?.top ?? 0) + rect.y + Math.max(0, rect.h / 2 - 28);
  return (
    <div
      className="island tl-ai-landing"
      data-testid="timeline-ai-landing"
      style={{ left, top }}
      role="status"
    >
      <span className="tl-ai-landing-text">
        <b>
          <Spark size={11} />
          {cut.lines.title}
        </b>
        <small>{cut.lines.line}</small>
      </span>
    </div>
  );
}
