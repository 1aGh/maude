// V2-1.12 §5.11 D1–D4 at the lane level — a v1 (compat) peer and a v2 peer
// editing the same canvas, through the SAME kernel merge the hub runs
// (`apps/hub/src/project-transactions/lanes.mjs`) and the same replica
// projection every desktop runs. Both directions (V1 → V2 and V2 → V1) and
// both acceptance orders, because sync is asymmetric (memory: test sync in
// both directions).
//
// What this does NOT cover (needs the hub H1–H5 + a compat build; the
// real-process matrix M1–M13 is `scripts/v2-mixed-peer.sh`, V2-2.18): the
// fence that makes an undeclared writer read-only, the 426 doors, the
// `maude.mode` notice.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import * as lanes from '../../hub/src/project-transactions/lanes.mjs';
import { readReplica, replicaBoardText, writeReplicaText } from '../annotations/replica.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const sticky = (id: string, index: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'sticky',
    index,
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    text: id,
    ...extra,
  }) as unknown as AnnotationElement;
/** v2's edit: R5 extension fields on s1 + a v2-only element type (R4). */
const V2_BOARD_EDIT = (base: AnnotationElement[]) => [
  { ...base[0], resolved: true, parentArtboard: 'hero' } as AnnotationElement,
  ...base.slice(1),
  {
    id: 'v1',
    type: 'vote-stamp',
    index: 'a9',
    x: 10,
    y: 10,
    by: 'tereza',
  } as unknown as AnnotationElement,
];
/** v1's edit: moves s2 (a field both understand). */
const V1_BOARD_EDIT = (base: AnnotationElement[]) =>
  base.map((e) => (e.id === 's2' ? ({ ...e, x: 300 } as AnnotationElement) : e));

const board = (els: AnnotationElement[]) =>
  serializeBoard(parseBoard(serializeBoard(els)).elements);

/** The kernel accepts `first`, then merges `second` (made on the same base). */
function accept(lane: 'annotations' | 'meta', base: string, first: string, second: string): string {
  const one = lanes.mergeLane(lane, base, first, base) as { ok: boolean; content: string };
  const two = lanes.mergeLane(lane, base, second, one.content) as { ok: boolean; content: string };
  expect(one.ok && two.ok).toBe(true);
  return two.content;
}

/** What a peer ends up holding: the accepted lane projected into its replica,
 *  and that replica written back out (its disk). */
function peerProjection(accepted: string): string {
  const doc = new Y.Doc();
  writeReplicaText(doc, accepted);
  return replicaBoardText(doc) ?? '';
}

describe('mixed v1/v2 peers — annotations lane', () => {
  const base = [sticky('s1', 'a0'), sticky('s2', 'a1')];
  const b0 = board(base);
  const v2 = board(V2_BOARD_EDIT(base));
  const v1 = board(V1_BOARD_EDIT(base));

  for (const order of ['v2 first', 'v1 first'] as const) {
    test(`${order}: both edits land; every peer's copy is byte-equal`, () => {
      const accepted =
        order === 'v2 first'
          ? accept('annotations', b0, v2, v1)
          : accept('annotations', b0, v1, v2);
      const els = parseBoard(accepted).elements;
      expect(els.find((e) => e.id === 's1')).toMatchObject({
        resolved: true,
        parentArtboard: 'hero',
      }); // V2 → V1
      expect(els.find((e) => e.id === 's2')).toMatchObject({ x: 300 }); // V1 → V2
      expect(els.find((e) => e.id === 'v1')?.type).toBe('vote-stamp'); // a new type round-trips
      // D2: the projection a compat desktop writes is the accepted bytes.
      expect(peerProjection(accepted)).toBe(accepted);
    });
  }

  test("a v1 peer's later edit of ANOTHER element keeps v2's fields in its replica (P2)", () => {
    const doc = new Y.Doc();
    writeReplicaText(doc, v2);
    const after = parseBoard(replicaBoardText(doc) ?? '').elements.map((e) =>
      e.id === 's2' ? ({ ...e, text: 'edited on 1.x' } as AnnotationElement) : e
    );
    writeReplicaText(doc, serializeBoard(after));
    expect(readReplica(doc)?.elements.find((e) => e.id === 's1')).toMatchObject({ resolved: true });
  });

  test("D3: the replica marker '~v' stays 2", () => {
    const doc = new Y.Doc();
    writeReplicaText(doc, v2);
    expect(doc.getMap('annotations2').get('~v')).toBe(2);
  });
});

describe('mixed v1/v2 peers — meta lane (R6)', () => {
  const m0 = JSON.stringify({
    title: 'Home',
    layout: {
      artboards: [
        { id: 'b0', x: 0, y: 0 },
        { id: 'b1', x: 900, y: 0 },
      ],
    },
  });
  const v2 = JSON.stringify({
    ...JSON.parse(m0),
    present: { order: ['b1', 'b0'] },
    artboardMeta: { b0: { notes: 'Opening' } },
  });
  const v1 = JSON.stringify({
    ...JSON.parse(m0),
    layout: {
      artboards: [
        { id: 'b0', x: 40, y: 0 },
        { id: 'b1', x: 900, y: 0 },
      ],
    },
  });
  for (const order of ['v2 first', 'v1 first'] as const) {
    test(`${order}: the v1 drag and the v2 top-level keys both survive`, () => {
      const accepted =
        order === 'v2 first' ? accept('meta', m0, v2, v1) : accept('meta', m0, v1, v2);
      const m = JSON.parse(accepted);
      expect(m.layout.artboards[0]).toMatchObject({ id: 'b0', x: 40 });
      expect(m.present).toEqual({ order: ['b1', 'b0'] });
      expect(m.artboardMeta).toEqual({ b0: { notes: 'Opening' } });
    });
  }
});
