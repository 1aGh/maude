// edit-ops/path.ts — `object.insert-path` and `path.edit` (S2.14, ed-pen: "P draws, double-click edits points").
//
// The Pen tool's finished path is ONE write: a plain `<svg>` with an inline style and one `<path d>` — what a v1 peer
// (and an agent, and SVG export) reads as it always did. Colours are tokens, never hex.
//
//   <svg data-cd-id="path" data-shape="path" width="W" height="H" viewBox="0 0 W H"
//        style={{ position: "absolute", left: "Xpx", top: "Ypx", overflow: "visible", fill: "none",
//                 stroke: "var(--accent)", strokeWidth: "4px", strokeLinecap: "round", strokeLinejoin: "round" }}>
//     <path d="M0 0C…" />
//   </svg>
//
// Stroke, width and Ends live on the `<svg>`'s style (SVG inherits them), so the inspector's Stroke section writes
// them like any other style and no second element needs an id. The `d` is relative to the svg's own box: the box is
// the path's drawn bounds, so a bend that grows the path moves `left` / `top` with it and every point stays put.
//
//   object.insert-path  params { artboard, path: PathModel (the container's px), relativeParent?: true }
//     targets[0]  the frame the path goes into (absent = the artboard `artboard` itself)
//   path.edit           params { path: PathModel (the container's px — the same space as left / top) }
//     targets[0]  the path's svg. Rewrites `d`, `width`, `height`, `viewBox`, `left`, `top` and nothing else.
//
// Refused (nothing written): a model that is not finite numbers, past 2 000 points, or a `d` the file computes.
// Same result by hand: `canvas-tsx.md` § "Draw a path".

import { parseSync } from 'oxc-parser';

import { applyEdit, readAttributeState } from '../canvas-edit.ts';
import { generateElementId, usedIds, walkIdElements } from '../element-ids.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { inlinePosition, refuse, writeStyle } from './constraints.ts';
import { appendChild } from './insert-shape.ts';
import {
  type Box,
  cleanPath,
  isSanePath,
  type PathModel,
  pathBounds,
  serializePath,
  translatePath,
} from './path-model.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';

/** What a new path is drawn with — names of the system's contract, never a colour. */
export const PATH_STROKE = 'var(--accent)';
export const PATH_WIDTH = '4px';

const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

/** The svg box for a model in the container's px: where it sits, how big, and the `d` relative to that box. */
export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
  d: string;
}

export function placementOf(model: PathModel, bounds?: Box): Placement {
  const b = bounds ?? pathBounds(model);
  const width = r2(Math.max(1, b.w));
  const height = r2(Math.max(1, b.h));
  return {
    left: r2(b.x),
    top: r2(b.y),
    width,
    height,
    d: serializePath(translatePath(model, -b.x, -b.y)),
  };
}

type Style = Array<[string, string]>;
const styleText = (style: Style): string =>
  `{{ ${style.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }}`;

/** The element of a drawn path: the same text insert-path writes (tests and combine's golden read it). */
export function pathSvg(id: string, p: Placement, extra: Style = []): string {
  const style: Style = [
    ['position', 'absolute'],
    ['left', `${p.left}px`],
    ['top', `${p.top}px`],
    ['overflow', 'visible'],
    ['fill', 'none'],
    ['stroke', PATH_STROKE],
    ['strokeWidth', PATH_WIDTH],
    ['strokeLinecap', 'round'],
    ['strokeLinejoin', 'round'],
    ...extra,
  ];
  return (
    `<svg data-cd-id="${id}" data-shape="path" width="${p.width}" height="${p.height}" ` +
    `viewBox="0 0 ${p.width} ${p.height}" style=${styleText(style)}><path d="${p.d}" /></svg>`
  );
}

function modelOf(req: ResolvedEditOp): PathModel {
  const raw = req.params.path;
  if (!isSanePath(raw))
    return refuse(req, 'The canvas did not say where the path goes; try again.');
  return cleanPath(raw);
}

export const objectInsertPath: EditOp = {
  id: 'object.insert-path',
  apply(source, req) {
    const artboard = req.params.artboard;
    if (typeof artboard !== 'string' || !ARTBOARD_ID_RE.test(artboard))
      return refuse(req, 'That artboard is not on this canvas.');
    const model = modelOf(req);
    if (model.subs.every((s) => s.points.length < 2))
      return refuse(req, 'A path needs two points; click once more.');
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');
    const parentRef: ElementRef | undefined = req.targets[0];
    const parent = parentRef
      ? walk.elements.find((e) => e.id === parentRef.element)
      : walk.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === artboard);
    if (!parent) return refuse(req, 'That frame is not on this canvas.');
    if (parent.artboard !== artboard) return refuse(req, 'That frame is not on this artboard.');

    const id = generateElementId({ tag: 'svg', dcElement: 'path' }, usedIds(walk.elements));
    let out = appendChild(source, parent, pathSvg(id, placementOf(model)), req);
    const check = parseSync('path.tsx', out, { sourceType: 'module' });
    if (check.errors?.length)
      return refuse(req, 'That drawing would break the canvas; nothing was written.');
    if (parentRef && req.params.relativeParent === true) {
      const pos = inlinePosition(out, req, parentRef);
      if (!pos || pos === 'static') out = writeStyle(out, req, parentRef, { position: 'relative' });
    }
    return { source: out, created: [{ artboard, element: id }] };
  },
};

/** The first `<path d="…">` inside an element: where its `d` literal sits in the source. */
export function dSpan(source: string, start: number, end: number): [number, number] | null {
  const slice = source.slice(start, end);
  const m = /<path\b[^>]*?\sd=(["'])([^"']*)\1/.exec(slice);
  if (!m) return null;
  const valueStart = start + m.index + m[0].length - 1 - (m[2] as string).length;
  return [valueStart, valueStart + (m[2] as string).length];
}

export const pathEdit: EditOp = {
  id: 'path.edit',
  apply(source, req) {
    const t = req.targets[0];
    if (!t) return refuse(req, 'Select a path to edit.');
    const model = modelOf(req);
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');
    const el = walk.elements.find((e) => e.id === t.element);
    if (!el) return refuse(req, 'That path is not on this canvas.', t.element);
    const shape = readAttributeState(req.file, source, t.element, 'data-shape', t.occurrence);
    if (el.tag !== 'svg' || shape.kind !== 'literal' || shape.value !== 'path')
      return refuse(req, 'That is not a path drawn with the Pen.', t.element);
    const span = dSpan(source, el.start, el.end);
    if (!span)
      return refuse(req, `${t.element} has a computed path; change it in the code.`, t.element);

    const p = placementOf(model);
    let out = `${source.slice(0, span[0])}${p.d}${source.slice(span[1])}`;
    const set = (attr: string, value: string) => {
      out = applyEdit(req.file, out, t.element, attr, value, t.occurrence).source;
    };
    set('width', String(p.width));
    set('height', String(p.height));
    set('viewBox', `0 0 ${p.width} ${p.height}`);
    out = writeStyle(out, req, t, { left: `${p.left}px`, top: `${p.top}px` });
    return { source: out };
  },
};
