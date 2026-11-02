/**
 * @file       figma/into-board.ts — a translated FigJam board → ops that land in an EXISTING canvas
 * @scope      apps/studio/figma/into-board.ts
 * @purpose    `import-figma --board <url> --into <canvas>` (S4.5, C23) and the S4.16 Import-from-Figma
 *             route: the strokes `toStrokes` produced become ONE section ("From FigJam") holding
 *             every imported item, as the `put` ops the annotation op route (or a direct board
 *             write) takes — so the whole import is one batch, one undo, one merge.
 *
 *             Every element is minted a per-import id (`fj<tag>_<old id>`), so importing the same
 *             board twice stacks a second section instead of replacing what people have done to the
 *             first, and a peer's concurrent import never collides. Each carries
 *             `source: {kind: "figjam", author?}` — the original author of a comment thread, when
 *             Figma gave one — on top of the `imported-figma` author marker the translator stamps
 *             (provenance, never a trust signal).
 *
 *             Pure: no I/O, no network. The bin verb fetches, resolves pictures and writes.
 */

import { compareOrder, keyBetween } from '../annotations/fractional-index.ts';
import type { Op } from '../annotations/ops.ts';
import { defOf, validateElement } from '../annotations/registry.ts';
import type { Dropped } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { Stroke } from '../annotations-model.ts';
import { toBoardElements } from './to-strokes.ts';

/** The one section's title. A Figma file's own name is never recorded (DDR-216 D7). */
export const FIGJAM_SECTION_TITLE = 'From FigJam';

/** Matches `fields.ts` ID_RE's length bound. */
const MAX_ID = 64;

export interface IntoOptions {
  /** Elements already on the target board (the new section goes on top of them). */
  existing?: Iterable<AnnotationElement>;
  /** World top-left of the new section. */
  at?: { x: number; y: number };
  /** Per-import tag in every minted id (`[a-z0-9]{3,8}`). */
  tag: string;
  /** Stroke id → the original author's display handle (comment threads). */
  authors?: ReadonlyMap<string, string>;
  /** The section title. */
  title?: string;
}

export interface IntoResult {
  /** `put` ops, the section first and parents before children. */
  ops: Op[];
  /** The section's id. */
  section: string;
  /** Items inside the section (not counting the section). */
  count: number;
  /** What the registry refused (never silently lost). */
  dropped: Dropped[];
}

/** A world extent that frames every stroke (what the backing section must cover). */
function extentOf(strokes: readonly Stroke[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const raw of strokes) {
    const s = raw as unknown as Record<string, number | undefined>;
    const x = Math.max(s.x ?? 0, (s.cx ?? 0) + (s.rx ?? 0));
    const y = Math.max(s.y ?? 0, (s.cy ?? 0) + (s.ry ?? 0));
    w = Math.max(w, x + (s.w ?? 0));
    h = Math.max(h, y + (s.h ?? 0));
  }
  return { w, h };
}

export function strokesIntoOps(strokes: readonly Stroke[], opts: IntoOptions): IntoResult {
  const { w, h } = extentOf(strokes);
  const regionId = 'figjam-region';
  const backing = {
    id: regionId,
    tool: 'section',
    x: 0,
    y: 0,
    w: Math.max(800, Math.round(w)),
    h: Math.max(600, Math.round(h)),
    label: opts.title ?? FIGJAM_SECTION_TITLE,
    color: '#8b8b8b',
  } as unknown as Stroke;
  const { elements, dropped } = toBoardElements([backing, ...strokes]);

  const mint = (old: string): string => `fj${opts.tag}_${old}`.slice(0, MAX_ID);
  const at = opts.at ?? { x: 0, y: 0 };

  // Z-order: the section sits above everything already at the top level.
  const top = [...(opts.existing ?? [])]
    .filter((e) => !e.parent)
    .sort(compareOrder)
    .at(-1);
  let nextTop = keyBetween(top?.index ?? null, null);

  const out: AnnotationElement[] = [];
  const refused: Dropped[] = [...dropped];
  for (const el of elements) {
    const next: Record<string, unknown> = { ...el, id: mint(el.id) };
    if (typeof el.parent === 'string') next.parent = mint(el.parent);
    if (Array.isArray(el.groups)) next.groups = el.groups.map((g: string) => mint(g));
    for (const k of ['start', 'end'] as const) {
      const e = el[k] as { el?: string } | undefined;
      if (e && typeof e === 'object' && typeof e.el === 'string')
        next[k] = { ...e, el: mint(e.el) };
    }
    // Parentless elements sit at the top level of the board: move them to `at`, above what is there.
    if (!el.parent) {
      const moved = defOf(el.type)?.translate(el as AnnotationElement, at.x, at.y);
      Object.assign(next, moved ?? {});
      next.index = nextTop;
      nextTop = keyBetween(nextTop, null);
    }
    const author = opts.authors?.get(el.id);
    const withAuthor = { ...next, source: { kind: 'figjam', ...(author ? { author } : {}) } };
    let v = validateElement(withAuthor);
    // An author handle the field rejects must not cost the item its provenance.
    if (!v.ok || !v.el.source) v = validateElement({ ...next, source: { kind: 'figjam' } });
    if (!v.ok) {
      refused.push({ id: el.id, reason: v.reason });
      continue;
    }
    out.push(v.el);
  }

  const section = mint(regionId);
  // Parents before children (a `put` of a child whose parent is not there yet would float).
  const depth = new Map<string, number>();
  const byId = new Map(out.map((e) => [e.id, e]));
  const depthOf = (e: AnnotationElement): number => {
    const known = depth.get(e.id);
    if (known !== undefined) return known;
    const p = typeof e.parent === 'string' ? byId.get(e.parent) : undefined;
    const d = p ? depthOf(p) + 1 : 0;
    depth.set(e.id, d);
    return d;
  };
  const ordered = [...out].sort((a, b) => depthOf(a) - depthOf(b));
  const ops: Op[] = ordered.map((el) => ({ op: 'put', el }));
  return { ops, section, count: Math.max(0, ops.length - 1), dropped: refused };
}
