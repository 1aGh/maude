// client/v2/shell/pages-pick.js — 2.0.7 B2: the shell remembers the canvas's Canvas | Pages pick.
//
// The canvas owns the view (canvas-pages.ts) but writes nothing: the canvas origin may PATCH only `layout` and
// `viewport` of `/_api/canvas-meta` (routes/canvas-origin.ts), and Pages adds no lane there. When a person switches,
// the active canvas says `pages-pick` and the shell — on the main origin, for the canvas IT has open — writes
// `canvasView` into the view file (`_canvas-state/<slug>.view.json`, per Mac, DDR-115), never the versioned meta.

import { normalizeOpenPath } from '../../share-link.js';

/** The `/_api/canvas-meta` body for `view` on the open canvas `activePath`, or null when there is none. */
export function pagesPickBody(activePath, designRel, view) {
  if (view !== 'canvas' && view !== 'pages') return null;
  const root = typeof designRel === 'string' && designRel ? designRel : '.design';
  const rel = normalizeOpenPath(activePath, root);
  if (!rel || !/\.(tsx|jsx)$/.test(rel)) return null;
  return {
    file: `${root.replace(/^\.\//, '').replace(/\/$/, '')}/${rel}`,
    patch: { canvasView: view },
  };
}

/** Write the pick (best-effort, like the camera: a refused write leaves the view as it is for this session). */
export function savePagesPick(activePath, designRel, view, doFetch = globalThis.fetch) {
  const body = pagesPickBody(activePath, designRel, view);
  if (!body || typeof doFetch !== 'function') return null;
  return Promise.resolve(
    doFetch('/_api/canvas-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).catch(() => null);
}
