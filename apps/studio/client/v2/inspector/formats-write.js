// client/v2/inspector/formats-write.js — S7.13: the Formats section's two writes (07 · ve-formats).
//
//   addFormat      "+ Add a format"           `video.format.add`: a linked copy of this video at another size, same cut
//   makeUnlinked   "Make an unlinked copy"    `video.format.unlink`: this artboard forks the comp (<Comp>Unlinked) and has its own cut from here on
//
// Both are ONE `POST /_api/edit-op` (S2's dispatcher, minRole edit — a viewer's 403 and AI's hold come back as words),
// so each is one undo step. The link itself is never written: it is "these artboards mount one comp", read back from the
// canvas (video/linked-formats.ts), so nothing here can leave a stale link behind.

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This artboard is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};

async function run(canvas, op, params, fetchImpl) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: canvas, op, targets: [], params }),
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
  if (body?.ok)
    return {
      ok: true,
      writeId: body.writeId,
      actionId: body.actionId ?? null,
      queued: body.queued === true,
      detail: body.detail ?? null,
    };
  return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not changed; try again.' };
}

/** @param {{ canvas: string, artboardId: string, width: number, height: number }} req */
export const addFormat = (req, fetchImpl = globalThis.fetch) =>
  run(
    req.canvas,
    'video.format.add',
    { artboard: req.artboardId, width: req.width, height: req.height },
    fetchImpl
  );

/** @param {{ canvas: string, artboardId: string }} req */
export const makeUnlinked = (req, fetchImpl = globalThis.fetch) =>
  run(req.canvas, 'video.format.unlink', { artboard: req.artboardId }, fetchImpl);

/** The words a landed write gets (a toast: the person's eye is on the canvas, not on the row). */
export const addedWords = (name) => `Added ${name}. It shares this cut.`;
export const unlinkedWords = 'This format has its own cut now.';
