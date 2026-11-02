// client/v2/timeline/other-takes-store.js — S7.15: the footage analysis of a clip's source, read once.
//
// `GET /_api/footage?asset=assets/<sha8>.<ext>` (the existing main-origin route; empty `{}` when AI has not
// watched the clip) answers the shots Other takes offers. Nothing is written here, nothing is persisted: a read
// per asset, cached for the life of the tab and dropped when the file may have changed (`forget`).

const cache = new Map(); // asset → analysis ({} when unwatched)
const inflight = new Map();

/** `assets/9f3a.mp4` from a clip's media src (`./assets/9f3a.mp4`, `/.design/assets/9f3a.mp4?v=2`, …), else null. */
export function assetOfSrc(src) {
  const m = /(?:^|\/)(assets\/[0-9a-f]{8,}[A-Za-z0-9_-]*\.[A-Za-z0-9]{1,5})(?:[?#].*)?$/.exec(
    String(src ?? '')
  );
  return m ? m[1] : null;
}

export const footageUrl = (asset) => `/_api/footage?asset=${encodeURIComponent(asset)}`;

/** The analysis of one asset (`{}` when none or unreadable). */
export async function loadFootage(asset, { fetchImpl = globalThis.fetch } = {}) {
  if (!asset) return {};
  if (cache.has(asset)) return cache.get(asset);
  if (inflight.has(asset)) return inflight.get(asset);
  const p = (async () => {
    let out = {};
    try {
      const r = await fetchImpl(footageUrl(asset), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && typeof j === 'object' && !Array.isArray(j)) out = j;
      }
    } catch {
      out = {};
    }
    inflight.delete(asset);
    // a failed read is not remembered: the next open asks again
    if (Array.isArray(out.shots)) cache.set(asset, out);
    return out;
  })();
  inflight.set(asset, p);
  return p;
}

/** Tests, and a write that changed the sidecar. */
export function forgetFootage(asset) {
  if (asset) cache.delete(asset);
  else cache.clear();
}
