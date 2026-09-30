/**
 * @file       annotations/ui/render-model.ts — what the scene draws, per element
 * @scope      apps/studio/annotations/ui/render-model.ts
 * @purpose    The scene (element-node.tsx) draws v2 element records in WORLD
 *             space, one DOM node per element, in paint order. A `RenderItem`
 *             is that record plus what the scene resolved for it (arrow
 *             endpoints).
 *
 *             `renderItemsFromStrokes` is the TRANSITIONAL source while the
 *             layer still edits v1 `Stroke[]` (removed with the v1 adapter,
 *             Task 26). It maps each stroke straight to a view record WITHOUT
 *             the validator: the UI also draws states that are never persisted
 *             (an image whose upload is still running carries a `blob:` href
 *             the validator would drop, making the picture blink out). One
 *             record per stroke object, cached, so an unchanged stroke keeps
 *             its record identity and its node skips re-rendering.
 */

import type { Stroke } from '../../annotations-model.ts';
import type { AnnotationElement } from '../types.ts';

export interface ArrowAnchor {
  el: string;
  nx: number;
  ny: number;
}

/** World endpoints of an arrow plus the magnet each bound end sits on. */
export interface ResolvedEnds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startAnchor?: ArrowAnchor;
  endAnchor?: ArrowAnchor;
}

export interface RenderItem {
  /** World-space record (no `parent`: containment is already resolved). */
  el: AnnotationElement;
  ends?: ResolvedEnds;
}

type Label = Extract<Stroke, { tool: 'text' }>;

function fmt(s: {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  listType?: string;
  align?: string;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.strike) out.strike = true;
  if (s.underline) out.underline = true;
  if (s.listType) out.list = s.listType;
  if (s.align) out.align = s.align;
  return out;
}

function author(s: Stroke): Record<string, unknown> {
  if (s.author === 'ai') return { author: { kind: 'ai' } };
  if (s.authorName) return { author: { kind: 'human', name: s.authorName } };
  return {};
}

function box(x: number, y: number, w: number, h: number) {
  return {
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

/** One stroke (and a shape's anchored label) → its world-space view record. */
export function strokeToRenderItem(s: Stroke, label?: Label): RenderItem | null {
  const head = { id: s.id, index: 'a0', ...author(s) };
  const rot = s.rotation ? { rot: s.rotation } : {};
  switch (s.tool) {
    case 'element':
      return { el: { ...s.el, id: s.id } };
    case 'sticky':
      return {
        el: {
          ...head,
          type: 'sticky',
          ...box(s.x, s.y, s.w, s.h),
          ...rot,
          fill: s.color,
          text: s.text,
          fontSize: s.fontSize,
          radius: s.cornerRadius,
          ...fmt(s),
        },
      };
    case 'text':
      if (s.anchorId) return null; // drawn inside its host
      return {
        el: {
          ...head,
          type: 'text',
          x: s.x ?? 0,
          y: s.y ?? 0,
          ...rot,
          text: s.text,
          fontSize: s.fontSize,
          color: s.color,
          ...fmt(s),
        },
      };
    case 'rect':
    case 'ellipse':
    case 'polygon': {
      const b =
        s.tool === 'ellipse'
          ? { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 }
          : box(s.x, s.y, s.w, s.h);
      return {
        el: {
          ...head,
          type: 'shape',
          kind: s.tool === 'polygon' ? s.shape : s.tool,
          ...b,
          ...rot,
          color: s.color,
          width: s.width,
          fill: s.fill ?? null,
          ...(s.tool === 'rect' && s.cornerRadius ? { radius: s.cornerRadius } : {}),
          ...(s.dashed ? { dashed: true } : {}),
          ...(label
            ? {
                label: {
                  text: label.text,
                  fontSize: label.fontSize,
                  color: label.color,
                  ...fmt(label),
                },
              }
            : {}),
        },
      };
    }
    case 'arrow':
      return {
        el: {
          ...head,
          type: 'arrow',
          start: { x: s.x1, y: s.y1 },
          end: { x: s.x2, y: s.y2 },
          color: s.color,
          width: s.width,
          ...(s.startHead ? { startHead: s.startHead } : {}),
          ...(s.endHead ? { endHead: s.endHead } : {}),
          ...(s.dashed ? { dashed: true } : {}),
          ...(s.lineType ? { line: s.lineType } : {}),
        },
        ends: {
          x1: s.x1,
          y1: s.y1,
          x2: s.x2,
          y2: s.y2,
          ...(s.startBind
            ? { startAnchor: { el: s.startBind.hostId, nx: s.startBind.nx, ny: s.startBind.ny } }
            : {}),
          ...(s.endBind
            ? { endAnchor: { el: s.endBind.hostId, nx: s.endBind.nx, ny: s.endBind.ny } }
            : {}),
        },
      };
    case 'pen':
      return {
        el: {
          ...head,
          type: 'pen',
          points: s.points.flat(),
          color: s.color,
          width: s.width,
          ...(s.highlighter ? { highlighter: true } : {}),
        },
      };
    case 'image':
      return {
        el: {
          ...head,
          type: 'image',
          ...box(s.x, s.y, s.w, s.h),
          ...rot,
          href: s.href,
          alt: s.alt ?? '',
        },
      };
    case 'link':
      return {
        el: {
          ...head,
          type: 'link',
          ...box(s.x, s.y, s.w, s.h),
          ...rot,
          url: s.url,
          title: s.title,
          domain: s.domain,
        },
      };
    case 'mediaref':
      return {
        el: {
          ...head,
          type: 'mediaref',
          ...box(s.x, s.y, s.w, s.h),
          ...rot,
          src: s.src,
          media: s.mediaKind,
          title: s.title,
        },
      };
    case 'section':
      return {
        el: {
          ...head,
          type: 'section',
          ...box(s.x, s.y, s.w, s.h),
          label: s.label,
          color: s.color,
        },
      };
    default:
      return null;
  }
}

const cache = new WeakMap<Stroke, { label: Label | undefined; item: RenderItem | null }>();

/**
 * The strokes in paint order as view records. `unknown` are elements of a type
 * this build does not know (a newer peer's) — drawn as labelled placeholders,
 * never dropped.
 */
export function renderItemsFromStrokes(
  strokes: readonly Stroke[],
  unknown: readonly AnnotationElement[] = []
): RenderItem[] {
  const labels = new Map<string, Label>();
  for (const s of strokes) {
    if (s.tool === 'text' && s.anchorId && !labels.has(s.anchorId)) labels.set(s.anchorId, s);
  }
  const out: RenderItem[] = [];
  for (const s of strokes) {
    const label = labels.get(s.id);
    const hit = cache.get(s);
    let item: RenderItem | null;
    if (hit && hit.label === label) item = hit.item;
    else {
      item = strokeToRenderItem(s, label);
      cache.set(s, { label, item });
    }
    if (item) out.push(item);
  }
  for (const el of unknown) out.push({ el });
  return out;
}
