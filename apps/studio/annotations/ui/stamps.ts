/**
 * @file       annotations/ui/stamps.ts — vote stamps on the canvas: make, upsert, gather (S4.13)
 * @scope      apps/studio/annotations/ui/stamps.ts
 * @purpose    Pure model behind canvas 15 `an-stamps` (no React, no DOM):
 *               · `stampElement` — one person's stamp of one kind on one spot, with the deterministic id
 *                 `stamp-<spot>-<author>-<kind>` (contract S4 Q7), so a second stamp of the same kind by the
 *                 same person is an UPSERT of the same element on every peer;
 *               · `upsertStampStroke` — put it into the layer's stroke list (replace in place, never double);
 *               · `clusterStamps` — the faces + count the canvas draws. The count is derived: ONE per person
 *                 per kind per spot, whoever forged what id (a forged duplicate counts once);
 *               · `stampCardTitle` / `stampCardRows` — the hover card "5 stamps on Směr B" and its rows.
 *             A local author id can be forged — accepted: formal votes (S4.14) are the secure path.
 */

import { type ElementStroke, type Stroke, strokeHitTest } from '../../annotations-model.ts';
import { stampCell, stampId, stampSpotOf } from '../elements/stamp.model.ts';
import { stampKindById } from '../stamp-kinds.ts';
import type { AnnotationElement, Box } from '../types.ts';

/** World size of one stamp (a 28 px disc: canvas 15 draws 32 at 34 %…60 %, the glyph is the same hand). */
export const STAMP_BOX = 28;
/** A cluster shows this many faces; beyond it the rest is a number. */
export const MAX_FACES = 2;

export interface StampWho {
  name: string;
  id?: string;
}

const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The stamp `who` makes at world point (x, y). `target` = what it lands on (`ab:<artboard>`,
 * `el:<artboard>/<id>` or an annotation id); without one the spot is the 40 px world cell under the point.
 */
export function stampElement(o: {
  kind: string;
  who: StampWho;
  target?: string | null;
  x: number;
  y: number;
}): AnnotationElement {
  if (!KIND_RE.test(o.kind)) throw new Error(`stamp: "${o.kind}" is not a stamp word`);
  const name = o.who.name.trim();
  if (!name) throw new Error('stamp: who made it?');
  const spot = o.target || stampCell(o.x, o.y);
  const el: AnnotationElement = {
    id: stampId({ spot, author: name, kind: o.kind }),
    type: 'stamp',
    index: 'a0',
    x: o.x - STAMP_BOX / 2,
    y: o.y - STAMP_BOX / 2,
    w: STAMP_BOX,
    h: STAMP_BOX,
    kind: o.kind,
    author: { kind: 'human', name },
  };
  if (o.target) {
    el.target = o.target;
    if (o.target.startsWith('ab:')) el.parentArtboard = o.target.slice(3); // rides with its artboard (Q3)
  }
  return el;
}

/** The layer's stroke list with this stamp in it: replaced in place when it is already there, else on top. */
export function upsertStampStroke(strokes: readonly Stroke[], stamp: AnnotationElement): Stroke[] {
  const author = stamp.author as { name?: string } | undefined;
  const next: ElementStroke = {
    id: stamp.id,
    tool: 'element',
    el: stamp,
    ...(author?.name ? { authorName: author.name } : null),
  };
  const i = strokes.findIndex((s) => s.id === stamp.id);
  if (i < 0) return [...strokes, next];
  const out = strokes.slice();
  out[i] = next;
  return out;
}

export interface StampFace {
  id: string;
  kind: string;
  who: string;
}

export interface StampCluster {
  /** The target ref / annotation id, or the free stamps' world cell. */
  spot: string;
  target: string | null;
  /** World point of the cluster's left edge, vertical centre. */
  x: number;
  y: number;
  /** Stamps counted: one per person per kind. */
  count: number;
  /** The first `MAX_FACES`, in the gallery's kind order. */
  faces: StampFace[];
  /** More than the faces shown: the number is drawn. */
  showCount: boolean;
  /** Every counted stamp (one per person per kind), in the same order. */
  items: AnnotationElement[];
}

const whoOf = (el: AnnotationElement): string => {
  const a = el.author as { name?: unknown } | undefined;
  return typeof a?.name === 'string' && a.name ? a.name : 'Someone';
};

const kindRank = (kind: string): number => {
  const i = ['yes', 'no', 'star', 'heart', 'ask', 'plus'].indexOf(kind);
  return i < 0 ? 99 : i;
};

/**
 * The faces + count to draw. `hostBox` finds the world box of a bound target so its cluster sits on the
 * host's bottom edge; without it (or for a free stamp) the cluster is where its first stamp is.
 */
export function clusterStamps(
  elements: Iterable<AnnotationElement>,
  hostBox?: (target: string) => Box | null
): StampCluster[] {
  // one per (spot, person, kind) — the smallest id wins, so every peer keeps the same element
  const counted = new Map<string, AnnotationElement>();
  for (const el of elements) {
    if (el.type !== 'stamp' || typeof el.kind !== 'string' || !KIND_RE.test(el.kind)) continue;
    const key = JSON.stringify([stampSpotOf(el), whoOf(el), el.kind]);
    const held = counted.get(key);
    if (!held || el.id < held.id) counted.set(key, el);
  }
  const bySpot = new Map<string, AnnotationElement[]>();
  for (const el of counted.values()) {
    const spot = stampSpotOf(el);
    const list = bySpot.get(spot);
    if (list) list.push(el);
    else bySpot.set(spot, [el]);
  }
  const out: StampCluster[] = [];
  for (const [spot, list] of bySpot) {
    list.sort(
      (a, b) =>
        kindRank(a.kind as string) - kindRank(b.kind as string) ||
        whoOf(a).localeCompare(whoOf(b)) ||
        (a.id < b.id ? -1 : 1)
    );
    const target = typeof list[0]?.target === 'string' ? (list[0].target as string) : null;
    const host = target && hostBox ? hostBox(target) : null;
    const first = list[0] as AnnotationElement;
    const faces = list.slice(0, MAX_FACES).map((e) => ({
      id: e.id,
      kind: e.kind as string,
      who: whoOf(e),
    }));
    const shownW = faces.length * STAMP_BOX - (faces.length - 1) * 8;
    out.push({
      spot,
      target,
      x: host ? host.x + host.w / 2 - shownW / 2 : (first.x as number),
      y: host ? host.y + host.h : (first.y as number) + STAMP_BOX / 2,
      count: list.length,
      faces,
      showCount: list.length > MAX_FACES,
      items: list,
    });
  }
  return out.sort((a, b) => (a.spot < b.spot ? -1 : 1));
}

/** "5 stamps on Směr B" · "1 stamp on Směr B" · "2 stamps" (CONTRACT §4: a noun that reads for 1 and many). */
export function stampCardTitle(count: number, label: string): string {
  const noun = `${count} ${count === 1 ? 'stamp' : 'stamps'}`;
  return label ? `${noun} on ${label}` : noun;
}

export interface StampCardRow {
  id: string;
  kind: string;
  /** "You" for the signed-in person, else the name. */
  who: string;
  /** The stamp's name: Yes · Star · Love it … */
  name: string;
}

/** One row per counted stamp: you first, then people by name, each person's kinds in the gallery's order. */
export function stampCardRows(cluster: StampCluster, me?: string | null): StampCardRow[] {
  const rows = cluster.items.map((e) => {
    const name = whoOf(e);
    return {
      id: e.id,
      kind: e.kind as string,
      name: stampKindById(e.kind)?.name ?? (e.kind as string),
      who: me && name === me ? 'You' : name,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.who === 'You') - Number(a.who === 'You') ||
      a.who.localeCompare(b.who) ||
      kindRank(a.kind) - kindRank(b.kind) ||
      (a.id < b.id ? -1 : 1)
  );
}

/**
 * What a stamp put down at `at` (world) lands on: the topmost card under it (a sticky or a picture - its id),
 * else the artboard it is over (`ab:<id>`), else nothing (the stamp then takes the 40 px world cell).
 * Stamps and sections are never a target: you vote on a thing, not on a vote.
 */
export function stampTargetAt(
  at: { x: number; y: number },
  strokes: readonly Stroke[],
  artboards: readonly { id: string; x: number; y: number; w: number; h: number }[]
): string | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i] as Stroke;
    if ((s.tool === 'sticky' || s.tool === 'image') && strokeHitTest(s, at.x, at.y, 2)) return s.id;
  }
  const ab = artboards.find(
    (a) => at.x >= a.x && at.x <= a.x + a.w && at.y >= a.y && at.y <= a.y + a.h
  );
  return ab ? `ab:${ab.id}` : null;
}
