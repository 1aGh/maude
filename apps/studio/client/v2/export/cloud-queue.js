// client/v2/export/cloud-queue.js — S8.5: a cloud render waiting on this Mac (09 ex-offline).
//
// A cloud video asked while this Mac cannot reach the cloud is an outbox record (V2-1.14
// `export.cloud`) whose id IS the job id; the Exports panel lists it as "In the cloud · Queued —
// starts when this Mac is online", and it starts by itself. Its one action is "Render on this Mac
// now": withdraw the queued record (`POST /_api/outbox/:id/cancel`, registry `outbox.cancel`) and run
// the same spec on this Mac (`POST /_api/export-jobs`, the sheet's own door). No new route: the agent
// does the same with `maude design outbox cancel <id>` + `maude design export …`.

import { useEffect, useState } from 'react';

export const RENDER_HERE = 'Render on this Mac now';
export const ALREADY_IN_CLOUD =
  'It has already started in the cloud — it will land here when done.';
export const RENDER_HERE_FAILED = 'Couldn’t start it on this Mac. Try again.';

/** Is this row a cloud render still waiting in the outbox? */
export const isQueuedCloud = (job) =>
  job?.runsOn === 'cloud' && job?.status === 'queued' && typeof job?.waiting === 'string';

/**
 * "Render on this Mac now". Resolves `{ ok: true, jobId }` (the this-Mac job) or `{ ok: false, words }`.
 * @param {string} id the queued row's job id (= its outbox record id)
 * @param {{ fetch?: typeof fetch }} [deps]
 */
export async function renderHereNow(id, deps = {}) {
  const f = deps.fetch ?? globalThis.fetch;
  const enc = encodeURIComponent(id);
  try {
    const rec = await f(`/_api/outbox/${enc}`);
    if (!rec.ok) return { ok: false, words: RENDER_HERE_FAILED };
    const record = await rec.json();
    const spec = record?.payload?.kind === 'export.cloud' ? record.payload.spec : null;
    if (!spec || typeof spec !== 'object') return { ok: false, words: RENDER_HERE_FAILED };
    const c = await f(`/_api/outbox/${enc}/cancel`, { method: 'POST' });
    if (c.status === 409) return { ok: false, words: ALREADY_IN_CLOUD };
    if (!c.ok) return { ok: false, words: RENDER_HERE_FAILED };
    const here = { ...spec, options: { ...(spec.options ?? {}), lane: 'this-mac' } };
    const r = await f('/_api/export-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 2, spec: here }),
    });
    if (!r.ok) return { ok: false, words: RENDER_HERE_FAILED };
    const body = await r.json().catch(() => ({}));
    return { ok: true, jobId: typeof body?.jobId === 'string' ? body.jobId : null };
  } catch {
    return { ok: false, words: RENDER_HERE_FAILED };
  }
}

/** This Mac's reachability as the browser knows it (`navigator.onLine` + its events). */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
