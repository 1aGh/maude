// client/v2/assets/place-asset.js — `placeAsset`, the one request the Assets tab (↵ / drag), Generate and a Finder drop make to
// put a picture on a canvas (S2.15; the cross-lane contract in client/v2/contracts/S8-slices.md § "cross-lane contracts").
//
//   placeAsset({ asset | assets, target: { canvas, artboardId, frameId?, occurrence? }, mode?, natural?, alt?, from? })
//
//   mode  'fill' (default for a frame) · 'loose' (default for an artboard) · 'fill-in-order' · 'grid'
//
// It is `POST /_api/edit-op { op: 'image.place' }` — the same writer the canvas's own drop and the Figma paste end in
// (edit-ops/image-fit.ts): one request, one file write, one undo step. `frameId` names a frame (or a picture) inside
// `artboardId`; without it the picture goes to the artboard. The server decides (role, holds, locks, the `assets/` path);
// this file only asks and says the answer in words. Nothing here throws.
//
// Undo: a legacy-link write hands `record` the `record-edit` payload for the canvas's undo stack (`revert {writeId}`); on the
// op log the write is a kernel action and `record` is not called.

const SAID = {
  'held-by-ai': 'Not placed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not placed. That is locked; unlock it first.',
  stale: 'Not placed. The canvas changed underneath; try again.',
  forbidden: 'Not placed. You can look here; ask to edit.',
  invalid: 'Not placed. That picture does not fit there; try another.',
};

export const PLACE_MODES = Object.freeze(['fill', 'loose', 'fill-in-order', 'grid']);

/**
 * @param {{
 *   asset?: string, assets?: string[],
 *   target: { canvas: string, artboardId: string, frameId?: string, occurrence?: number },
 *   mode?: 'fill' | 'loose' | 'fill-in-order' | 'grid',
 *   natural?: { w: number, h: number }, alt?: string, from?: { name?: string }
 * }} req
 * @param {{ fetch?: typeof fetch, record?: (payload: { op: 'edit-op', writeId: string, label: string }) => void }} [opts]
 * @returns {Promise<{ ok: true, writeId: string, created: Array<{ artboard: string, element: string }> } | { ok: false, message: string }>}
 */
export async function placeAsset(req, opts = {}) {
  const get = opts.fetch ?? globalThis.fetch;
  const t = req?.target;
  if (!t || typeof t.canvas !== 'string' || typeof t.artboardId !== 'string')
    return { ok: false, message: 'Not placed. Select an artboard first.' };
  const list = Array.isArray(req.assets) ? req.assets : req.asset ? [req.asset] : [];
  if (list.length === 0) return { ok: false, message: 'Not placed. Pick a picture first.' };
  const mode = req.mode ?? (t.frameId ? 'fill' : 'loose');
  const params = { mode };
  if (req.assets) params.assets = req.assets;
  else params.asset = req.asset;
  if (!t.frameId) params.artboard = t.artboardId;
  if (req.natural) params.natural = req.natural;
  if (typeof req.alt === 'string') params.alt = req.alt;
  if (req.from) params.from = req.from;
  const targets = t.frameId
    ? [
        {
          artboard: t.artboardId,
          element: t.frameId,
          ...(Number.isInteger(t.occurrence) && t.occurrence > 0
            ? { occurrence: t.occurrence }
            : {}),
        },
      ]
    : [];
  let res;
  try {
    res = await get('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: t.canvas, op: 'image.place', targets, params }),
    });
  } catch {
    return { ok: false, message: 'Not placed. The studio could not be reached; try again.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (res.status === 404 || res.status === 405)
    return { ok: false, message: 'Placing a picture is not available in this version yet.' };
  if (body?.ok && typeof body.writeId === 'string') {
    if (!body.actionId && !body.queued && body.writeId)
      opts.record?.({ op: 'edit-op', writeId: body.writeId, label: 'Place picture' });
    return {
      ok: true,
      writeId: body.writeId,
      created: Array.isArray(body.created) ? body.created : [],
    };
  }
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not placed; try again.' };
}
