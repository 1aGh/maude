// client/v2/inspector/element-id.js — S2.2: the inspector's element-id rename (registry `element.set-id`).
//
// One request to the dispatch route S2.1 owns (`POST /_api/edit-op`, S2-slices §3a): the writer renames
// `data-cd-id` AND every durable reference to it in the same action (V2-1.4 §5.5), refused when the new
// id is taken or invalid, locked, or held by AI. This file only asks and says the answer in words; until
// the route exists the answer is a plain "not available yet" (the field stays honest, nothing is faked).

const SAID = {
  'held-by-ai': 'Not renamed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not renamed. This object is locked; unlock it first.',
  stale: 'Not renamed. The canvas changed underneath; try again.',
  forbidden: 'Not renamed. You can look here; ask to edit.',
  invalid: 'Not renamed. That id does not fit; pick another.',
};

/**
 * @param {{ from: string, to: string, index?: number, artboardId?: string, canvas: string }} req
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function renameElementId(req, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'element.set-id',
        targets: [
          {
            artboard: req.artboardId,
            element: req.from,
            ...(Number.isInteger(req.index) && req.index > 0 ? { occurrence: req.index } : {}),
          },
        ],
        params: { id: req.to },
      }),
    });
  } catch {
    return { ok: false, message: 'Not renamed. The studio could not be reached; try again.' };
  }
  if (res.status === 404 || res.status === 405) {
    return { ok: false, message: 'Renaming an id is not available in this version yet.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (body?.ok) return { ok: true };
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not renamed; try again.' };
}
