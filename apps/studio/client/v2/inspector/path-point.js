// client/v2/inspector/path-point.js — the Point card of a Pen path (14 Editing, ed-pen: "Point · Corner Smooth / Sharp · X · Y").
//
// The canvas says which point is selected (`attrs['data-dc-pen-point']`, editing/pen/point-store.ts). The numbers of the path
// come from the payload's own markup (`el.html`, the svg as it is in the file); the answer is ONE `path.edit` edit-op on the
// dispatch route (`POST /_api/edit-op`) — the same op a point drag asks of the canvas — so it is one write and one undo step.
// The arithmetic is the Pen's own (editing/pen/pen-geometry.ts); nothing here draws or measures.

import { parsePathD, translatePath } from '../../../edit-ops/path-model.ts';
import { dragged, toggled } from '../../../editing/pen/pen-geometry.ts';
import { parsePenPointAttr } from '../../../editing/pen/point-store.ts';

/** The selected point the canvas reported, or null. */
export const pointOf = (el) =>
  el && !Array.isArray(el) ? parsePenPointAttr(el.attrs?.['data-dc-pen-point']) : null;

/** The path model (the svg's local px) read from the payload's markup; null when it cannot be (cut off, arcs). */
export function localModelOf(el) {
  const html = el?.html;
  if (!html || typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const d = doc.querySelector('svg[data-shape="path"] path')?.getAttribute('d');
    return d ? parsePathD(d) : null;
  } catch {
    return null;
  }
}

/** The svg's own origin in container px: what takes the local numbers to the point's container numbers. */
function originOf(model, info) {
  const p = model.subs[info.sub]?.points[info.i];
  return p ? { x: info.x - p.x, y: info.y - p.y } : null;
}

/** The whole path in container px with the selected point turned Smooth or Sharp; null when nothing changes. */
export function withCorner(el, kind) {
  const info = pointOf(el);
  const model = info && localModelOf(el);
  const o = model && originOf(model, info);
  if (!o || info.kind === kind) return null;
  return translatePath(toggled(model, { sub: info.sub, i: info.i }), o.x, o.y);
}

/** The whole path in container px with the selected point at `to` ({ x?, y? } in container px); null when nothing moves. */
export function withPosition(el, to) {
  const info = pointOf(el);
  const model = info && localModelOf(el);
  const o = model && originOf(model, info);
  if (!o) return null;
  const x = to.x ?? info.x;
  const y = to.y ?? info.y;
  if (x === info.x && y === info.y) return null;
  const next = dragged(
    model,
    { kind: 'anchor', sub: info.sub, i: info.i },
    { x: x - o.x, y: y - o.y },
    { alt: false, shift: false }
  );
  return translatePath(next, o.x, o.y);
}

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This path is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};

/**
 * @param {{ canvas: string, el: any, model: any }} req  `model`: the whole path in container px
 * @returns {Promise<{ ok: true, writeId?: string, actionId?: string | null } | { ok: false, message: string }>}
 */
export async function writePath(req, fetchImpl = globalThis.fetch) {
  const { el } = req;
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'path.edit',
        targets: [
          {
            artboard: el.artboardId,
            element: el.id,
            ...(Number.isInteger(el.index) && el.index > 0 ? { occurrence: el.index } : {}),
          },
        ],
        params: { path: req.model },
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
  return { ok: false, message: body?.message ?? SAID[body?.code] ?? 'Not changed; try again.' };
}
