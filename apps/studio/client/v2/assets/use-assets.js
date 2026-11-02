// client/v2/assets/use-assets.js — what the Assets tab lists (S8.12).
//
// One read: `GET /_api/index?part=assets` (S8.11's rows — kind, size, where each file is used, whether anything still
// needs it). The old listing (`GET /_api/assets`) is the fallback for a studio that has no index (an older server, a cloud
// tab that does not serve it): the tab then lists the same pictures without the "Used in …" line. Re-read when the server
// says something moved (`index-changed`, relayed by the shell).

import { useCallback, useEffect, useRef, useState } from 'react';
import { INDEX_CHANGED_EVENT } from '../canvases/use-canvas-index.js';

const KINDS = new Set(['image', 'video', 'audio']);

const baseName = (rel) => String(rel).split('/').pop() || String(rel);

/** An index answer's rows → the tab's rows: pictures, video and sound only, newest first. */
export function rowsFromIndex(answer) {
  const rows = Array.isArray(answer?.assets) ? answer.assets : [];
  return rows
    .filter((r) => r && typeof r.rel === 'string' && KINDS.has(r.kind))
    .map((r) => ({
      path: r.rel,
      name: baseName(r.rel),
      kind: r.kind,
      size: Number(r.size) || 0,
      mtimeMs: Number(r.mtimeMs) || 0,
      usedIn: Array.isArray(r.usedIn) ? r.usedIn : [],
      usedElsewhere: !!r.usedElsewhere,
      olderVersions: r.olderVersions ?? false,
      recentTake: !!r.recentTake,
      notUsed: r.notUsed ?? false,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The old listing → rows with no usage (`usedIn: null` says "not known", which draws no line). */
export function rowsFromListing(listing) {
  const list = Array.isArray(listing?.assets) ? listing.assets : [];
  return list
    .filter((a) => a && typeof a.path === 'string')
    .map((a) => ({
      path: a.path,
      name: a.name || baseName(a.path),
      kind: a.kind || 'image',
      size: Number(a.size) || 0,
      mtimeMs: Number(a.mtimeMs) || 0,
      usedIn: null,
      usedElsewhere: false,
      olderVersions: false,
      recentTake: false,
      notUsed: false,
    }));
}

/**
 * "Used in 4 canvases" — the hover line. Never says "Not used" while older versions are still being read
 * (a wrong "not used" would invite deleting a picture a version still shows).
 * @returns {string} '' when usage is not known
 */
export function usageWords(row) {
  if (!row || row.usedIn == null) return '';
  const n = row.usedIn.length;
  if (n > 0) return `Used in ${n} ${n === 1 ? 'canvas' : 'canvases'}`;
  if (row.recentTake) return 'Not placed yet';
  if (row.olderVersions === true) return 'Only in an older version';
  if (row.usedElsewhere) return 'Used outside the canvases';
  if (row.notUsed === 'checking' || row.olderVersions === 'checking')
    return 'Checking older versions…';
  return 'Not used';
}

async function readRows(get) {
  try {
    const r = await get('/_api/index?part=assets', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j?.assets))
        return { rows: rowsFromIndex(j), history: j.history ?? 'idle', source: 'index' };
    }
  } catch {
    /* fall back to the listing */
  }
  try {
    const r = await get('/_api/assets');
    const j = await r.json();
    return { rows: j?.ok ? rowsFromListing(j) : [], history: 'idle', source: 'listing' };
  } catch {
    return { rows: [], history: 'idle', source: 'none' };
  }
}

/** @returns {{ assets: object[] | null, history: string, reload: () => Promise<void> }} `assets` is null until the first answer */
export function useAssets({ fetchImpl } = {}) {
  const [state, setState] = useState({ assets: null, history: 'idle' });
  const alive = useRef(true);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;

  const reload = useCallback(async () => {
    const got = await readRows((...a) => fetchRef.current(...a));
    if (alive.current) setState({ assets: got.rows, history: got.history });
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    // a burst of file events is one re-read
    let timer = null;
    const on = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 150);
    };
    window.addEventListener(INDEX_CHANGED_EVENT, on);
    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener(INDEX_CHANGED_EVENT, on);
    };
  }, [reload]);

  return { assets: state.assets, history: state.history, reload };
}
