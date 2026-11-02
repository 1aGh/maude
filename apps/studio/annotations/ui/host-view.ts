/**
 * @file       annotations/ui/host-view.ts — the board as the live canvas makes it look (S4.11)
 * @scope      apps/studio/annotations/ui/host-view.ts
 * @purpose    A bound arrow stores the host's ref and a CACHE of where it last was (hosts.ts).
 *             What the person sees is derived from the live `canvas-rects` manifest:
 *
 *               - an element moved, or AI rewrote it (same id, new box): the end slides to the new
 *                 edge — `viewStrokes` re-derives the ends WITHOUT writing (V2-1.4 T9);
 *               - an element is gone (replaced, or its artboard trashed): the bind stays, the end
 *                 stays where it was, `danglingOf` names it, `markDangling` draws it dashed with no
 *                 head — and restoring the element (or ⌘Z) re-attaches it, because nothing was
 *                 ever stripped.
 *
 *             Until the canvas has rendered (no artboard in the manifest yet) NOTHING is derived or
 *             marked: a not-yet-painted canvas must not flash every arrow as dangling.
 *
 *             Pure: the manifest is passed in.
 */

import { recomputeBoundArrows } from '../../annotations-bindings.ts';
import type { Stroke } from '../../annotations-model.ts';
import { type DanglingEnd, danglingEnds, hostsOf, resolverFromRects } from '../hosts.ts';
import type { AimRects } from './arrow-bind.ts';
import { asHostRects, rewrittenText } from './arrow-bind.ts';
import type { RenderItem, ResolvedEnds } from './render-model.ts';

/** The manifest says something about the canvas (it has painted at least one artboard). */
export const rectsReady = (r: AimRects | null | undefined): r is AimRects =>
  !!r && r.artboards.length > 0;

/** Does any arrow carry a canvas-host bind? */
export function hasHosts(strokes: readonly Stroke[]): boolean {
  for (const s of strokes) {
    if (s.tool !== 'arrow') continue;
    const h = hostsOf(s);
    if (h.startHost || h.endHost) return true;
  }
  return false;
}

/**
 * `strokes` with every canvas-host end re-derived from the live boxes. The same array comes back
 * when nothing is bound, the canvas has not painted, or nothing moved — so memoised consumers
 * keep their identity.
 */
export function viewStrokes(strokes: readonly Stroke[], rects: AimRects | null): readonly Stroke[] {
  if (!rectsReady(rects) || !hasHosts(strokes)) return strokes;
  return recomputeBoundArrows(strokes, resolverFromRects(asHostRects(rects)));
}

/** Every bound end the live canvas cannot find. Empty until the canvas has painted. */
export function danglingOf(strokes: readonly Stroke[], rects: AimRects | null): DanglingEnd[] {
  if (!rectsReady(rects) || !hasHosts(strokes)) return [];
  return danglingEnds(strokes, resolverFromRects(asHostRects(rects)));
}

/** `items` with `ends.dangling` set for the arrows that have a lost end. */
export function markDangling(
  items: readonly RenderItem[],
  dangling: ReadonlyArray<Pick<DanglingEnd, 'arrowId' | 'end'>>
): RenderItem[] {
  if (!dangling.length) return items as RenderItem[];
  const by = new Map<string, { start?: boolean; end?: boolean }>();
  for (const d of dangling) {
    const cur = by.get(d.arrowId) ?? {};
    cur[d.end] = true;
    by.set(d.arrowId, cur);
  }
  return items.map((it) => {
    const d = by.get(it.el.id);
    if (!d || !it.ends) return it;
    const ends: ResolvedEnds = { ...it.ends, dangling: d };
    return { ...it, ends };
  });
}

/**
 * The cheap signature of everything a re-render of the host view depends on: the box of each
 * referenced host (and, for an element, the words AI rewrote it to), or `-` when it cannot be found. The layer polls the manifest and only sets
 * state when this changes.
 */
export function hostSignature(strokes: readonly Stroke[], rects: AimRects | null): string {
  if (!rectsReady(rects)) return 'pending';
  const resolve = resolverFromRects(asHostRects(rects));
  const parts: string[] = [];
  for (const s of strokes) {
    if (s.tool !== 'arrow') continue;
    const h = hostsOf(s);
    for (const b of [h.startHost, h.endHost]) {
      if (!b) continue;
      const box = resolve(b.ref);
      // S4.18b - the words are part of what the view depends on: AI can rewrite a button and keep its box
      // (an-rebind's ring names the new words), and a box-only signature never re-read it.
      const words = rewrittenText(rects, b) ?? '';
      parts.push(box ? `${b.ref}@${box.x},${box.y},${box.w},${box.h}~${words}` : `${b.ref}@-`);
    }
  }
  return parts.join('|');
}
