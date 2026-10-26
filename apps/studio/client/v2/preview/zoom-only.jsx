// client/v2/preview/zoom-only.jsx — S3.9: Preview's zoom readout, bottom left (04 md-preview `ZoomOnly`).
//
// The percentage and nothing else: Preview cannot undo anything, so Edit's ZoomUndo is down to a readout.
// The zoom comes from the canvas as `viewport-zoom` (V2-1.2 §5.2, ≤ 20 Hz during a gesture and once on
// settle); `useViewportZoom` listens for it, gated by the dgn table to the ACTIVE canvas.

import { useEffect, useState } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';

/** "76%" — a whole percent; 100% until the canvas has said otherwise. */
export function zoomLabel(zoom) {
  return `${Number.isFinite(zoom) && zoom > 0 ? Math.round(zoom * 100) : 100}%`;
}

export function ZoomOnly({ zoom, state = 'in' }) {
  return (
    <div
      className="sh-zoomonly island"
      data-testid="zoom-only"
      data-occludes="bottom"
      data-state={state}
    >
      <span
        className="sh-zoomonly-v"
        role="status"
        aria-live="off"
        aria-label={`Zoom ${zoomLabel(zoom)}`}
      >
        {zoomLabel(zoom)}
      </span>
    </div>
  );
}

/**
 * The active canvas' zoom, as it posts `viewport-zoom`.
 * @param canvasOrigin the origin canvases are served from
 * @param activeWin () => Window | null — the active canvas' window
 */
export function useViewportZoom({ canvasOrigin, activeWin }) {
  return useViewportCamera({ canvasOrigin, activeWin }).zoom;
}

/** Zoom and whether the camera still sits where the last Zoom to fit put it (`viewport-zoom.fit`). */
export function useViewportCamera({ canvasOrigin, activeWin }) {
  const [cam, setCam] = useState({ zoom: 1, fit: false });
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeWin reads a live ref
  useEffect(() => {
    const onMessage = (e) => {
      if (e.data?.dgn !== 'viewport-zoom') return;
      const m = acceptFromCanvas(e, { canvasOrigin, active: activeWin() });
      if (m?.dgn === 'viewport-zoom') setCam({ zoom: m.zoom, fit: m.fit === true });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [canvasOrigin]);
  return cam;
}
