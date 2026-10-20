// client/v2/ds/reach-data.js — S10.9: what the reach view needs from the studio, read once when "Show" is pressed.
//
//   · the usage of ONE token (or master): `GET /_api/ds/usage?ds=&css=` — the places per canvas, per artboard, and the
//     element ids to ring (S10.5). A read: anyone who can open the project may look.
//   · the review the same list opens ("Update N canvases"): `loadDsReview` in review-host.jsx. It is optional — a
//     token nothing waits on still has a reach, it just has no list under it.
//
// Nothing here is trusted from the page: the system comes from the canvas the person has open (review-host
// `systemOf`), the token from the inspector's selection, and the server refuses what it does not know.

import { reachModel } from './reach-model.js';

export const REACH_WORDS = Object.freeze({
  title: 'One colour, everywhere it lands',
  titleOther: 'Everywhere it lands',
  lines: 'Lines run from the swatch to every spot that will change, ringed.',
  reviewNote: 'The review is the same list — untick a canvas to leave it out.',
  hide: 'Hide',
  close: 'Close',
  loading: 'Looking for the places…',
  unreachable: 'Could not look up the places. Try again.',
  forbidden: 'You can look here; ask to see where this is used.',
  nothing: (name) => `Nothing uses ${name} yet.`,
  noFrame: 'Not drawn — this canvas could not be shown here.',
});

const CSS_NAME = /^--[A-Za-z0-9_-]{1,128}$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

/** The query string for the thing the reach is asked about: a token (`css`) or a master (`component`). */
export function reachQuery({ css, component } = {}) {
  if (typeof css === 'string' && CSS_NAME.test(css)) return `css=${encodeURIComponent(css)}`;
  if (typeof component === 'string' && COMPONENT.test(component))
    return `component=${encodeURIComponent(component)}`;
  return null;
}

/**
 * @returns {Promise<{ ok: true, usage: any, model: ReturnType<typeof reachModel> } | { ok: false, message: string }>}
 */
export async function loadReach({ ds, css, component, name }, fetchImpl = globalThis.fetch) {
  const q = reachQuery({ css, component });
  if (!q || typeof ds !== 'string' || !ds) return { ok: false, message: REACH_WORDS.unreachable };
  let res;
  try {
    res = await fetchImpl(`/_api/ds/usage?ds=${encodeURIComponent(ds)}&${q}`, {
      cache: 'no-store',
    });
  } catch {
    return { ok: false, message: REACH_WORDS.unreachable };
  }
  if (res.status === 403) return { ok: false, message: REACH_WORDS.forbidden };
  let usage = null;
  try {
    usage = await res.json();
  } catch {
    /* judged by the status below */
  }
  if (!res.ok || !usage) return { ok: false, message: REACH_WORDS.unreachable };
  const model = reachModel(usage);
  if (model.places === 0) return { ok: false, message: REACH_WORDS.nothing(name || 'this') };
  return { ok: true, usage, model };
}
