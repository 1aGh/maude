// client/v2/inspector/link-write.js — S3.10a: the inspector's On click write (registry `element.set-link` /
// `element.clear-link`).
//
// One request to S2.1's dispatch route (`POST /_api/edit-op`), body `{file, op, targets:[{artboard, element,
// occurrence}], params:{target}}` — the shape every edit op shares (S3-links-format §3). The writer stamps the id,
// sets or removes `data-cd-link` and answers; AI holds, locks and the viewer's 403 come back as words here.

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This object is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  invalid: 'Not changed. That link does not fit; pick another.',
};

/**
 * @param {{ canvas: string, artboardId: string, id: string, index?: number, target: string | null }} req
 *   `target: null` clears the link.
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function writeLink(req, fetchImpl = globalThis.fetch) {
  const clear = req.target == null;
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: clear ? 'element.clear-link' : 'element.set-link',
        targets: [
          {
            artboard: req.artboardId,
            element: req.id,
            ...(Number.isInteger(req.index) && req.index > 0 ? { occurrence: req.index } : {}),
          },
        ],
        ...(clear ? {} : { params: { target: req.target } }),
      }),
    });
  } catch {
    return { ok: false, message: 'Not changed. The studio could not be reached; try again.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (body?.ok) return { ok: true, writeId: body.writeId, actionId: body.actionId ?? null };
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not changed; try again.' };
}
