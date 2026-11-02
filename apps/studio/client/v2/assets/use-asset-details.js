// client/v2/assets/use-asset-details.js — one asset's details, read from the studio (S8.21).
//
// `GET /_api/asset-details?path=assets/<name>` (routes/asset-details.ts) says what the sheet draws. It is a read: nothing here
// writes. A studio that does not serve the route (an older one, a cloud tab) answers 404, and the sheet then draws what the
// Assets tab already knows (name, kind, size, where it is used) — a quieter sheet, never a broken one. Re-read when the server
// says something moved (`index-changed`), so a new use or a finished edit shows without reopening.

import { useCallback, useEffect, useRef, useState } from 'react';
import { INDEX_CHANGED_EVENT } from '../canvases/use-canvas-index.js';

/** @returns {Promise<{ state: 'ready', details: object } | { state: 'gone' } | { state: 'error' }>} */
export async function readAssetDetails(path, get) {
  try {
    const r = await get(`/_api/asset-details?path=${encodeURIComponent(path)}`, {
      cache: 'no-store',
    });
    if (r.status === 404) return { state: 'gone' };
    if (!r.ok) return { state: 'error' };
    const j = await r.json();
    return j?.ok && j.details ? { state: 'ready', details: j.details } : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

/** @returns {{ state: 'loading' | 'ready' | 'gone' | 'error', details: object | null }} */
export function useAssetDetails(path, { fetchImpl } = {}) {
  const [got, setGot] = useState({ path: null, state: 'loading', details: null });
  const alive = useRef(true);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;

  const load = useCallback(async () => {
    if (!path) return;
    const r = await readAssetDetails(path, (...a) => fetchRef.current(...a));
    if (alive.current)
      setGot({ path, state: r.state, details: r.state === 'ready' ? r.details : null });
  }, [path]);

  useEffect(() => {
    alive.current = true;
    load();
    let timer = null;
    const on = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    };
    window.addEventListener(INDEX_CHANGED_EVENT, on);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener(INDEX_CHANGED_EVENT, on);
    };
  }, [load]);

  // an answer for the previous asset is not this one's
  return got.path === path ? got : { state: 'loading', details: null };
}
