// client/v2/inspector/safe-zones-write.js — S7.22: the Safe zones row's two writes.
//
//   writeSafeZones         the artboard's `safeZones` prop (registry `artboard.set-safe-zones`) — one request to S2.1's
//                          dispatch route, `POST /_api/edit-op`; AI holds, a viewer's 403 and a stale canvas come back as words
//   readSafeZonesVisible   "Show on canvas" for this canvas: shown unless THIS person turned it off
//   writeSafeZonesVisible  the same, written to the person's own view state (`PATCH /_api/canvas-meta` → view.json
//                          `overlays.safeZones`, never the versioned file), and told to the open canvas so it redraws now
//
// The visibility is a view preference, not an edit: it is not an undo step and no role is needed to flip it.

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This artboard is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  invalid: 'Not changed. That safe zone does not fit; pick another.',
};

/** The shell hears this and forwards `{ dgn: 'view-chrome', …patch }` to the open canvas (use-canvas-bridge.jsx). */
export const CANVAS_VIEW_CHROME_EVENT = 'maude:canvas-view-chrome';

/**
 * @param {{ canvas: string, artboardId: string, preset: string | null }} req  `preset: null` is "None"
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function writeSafeZones(req, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'artboard.set-safe-zones',
        targets: [],
        params: { artboard: req.artboardId, preset: req.preset || null },
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

/** @returns {Promise<boolean>} true unless the person's own view state says `overlays.safeZones === false` */
export async function readSafeZonesVisible(canvas, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(canvas)}`);
    const meta = await res.json();
    return meta?.overlays?.safeZones !== false;
  } catch {
    return true;
  }
}

/**
 * @returns {Promise<boolean>} whether the preference was stored
 */
export async function writeSafeZonesVisible(
  canvas,
  visible,
  fetchImpl = globalThis.fetch,
  target = globalThis.window
) {
  try {
    const res = await fetchImpl('/_api/canvas-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: canvas, patch: { overlays: { safeZones: !!visible } } }),
    });
    if (res && res.ok === false) return false;
  } catch {
    return false;
  }
  target?.dispatchEvent?.(
    new CustomEvent(CANVAS_VIEW_CHROME_EVENT, {
      detail: { canvas, patch: { safeZones: !!visible } },
    })
  );
  return true;
}
