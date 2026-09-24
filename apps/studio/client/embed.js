// DDR-242 — the chromeless `?embed=1` view another app frames, and the ONE-WAY
// message contract it speaks to that app. Pure (URLSearchParams + URL only) so
// `test/embed.test.ts` exercises it without React or a DOM.
//
// THE CONTRACT (v1) — embedders build against this shape, so it only grows:
//
//   { source: 'maude-hub', v: 1,
//     type: 'ready' | 'auth-required' | 'not-found' | 'escape',
//     open: string, title?: string }
//
// `auth-required` is posted by the hub's signed-out embed page
// (apps/hub/src/embed-page.mjs), the others by `embed-view.jsx`. `escape`
// (added to v1, additive) means Escape was pressed inside the embed and
// nothing there consumed it — keys in a frame never reach the embedding page,
// so without it an embed inside a dialog would trap a keyboard user. The embed
// never takes focus on its own; only a click moves focus into it. Nothing is
// ever posted to '*': the target is the parent's exact origin, and only when
// that origin is on the server's embed allowlist. Nothing is accepted FROM the
// parent in v1.
import { readOpenParam } from './share-link.js';

export const EMBED_SOURCE = 'maude-hub';
export const EMBED_VERSION = 1;

/** Is this page load the embed view? Exactly `embed=1`, nothing looser. */
export function isEmbedLocation(location) {
  try {
    return new URLSearchParams(location?.search ?? '').get('embed') === '1';
  } catch {
    return false;
  }
}

/** An artboard id the embed may ask the canvas to frame. Only ever compared for
 *  equality against `data-dc-screen`, so the bound is length + no controls. */
export function validArtboardId(raw) {
  return (
    typeof raw === 'string' &&
    raw.length > 0 &&
    raw.length <= 120 &&
    ![...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}

/**
 * What the embed was asked to show. `open` is the validated design-root
 * relative identity (share-link.js rules) or null; `requested` is what the
 * embedder sent, echoed back in `not-found` so it can tell its own requests
 * apart.
 */
export function readEmbedParams(location, designRel = '.design') {
  const params = new URLSearchParams(location?.search ?? '');
  const values = params.getAll('open');
  const artboard = params.get('artboard');
  return {
    open: readOpenParam(location, designRel),
    requested: values.length === 1 ? values[0].slice(0, 512) : '',
    artboard: validArtboardId(artboard) ? artboard : null,
  };
}

/**
 * The embedding page's origin. `ancestorOrigins` where the engine has it
 * (Chromium, WebKit) — it cannot be influenced by the parent's referrer
 * policy — else the referrer's origin (Firefox). Null when not framed at all.
 */
export function parentOrigin(win) {
  try {
    if (!win || win.parent === win) return null;
    const ancestors = win.location?.ancestorOrigins;
    if (ancestors && ancestors.length > 0) return ancestors[0];
    const referrer = win.document?.referrer;
    return referrer ? new URL(referrer).origin : null;
  } catch {
    return null;
  }
}

/** The exact origin to post to, or null — never '*', never an unlisted parent. */
export function embedTarget(origin, allowlist) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return null;
  return Array.isArray(allowlist) && allowlist.includes(origin) ? origin : null;
}

export function embedMessage(type, open, title) {
  const msg = { source: EMBED_SOURCE, v: EMBED_VERSION, type, open: String(open ?? '') };
  if (typeof title === 'string' && title) msg.title = title;
  return msg;
}

/** Post one contract message to the parent, if the parent may hear it. */
export function postToEmbedder(win, allowlist, type, open, title) {
  const target = embedTarget(parentOrigin(win), allowlist);
  if (!target) return false;
  try {
    win.parent.postMessage(embedMessage(type, open, title), target);
    return true;
  } catch {
    return false;
  }
}
