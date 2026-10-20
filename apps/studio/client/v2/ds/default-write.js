// client/v2/ds/default-write.js — S10.13: the two gestures behind the pinned rows that are not "open".
//
//   setDefaultSystem(ds)   `ds.set-default` — "Use for new canvases": one POST to /_api/ds/default
//   requestDsMake()        `ds.make` — the empty row's door: opens the three-input sheet (S10.16b listens)
//
// Both are the registry actions' bodies, so the row and ⌘K / an agent do exactly one thing. The server
// judges the role (Can edit on the whole project); the words here only say what happened.

import { tokenWords } from './token-write.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The event the make sheet (S10.16b) answers; it calls `preventDefault()` to say "I took it". */
export const DS_MAKE_EVENT = 'maude:ds-make';

export const DEFAULT_WORDS = Object.freeze({
  set: (label) => `${label} is now the default for new canvases.`,
  already: (label) => `${label} is already the default.`,
  make: 'Making a design system opens here soon.',
});

/**
 * @param {string} ds  the system's name
 * @param {{ label?: string, fetchImpl?: typeof fetch }} [o]
 * @returns {Promise<{ ok: boolean, message: string, changed?: boolean }>}
 */
export async function setDefaultSystem(ds, { label, fetchImpl = globalThis.fetch } = {}) {
  const name = label || ds;
  let res;
  try {
    res = await fetchImpl('/_api/ds/default', {
      method: 'POST',
      cache: 'no-store',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ds }),
    });
  } catch {
    return { ok: false, message: tokenWords('unreachable') };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* judged by status */
  }
  if (!res.ok) {
    const code = json?.code ?? (res.status === 403 ? 'forbidden' : 'failed');
    return { ok: false, message: tokenWords(code) };
  }
  const changed = json?.previous !== ds;
  return {
    ok: true,
    changed,
    message: changed ? DEFAULT_WORDS.set(name) : DEFAULT_WORDS.already(name),
  };
}

/**
 * Ask the make sheet to open. With no sheet listening (it lands with S10.16b) the row says so in a toast
 * rather than doing nothing.
 * @returns {boolean} whether something took the request
 */
export function requestDsMake(params = {}, { toast, target = globalThis.window } = {}) {
  if (!target?.dispatchEvent) return false;
  const ev = new CustomEvent(DS_MAKE_EVENT, { detail: params, cancelable: true });
  target.dispatchEvent(ev);
  if (!ev.defaultPrevented) toast?.(DEFAULT_WORDS.make);
  return ev.defaultPrevented;
}
