// client/v2/ds/door-write.js — S10.21b: the client writers of three engine doors that had none (S10.21 audit):
//
//   ds.canvas-update   a left-out canvas's row menu › Update      POST /_api/ds/canvas { canvas, action: 'update' }
//   ds.canvas-leave    the update card's Keep this version          POST /_api/ds/canvas { canvas, action: 'leave' }
//   ds.restore-token   Trash › a token's Restore                    POST /_api/ds/restore { ds, css }
//   ds.clear-token     Trash › Clear out… (owner) — each token      POST /_api/ds/clear { ds, css }
//
// Each is one request; the server judges it again (routes/ds.ts — Can edit, Clear out is the owner's). The same
// functions back the registry rows (menu-runner `runDsDoorAction`), so a button and the action are one writer and
// an agent's verb (`maude design ds canvas update | restore | clear`) lands the same files (test/ds-agent-parity).
// After a write the window hears DS_STATE_CHANGED, so the Trash's token rows read the system again.
//
// `trashedTokenItems` turns `GET /_api/ds/state`'s `trashed[]` (S10 §2.2 "Token tombstones in Trash") into rows
// the Trash view draws next to canvases and artboards.

/** use-ds-state.js re-reads on this window event. */
export const DS_STATE_CHANGED = 'maude:ds-state-changed';

const JSON_HEADERS = { 'content-type': 'application/json' };

export const DOOR_WORDS = Object.freeze({
  forbidden: 'You can look here; ask to edit.',
  owner: 'Only an owner clears out the trash. Nothing was changed.',
  moved: 'Someone updated the system just now. Nothing was changed. Try again.',
  gone: 'That one is not in the trash any more.',
  unreachable: 'Not changed. The studio could not be reached; try again.',
  failed: 'Not changed; try again.',
});

const quoted = (s) => `“${s}”`;
const baseName = (p) =>
  String(p || '')
    .split('/')
    .pop()
    .replace(/\.(tsx|jsx)$/i, '');

/** A refusal code from routes/ds.ts → the person's words. */
export function doorWords(code, { clear = false } = {}) {
  switch (code) {
    case 'forbidden':
      return clear ? DOOR_WORDS.owner : DOOR_WORDS.forbidden;
    case 'ds-head-moved':
      return DOOR_WORDS.moved;
    case 'ds-not-trashed':
      return DOOR_WORDS.gone;
    case 'unreachable':
      return DOOR_WORDS.unreachable;
    default:
      return DOOR_WORDS.failed;
  }
}

async function post(fetchImpl, url, body) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by its status */
  }
  if (res.ok) {
    try {
      globalThis.window?.dispatchEvent(new Event(DS_STATE_CHANGED));
    } catch {
      /* no window (a test, an agent) */
    }
    return { ok: true, body: json };
  }
  return { ok: false, code: json?.code ?? (res.status === 403 ? 'forbidden' : 'failed') };
}

/** "Update" on a left-out canvas: it follows the system's head again (`meta.dsRev` goes; one ⌘Z). */
export async function canvasUpdateNow({ canvas }, fetchImpl = globalThis.fetch) {
  const r = await post(fetchImpl, '/_api/ds/canvas', { canvas, action: 'update' });
  return r.ok
    ? { ok: true, message: `Updated ${quoted(baseName(canvas))}.` }
    : { ok: false, code: r.code, message: doorWords(r.code) };
}

/**
 * p8-dead-reasons — "Keep this version": the canvas stays on the version it shows; the engine remembers the head it
 * declined (`dsKept`) so the update card stays away until the system moves on. Update stays in the canvas's menu.
 * The card going away is the answer: no sentence on success (it is one kernel action, so it undoes).
 */
export async function canvasLeaveNow({ canvas }, fetchImpl = globalThis.fetch) {
  const r = await post(fetchImpl, '/_api/ds/canvas', { canvas, action: 'leave' });
  return r.ok ? { ok: true, message: '' } : { ok: false, code: r.code, message: doorWords(r.code) };
}

/** Restore a token from the Trash: a publish that puts its previous values back. */
export async function restoreTokenNow({ ds, css, label }, fetchImpl = globalThis.fetch) {
  const r = await post(fetchImpl, '/_api/ds/restore', { ds, css });
  return r.ok
    ? { ok: true, message: `Restored ${quoted(label || css)}.` }
    : { ok: false, code: r.code, message: doorWords(r.code) };
}

/** Clear a token out of the Trash (owner): the tombstone goes, the alias line stays. */
export async function clearTokenNow({ ds, css, label }, fetchImpl = globalThis.fetch) {
  const r = await post(fetchImpl, '/_api/ds/clear', { ds, css });
  return r.ok
    ? { ok: true, message: `Cleared out ${quoted(label || css)}.` }
    : { ok: false, code: r.code, message: doorWords(r.code, { clear: true }) };
}

const CSS_RE = /^--[A-Za-z0-9_-]{1,128}$/;

/** Registry `ds.canvas-update` / `ds.canvas-leave` / `ds.restore-token` / `ds.clear-token` (menu-runner): the write, a sentence back. */
export async function runDsDoorAction(id, p, fetchImpl = globalThis.fetch) {
  const canvas = typeof p?.canvas === 'string' ? p.canvas : '';
  const ds = typeof p?.ds === 'string' ? p.ds : '';
  const css = typeof p?.css === 'string' ? p.css : '';
  if (id === 'ds.canvas-update' || id === 'ds.canvas-leave') {
    if (!/\.tsx$/i.test(canvas)) return { ok: false, message: DOOR_WORDS.failed };
    return id === 'ds.canvas-update'
      ? canvasUpdateNow({ canvas }, fetchImpl)
      : canvasLeaveNow({ canvas }, fetchImpl);
  }
  if (!ds || !CSS_RE.test(css)) return { ok: false, message: DOOR_WORDS.failed };
  const label = typeof p?.label === 'string' ? p.label : '';
  if (id === 'ds.restore-token') return restoreTokenNow({ ds, css, label }, fetchImpl);
  if (id === 'ds.clear-token') return clearTokenNow({ ds, css, label }, fetchImpl);
  return { ok: false, message: DOOR_WORDS.failed };
}

/**
 * The Trash rows for the tokens moved to the trash, from use-ds-state's map (`{ [system]: { label, trashed } }`).
 * Each row is `{ id, kind: 'token', ds, system, systemLabel, css, label, replacement, at, who }` — `at` in ms (the
 * Trash groups and words by it), `who` the name the tombstone carries.
 */
export function trashedTokenItems(byName) {
  const out = [];
  for (const [system, s] of Object.entries(byName ?? {})) {
    for (const t of s?.trashed ?? []) {
      if (!t || typeof t.css !== 'string' || !CSS_RE.test(t.css)) continue;
      const at = typeof t.at === 'string' ? Date.parse(t.at) : Number.NaN;
      const who = t.by && typeof t.by.name === 'string' && t.by.name ? t.by.name : null;
      out.push({
        id: `ds-token:${system}:${t.css}`,
        kind: 'token',
        ds: system,
        system,
        systemLabel: s.label || system,
        css: t.css,
        label: typeof t.label === 'string' && t.label ? t.label : null,
        replacement: typeof t.replacement === 'string' ? t.replacement : null,
        at: Number.isNaN(at) ? 0 : at,
        ...(who ? { who } : {}),
      });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
