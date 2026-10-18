// client/v2/export/last-finished.js — S8.9: when the open canvas last finished a version, for the sheet's
// "From 14:05" line while AI is working on it. The canvas file's own mtime (from the project index) is the
// last time anything landed on it; one read when the sheet opens, nothing while it is closed.

import { useEffect, useState } from 'react';
import { indexMeta } from '../canvases/tree-model.js';

/** @returns ms, or null (no index, no such canvas, or the sheet is closed) */
export function useLastFinishedAt({ open, activePath, designRel, fetchImpl }) {
  const [at, setAt] = useState(null);
  useEffect(() => {
    if (!open || !activePath) {
      setAt(null);
      return undefined;
    }
    let cancelled = false;
    const doFetch = fetchImpl || ((...a) => fetch(...a));
    (async () => {
      try {
        const r = await doFetch('/_api/index', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const snapshot = await r.json();
        const row = indexMeta(snapshot, designRel).get(activePath);
        if (!cancelled) setAt(row?.mtimeMs > 0 ? row.mtimeMs : null);
      } catch {
        /* no index: the sheet says "now" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activePath, designRel, fetchImpl]);
  return at;
}
