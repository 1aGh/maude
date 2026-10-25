// client/v2/shell/use-fit-while-ai-drafts.js — P8 c6 (01 `cf-ai-drafting`): while an AI run of yours draws a new
// canvas, the camera shows ALL of it (board: 28 % with the artboards that have landed), not 64 % on the first
// one with the rest drawn off-screen. Each time an artboard lands on the open canvas during a live run, the
// shell asks the canvas to Fit — the same parent-gated `run-action view.zoom-fit` the pinned chat uses
// (use-fit-on-ai-pin.js), so no new bridge message.
//
// A person who moves the camera meanwhile is not fought: the fit is asked ONCE per landing, never on a timer.

import { useEffect, useRef } from 'react';
import { postFitAll } from './use-fit-on-ai-pin.js';

/** A landing is the artboard count growing; the first reading is the canvas as it was, not a landing. */
export function fitOnLandingDue({ prev, next, working }) {
  return !!working && prev !== undefined && next > prev;
}

/** Let the landed artboard paint before the camera frames it. */
export const FIT_AFTER_LANDING_MS = 450;

/**
 * @param iframesRef Map<path, HTMLIFrameElement> (the shell's registered canvas frames)
 * @param count      how many artboards the open canvas has (the shell's `activeArtboards`)
 * @param working    a run of yours is live (`yoursCount(view) > 0`)
 */
export function useFitWhileAiDrafts({ iframesRef, count: artboardCount, working }) {
  const prev = useRef(undefined);
  const count = Number.isFinite(artboardCount) ? artboardCount : 0;
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (!fitOnLandingDue({ prev: before, next: count, working })) return undefined;
    const t = setTimeout(() => {
      for (const f of iframesRef.current?.values() ?? []) postFitAll(f.contentWindow);
    }, FIT_AFTER_LANDING_MS);
    return () => clearTimeout(t);
  }, [count, working, iframesRef]);
}
