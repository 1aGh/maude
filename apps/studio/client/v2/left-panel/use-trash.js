// client/v2/left-panel/use-trash.js — V2-4.4a: the trash list behind the Canvases panel's last row.
// Today's list: GET /_api/sync/trash → { entries, total, bytes } (restore / prune are POSTs to the same
// route). It lists every parked file under <designRoot>/_trash/ — moved canvases, conflict losers,
// sync's quarantined copies — so the row's count is the same one the Sync panel shows.

import { useCallback, useEffect, useRef, useState } from 'react';

/** A canvas moved to the trash parks its bundle with a `_trash-manifest.json` bookkeeping file — a thing
 *  the person never made, so it is not a "thing" in the list or the count. */
export function visibleTrash(j) {
  const entries = j.entries.filter((e) => !/(^|\/)_trash-manifest\.json$/.test(e.trashRel || ''));
  const hidden = j.entries.length - entries.length;
  return { ...j, entries, total: Math.max(0, (j.total ?? j.entries.length) - hidden) };
}

export async function fetchTrash(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/_api/sync/trash');
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.entries) ? visibleTrash(j) : null;
  } catch {
    return null;
  }
}

/** `trash` is null until the first answer (or when the route is refused — a viewer, a cell). `reload`
 *  re-reads; `stamp` re-reads it when it changes (a canvas moved to the trash arrives as a new index). */
export function useTrash({ enabled = true, stamp = 0 } = {}) {
  const [trash, setTrash] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    const j = await fetchTrash();
    if (alive.current) setTrash(j);
    return j;
  }, [enabled]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is the caller's re-read trigger.
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(reload, 250); // a burst of index updates reads once
    return () => clearTimeout(t);
  }, [enabled, reload, stamp]);
  return { trash, reload };
}

export async function postTrash(body, fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/_api/sync/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return r.ok && j?.ok !== false
      ? { ok: true, ...j }
      : { ok: false, error: j?.error || j?.detail || 'That did not complete.' };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
