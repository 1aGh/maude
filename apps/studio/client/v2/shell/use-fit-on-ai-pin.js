// client/v2/shell/use-fit-on-ai-pin.js — P8 c5 (03 `ai-long-pinned`): pinning the AI chat to the side makes the
// canvas's frame narrower, and a frame that narrows does not move its camera (the canvas re-fits only on its
// own first size) — so the Post artboard stayed cut by the column. The board's canvas is fitted to the room
// left of the column: when the pinned chat shows or goes away, the shell asks every open canvas to Fit.
//
// No new dgn message: the ask is the existing parent-gated `run-action` with the registry's `view.zoom-fit`
// (⌘0), which `canvas-shell.tsx` answers only for `e.source === window.parent` with `zoomController.fit()`.
// Nothing rides along (no params), so a canvas learns nothing but "Fit".

import { useEffect, useRef } from 'react';
import { postToCanvas } from '../../../bridge/dgn-protocol.ts';

/** The panel's own width transition (--dur-panel) plus the insets pump's frame — the canvas fits to the room
 *  that is left once the column has settled. */
export const FIT_AFTER_MS = 320;

/** A fit is due when the pinned chat appears or disappears — never on the first render, never when nothing changed. */
export function fitOnAiPinDue(prev, next) {
  return prev !== undefined && prev !== next;
}

/** The one message: the registry's Fit, to the shell-owned frame. */
export function postFitAll(win) {
  postToCanvas(win, 'run-action', { v: 1, id: 'view.zoom-fit' }, '*');
}

/**
 * @param iframesRef Map<path, HTMLIFrameElement> (the shell's registered canvas frames)
 * @param aiPinned   the AI chat is docked as a column (pinned layout, chat shown)
 */
export function useFitOnAiPin({ iframesRef, aiPinned }) {
  const prev = useRef(undefined);
  useEffect(() => {
    const was = prev.current;
    prev.current = !!aiPinned;
    if (!fitOnAiPinDue(was, !!aiPinned)) return undefined;
    const t = setTimeout(() => {
      for (const f of iframesRef.current?.values() ?? []) postFitAll(f.contentWindow);
    }, FIT_AFTER_MS);
    return () => clearTimeout(t);
  }, [aiPinned, iframesRef]);
}
