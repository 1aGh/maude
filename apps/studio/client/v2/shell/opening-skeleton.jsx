// client/v2/shell/opening-skeleton.jsx — 2.0.7 (B1): the artboards of a canvas that is opening, drawn at once
// at their final place and size (opening-skeleton.js holds the rules). The studio draws them over the frame and
// drops them when the canvas reports `canvas-rendered`; the frame itself never draws a skeleton, so captures and
// exports cannot show one. Until the layout is known — or when it cannot be known before the canvas runs — the
// caller's card shows instead.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SkeletonArtboard } from '../empty/skeleton.jsx';
import { useIndexSnapshotNow } from '../canvases/use-canvas-index.js';
import { insetsNow } from './insets-now.js';
import { indexRowOf, screenBoards, skeletonBoards, skeletonCamera } from './opening-skeleton.js';

/** The canvas's meta (layout + the person's viewport), as the frame reads it. undefined while asked, null: none. */
function useCanvasMeta(path, fetchImpl) {
  const [meta, setMeta] = useState(undefined);
  useEffect(() => {
    let alive = true;
    setMeta(undefined);
    const f = fetchImpl || ((...a) => fetch(...a));
    Promise.resolve()
      .then(() =>
        f(`/_api/canvas-meta?file=${encodeURIComponent(path)}`, {
          headers: { 'Cache-Control': 'no-store' },
        })
      )
      .then((r) => (r?.ok ? r.json() : null))
      .then((j) => alive && setMeta(j && typeof j === 'object' ? j : null))
      .catch(() => alive && setMeta(null));
    return () => {
      alive = false;
    };
  }, [path, fetchImpl]);
  return meta;
}

function useBoxSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * @param {{ path: string, fallback: import('react').ReactNode, note?: string | null, fetchImpl?: typeof fetch }} props
 *   path      the opening canvas (repo-relative, e.g. `<designRoot>/ui/Home.tsx`)
 *   fallback  what shows while the layout is not known (the "Opening …" card)
 *   note      a line over the skeletons once opening is slow (the card's own hint)
 */
export function OpeningSkeleton({ path, fallback, note = null, fetchImpl }) {
  const ref = useRef(null);
  const snapshot = useIndexSnapshotNow();
  const meta = useCanvasMeta(path, fetchImpl);
  const insets = useSyncExternalStore(insetsNow.subscribe, insetsNow.get, insetsNow.get);
  const size = useBoxSize(ref);
  const boards =
    meta === undefined ? null : skeletonBoards({ row: indexRowOf(snapshot, path), meta });
  const cam =
    boards && size.w && size.h
      ? skeletonCamera({
          boards,
          width: size.w,
          height: size.h,
          insets,
          viewport: meta?.viewport,
        })
      : null;
  const shown = cam ? screenBoards(boards, cam, size.w, size.h) : null;
  return (
    <div
      ref={ref}
      className="sh-opening-skel"
      data-testid="canvas-skeleton"
      data-ready={shown ? 'true' : 'false'}
    >
      {shown && note ? (
        <p className="sh-opening-note" data-testid="canvas-skeleton-note">
          {note}
        </p>
      ) : null}
      {shown
        ? shown.map((b) => (
            <SkeletonArtboard
              key={b.id}
              label={b.named ? b.label : ''}
              kind={b.kind}
              x={b.left}
              y={b.top}
              w={b.sw}
              h={b.sh}
            />
          ))
        : fallback}
    </div>
  );
}
