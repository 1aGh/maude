/**
 * @file       annotations/v1-adapter.ts — v2 elements ⇄ the v1 `Stroke[]` UI
 * @scope      apps/studio/annotations/v1-adapter.ts
 * @purpose    v2-adapter: removed in Task 26.
 *
 *             Milestone B of the annotations-v2 plan lands storage + transport
 *             UNDER the unchanged v1 UI (annotations-layer.tsx works on
 *             `Stroke[]`). This adapter is the seam:
 *               • elementsToStrokes — the board as the UI draws it (world
 *                 coordinates, labels as anchored text, arrow endpoints
 *                 resolved);
 *               • strokesToElements — the UI's next `Stroke[]` back to canonical
 *                 elements, PRESERVING what the UI cannot express: an element
 *                 that did not move keeps its parent, sibling order keeps its
 *                 fractional keys where it can, unknown types are carried over.
 *             The caller diffs two adapter outputs (`diffToOps`) — the UI's own
 *             before/after — so only what the user changed is sent.
 */

import type { ArrowBind, Stroke, WorldPoint } from '../annotations-model.ts';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_INK,
  DEFAULT_SECTION_COLOR,
  DEFAULT_STICKY_FILL,
  STICKY_RADIUS,
} from './constants.ts';
import { keyBetween, orderKeys } from './fractional-index.ts';
import { v1ToV2 } from './migrate-v1.ts';
import { defOf, isKnownType } from './registry.ts';
import { Scene } from './scene.ts';
import { validateElements } from './schema.ts';
import type { AnnotationElement, ArrowEnd, Box } from './types.ts';

/** Stable id of the v1 anchored-text stroke that shows a shape's label. */
export function labelStrokeId(shapeId: string): string {
  return `${shapeId}~label`;
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' ? v : d;
}

function str(v: unknown, d = ''): string {
  return typeof v === 'string' ? v : d;
}

type Fmt = {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  listType?: 'bullet' | 'number';
  align?: 'left' | 'center' | 'right';
};

function fmtOf(r: Record<string, unknown>, defAlign: 'left' | 'center'): Fmt {
  const out: Fmt = {};
  if (r.bold === true) out.bold = true;
  if (r.italic === true) out.italic = true;
  if (r.strike === true) out.strike = true;
  if (r.underline === true) out.underline = true;
  if (r.list === 'bullet' || r.list === 'number') out.listType = r.list;
  const a = r.align;
  if ((a === 'left' || a === 'center' || a === 'right') && a !== defAlign) out.align = a;
  return out;
}

function shared(el: AnnotationElement): Partial<Stroke> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(el.groups) && el.groups.length) out.groupIds = [...(el.groups as string[])];
  const a = el.author as { kind?: string; name?: string; id?: string } | undefined;
  if (a?.kind === 'ai') out.author = 'ai';
  else if (a?.kind === 'human') {
    if (a.name) out.authorName = a.name;
    if (a.id) out.authorId = a.id;
  }
  if (num(el.rot) !== 0) out.rotation = num(el.rot);
  if (el.locked === true) out.locked = true;
  return out as Partial<Stroke>;
}

/** The board as the v1 UI draws it, in paint order. Unknown types are not drawn by v1. */
export function elementsToStrokes(elements: Iterable<AnnotationElement>): Stroke[] {
  const scene = new Scene(elements);
  const out: Stroke[] = [];
  for (const el of scene.paintOrder()) out.push(...elementStrokes(scene, el));
  return out;
}

/** One element as the strokes the UI draws for it (a labelled shape is two). */
export function elementStrokes(scene: Scene, el: AnnotationElement): Stroke[] {
  const out: Stroke[] = [];
  {
    if (!isKnownType(el.type)) return out;
    const o = scene.originOf(el);
    const x = num(el.x) + o.x;
    const y = num(el.y) + o.y;
    const w = num(el.w);
    const h = num(el.h);
    const base = { id: el.id, ...shared(el) };
    switch (el.type) {
      case 'sticky':
        out.push({
          ...base,
          tool: 'sticky',
          color: str(el.fill, DEFAULT_STICKY_FILL),
          x,
          y,
          w,
          h,
          text: str(el.text),
          fontSize: num(el.fontSize, DEFAULT_FONT_SIZE),
          cornerRadius: num(el.radius, STICKY_RADIUS),
          ...fmtOf(el, 'left'),
        } as Stroke);
        break;
      case 'text':
        out.push({
          ...base,
          tool: 'text',
          color: str(el.color, DEFAULT_INK),
          fontSize: num(el.fontSize, DEFAULT_FONT_SIZE),
          text: str(el.text),
          x,
          y,
          ...fmtOf(el, 'left'),
        } as Stroke);
        break;
      case 'shape': {
        const kind = str(el.kind, 'rect');
        const common = {
          ...base,
          color: str(el.color, DEFAULT_INK),
          width: num(el.width, 2),
          fill: typeof el.fill === 'string' ? el.fill : null,
          ...(el.dashed === true ? { dashed: true } : {}),
        };
        if (kind === 'rect')
          out.push({ ...common, tool: 'rect', x, y, w, h, cornerRadius: num(el.radius) } as Stroke);
        else if (kind === 'ellipse')
          out.push({
            ...common,
            tool: 'ellipse',
            cx: x + w / 2,
            cy: y + h / 2,
            rx: w / 2,
            ry: h / 2,
          } as Stroke);
        else out.push({ ...common, tool: 'polygon', shape: kind, x, y, w, h } as Stroke);
        const label = el.label as Record<string, unknown> | undefined;
        if (label && typeof label.text === 'string') {
          const lf = fmtOf(label, 'center');
          out.push({
            id: labelStrokeId(el.id),
            tool: 'text',
            anchorId: el.id,
            color: str(label.color, DEFAULT_INK),
            fontSize: num(label.fontSize, DEFAULT_FONT_SIZE),
            text: label.text,
            ...lf,
            // v1 anchored text defaults to centre; carry a non-centre alignment explicitly.
            ...(label.align === 'left' || label.align === 'right' ? { align: label.align } : {}),
          } as Stroke);
        }
        break;
      }
      case 'arrow': {
        const r = scene.arrowWorld(el);
        if (!r) break;
        const bind = (
          a: typeof r.startAnchor,
          end: ArrowEnd | undefined
        ): ArrowBind | undefined => {
          if (!a) return undefined;
          const pinned = !!end && 'el' in end && end.nx !== undefined;
          return { hostId: a.el, nx: a.nx, ny: a.ny, ...(pinned ? { pinned: true } : {}) };
        };
        const sb = bind(r.startAnchor, el.start as ArrowEnd);
        const eb = bind(r.endAnchor, el.end as ArrowEnd);
        const head = (k: string, def: string) =>
          typeof el[k] === 'string' && el[k] !== def ? { [k]: el[k] } : {};
        out.push({
          ...base,
          tool: 'arrow',
          color: str(el.color, DEFAULT_INK),
          width: num(el.width, 2),
          x1: r.x1,
          y1: r.y1,
          x2: r.x2,
          y2: r.y2,
          ...head('startHead', 'none'),
          ...head('endHead', 'triangle'),
          ...(el.dashed === true ? { dashed: true } : {}),
          ...(typeof el.line === 'string' && el.line !== 'straight' ? { lineType: el.line } : {}),
          ...(sb ? { startBind: sb } : {}),
          ...(eb ? { endBind: eb } : {}),
        } as Stroke);
        break;
      }
      case 'pen': {
        const p = Array.isArray(el.points) ? (el.points as number[]) : [];
        const points: WorldPoint[] = [];
        for (let i = 0; i + 1 < p.length; i += 2)
          points.push([(p[i] as number) + o.x, (p[i + 1] as number) + o.y]);
        out.push({
          ...base,
          tool: 'pen',
          color: str(el.color, DEFAULT_INK),
          width: num(el.width, 2),
          points,
          ...(el.highlighter === true ? { highlighter: true } : {}),
        } as Stroke);
        break;
      }
      case 'image':
        out.push({
          ...base,
          tool: 'image',
          x,
          y,
          w,
          h,
          href: str(el.href),
          ...(el.alt ? { alt: str(el.alt) } : {}),
        } as Stroke);
        break;
      case 'link':
        out.push({
          ...base,
          tool: 'link',
          x,
          y,
          w,
          h,
          url: str(el.url),
          title: str(el.title),
          domain: str(el.domain),
        } as Stroke);
        break;
      case 'mediaref':
        out.push({
          ...base,
          tool: 'mediaref',
          x,
          y,
          w,
          h,
          src: str(el.src),
          mediaKind: el.media === 'audio' ? 'audio' : 'video',
          title: str(el.title),
        } as Stroke);
        break;
      default: {
        // A registry type with no stroke form of its own (Task 25): carried as
        // its world-space record; geometry comes from its definition.
        const def = defOf(el.type);
        if (!def) break;
        const world: Record<string, unknown> = { ...el, ...def.translate(el, o.x, o.y) };
        delete world.parent;
        out.push({ ...base, tool: 'element', el: world as AnnotationElement } as Stroke);
        break;
      }
      case 'section':
        out.push({
          ...base,
          tool: 'section',
          x,
          y,
          w,
          h,
          label: str(el.label, 'Section'),
          color: str(el.color, DEFAULT_SECTION_COLOR),
        } as Stroke);
        break;
    }
  }
  return out;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.011 &&
    Math.abs(a.y - b.y) < 0.011 &&
    Math.abs(a.w - b.w) < 0.011 &&
    Math.abs(a.h - b.h) < 0.011
  );
}

/**
 * The UI's `Stroke[]` → canonical elements, reconciled with the `current`
 * board so that what the v1 UI can't express survives: parents of unmoved
 * elements, sibling keys, unknown element types.
 */
export function strokesToElements(
  strokes: readonly Stroke[],
  current: ReadonlyMap<string, AnnotationElement>
): AnnotationElement[] {
  const flat = v1ToV2(strokes, { flat: true }).elements; // world coords, top level
  const world = new Map(flat.map((e) => [e.id, e]));
  const curScene = new Scene(current.values());
  const nextScene = new Scene(flat); // all top-level → world boxes = own boxes
  const boxOf = (id: string) => nextScene.worldBox(id);
  // Parents: keep when the element did not move and its parent survives; else by centre.
  const sections = flat
    .filter((e) => e.type === 'section')
    .map((e) => ({ id: e.id, box: boxOf(e.id) as Box }))
    .filter((s) => s.box);
  const area = (b: Box) => b.w * b.h;
  const parentOf = new Map<string, string>();
  // Same rule as the migration: a section adopts only what paints above it.
  const zOf = new Map(strokes.map((s, i) => [s.id, i]));
  const inside = (box: Box, x: number, y: number) =>
    x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  for (const el of flat) {
    const prev = current.get(el.id);
    const b = boxOf(el.id);
    if (!b) continue;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const self = el.type === 'section' ? area(b) : null;
    // The smallest section under the element's centre that it painted above
    // (the v1 rule: what sits on a section is in it).
    let best: { id: string; a: number } | null = null;
    for (const s of sections) {
      if (s.id === el.id || (self !== null && area(s.box) <= self)) continue;
      if ((zOf.get(s.id) ?? 0) >= (zOf.get(el.id) ?? Number.POSITIVE_INFINITY)) continue;
      if (!inside(s.box, cx, cy)) continue;
      // Equal size (a copy lying exactly on its original): the one painted
      // later — nearest below the element — is its container.
      if (!best || area(s.box) <= best.a) best = { id: s.id, a: area(s.box) };
    }
    // An element that did not move keeps its container while it still sits
    // in it — unless a smaller section now holds it (one drawn around it, or
    // moved or resized onto it: it adopts what it lands on, as in v1).
    const moved = !prev || !sameBox(curScene.worldBox(prev), b);
    const kept = prev?.parent;
    const keptBox = kept && world.has(kept) ? boxOf(kept) : null;
    if (!moved && kept && keptBox && inside(keptBox, cx, cy)) {
      parentOf.set(el.id, best && best.a < area(keptBox) ? best.id : kept);
      continue;
    }
    if (best) parentOf.set(el.id, best.id);
  }
  // Break any cycle the kept parents could form (walk up; drop the parent that closes a loop).
  for (const id of parentOf.keys()) {
    const seen = new Set<string>([id]);
    let cur = parentOf.get(id);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        parentOf.delete(id);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  // World origin of a parent = its world top-left (all `flat` coords are world).
  const originOf = (id: string): { x: number; y: number } => {
    const p = parentOf.get(id);
    if (!p) return { x: 0, y: 0 };
    const pb = world.get(p);
    return { x: num(pb?.x), y: num(pb?.y) };
  };
  // Sibling order from the stroke array; keys reused where still in order.
  const order = new Map(strokes.map((s, i) => [s.id, i]));
  const byParent = new Map<string, string[]>();
  for (const el of flat) {
    const k = parentOf.get(el.id) ?? '';
    const list = byParent.get(k);
    if (list) list.push(el.id);
    else byParent.set(k, [el.id]);
  }
  const indexOf = new Map<string, string>();
  for (const [p, ids] of byParent) {
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const prevKeys = new Map<string, string>();
    for (const id of ids) {
      const prev = current.get(id);
      if (prev && (prev.parent ?? '') === p) prevKeys.set(id, prev.index);
    }
    for (const [id, k] of orderKeys(ids, prevKeys)) indexOf.set(id, k);
  }
  const out: Record<string, unknown>[] = [];
  for (const el of flat) {
    const o = originOf(el.id);
    const rec: Record<string, unknown> = {
      ...el,
      index: indexOf.get(el.id) ?? keyBetween(null, null),
    };
    const p = parentOf.get(el.id);
    if (p) rec.parent = p;
    else delete rec.parent;
    if (o.x !== 0 || o.y !== 0) {
      if (typeof rec.x === 'number') rec.x = (rec.x as number) - o.x;
      if (typeof rec.y === 'number') rec.y = (rec.y as number) - o.y;
      if (Array.isArray(rec.points))
        rec.points = (rec.points as number[]).map((v, i) => v - (i % 2 === 0 ? o.x : o.y));
      for (const k of ['start', 'end']) {
        const e = rec[k] as ArrowEnd | undefined;
        if (e && !('el' in e)) rec[k] = { x: e.x - o.x, y: e.y - o.y };
      }
    }
    // Standalone text: v1 only knows a character estimate — keep the measured box while the text is unchanged.
    const prev = current.get(el.id);
    if (
      el.type === 'text' &&
      prev?.type === 'text' &&
      prev.text === el.text &&
      typeof prev.w === 'number'
    ) {
      rec.w = prev.w;
      rec.h = prev.h;
    }
    out.push(rec);
  }
  // Unknown types the v1 UI never showed are carried over untouched.
  for (const el of current.values()) if (!isKnownType(el.type)) out.push(el);
  return validateElements(out).elements;
}

/** Map form of `strokesToElements` for `diffToOps`. */
export function strokesToElementMap(
  strokes: readonly Stroke[],
  current: ReadonlyMap<string, AnnotationElement>
): Map<string, AnnotationElement> {
  return new Map(strokesToElements(strokes, current).map((e) => [e.id, e]));
}
