// client/v2/export/preview.jsx — P8-C4: the preview column of the Export sheet (09 Export `Pic` + `.ex-prev`).
//
// One artboard exported (a post, a web page, a video's poster) → its picture with its size line underneath, beside
// the rows. The picture is what the canvas itself draws: the shell asks the open canvas to capture the artboard
// small (`onBrowserCapture`, the same bridge the browser lane exports through), checks the reply like a download
// (`sanitizeCapturedItems` — the capture shares a window with tenant TSX), and shows it. Where that is not
// possible (no canvas open, a capture that fails) the frame stays, as a quiet fill at the artboard's own shape.

import { useEffect, useState } from 'react';
import { sanitizeCapturedItems } from '../../export-lane.js';

/** The artboard's box fitted inside `maxW × maxH`, never enlarged past its own size. */
export function fitBox(w, h, maxW, maxH) {
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  if (!ok) return { w: maxW, h: Math.round((maxW * 5) / 4) };
  const k = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** "1080 × 1350" — the size line under a preview (a thin space around the ×, as the sheet writes it). */
export const sizeLine = (w, h) =>
  Number.isFinite(w) && Number.isFinite(h) ? `${Math.round(w)} × ${Math.round(h)}` : '';

/**
 * The picture of one artboard, as an object URL — or null while it is being drawn, or when it cannot be.
 * @param capture  `onBrowserCapture` (`({ format, artboardIds, scale }) => Promise<[{ name, blob }]>`) or null
 */
export function useBoardPicture(capture, board, { enabled = true, maxSide = 240 } = {}) {
  const [src, setSrc] = useState(null);
  const id = board?.id ?? null;
  const w = board?.w ?? 0;
  const h = board?.h ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the artboard's id and size are the key
  useEffect(() => {
    setSrc(null);
    if (!enabled || typeof capture !== 'function' || !id) return undefined;
    let url = null;
    let gone = false;
    // twice the preview's own pixels, so it stays sharp on a Retina screen
    const scale = Math.min(1, (maxSide * 2) / Math.max(w || maxSide, h || maxSide));
    capture({ format: 'png', artboardIds: [id], scale, timeoutMs: 15_000 })
      .then((items) => sanitizeCapturedItems(items, 'png'))
      .then((safe) => {
        if (gone || !safe[0]) return;
        url = URL.createObjectURL(safe[0].blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [capture, enabled, id, w, h, maxSide]);
  return src;
}

/** A preview picture with its size line under it. `children` draws over the picture (a fold line, a scrub chip). */
export function Pic({ w, h, cap, src, children, testid = 'export-preview-pic' }) {
  return (
    <>
      <span className="ex-pic" style={{ width: w, height: h }} data-testid={testid}>
        {src ? <img className="ex-fill" src={src} alt="" draggable={false} /> : null}
        {children}
      </span>
      <span className="ex-prev-cap" data-testid="export-preview-caption">
        {cap}
      </span>
    </>
  );
}

/** The column itself: a quiet well beside the rows. */
export function PreviewColumn({ children, width }) {
  return (
    <div className="ex-prev" data-testid="export-preview" style={width ? { width } : undefined}>
      {children}
    </div>
  );
}
