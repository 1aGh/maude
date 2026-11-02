// apps/studio/present/present-zoom.ts — S3.2b: the canvas tells the shell its zoom while it is presented.
//
// Present the canvas shows a pill with the zoom ("Presenting the canvas · 21% · esc to leave"). The shell
// cannot read the canvas's camera (another document), so the canvas says it — `viewport-zoom {zoom}`, the
// message the protocol already names — and only while a Present is running, and only when the whole percent
// changes (a pinch posts a handful of messages, not sixty a second).

import { useEffect, useRef } from 'react';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';

/** The posting half, pure over a window: remembers the last whole percent it sent. */
export function createZoomReporter(win: Window) {
  let sent: number | null = null;
  return {
    /** @returns whether a message went out */
    report(zoom: number, presenting: boolean): boolean {
      if (!presenting) {
        sent = null; // the next Present reports afresh
        return false;
      }
      if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom <= 0) return false;
      const pct = Math.round(zoom * 100);
      if (pct === sent) return false;
      if (win.parent === win) return false;
      try {
        win.parent.postMessage({ dgn: 'viewport-zoom', zoom }, '*');
      } catch {
        return false; // detached
      }
      sent = pct;
      return true;
    },
  };
}

/** Present · Canvas only: the Artboards stage glides the camera and the pill is not shown there. */
function presentedCanvas(win: Window): boolean {
  const s = canvasModeStore(win).get();
  return s.mode === 'present' && s.present?.kind === 'canvas';
}

/** Called from `usePresentStage` with the viewport controller's published zoom. */
export function usePresentZoom(zoom: number): void {
  const win = typeof window === 'undefined' ? null : window;
  const reporter = useRef<ReturnType<typeof createZoomReporter> | null>(null);
  if (!reporter.current && win) reporter.current = createZoomReporter(win);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `zoom` is the trigger; the mode is read live
  useEffect(() => {
    if (!win) return;
    reporter.current?.report(zoomRef.current, presentedCanvas(win));
  }, [zoom, win]);

  // Present starting reports the zoom it starts with (it may not change again).
  useEffect(() => {
    if (!win) return;
    const store = canvasModeStore(win);
    const sync = () => reporter.current?.report(zoomRef.current, presentedCanvas(win));
    return store.subscribe(sync);
  }, [win]);
}
