// client/v2/assets/trash-assets.js — Move to the trash for pictures, and Undo (S8.13; 12 · ia-assets-keys, ia-assets-tidy).
//
// One request, `POST /_api/assets/trash { assets }`, answers per item: moved (with the `_trash/` bundle that holds the
// picture and its sidecars), or refused (used | kept-by-versions | checking | missing | invalid). The studio decides — this file
// only asks and says the answer in words. Undo puts every moved bundle back through the Trash's own per-file restore, the
// road a trashed canvas takes (canvases/trash-canvas.js), so what was moved comes back under the same names.
// Nothing here throws.

import { restoreTrashedCanvas } from '../canvases/trash-canvas.js';

export const ASSET_TRASH_WORDS = {
  moved: (name) => `“${name}” moved to the trash.`,
  movedMany: (n) => `${n} assets moved to the trash.`,
  back: (name) => `“${name}” is back.`,
  backMany: (n) => `${n} assets are back.`,
  undo: 'Undo',
  used: (name) => `“${name}” is used on a canvas. Take it off the artboards first.`,
  keptByVersions: (name) => `“${name}” is still in an older version, so it stays.`,
  checking: 'Still checking older versions. Try again in a moment.',
  gone: (name) => `“${name}” is not in the project any more.`,
  stayed: (n) => `${n} stayed: used on a canvas or kept by an older version.`,
  forbidden: 'Not moved. You can look here; ask to edit.',
  failed: 'Not moved. The studio could not be reached; try again.',
  stuck: 'Could not bring them back. They are still in the Trash.',
};

const baseName = (rel) => String(rel).split('/').pop() || String(rel);

/** The sentence for one refusal. */
export function refusalWords(rel, reason) {
  const name = baseName(rel);
  if (reason === 'used') return ASSET_TRASH_WORDS.used(name);
  if (reason === 'kept-by-versions') return ASSET_TRASH_WORDS.keptByVersions(name);
  if (reason === 'checking') return ASSET_TRASH_WORDS.checking;
  return ASSET_TRASH_WORDS.gone(name);
}

/**
 * Ask the studio to move `paths` (`assets/<name>`) to the trash.
 * @returns {Promise<{ ok: boolean, moved: Array<{ rel: string, trashDir: string }>, refused: Array<{ rel: string, reason: string }>, message: string }>}
 *   `message` is the sentence to say (moved, or why nothing was).
 */
export async function moveAssetsToTrash(paths, { fetchImpl = fetch } = {}) {
  const none = (message) => ({ ok: false, moved: [], refused: [], message });
  let res;
  try {
    res = await fetchImpl('/_api/assets/trash', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assets: paths }),
    });
  } catch {
    return none(ASSET_TRASH_WORDS.failed);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (res.status === 403) return none(ASSET_TRASH_WORDS.forbidden);
  if (!res.ok || !body?.ok || !Array.isArray(body.results)) return none(ASSET_TRASH_WORDS.failed);
  const moved = body.results
    .filter((r) => r?.ok)
    .map((r) => ({ rel: r.rel, trashDir: r.trashDir }));
  const refused = body.results
    .filter((r) => r && !r.ok)
    .map((r) => ({ rel: r.rel, reason: r.reason }));
  let message;
  if (moved.length === 1 && !refused.length)
    message = ASSET_TRASH_WORDS.moved(baseName(moved[0].rel));
  else if (moved.length && !refused.length) message = ASSET_TRASH_WORDS.movedMany(moved.length);
  else if (moved.length)
    message = `${ASSET_TRASH_WORDS.movedMany(moved.length)} ${ASSET_TRASH_WORDS.stayed(refused.length)}`;
  else if (refused.length === 1) message = refusalWords(refused[0].rel, refused[0].reason);
  else message = ASSET_TRASH_WORDS.stayed(refused.length);
  return { ok: moved.length > 0, moved, refused, message };
}

/**
 * Put moved assets back (Undo). Each bundle restores per file through the Trash route, so the picture and its sidecars return together.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function undoAssetTrash(moved, { fetchImpl = fetch } = {}) {
  let failed = 0;
  for (const m of moved) {
    const r = await restoreTrashedCanvas({ trashDir: m.trashDir, fetchImpl });
    if (!r.ok) failed++;
  }
  if (failed) return { ok: false, message: ASSET_TRASH_WORDS.stuck };
  return {
    ok: true,
    message:
      moved.length === 1
        ? ASSET_TRASH_WORDS.back(baseName(moved[0].rel))
        : ASSET_TRASH_WORDS.backMany(moved.length),
  };
}
