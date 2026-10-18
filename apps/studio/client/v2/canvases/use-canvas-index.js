// client/v2/canvases/use-canvas-index.js — S1.1: the project index (`GET /_api/index`, V2-1.17) for the
// Canvases panel — the project id, the design root, and per-canvas meta (artboard kinds, made by AI, cover).
//
// Re-read when the tree changes (`?since=<seq>` answers `{unchanged}` when nothing moved). If the server has
// no index (an older server, a cloud tab that does not serve it) the panel is simply without badges.

import { useEffect, useRef, useState } from 'react';

export function useCanvasIndex({ stamp, fetchImpl } = {}) {
  const [snapshot, setSnapshot] = useState(null);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const seq = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the "the tree changed" signal
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
  }, [stamp]);

  return snapshot;
}
