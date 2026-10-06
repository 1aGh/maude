/**
 * @file       comment-anchor.ts — where a comment lives when it is not on an element
 * @scope      apps/studio/comment-anchor.ts
 * @purpose    Two anchors besides the `data-cd-id` element selector (#134/#136):
 *
 *   - `annotationId` — a comment placed on a sticky, shape, pen stroke, image,
 *     link or media card anchors to that annotation's `data-id`. Annotation ids
 *     are persisted in `*.annotations.svg` and stable across edits, undo and
 *     sync (see `stableAnnotationId` in annotations-model.ts for the one case
 *     they were not). The pin follows the annotation; a deleted annotation
 *     DETACHES the comment, it never deletes it.
 *   - `world` — a comment placed on empty canvas holds a WORLD point, so it stays
 *     put through pan and zoom. The legacy screen `bounds` captured at create
 *     time only matched the camera of that moment.
 *
 * Runs inside the canvas iframe, in both the canvas bundle and the separate
 * comment-mount bundle — so the camera is read through `window.__maudeViewport`
 * (canvas-lib.tsx), not through a module import that would be another copy.
 * Annotation ids are peer-supplied (DDR-054): every id is validated before it
 * reaches a selector.
 */

export interface WorldPoint {
  x: number;
  y: number;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Shape rule for an annotation id — the `s_…` scheme plus imported ids. */
const ANNOTATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** World coordinates beyond this are garbage, not a place on the board. */
const MAX_WORLD = 10_000_000;

export function isAnnotationId(v: unknown): v is string {
  return typeof v === 'string' && ANNOTATION_ID_RE.test(v);
}

export function isWorldPoint(v: unknown): v is WorldPoint {
  if (!v || typeof v !== 'object') return false;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) <= MAX_WORLD &&
    Math.abs(y) <= MAX_WORLD
  );
}

function liveCamera(): { vp: Viewport; left: number; top: number } | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const vp = window.__maudeViewport?.() ?? null;
  if (!vp || !(vp.zoom > 0)) return null;
  const host = document.querySelector('.dc-canvas');
  if (!host) return null;
  const r = host.getBoundingClientRect();
  return { vp, left: r.left, top: r.top };
}

/** Client (iframe viewport) point → world point, or null with no world plane. */
export function clientToWorld(clientX: number, clientY: number): WorldPoint | null {
  const cam = liveCamera();
  if (!cam) return null;
  const { vp } = cam;
  return {
    x: (clientX - cam.left - vp.x) / vp.zoom,
    y: (clientY - cam.top - vp.y) / vp.zoom,
  };
}

/** World point → client point, or null with no world plane. */
export function worldToClient(p: WorldPoint): { x: number; y: number } | null {
  const cam = liveCamera();
  if (!cam) return null;
  const { vp } = cam;
  return { x: cam.left + vp.x + p.x * vp.zoom, y: cam.top + vp.y + p.y * vp.zoom };
}

/** The live element of an annotation, or null. */
export function annotationElement(id: string): Element | null {
  if (typeof document === 'undefined' || !isAnnotationId(id)) return null;
  // The id is already restricted to [A-Za-z0-9_-]; no escaping needed.
  return document.querySelector(`[data-id="${id}"][data-tool]`);
}

/**
 * The annotation under a client point, if any. Geometric rather than
 * `elementFromPoint`: in comment mode the annotation layer is not the hit
 * target (its pointer events belong to the draw tools), which is exactly why a
 * click on a sticky used to fall through to a floating comment.
 *
 * The smallest containing box wins, so a sticky inside a section anchors to
 * the sticky. Sections are skipped: they frame artboards and other elements,
 * and "a comment somewhere inside this section" is a floating comment.
 */
export function annotationIdAt(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined') return null;
  let best: { id: string; area: number } | null = null;
  for (const el of Array.from(document.querySelectorAll('[data-id][data-tool]'))) {
    if (el.getAttribute('data-tool') === 'section') continue;
    const id = el.getAttribute('data-id');
    if (!isAnnotationId(id)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const area = Math.max(1, r.width) * Math.max(1, r.height);
    if (!best || area <= best.area) best = { id, area };
  }
  return best?.id ?? null;
}
