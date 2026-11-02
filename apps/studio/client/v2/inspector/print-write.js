// client/v2/inspector/print-write.js — S7.23: the print inspector's writes and the one view read it needs.
//
//   writePrint              registry `artboard.set-print` — paper · mm size · orientation · bleed · safe margin in ONE
//                           request to S2.1's dispatch route (`POST /_api/edit-op`); the prop and the px size land in one write
//   writePrintGuides        registry `artboard.set-print-guides` — this artboard's own switch (C25); `null` follows View again
//   writeGuides             registry `artboard.set-guides` — the artboard's layout guides (columns · rows · grid), Advanced › Guides
//   readPrintGuidesDefault  View › Advanced › Print guides for this canvas (view.json `overlays.print`)
//
// AI holds, a viewer's 403 and a stale canvas come back as words, never a thrown error.

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This artboard is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  invalid: 'Not changed. That does not fit; try another.',
};

/** The shell says this when View › Advanced › Print guides flips: `{ canvas, visible }`. */
export const PRINT_GUIDES_DEFAULT_EVENT = 'maude:print-guides-default';

async function send(op, canvas, params, fetchImpl) {
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
  if (body?.ok) return { ok: true, writeId: body.writeId, actionId: body.actionId ?? null };
  return { ok: false, message: body?.message ?? SAID[body?.code] ?? 'Not changed; try again.' };
}

/**
 * @param {{ canvas: string, artboardId: string, patch: { paper?: string, orientation?: string, bleedMm?: number, marginMm?: number, sizeMm?: [number, number] | null } }} req
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export function writePrint(req, fetchImpl = globalThis.fetch) {
  return send(
    'artboard.set-print',
    req.canvas,
    { artboard: req.artboardId, ...req.patch },
    fetchImpl
  );
}

/** @param {{ canvas: string, artboardId: string, visible: boolean | null }} req */
export function writePrintGuides(req, fetchImpl = globalThis.fetch) {
  return send(
    'artboard.set-print-guides',
    req.canvas,
    { artboard: req.artboardId, visible: req.visible },
    fetchImpl
  );
}

/** @param {{ canvas: string, artboardId: string, guides: object | null }} req */
export function writeGuides(req, fetchImpl = globalThis.fetch) {
  return send(
    'artboard.set-guides',
    req.canvas,
    { artboard: req.artboardId, guides: req.guides },
    fetchImpl
  );
}

/** @returns {Promise<boolean>} true only when the person turned the View default on (absence is off, like the canvas) */
export async function readPrintGuidesDefault(canvas, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(canvas)}`);
    const meta = await res.json();
    return meta?.overlays?.print === true;
  } catch {
    return false;
  }
}
