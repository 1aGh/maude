// edit-ops/insert-shape.ts — `object.insert-shape` and `artboard.draw` (S2.13, ed-shape: "R draws a rectangle").
//
// The Frame (F) and Shape (R, and More: Line · Ellipse · Polygon) tools draw by dragging; the drag ends in ONE of
// these ops, so a drawing is one write and one undo step. Everything written is plain TSX a v1 peer reads as it
// always did: a `<div>` with an inline style and a fresh readable `data-cd-id` ("frame", "rectangle", "ellipse-2").
// A shape additionally carries `data-shape="rectangle|ellipse|line|polygon"` — an inert data attribute, the one
// thing the inspector and the selection read to say "Shape" (a frame has none).
//
//   object.insert-shape  params { kind: 'frame' | 'rectangle' | 'ellipse' | 'line' | 'polygon',
//                                 artboard, rect?: { x, y, w, h }, line?: { x1, y1, x2, y2 }, sides?: 3..12,
//                                 relativeParent?: true }
//     targets[0]  the frame the drawing goes into (absent = the artboard `artboard` itself). `rect` / `line` are
//                 in that container's own px (what the canvas measures from its box). `relativeParent: true`
//                 (the canvas saw the container is `position: static`) gives it `position: relative` so the
//                 numbers mean what they say — as Place freely does.
//   artboard.draw        params { rect: { x, y, w, h } }  (world px, an empty stretch of the canvas)
//     A new Fixed size artboard (`kind="digital"` `fixed`) of that size, its place in the layout lane.
//
// Colours are tokens, never hex: a frame is `var(--bg-1)`, a shape `var(--accent)`, a line's stroke `var(--fg-0)`.
// Refused (nothing written): a rect under 1 px or past 10 000, a parent the file computes, a self-closing
// component parent that is not a plain element.
//
// Same result by hand: `canvas-tsx.md` § "Draw a frame or a shape".

import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';

import { applyInsertArtboard, applySetArtboardKind } from '../canvas-edit.ts';
import { generateElementId, type IdElement, usedIds, walkIdElements } from '../element-ids.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { inlinePosition, refuse, writeStyle } from './constraints.ts';
import { lineIndent } from './siblings.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';

export const SHAPE_KINDS = ['frame', 'rectangle', 'ellipse', 'line', 'polygon'] as const;
export type DrawnKind = (typeof SHAPE_KINDS)[number];

/** The tokens a new drawing is made of — names of the system's contract, never a colour. */
export const FRAME_FILL = 'var(--bg-1)';
export const SHAPE_FILL = 'var(--accent)';
export const LINE_STROKE = '2px solid var(--fg-0)';

const MAX_PX = 10_000;
const DEFAULT_SIDES = 6;

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
const px = (n: number) => `${Math.round(n)}px`;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(req: ResolvedEditOp, raw: unknown): Box {
  if (!isRec(raw) || !num(raw.x) || !num(raw.y) || !num(raw.w) || !num(raw.h))
    return refuse(req, 'The canvas did not say where you drew; try again.');
  if (Math.abs(raw.x) > MAX_PX || Math.abs(raw.y) > MAX_PX)
    return refuse(req, 'That is too far from the artboard.');
  if (raw.w < 1 || raw.h < 1 || raw.w > MAX_PX || raw.h > MAX_PX)
    return refuse(req, 'Drag a little further to draw it.');
  return { x: raw.x, y: raw.y, w: raw.w, h: raw.h };
}

/** A regular polygon's `clip-path`: `sides` points on the box's inscribed ellipse, the first at the top. */
export function polygonClip(sides: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    const x = round(50 + 50 * Math.cos(a));
    const y = round(50 + 50 * Math.sin(a));
    pts.push(`${x}% ${y}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

type Style = Array<[string, string]>;

function styleFor(req: ResolvedEditOp, kind: DrawnKind): { style: Style; shape: string | null } {
  const p = req.params;
  if (kind === 'line') {
    const l = p.line;
    if (!isRec(l) || !num(l.x1) || !num(l.y1) || !num(l.x2) || !num(l.y2))
      return refuse(req, 'The canvas did not say where you drew; try again.');
    if ([l.x1, l.y1, l.x2, l.y2].some((n) => Math.abs(n as number) > MAX_PX))
      return refuse(req, 'That is too far from the artboard.');
    const dx = l.x2 - l.x1;
    const dy = l.y2 - l.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return refuse(req, 'Drag a little further to draw it.');
    const deg = round((Math.atan2(dy, dx) * 180) / Math.PI);
    const style: Style = [
      ['position', 'absolute'],
      ['left', px(l.x1)],
      ['top', px(l.y1)],
      ['width', px(len)],
      ['height', '0'],
      ['borderTop', LINE_STROKE],
    ];
    if (deg !== 0) {
      style.push(['transform', `rotate(${deg}deg)`], ['transformOrigin', '0 0']);
    }
    return { style, shape: 'line' };
  }
  const b = boxOf(req, p.rect);
  const style: Style = [
    ['position', 'absolute'],
    ['left', px(b.x)],
    ['top', px(b.y)],
    ['width', px(b.w)],
    ['height', px(b.h)],
    ['background', kind === 'frame' ? FRAME_FILL : SHAPE_FILL],
  ];
  if (kind === 'ellipse') style.push(['borderRadius', '50%']);
  if (kind === 'polygon') {
    const sides = p.sides === undefined ? DEFAULT_SIDES : p.sides;
    if (!Number.isInteger(sides) || (sides as number) < 3 || (sides as number) > 12)
      return refuse(req, 'A polygon has 3 to 12 sides.');
    style.push(['clipPath', polygonClip(sides as number)]);
  }
  return { style, shape: kind === 'frame' ? null : kind };
}

const styleText = (style: Style): string =>
  `{{ ${style.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }}`;

/** `child` as the last child of `parent` (a self-closing parent opens up). Shared with the Pen's path (path.ts). */
export function appendChild(
  source: string,
  parent: IdElement,
  child: string,
  req: ResolvedEditOp
): string {
  const s = new MagicString(source);
  const indent = lineIndent(source, parent.start);
  const unit = indent.includes('\t') ? '\t' : '  ';
  const text = source.slice(parent.start, parent.end);
  if (text.endsWith('/>')) {
    // a self-closing parent opens up: `<div … />` → `<div …>\n  <child />\n</div>`
    if (!/^[a-z]/.test(parent.tag) && parent.tag !== 'DCArtboard')
      return refuse(req, 'Draw inside a frame, not a component.');
    s.overwrite(
      parent.end - 2,
      parent.end,
      `>\n${indent}${unit}${child}\n${indent}</${parent.tag}>`
    );
  } else {
    const close = source.lastIndexOf('</', parent.end);
    const own = /^\s*$/.test(source.slice(source.lastIndexOf('\n', close - 1) + 1, close));
    if (own) s.appendLeft(source.lastIndexOf('\n', close - 1), `\n${indent}${unit}${child}`);
    else s.appendLeft(close, child);
  }
  return s.toString();
}

export const objectInsertShape: EditOp = {
  id: 'object.insert-shape',
  apply(source, req) {
    const kind = req.params.kind;
    if (typeof kind !== 'string' || !(SHAPE_KINDS as readonly string[]).includes(kind))
      return refuse(req, 'Pick Frame, Rectangle, Ellipse, Line or Polygon.');
    const artboard = req.params.artboard;
    if (typeof artboard !== 'string' || !ARTBOARD_ID_RE.test(artboard))
      return refuse(req, 'That artboard is not on this canvas.');
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');

    const parentRef: ElementRef | undefined = req.targets[0];
    const parent = parentRef
      ? walk.elements.find((e) => e.id === parentRef.element)
      : walk.elements.find((e) => e.tag === 'DCArtboard' && e.artboard === artboard);
    if (!parent) return refuse(req, 'That frame is not on this canvas.');
    if (parent.artboard !== artboard) return refuse(req, 'That frame is not on this artboard.');

    const { style, shape } = styleFor(req, kind as DrawnKind);
    const id = generateElementId({ tag: 'div', dcElement: kind }, usedIds(walk.elements));
    const attrs = [`data-cd-id="${id}"`, ...(shape ? [`data-shape="${shape}"`] : [])];
    const child = `<div ${attrs.join(' ')} style=${styleText(style)} />`;

    let out = appendChild(source, parent, child, req);
    const check = parseSync('draw.tsx', out, { sourceType: 'module' });
    if (check.errors?.length)
      return refuse(req, 'That drawing would break the canvas; nothing was written.');

    // A frame the artboard does not place (position: static) needs `position: relative` for the numbers to mean
    // what they say (the artboard body already is relative).
    if (parentRef && req.params.relativeParent === true) {
      const pos = inlinePosition(out, req, parentRef);
      if (!pos || pos === 'static') out = writeStyle(out, req, parentRef, { position: 'relative' });
    }
    return { source: out, created: [{ artboard, element: id }] };
  },
};

// ── a Fixed size artboard on empty canvas ─────────────────────────────────────────────────────

const MIN_DRAWN = 64;
const MAX_DRAWN = 8192;

export const artboardDraw: EditOp = {
  id: 'artboard.draw',
  apply(source, req) {
    const b = boxOf(req, req.params.rect);
    const w = Math.max(MIN_DRAWN, Math.min(MAX_DRAWN, Math.round(b.w)));
    const h = Math.max(MIN_DRAWN, Math.min(MAX_DRAWN, Math.round(b.h)));
    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return refuse(req, 'This canvas does not parse; fix it before editing.');
    const taken = new Set(
      walk.elements.filter((e) => e.tag === 'DCArtboard' && e.artboard).map((e) => e.artboard)
    );
    let n = taken.size + 1;
    while (taken.has(`artboard-${n}`)) n++;
    const id = `artboard-${n}`;
    {
      const made = applyInsertArtboard(req.file, source, {
        id,
        label: `Artboard ${n}`,
        width: w,
        height: h,
      });
      let out = applySetArtboardKind(req.file, made.source, id, 'digital').source;
      // `fixed`: the drawn height is the height (not a floor the content may grow past)
      const tag = new RegExp(`<DCArtboard\\b[^>]*\\bid="${id}"[^>]*?(?=>)`).exec(out);
      if (tag && !/\bfixed\b/.test(tag[0])) {
        const at = (tag.index ?? 0) + tag[0].length;
        out = `${out.slice(0, at)} fixed${out.slice(at)}`;
      }
      return {
        source: out,
        created: [{ artboard: id, element: id }],
        layout: { set: [{ id, x: Math.round(b.x), y: Math.round(b.y) }] },
      };
    }
  },
};
