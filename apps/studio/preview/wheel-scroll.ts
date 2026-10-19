// apps/studio/preview/wheel-scroll.ts — S3.9 (md-preview-combine): "the web page scrolls inside its
// artboard". In Preview the design is live, so a wheel over an artboard whose design surface can scroll in
// that direction scrolls it; a wheel that cannot (the end of the page, a surface that fits, anything outside
// an artboard) pans the canvas as it always did. Zoom (⌘/ctrl) and shift-pan are the canvas's, always.
//
// Pure DOM reads — no state — so the viewport controller can ask per wheel event.

import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';

const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);
const SLACK_PX = 1;

function canScroll(el: HTMLElement, dx: number, dy: number): boolean {
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;
  } catch {
    cs = null;
  }
  const oy = cs?.overflowY || el.style.overflowY;
  const ox = cs?.overflowX || el.style.overflowX;
  if (dy !== 0 && SCROLLABLE.has(oy) && el.scrollHeight > el.clientHeight + SLACK_PX) {
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - SLACK_PX)
      return true;
  }
  if (dx !== 0 && SCROLLABLE.has(ox) && el.scrollWidth > el.clientWidth + SLACK_PX) {
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - SLACK_PX)
      return true;
  }
  return false;
}

/**
 * Can `target` — or an ancestor up to and including `boundary` (the artboard's design surface) — scroll in
 * the direction of the wheel (`dx`, `dy` as the event reports them: positive = toward the end)?
 */
export function scrollsInside(
  target: EventTarget | null,
  boundary: Element,
  dx: number,
  dy: number
): boolean {
  let el = target as HTMLElement | null;
  while (el && typeof el === 'object' && 'ownerDocument' in el) {
    if (canScroll(el, dx, dy)) return true;
    if (el === boundary) return false;
    el = el.parentElement;
  }
  return false;
}

/**
 * Should this wheel event go to the design instead of panning the canvas? Preview only, no zoom/shift
 * modifier, and only from inside an artboard's design surface that can scroll that way.
 */
export function previewWheelPassthrough(e: WheelEvent, mode: CanvasModeV2 | null): boolean {
  if (mode !== 'preview') return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const t = e.target as Element | null;
  const body = t && typeof t.closest === 'function' ? t.closest('.dc-artboard-body') : null;
  if (!body) return false;
  return scrollsInside(t, body, e.deltaX, e.deltaY);
}

/**
 * S3.15 (md-preview-combine) — should the host's scroll-0 clamp put `t`'s scroll back to 0? The engine's clip
 * layers (the host, each artboard and its body) sit at scroll 0 because the camera is a transform, so a stray
 * programmatic scroll is undone. The one release: in Preview a WEB artboard's body is a page to read — it
 * scrolls inside itself (S3.9's `overflow-y: auto`), and clamping it straight back made that a no-op.
 * Present moves a camera, never a native scroll; print, social and video boards are frames, not pages.
 */
export function clampsEngineScroll(
  t: Element,
  host: Element,
  mode: CanvasModeV2 | null | undefined
): boolean {
  const isEngineClip =
    t === host || t.classList.contains('dc-artboard-body') || t.classList.contains('dc-artboard');
  if (!isEngineClip) return false;
  if (mode === 'preview' && t.classList.contains('dc-artboard-body')) {
    const kind = t.closest('.dc-artboard')?.getAttribute('data-dc-kind');
    if (kind === 'web') return false;
  }
  return true;
}
