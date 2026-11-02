// client/v2/ds/edge-write.js — S10.17: the writes and reads of the three edges. Each is one request to the server,
// which judges it again (routes/ds-edges.ts, ds.ts `trash`, routes/edit.ts); nothing here is trusted by the server.
// The same functions back the registry actions `ds.fix-contrast`, `ds.add-colour`, `ds.use-nearest` and
// `ds.trash-token`, so the buttons and an agent do exactly one thing.

import { edgeWords } from './edge-model.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(fetchImpl, method, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      cache: 'no-store',
      ...(body ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}),
    });
  } catch {
    return { ok: false, code: 'unreachable', body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an unreadable answer is judged by its status */
  }
  const code = res.ok
    ? null
    : (json?.code ?? (res.status === 403 ? 'forbidden' : res.status === 409 ? 'stale' : 'failed'));
  return { ok: res.ok, code, body: json };
}

const refuse = (r) => ({ ok: false, code: r.code, message: edgeWords(r.code) });

/** "Lighten to 4.5:1": one waiting edit (`ds/edges.ts`). */
export async function fixContrastNow({ ds, css, theme }, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/fix-contrast', {
    ds,
    css,
    ...(theme ? { theme } : {}),
  });
  return r.ok ? { ok: true, fixes: r.body?.fixes ?? [] } : refuse(r);
}

/** "Add it to the system": a waiting new colour. */
export async function addColourNow({ ds, value, label }, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/add-colour', {
    ds,
    value,
    ...(label ? { label } : {}),
  });
  return r.ok ? { ok: true, css: r.body?.css, label: r.body?.label } : refuse(r);
}

/** What the trash sheet asks: the closest colour to follow, how many canvases use it, whether it can go. */
export async function fetchTrashQuestion({ ds, css }, fetchImpl = globalThis.fetch) {
  const r = await call(
    fetchImpl,
    'GET',
    `/_api/ds/nearest?ds=${encodeURIComponent(ds)}&css=${encodeURIComponent(css)}`
  );
  return r.ok && r.body?.edge === 'trash' ? { ok: true, question: r.body } : refuse(r);
}

/** "Move to trash": the engine's own trash (publishes with every follower ticked; one undo step). */
export async function trashTokenNow({ ds, css, replacement }, fetchImpl = globalThis.fetch) {
  const r = await call(fetchImpl, 'POST', '/_api/ds/trash', { ds, css, replacement });
  return r.ok ? { ok: true } : refuse(r);
}

/** Hand-picked colours on the lines changed in a canvas, each with the closest system colour. */
export async function fetchOffSystem({ canvas }, fetchImpl = globalThis.fetch) {
  const r = await call(
    fetchImpl,
    'GET',
    `/_api/ds/off-system?canvas=${encodeURIComponent(canvas)}`
  );
  return r.ok && r.body?.edge === 'off-system' ? { ok: true, answer: r.body } : refuse(r);
}

/** "Use Accent": one edit on the element that carries the colour (one ⌘Z). */
export async function applyNearestNow({ canvas, finding, css }, fetchImpl = globalThis.fetch) {
  if (!finding?.target) return { ok: false, code: 'failed', message: edgeWords('failed') };
  const r = await call(fetchImpl, 'POST', '/_api/edit-op', {
    file: canvas,
    op: 'ds.use-nearest',
    targets: [finding.target],
    params: { literal: finding.literal, css, line: finding.line, col: finding.col },
  });
  return r.ok ? { ok: true } : refuse(r);
}
