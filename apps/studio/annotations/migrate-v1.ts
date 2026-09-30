/**
 * @file       annotations/migrate-v1.ts — v1 strokes → v2 elements (DDR-242 §6)
 * @scope      apps/studio/annotations/migrate-v1.ts
 * @purpose    The pure transform behind every migration path (studio boot,
 *             hub checkout, hub document load, lazy history upconvert). Same
 *             input → same output on every host, so two machines migrating the
 *             same board converge on identical records.
 *
 *             What changes shape (and why the board still LOOKS the same):
 *               • anchored text        → the host shape's embedded `label`
 *               • rect/ellipse/polygon → `shape` + `kind` (ellipse becomes a box)
 *               • section membership   → computed ONCE with the v1 drag rule
 *                                        (bbox centre inside, inclusive; the
 *                                        smallest containing section wins, so
 *                                        visually nested sections nest), then
 *                                        coordinates become parent-relative
 *               • array order          → fractional `index` per parent
 *               • bound arrow ends     → `{el}` (auto) / `{el,nx,ny}` (pinned);
 *                                        the stored v1 endpoints are dropped
 *               • standalone text box  → v1's estimated bbox, stored (the editor
 *                                        re-measures it on the next edit)
 *             Nothing is dropped silently: every element that cannot be carried
 *             over is listed in `report`.
 */

import {
  type AnchorHost,
  type Stroke,
  sanitizeAnnotationSvg,
  strokeBBox,
  strokesFromDocument,
} from '../annotations-model.ts';
import { MAX_PEN_POINTS } from './constants.ts';
import { keysBetween } from './fractional-index.ts';
import { parseMiniDom } from './legacy/mini-dom.ts';
import { defOf } from './registry.ts';
import { type Dropped, validateElements } from './schema.ts';
import type { AnnotationElement, Box } from './types.ts';

export interface MigrationResult {
  elements: AnnotationElement[];
  report: Dropped[];
}

/** Parse a legacy `.annotations.svg` (sanitized first, DOM-free) into v1 strokes. */
export function parseLegacySvg(svg: string): Stroke[] {
  const clean = sanitizeAnnotationSvg(svg ?? '');
  if (!clean.trim()) return [];
  return strokesFromDocument(parseMiniDom(clean));
}

/** Legacy SVG text → v2 elements. */
export function migrateSvg(svg: string): MigrationResult {
  return v1ToV2(parseLegacySvg(svg));
}

function normBox(x: number, y: number, w: number, h: number): Box {
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

function author(s: Stroke): Record<string, unknown> | undefined {
  if (s.author === 'ai') return { kind: 'ai' };
  if (s.authorName || s.authorId) {
    return {
      kind: 'human',
      ...(s.authorName ? { name: s.authorName } : {}),
      ...(s.authorId ? { id: s.authorId } : {}),
    };
  }
  return undefined;
}

function textStyle(s: {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  listType?: string;
  align?: string;
}): Record<string, unknown> {
  return {
    bold: s.bold,
    italic: s.italic,
    strike: s.strike,
    underline: s.underline,
    list: s.listType,
    align: s.align,
  };
}

/** Pen points, decimated to the v2 cap if a v1 stroke exceeded it. */
function penPoints(points: ReadonlyArray<readonly [number, number]>): number[] {
  const step = Math.ceil(points.length / MAX_PEN_POINTS) || 1;
  const out: number[] = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i] as readonly [number, number];
    out.push(p[0], p[1]);
  }
  const lastP = points[points.length - 1];
  if (step > 1 && lastP && (out[out.length - 2] !== lastP[0] || out[out.length - 1] !== lastP[1])) {
    out.push(lastP[0], lastP[1]);
  }
  return out;
}

export interface V1ToV2Opts {
  /**
   * Skip section membership: every element stays top level in WORLD
   * coordinates. The v1 adapter (v1-adapter.ts) decides parents itself from
   * the current board, so an unmoved element keeps its parent.
   */
  flat?: boolean;
}

export function v1ToV2(strokes: readonly Stroke[], opts: V1ToV2Opts = {}): MigrationResult {
  const report: Dropped[] = [];
  const byId = new Map<string, Stroke>();
  for (const s of strokes) if (!byId.has(s.id)) byId.set(s.id, s);
  const isShape = (s: Stroke | undefined): s is AnchorHost =>
    !!s && (s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon');

  // 1. Anchored text → the host's label (first wins; extras become standalone text).
  const labelOf = new Map<string, Extract<Stroke, { tool: 'text' }>>();
  const extraText: Array<{ t: Extract<Stroke, { tool: 'text' }>; at: Box }> = [];
  for (const s of strokes) {
    if (s.tool !== 'text' || !s.anchorId) continue;
    const host = byId.get(s.anchorId);
    if (!isShape(host)) {
      report.push({
        id: s.id,
        reason: 'anchored text without a shape host (not rendered in v1) — dropped',
      });
      continue;
    }
    if (!labelOf.has(host.id)) labelOf.set(host.id, s);
    else {
      const bb = strokeBBox(host) as Box;
      extraText.push({ t: s, at: bb });
      report.push({ id: s.id, reason: 'second label on one shape — kept as standalone text' });
    }
  }

  // 2. World boxes (v1 geometry) for membership + relative coordinates.
  const kept = strokes.filter(
    (s) => !(s.tool === 'text' && s.anchorId && byId.has(s.id) && s.anchorId !== '')
  );
  const worldBox = new Map<string, Box>();
  for (const s of kept) {
    const bb = strokeBBox(s);
    if (bb) worldBox.set(s.id, normBox(bb.x, bb.y, bb.w, bb.h));
  }
  for (const { t, at } of extraText) worldBox.set(t.id, at);

  // 3. Section membership: smallest section whose box contains the centre
  //    (inclusive) AND that the element painted ABOVE in v1. A child always
  //    paints over its container in v2, so adopting an element that sat UNDER
  //    a section (a backing paper, a big shape) would change what the user sees.
  const sections = kept.filter((s) => s.tool === 'section');
  const zOf = new Map(strokes.map((s, i) => [s.id, i]));
  const area = (b: Box) => b.w * b.h;
  const parentOf = new Map<string, string>();
  const containerFor = (id: string, b: Box, selfArea: number | null): string | undefined => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    let best: { id: string; area: number } | null = null;
    for (const sec of sections) {
      if (sec.id === id) continue;
      if ((zOf.get(sec.id) ?? 0) >= (zOf.get(id) ?? Number.POSITIVE_INFINITY)) continue;
      const sb = worldBox.get(sec.id);
      if (!sb) continue;
      // A section only nests inside a strictly larger one (no cycles by construction).
      if (selfArea !== null && area(sb) <= selfArea) continue;
      if (cx < sb.x || cx > sb.x + sb.w || cy < sb.y || cy > sb.y + sb.h) continue;
      // Equal size: the later-painted (nearest below) section wins.
      if (!best || area(sb) <= best.area) best = { id: sec.id, area: area(sb) };
    }
    return best?.id;
  };
  const all = [...kept.map((s) => s.id), ...extraText.map((e) => e.t.id)];
  for (const id of opts.flat ? [] : all) {
    const b = worldBox.get(id);
    if (!b) continue;
    const s = byId.get(id);
    const p = containerFor(id, b, s?.tool === 'section' ? area(b) : null);
    if (p) parentOf.set(id, p);
  }
  // World origin of a parent = its own world top-left.
  const originOf = (id: string): { x: number; y: number } => {
    const p = parentOf.get(id);
    if (!p) return { x: 0, y: 0 };
    const b = worldBox.get(p) as Box;
    return { x: b.x, y: b.y };
  };

  // 4. Fractional indexes per parent, in v1 array (paint) order.
  const order = new Map(strokes.map((s, i) => [s.id, i]));
  const siblings = new Map<string, string[]>();
  for (const id of all) {
    const key = parentOf.get(id) ?? '';
    const list = siblings.get(key);
    if (list) list.push(id);
    else siblings.set(key, [id]);
  }
  const indexOf = new Map<string, string>();
  for (const list of siblings.values()) {
    list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const keys = keysBetween(null, null, list.length);
    for (let i = 0; i < list.length; i++) indexOf.set(list[i] as string, keys[i] as string);
  }

  // 5. Emit records (raw; validateElements makes them canonical).
  const raw: Record<string, unknown>[] = [];
  const head = (s: Stroke) => {
    const o = originOf(s.id);
    return {
      o,
      base: {
        id: s.id,
        parent: parentOf.get(s.id),
        index: indexOf.get(s.id),
        groups: s.groupIds,
        author: author(s),
      } as Record<string, unknown>,
    };
  };
  const rel = (b: Box, o: { x: number; y: number }) => ({
    x: b.x - o.x,
    y: b.y - o.y,
    w: b.w,
    h: b.h,
  });
  const hostIds = new Set(
    kept.filter((s) => s.tool !== 'arrow' && s.tool !== 'pen').map((s) => s.id)
  );
  const arrowEnd = (
    bind: { hostId: string; nx: number; ny: number; pinned?: boolean } | undefined,
    x: number,
    y: number,
    o: { x: number; y: number }
  ) => {
    if (bind && hostIds.has(bind.hostId)) {
      return bind.pinned ? { el: bind.hostId, nx: bind.nx, ny: bind.ny } : { el: bind.hostId };
    }
    return { x: x - o.x, y: y - o.y };
  };

  for (const s of kept) {
    const { o, base } = head(s);
    const b = worldBox.get(s.id);
    const rot = s.rotation;
    switch (s.tool) {
      case 'pen':
        raw.push({
          ...base,
          type: 'pen',
          points: penPoints(s.points.map(([x, y]) => [x - o.x, y - o.y] as const)),
          color: s.color,
          width: s.width,
          highlighter: s.highlighter,
        });
        break;
      case 'rect':
      case 'ellipse':
      case 'polygon': {
        const label = labelOf.get(s.id);
        raw.push({
          ...base,
          type: 'shape',
          kind: s.tool === 'polygon' ? s.shape : s.tool,
          ...rel(b as Box, o),
          rot,
          color: s.color,
          width: s.width,
          fill: s.fill ?? null,
          radius: s.tool === 'rect' ? s.cornerRadius : undefined,
          dashed: s.dashed,
          label: label
            ? {
                text: label.text,
                fontSize: label.fontSize,
                color: label.color,
                ...textStyle(label),
              }
            : undefined,
        });
        break;
      }
      case 'arrow':
        raw.push({
          ...base,
          type: 'arrow',
          start: arrowEnd(s.startBind, s.x1, s.y1, o),
          end: arrowEnd(s.endBind, s.x2, s.y2, o),
          color: s.color,
          width: s.width,
          startHead: s.startHead,
          endHead: s.endHead,
          dashed: s.dashed,
          line: s.lineType,
        });
        break;
      case 'text':
        raw.push({
          ...base,
          type: 'text',
          ...rel(b as Box, o),
          rot,
          text: s.text,
          fontSize: s.fontSize,
          color: s.color,
          ...textStyle(s),
        });
        break;
      case 'sticky':
        raw.push({
          ...base,
          type: 'sticky',
          ...rel(b as Box, o),
          rot,
          fill: s.color,
          text: s.text,
          fontSize: s.fontSize,
          radius: s.cornerRadius,
          ...textStyle(s),
        });
        break;
      case 'image':
        raw.push({ ...base, type: 'image', ...rel(b as Box, o), rot, href: s.href, alt: s.alt });
        break;
      case 'link':
        raw.push({
          ...base,
          type: 'link',
          ...rel(b as Box, o),
          rot,
          url: s.url,
          title: s.title,
          domain: s.domain,
        });
        break;
      case 'mediaref':
        raw.push({
          ...base,
          type: 'mediaref',
          ...rel(b as Box, o),
          rot,
          src: s.src,
          media: s.mediaKind,
          title: s.title,
        });
        break;
      case 'section':
        raw.push({ ...base, type: 'section', ...rel(b as Box, o), label: s.label, color: s.color });
        break;
      case 'element': {
        // A registry type with no stroke form: its own record, moved into parent space.
        const def = defOf(s.el.type);
        if (!def) break;
        raw.push({ ...s.el, ...def.translate(s.el, -o.x, -o.y), ...base });
        break;
      }
    }
  }
  for (const { t, at } of extraText) {
    const { o, base } = head(t);
    raw.push({
      ...base,
      type: 'text',
      ...rel(at, o),
      text: t.text,
      fontSize: t.fontSize,
      color: t.color,
      ...textStyle(t),
    });
  }

  // Strip undefined so the validator sees absent fields.
  const clean = raw.map((r) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))
  );
  const v = validateElements(clean);
  return { elements: v.elements, report: [...report, ...v.dropped] };
}
