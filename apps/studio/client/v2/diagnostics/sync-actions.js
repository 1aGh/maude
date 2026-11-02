// client/v2/diagnostics/sync-actions.js — V2-4.7b: Resync and Download all, in one place.
//
// These two used to live inside SyncPanel's header; Menu › Diagnostics › Advanced reaches them too
// (CONTRACT §1), so the fetches moved here and both callers use them — the behaviour (routes, wording,
// failure messages) is exactly the panel's. Each returns the sentence to show, or '' when there is
// nothing to say.

/** POST /_api/sync/resync → { ok, note }. `note` is '' when the restart began and says nothing. */
export async function requestResync(fetchFn = globalThis.fetch) {
  let res = null;
  let json = {};
  try {
    res = await fetchFn('/_api/sync/resync', { method: 'POST' });
    json = await res.json().catch(() => ({}));
  } catch {
    /* the server went away — say so below rather than throwing into render */
  }
  if (!res) return { ok: false, note: 'Maude could not reach the sync service.' };
  if (res.status === 409) return { ok: false, note: 'Already restarting — give it a moment.' };
  if (!res.ok || !json.ok) return { ok: false, note: json.detail || 'Resync could not start.' };
  // A restart that declined is not an error, but it IS the only thing worth saying.
  if (json.sync && !json.sync.syncing) return { ok: true, note: json.sync.detail || '' };
  return { ok: true, note: '' };
}

/** POST /_api/sync/offline ("Download everything for offline") → the sentence to show. */
export async function requestOffline(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn('/_api/sync/offline', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return j.error || 'Could not download the project right now.';
    if (j.complete)
      return `Everything is on this device${j.pulled ? ` — ${j.pulled} file${j.pulled === 1 ? '' : 's'} came down` : ''}.`;
    return `${j.pulled} file${j.pulled === 1 ? '' : 's'} came down; ${j.failed} still to come — Maude keeps trying.`;
  } catch {
    return 'Maude isn’t reachable right now.';
  }
}
