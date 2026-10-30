// client/v2/canvases/use-canvas-index.js — S1.1: the project index (`GET /_api/index`, V2-1.17) for the
// Canvases panel — the project id, the design root, and per-canvas meta (artboard kinds, made by AI, cover).
//
// Re-read when the tree changes (`?since=<seq>` answers `{unchanged}` when nothing moved) and when the
// server says a canvas's content moved (`index-changed` over the socket, relayed by the shell as the window
// event below) — a trashed or added artboard changes no path, so the tree stamp alone never saw it (S1.23:
// the panel foot kept "21 artboards" after one was trashed). If the server has
// no index (an older server, a cloud tab that does not serve it) the panel is simply without badges.

import { useEffect, useRef, useState } from 'react';

/** The shell's relay of the socket's `index-changed { seq, rels }` (client/app.jsx). */
export const INDEX_CHANGED_EVENT = 'maude:index-changed';

export function useCanvasIndex({ stamp, fetchImpl } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    const on = () => setMoved((n) => n + 1);
    window.addEventListener(INDEX_CHANGED_EVENT, on);
    return () => window.removeEventListener(INDEX_CHANGED_EVENT, on);
  }, []);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const seq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` and `moved` are the "something changed" signals
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const url = seq.current ? `/_api/index?since=${seq.current}` : '/_api/index';
        const r = await fetchRef.current(url, { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (cancelled || data?.unchanged || !Array.isArray(data?.canvases)) return;
        seq.current = data.writer?.seq || 0;
        setSnapshot(data);
      } catch {
        /* no index: no badges */
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [stamp, moved]);

  return snapshot;
}
