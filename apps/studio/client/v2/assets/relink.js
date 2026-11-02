// client/v2/assets/relink.js — S8.19c: the relink sheet's two requests, with no UI in them.
//
//   1. import the chosen file through the asset import (`POST /_api/asset`, the same route a drop uses),
//      which answers the project path `assets/<sha8>.<ext>`;
//   2. run the edit op `asset.relink {from, to}` on the canvas (`POST /_api/edit-op`): every reference
//      to `from` points at `to`, one write, one undo (`revert {writeId}`).
//
// `from` is the studio's own rel for the picture (asset-state-lane.js), never a string the canvas made up.
// Words are plain: what happened and what is safe. Nothing here throws.

const SAID = {
  'held-by-ai': 'Not relinked. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not relinked. Something that uses this picture is locked; unlock it first.',
  stale: 'Not relinked. The canvas changed underneath; try again.',
  forbidden: 'Not relinked. You can look here; ask to edit.',
  invalid: 'Not relinked. That file does not fit here; pick another.',
};

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * @param {{ canvas: string, from: string, file: Blob & { type?: string, name?: string } }} req
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, to: string, writeId: string } | { ok: false, message: string }>}
 */
export async function relinkWithFile(req, fetchImpl = globalThis.fetch) {
  let up;
  try {
    const res = await fetchImpl('/_api/asset', {
      method: 'POST',
      headers: { 'content-type': req.file.type || 'application/octet-stream' },
      body: req.file,
    });
    up = { status: res.status, body: await json(res) };
  } catch {
    return { ok: false, message: 'Not relinked. The studio could not be reached; try again.' };
  }
  const to = up.body?.path;
  if (typeof to !== 'string' || !to) {
    return {
      ok: false,
      message:
        up.status === 413
          ? 'Not relinked. That file is too big to bring in.'
          : up.body?.error
            ? `Not relinked. ${up.body.error}`
            : 'Not relinked. That file could not be brought in; try another.',
    };
  }
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'asset.relink',
        targets: [],
        params: { from: req.from, to },
      }),
    });
  } catch {
    return { ok: false, message: 'Not relinked. The studio could not be reached; try again.' };
  }
  const body = await json(res);
  if (res.status === 404 || res.status === 405) {
    return { ok: false, message: 'Relinking is not available in this version yet.' };
  }
  if (body?.ok && typeof body.writeId === 'string') return { ok: true, to, writeId: body.writeId };
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not relinked; try again.' };
}

/** One undo step: the edit op's own `revert`. @returns {Promise<boolean>} */
export async function undoRelink(req, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'revert',
        targets: [],
        params: { writeId: req.writeId },
      }),
    });
    return !!(await json(res))?.ok;
  } catch {
    return false;
  }
}
