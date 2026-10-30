// client/v2/canvases/open-link.js — S1.18: stable canvas links (11 · pn-deeplink, S1 Q6).
//
// A canvas link names the kernel ENTRY, never a path, so moving or renaming the canvas keeps the link:
//   minted (Copy link)          maude://open/<project>?c=<entry>[&m=<commentId>][#<artboardId>]
//   delivered by the shell      maude://open/<project>?c=<entry>[&a=<artboardId>][&m=<commentId>]
// The shell (deep_link.rs) validates the ids and REBUILDS the link before a window sees it; the anchor rides
// as `a=` because the window never gets a fragment. Untrusted all the same: this module re-validates, and the
// window resolves the entry against its OWN server (`GET /_api/link/resolve`), never anything the link says.
//
// The toast never shows text from the link. "Opened from <name>'s link" takes the name from the comment the
// link opens, as this project stores it; without one it is "Opened from a link".

const PROJECT_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const ENTRY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const COMMENT_RE = /^[A-Za-z0-9_]{1,64}$/;

/** The kernel's artboard grammar: 1–128 characters, no `/`, no control characters. */
export const okArtboard = (a) =>
  typeof a === 'string' &&
  a.length > 0 &&
  [...a].length <= 128 &&
  !a.includes('/') &&
  ![...a].some((c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159));

/** Read a delivered canvas link. null = not one (or not well formed). */
export function parseCanvasLink(raw) {
  const m = /^maude:\/\/open\/([a-z0-9-]{1,40})\/?\?([^#]*)$/.exec(String(raw ?? ''));
  if (!m || !PROJECT_RE.test(m[1])) return null;
  const params = new URLSearchParams(m[2]);
  const keys = [...params.keys()];
  if (keys.some((k) => !['c', 'a', 'm'].includes(k))) return null;
  if (['c', 'a', 'm'].some((k) => params.getAll(k).length > 1)) return null;
  const entry = params.get('c');
  if (!entry || !ENTRY_RE.test(entry)) return null;
  const artboard = params.get('a');
  const comment = params.get('m');
  if (artboard !== null && !okArtboard(artboard)) return null;
  if (comment !== null && !COMMENT_RE.test(comment)) return null;
  return { project: m[1], entry, artboard, comment };
}

/** Mint a link (Copy link). null when an id is not well formed. */
export function canvasLink({ project, entry, artboard = null, comment = null }) {
  if (!PROJECT_RE.test(String(project ?? '')) || !ENTRY_RE.test(String(entry ?? ''))) return null;
  if (artboard != null && !okArtboard(artboard)) return null;
  if (comment != null && !COMMENT_RE.test(comment)) return null;
  const q = `c=${entry}${comment ? `&m=${comment}` : ''}`;
  return `maude://open/${project}?${q}${artboard ? `#${encodeURIComponent(artboard)}` : ''}`;
}

/** CONTRACT words. */
export const goneWords = (project) => `This canvas isn't in ${project || 'this project'} any more.`;
export function openedFromWords({ who, canvas, artboard }) {
  const from = who ? `Opened from ${who}'s link` : 'Opened from a link';
  return `${from} — ${canvas}${artboard ? ` · ${artboard}` : ''}.`;
}

/**
 * What a resolve answer does, as data. Pure.
 *   { kind: 'open', path, artboard, comment }   open the canvas, glide to the artboard, open the comment
 *   { kind: 'trash' }                            the canvas is in the Trash: show the Trash
 *   { kind: 'gone' }                             "This canvas isn't in <project> any more."
 *   { kind: 'legacy' }                           no op log here: nothing to resolve against
 */
export function planOpenLink(answer, link) {
  if (!answer || answer.ok !== true)
    return { kind: answer?.reason === 'legacy' ? 'legacy' : 'gone' };
  if (answer.status === 'trashed') return { kind: 'trash' };
  if (answer.status !== 'live' || typeof answer.path !== 'string' || !answer.path)
    return { kind: 'gone' };
  return {
    kind: 'open',
    path: answer.path,
    artboard: link?.artboard ?? null,
    comment: link?.comment ?? null,
  };
}

const getJson = async (fetchImpl, url) => {
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
    return r.ok ? await r.json() : { ok: false, reason: 'unreachable' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
};

/** Entry → where the canvas is now, on THIS window's server. */
export const resolveLink = (entry, fetchImpl = globalThis.fetch) =>
  getJson(fetchImpl, `/_api/link/resolve?c=${encodeURIComponent(entry)}`);

/** A canvas path → the entry a new link names. */
export const entryForPath = (path, fetchImpl = globalThis.fetch) =>
  getJson(fetchImpl, `/_api/link/resolve?path=${encodeURIComponent(path)}`);

/**
 * Copy link: the stable app link when this project has an op log and the canvas an entry; null → the caller
 * keeps today's link (a legacy project, the cloud shell). `appLink` is today's `maude://open/<id>?open=…`
 * link, read only for the project id it was built with (share-link.js `buildShareLinks`).
 */
export async function stableLinkFor({ path, appLink, fetchImpl = globalThis.fetch }) {
  const project = /^maude:\/\/open\/([a-z0-9-]{1,40})\/?\?/.exec(String(appLink ?? ''))?.[1];
  if (!project || !path) return null;
  const a = await entryForPath(path, fetchImpl);
  return a?.ok === true && a.status === 'live' ? canvasLink({ project, entry: a.entry }) : null;
}

// ── the line from the link's consumer (CloudBar) to the shell's tab hook ──────────────────────────────────
// The tab hook may mount after the link arrives (a NEW tab takes its parked link on boot), so a request is
// remembered until the hook takes it — the left-panel-bus pattern.
export const OPEN_LINK_EVENT = 'maude:open-link';
let waiting = [];

/** Hand a parsed canvas link to the shell. */
export function requestOpenLink(link, target = globalThis.window) {
  waiting.push(link);
  target?.dispatchEvent?.(new CustomEvent(OPEN_LINK_EVENT));
}

/** Everything waiting, oldest first. */
export function takeOpenLinks() {
  const out = waiting;
  waiting = [];
  return out;
}
