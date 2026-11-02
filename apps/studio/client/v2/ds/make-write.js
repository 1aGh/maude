// client/v2/ds/make-write.js — S10.16b: the shell's calls for making a design system.
//
//   makeSystem({ds, label})        POST /_api/ds/make {action:'make'}    the outline: a config entry + folder + canvas
//   useDirection({ds, direction})  POST /_api/ds/make {action:'use'}     direction X into the working files
//   mixDirections({ds, base, take}) POST /_api/ds/make {action:'mix'}    base X, with whole groups from others
//   finishMaking({ds})             POST /_api/ds/make {action:'done'}    first revision; becomes the default
//   readMakeState(ds)              GET  /_api/ds/make-state?ds=          section states, level, reasons, drafts
//
// These are the bodies of the registry actions (`ds.make`, `ds.use-direction`, `ds.mix`, `ds.make-done`); an agent
// reaches the same route with `maude design ds make|use|mix|done`. The server judges the role (Can edit on the
// whole project) and every name; a refusal comes back as a code and becomes the person's words.

import { refusalWords } from './make-model.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const URL_MAKE = '/_api/ds/make';

async function send(fetchImpl, body) {
  let res;
  try {
    res = await fetchImpl(URL_MAKE, {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: 'unreachable', message: refusalWords('unreachable'), body: null };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  if (res.ok) return { ok: true, code: null, message: '', body: json };
  const code = json?.code ?? (res.status === 403 ? 'forbidden' : 'failed');
  return { ok: false, code, message: refusalWords(code), body: json };
}

export const makeSystem = ({ ds, label }, fetchImpl = globalThis.fetch) =>
  send(fetchImpl, { action: 'make', ds, label });

export const useDirection = ({ ds, direction }, fetchImpl = globalThis.fetch) =>
  send(fetchImpl, { action: 'use', ds, direction });

export const mixDirections = ({ ds, base, take }, fetchImpl = globalThis.fetch) =>
  send(fetchImpl, { action: 'mix', ds, base, take });

export const finishMaking = ({ ds, setDefault = true }, fetchImpl = globalThis.fetch) =>
  send(fetchImpl, { action: 'done', ds, setDefault });

/**
 * A logo's bytes → the server's own path for it (`assets/logos/<8>.svg`), or a reason in words. Bytes only
 * (DDR-167): the page never names a path, the server answers with its own.
 */
export async function uploadLogo(bytes, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/_api/import-asset', {
      method: 'POST',
      headers: { 'X-Import-Kind': 'svg' },
      body: bytes,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok && typeof json.path === 'string') return { ok: true, path: json.path };
    return {
      ok: false,
      message:
        res.status === 415 || res.status === 400
          ? 'That file isn’t a logo Maude can read. Use an SVG.'
          : 'Couldn’t read the logo.',
    };
  } catch {
    return { ok: false, message: 'Couldn’t read the logo.' };
  }
}

/** The make-state of `ds`, or null when the server will not say (no such system, unreadable). */
export async function readMakeState(ds, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/_api/ds/make-state?ds=${encodeURIComponent(ds)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.format === 'maude.ds-make' ? json : null;
  } catch {
    return null;
  }
}
