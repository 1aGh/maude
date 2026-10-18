// client/v2/left-panel/use-trash.js — the Trash behind the Canvases panel's last row.
//
// S1.8: the Trash is the SHARED one now — GET /_api/trash (routes/trash.ts, S1.7) answers
// `{ ok, items, canClear, seq }`: canvases and artboards with who / when, Today / Earlier, newest first.
// Two other things travel with it:
//   - `legacy: true` (or an old studio that has no such route, or an answer without `items`): this home
//     has no shared Trash, so the view falls back to today's per-Mac list, GET /_api/sync/trash.
//   - that per-Mac list ALSO stays — as "Kept on this Mac" under Canvases › Advanced (S1 Q5): conflict
//     losers, sync's quarantined copies, migration copies. `kept` is always read; `items` only when the
//     shared Trash answers.
//
// `useTrash() → { trash, reload, items, canClear, seq, legacy, kept }`. `trash` is the whole state object
// (the row's count `trash.total`, and for the legacy view `trash.entries` / `trash.bytes`, are what the
// callers of the pre-S1.8 hook already read). It re-reads on the bus's `trash:changed` (relayed by the app
// shell as the window event below), on `stamp` (a canvas list update re-stamps it), and after a write.

import { useCallback, useEffect, useRef, useState } from 'react';

import { trashClearRequest, trashRestoreRequest } from '../../../history/surface-requests.ts';

/** The app shell relays the bus's `trash:changed { seq }` as this window event. */
export const TRASH_CHANGED_EVENT = 'maude:trash-changed';

/** A canvas moved to the trash parks its bundle with a `_trash-manifest.json` bookkeeping file — a thing
 *  the person never made, so it is not a "thing" in the list or the count. */
export function visibleTrash(j) {
  const entries = j.entries.filter((e) => !/(^|\/)_trash-manifest\.json$/.test(e.trashRel || ''));
  const hidden = j.entries.length - entries.length;
  return { ...j, entries, total: Math.max(0, (j.total ?? j.entries.length) - hidden) };
}

/** Today's per-Mac list (`/_api/sync/trash`): "Kept on this Mac". Null when the route refuses. */
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

/**
 * The shared Trash. `{ kind: 'shared', items, canClear, seq }`, `{ kind: 'legacy' }` (no shared Trash
 * here — an older studio, a legacy-mode project), or `{ kind: 'unreachable' }` (the team server did not
 * answer: keep what was on screen, say so).
 */
export async function fetchSharedTrash(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/_api/trash');
    if (!r.ok) return { kind: 'legacy' };
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') return { kind: 'legacy' };
    if (j.legacy === true) return { kind: 'legacy' };
    if (j.ok === false) return { kind: 'unreachable' };
    if (!Array.isArray(j.items)) return { kind: 'legacy' };
    return { kind: 'shared', items: j.items, canClear: j.canClear === true, seq: j.seq ?? 0 };
  } catch {
    return { kind: 'legacy' };
  }
}

/** Both lists → the one state the view and the row read. */
export function trashState(shared, kept, prev = null) {
  const keptList = kept ?? null;
  if (shared.kind === 'unreachable' && prev?.loaded)
    return { ...prev, kept: keptList, unreachable: true };
  const legacy = shared.kind !== 'shared';
  const items = shared.kind === 'shared' ? shared.items : [];
  return {
    loaded: true,
    unreachable: shared.kind === 'unreachable',
    legacy,
    items,
    canClear: shared.kind === 'shared' ? shared.canClear : false,
    seq: shared.kind === 'shared' ? shared.seq : 0,
    kept: keptList,
    // the legacy view lists the per-Mac entries, so they ARE the count there
    entries: keptList?.entries ?? [],
    bytes: keptList?.bytes ?? 0,
    total: legacy ? (keptList?.total ?? 0) : items.length,
  };
}

/** `trash` is null until the first answer (or when nothing at all answers — a viewer, a cell). */
export function useTrash({ enabled = true, stamp = 0 } = {}) {
  const [trash, setTrash] = useState(null);
  const [bump, setBump] = useState(0);
  const alive = useRef(true);
  const last = useRef(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    const [shared, kept] = await Promise.all([fetchSharedTrash(), fetchTrash()]);
    const next = shared.kind === 'legacy' && !kept ? null : trashState(shared, kept, last.current);
    last.current = next;
    if (alive.current) setTrash(next);
    return next;
  }, [enabled]);
  useEffect(() => {
    const on = () => setBump((n) => n + 1);
    window.addEventListener(TRASH_CHANGED_EVENT, on);
    return () => window.removeEventListener(TRASH_CHANGED_EVENT, on);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` and `bump` are the re-read triggers.
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(reload, 250); // a burst of index updates / bus events reads once
    return () => clearTimeout(t);
  }, [enabled, reload, stamp, bump]);
  return {
    trash,
    reload,
    items: trash?.items ?? [],
    canClear: trash?.canClear === true,
    seq: trash?.seq ?? 0,
    legacy: trash?.legacy ?? false,
    kept: trash?.kept ?? null,
  };
}

async function postJson(url, body, fetchImpl) {
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, body: j };
  } catch (e) {
    return {
      status: 0,
      body: { ok: false, reason: 'unreachable', detail: String(e?.message || e) },
    };
  }
}

/** `trash.restore` { id } → { status, body } (the one request shape: history/surface-requests.ts). */
export const restoreItem = (id, fetchImpl = fetch) => {
  const q = trashRestoreRequest(id);
  return postJson(q.route, q.body, fetchImpl);
};

/** `trash.clear` { items? } → { status, body }. Absent `items` = everything in the Trash. */
export const clearOut = (items, fetchImpl = fetch) => {
  const q = trashClearRequest(items || undefined);
  return postJson(q.route, q.body, fetchImpl);
};

/** The per-Mac list's own writes (restore / prune), unchanged: POST /_api/sync/trash. */
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
