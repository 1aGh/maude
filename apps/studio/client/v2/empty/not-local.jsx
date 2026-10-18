// client/v2/empty/not-local.jsx — S11.4: offline, and this canvas never came down (05 · es-offline-uncached).
//
// "The canvas isn't broken and nothing is lost — it just isn't on this Mac yet, so there's no toolbar."
// The card says what is missing, why that is fine, and offers the one thing that works now: narrowing the
// Canvases panel to what IS here. The words are the 05 copy table's, verbatim (`es-offline-uncached.not-local`).
//
// `useCanvasAvailability(path)` is what a viewport asks before it tries to load a module that is not on disk:
// 'present' | 'arriving' | 'not-local' | 'unknown' (the server never says not-local before the hub has answered
// once this boot — routes/availability.ts). The tab that shows this card has no toolbar and no zoom: the
// viewport mounts it INSTEAD of the canvas frame (patch request to the shell owner).

import { useEffect, useState } from 'react';
import { setShowLocalOnly } from './arriving.jsx';
import { copy } from './empty-copy.js';
import { Empty } from './empty.jsx';

/** @param {{ name: string, onShowLocal?: () => void }} props */
export function NotLocalCanvas({ name, onShowLocal }) {
  const words = copy('es-offline-uncached.not-local', { canvas: name });
  return (
    <Empty
      size="canvas"
      glyph="offline"
      copyId="es-offline-uncached.not-local"
      vars={{ canvas: name }}
      testid="canvas-not-local"
      actions={
        <button
          type="button"
          className="btn btn--sm"
          data-testid="canvas-not-local-show-local"
          onClick={() => {
            setShowLocalOnly(true);
            onShowLocal?.();
          }}
        >
          {words.action}
        </button>
      }
    />
  );
}

/**
 * A canvas the hub lists but this Mac has not received yet (05 · es-arriving, the Q13 fallback when the
 * listing carries no artboard sizes): one centred card, no frame — the module is not on disk to load.
 * @param {{ name: string }} props
 */
export function ArrivingCanvas({ name }) {
  return (
    <Empty
      size="canvas"
      copyId="es-arriving.canvas-arriving"
      vars={{ canvas: name }}
      testid="canvas-arriving"
    />
  );
}

/** How often an opened canvas that is still arriving asks again. */
export const ARRIVING_RECHECK_MS = 2000;

const askAvailability = (path, fetchImpl) =>
  (fetchImpl || fetch)(`/_api/sync/availability?canvas=${encodeURIComponent(path)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => body?.canvas?.state ?? 'unknown');

/**
 * One canvas's availability, asked once per path (and again when `stamp` changes — the tab's reload key).
 * A canvas that is `arriving` is asked again every `recheckMs` until it is here (no flicker: the answer
 * stays `arriving` between asks), so the card gives way to the frame by itself.
 * @param {string|null} path designRoot-relative
 * @returns {'present'|'arriving'|'not-local'|'unknown'|null} null while asking
 */
export function useCanvasAvailability(
  path,
  { stamp, fetchImpl, recheckMs = ARRIVING_RECHECK_MS } = {}
) {
  const [state, setState] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the tab's reload key — a trigger only
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState(null);
    askAvailability(path, fetchImpl)
      .then((s) => alive && setState(s))
      .catch(() => alive && setState('unknown'));
    return () => {
      alive = false;
    };
  }, [path, stamp, fetchImpl]);
  useEffect(() => {
    if (!path || state !== 'arriving') return;
    let alive = true;
    let timer;
    const again = () => {
      timer = setTimeout(async () => {
        const s = await askAvailability(path, fetchImpl).catch(() => 'arriving');
        if (!alive) return;
        if (s !== 'arriving') setState(s);
        else again();
      }, recheckMs);
    };
    again();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path, state, fetchImpl, recheckMs]);
  return state;
}
