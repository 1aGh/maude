// edit-ops/combine.ts — `shape.combine.{union,subtract,intersect,exclude}` (S2.14, ed-pen: "Combine shapes").
//
// Non-destructive SVG composition in ONE `<svg>` (S2-slices Q6): there is no boolean-geometry dependency, so the
// result is drawn by the renderer, not computed, and it exports identically as SVG.
//
//   union      one `<path>` of every outline, fill-rule nonzero     (each outline wound clockwise so overlaps merge)
//   exclude    the same `<path>`, fill-rule evenodd                  (overlaps become holes)
//   subtract   the bottom shape, masked: a `<mask>` that is white everywhere and black where the others are
//   intersect  the bottom shape, clipped by each other shape's `<clipPath>`
//
// The bottom shape (first in the file) stays the first `<path>` of the svg, so the Pen's point editing and `path.edit`
// keep working on it; the others live in `<defs>`. Flatten (a computed result) is out of v2.0.
//
//   params { operands: [{ x, y, w, h, radii? }] }  one per target, in the PARENT's px (what the canvas measured:
//                                                  a token radius is a number here, a % radius too)
//   targets   ≥ 2 siblings in one parent: rectangles, ellipses, polygons (a div with data-shape) or Pen paths
//
// The result takes the place of the bottom shape (data-cd-id "union", "subtract", …); the operands are removed
// in the same write — one edit, one undo. The fill is the bottom shape's token (never a hex). The mask's `white` /
// `black` are luminance, not design colours.
// Refused (nothing written): fewer than two shapes, a line, a frame, a rotated shape (reset the rotation), shapes
// from different parents, a computed `d` or `clip-path`.
//
// Same result by hand: `canvas-tsx.md` § "Combine shapes".

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { readAttributeState, spanWithFraming } from '../canvas-edit.ts';
import { generateElementId, usedIds, walkIdElements } from '../element-ids.ts';
import { refuse } from './constraints.ts';
import { dSpan } from './path.ts';
import {
  type Box,
  COMBINE_KINDS,
  type CombineKind,
  clockwise,
  ellipseSub,
  type PathModel,
  parsePathD,
  pathBounds,
  polygonSubFromClip,
  rectSub,
  type SubPath,
  serializePath,
  translatePath,
} from './path-model.ts';
import { siblingModel } from './siblings.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

export { COMBINE_KINDS, type CombineKind };

/** Area outside every shape a mask must still cover, so a stroke at the edge is not cut. */
const PAD = 200;
const TOKEN_FILL = /^var\(--[a-z0-9-]+\)$/i;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

interface Measured extends Box {
  radii: [number, number, number, number];
}

function measuredOf(req: ResolvedEditOp, i: number): Measured {
  const list = req.params.operands;
  const raw = Array.isArray(list) ? list[i] : undefined;
  if (!isRec(raw) || !num(raw.x) || !num(raw.y) || !num(raw.w) || !num(raw.h))
    return refuse(req, 'The canvas did not measure the shapes; try again.');
  if ([raw.x, raw.y, raw.w, raw.h].some((n) => Math.abs(n as number) > 100_000))
    return refuse(req, 'That is too far from the artboard.');
  const rr = Array.isArray(raw.radii) ? raw.radii : [0, 0, 0, 0];
  const radii = [0, 1, 2, 3].map((k) => (num(rr[k]) ? Math.max(0, rr[k] as number) : 0));
  return {
    x: raw.x,
    y: raw.y,
    w: raw.w,
    h: raw.h,
    radii: radii as Measured['radii'],
  };
}

const path = (subs: SubPath[]): PathModel => ({ subs });
const d = (subs: SubPath[]): string => serializePath(path(subs));

function composition(
  kind: CombineKind,
  id: string,
  subs: SubPath[][],
  w: number,
  h: number
): string {
  const all = subs.flat();
  if (kind === 'union') return `<path d="${d(all)}" fillRule="nonzero" />`;
  if (kind === 'exclude') return `<path d="${d(all)}" fillRule="evenodd" />`;
  const base = d(subs[0] as SubPath[]);
  const rest = subs.slice(1);
  if (kind === 'subtract') {
    const holes = rest.map((s) => `<path d="${d(s)}" fill="black" />`).join('');
    return (
      `<path d="${base}" mask="url(#${id}-mask)" />` +
      `<defs><mask id="${id}-mask" maskUnits="userSpaceOnUse" x="${-PAD}" y="${-PAD}" ` +
      `width="${r2(w + 2 * PAD)}" height="${r2(h + 2 * PAD)}">` +
      `<rect x="${-PAD}" y="${-PAD}" width="${r2(w + 2 * PAD)}" height="${r2(h + 2 * PAD)}" fill="white" />` +
      `${holes}</mask></defs>`
    );
  }
  // intersect: the first clip sits on the path, each further one on a <g> around it
  let body = `<path d="${base}" clipPath="url(#${id}-clip-1)" />`;
  for (let k = 2; k <= rest.length; k++) body = `<g clipPath="url(#${id}-clip-${k})">${body}</g>`;
  const clips = rest
    .map((s, k) => `<clipPath id="${id}-clip-${k + 1}"><path d="${d(s)}" /></clipPath>`)
    .join('');
  return `${body}<defs>${clips}</defs>`;
}

function combineOp(kind: CombineKind): EditOp {
  return {
    id: `shape.combine.${kind}`,
    apply(source, req) {
      if (req.targets.length < 2) return refuse(req, 'Combine needs two or more shapes.');
      const walk = walkIdElements(source, req.file);
      if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');
      const model = siblingModel(source, req.file);
      const NOT_SIBLINGS = 'Combine works on shapes that sit in the same frame.';

      let group: object | null = null;
      const kids: Array<{ start: number; end: number; index: number }> = [];
      const subs: Array<{ index: number; subs: SubPath[]; fill: string | null }> = [];
      let artboard = req.targets[0]?.artboard ?? '';

      req.targets.forEach((t, i) => {
        const el = walk.elements.find((e) => e.id === t.element);
        if (!el) return refuse(req, NOT_SIBLINGS, t.element);
        const hit = model.at.get(el.start);
        if (!hit || (group && hit.group !== group)) return refuse(req, NOT_SIBLINGS, t.element);
        group = hit.group;
        artboard = t.artboard;
        const shape = readAttributeState(req.file, source, t.element, 'data-shape', t.occurrence);
        if (shape.kind !== 'literal')
          return refuse(req, 'Combine works on shapes and paths.', t.element);
        const rotated = readAttributeState(
          req.file,
          source,
          t.element,
          'style.transform',
          t.occurrence
        );
        if (rotated.kind !== 'absent')
          return refuse(req, 'Reset the rotation before combining.', t.element);
        const m = measuredOf(req, i);
        const box: Box = { x: m.x, y: m.y, w: m.w, h: m.h };
        let outline: SubPath[];
        let fillProp = 'background';
        if (shape.value === 'rectangle') outline = [rectSub(box, m.radii)];
        else if (shape.value === 'ellipse') outline = [ellipseSub(box)];
        else if (shape.value === 'polygon') {
          const clip = readAttributeState(
            req.file,
            source,
            t.element,
            'style.clipPath',
            t.occurrence
          );
          if (clip.kind !== 'literal')
            return refuse(
              req,
              `${t.element} has a computed outline; change it in the code.`,
              t.element
            );
          const sub = polygonSubFromClip(clip.value, box);
          if (!sub)
            return refuse(req, `${t.element} has an outline Combine cannot read.`, t.element);
          outline = [sub];
        } else if (shape.value === 'path') {
          fillProp = 'fill';
          const span = el.tag === 'svg' ? dSpan(source, el.start, el.end) : null;
          if (!span)
            return refuse(
              req,
              `${t.element} has a computed path; change it in the code.`,
              t.element
            );
          try {
            outline = translatePath(parsePathD(source.slice(span[0], span[1])), m.x, m.y).subs;
          } catch {
            return refuse(
              req,
              `${t.element} uses arcs; Combine needs a path of points.`,
              t.element
            );
          }
        } else if (shape.value === 'line') {
          return refuse(req, 'A line has no area to combine.', t.element);
        } else return refuse(req, 'Combine works on shapes and paths.', t.element);
        const fill = readAttributeState(
          req.file,
          source,
          t.element,
          `style.${fillProp}`,
          t.occurrence
        );
        subs.push({
          index: hit.index,
          subs: outline.map(clockwise),
          fill:
            fill.kind === 'literal' && TOKEN_FILL.test(fill.value.trim())
              ? fill.value.trim()
              : null,
        });
        kids.push({
          ...(hit.group.kids[hit.index] as { start: number; end: number }),
          index: hit.index,
        });
      });
      if (!group) return refuse(req, NOT_SIBLINGS);

      // the bottom shape = first in the file; the order of the rest is the file's too
      const order = subs
        .map((_, i) => i)
        .sort(
          (a, b) => (subs[a] as { index: number }).index - (subs[b] as { index: number }).index
        );
      const ordered = order.map((i) => subs[i] as (typeof subs)[number]);
      const orderedKids = order.map((i) => kids[i] as (typeof kids)[number]);
      const union: PathModel = path(ordered.flatMap((o) => o.subs));
      const b = pathBounds(union);
      const w = r2(Math.max(1, b.w));
      const h = r2(Math.max(1, b.h));
      const local = ordered.map((o) => translatePath(path(o.subs), -b.x, -b.y).subs);

      const id = generateElementId({ tag: 'svg', dcElement: kind }, usedIds(walk.elements));
      const fill = ordered[0]?.fill ?? 'var(--accent)';
      const style = [
        ['position', 'absolute'],
        ['left', `${r2(b.x)}px`],
        ['top', `${r2(b.y)}px`],
        ['overflow', 'visible'],
        ['fill', fill],
      ];
      const styleText = `{{ ${style.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }}`;
      const svg =
        `<svg data-cd-id="${id}" data-shape="path" data-combine="${kind}" width="${w}" height="${h}" ` +
        `viewBox="0 0 ${w} ${h}" style=${styleText}>${composition(kind, id, local, w, h)}</svg>`;

      const first = orderedKids[0] as { start: number; end: number };
      const s = new MagicString(source);
      s.overwrite(first.start, first.end, svg);
      for (const k of orderedKids.slice(1)) {
        const [rs] = spanWithFraming(source, k.start, k.end);
        const own = /^\s*$/.test(source.slice(source.lastIndexOf('\n', k.start - 1) + 1, k.start));
        s.remove(own ? rs : k.start, k.end);
      }
      const out = s.toString();
      const check = parseSync('combine.tsx', out, { sourceType: 'module' });
      if (check.errors?.length)
        return refuse(req, 'That would break the canvas; nothing was written.');
      return { source: out, created: [{ artboard, element: id }] };
    },
  };
}

export const shapeCombineOps: readonly EditOp[] = COMBINE_KINDS.map(combineOp);
