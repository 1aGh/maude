// #113 slice A — an older (format-1) reader keeps checklist items (contract 113-checklist §4.3, §7;
// V2-1.12 R4). Under `withFormat1Reader` `checkitem` is an unknown type: not drawn, never dropped, never
// rewritten; a stroke-view write (the v1 UI path) carries the records untouched; sync keeps them both ways.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { itemsOf } from '../annotations/elements/checkitem.model.ts';
import { diffToOps } from '../annotations/ops.ts';
import { isKnownType, withFormat1Reader } from '../annotations/registry.ts';
import {
  applyOpsToReplica,
  readReplica,
  replicaBoardText,
  writeReplica,
  writeReplicaText,
} from '../annotations/replica.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';

const AT = '2026-11-08T10:12:00Z';
const v1 = <T>(fn: () => T): T => withFormat1Reader(fn);

const raw = (): Record<string, unknown>[] => [
  { id: 's1', type: 'sticky', index: 'a0', x: 0, y: 0, w: 220, h: 176, text: 'Launch' },
  { id: 'c1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
  {
    id: 'c2',
    type: 'checkitem',
    index: 'a1',
    list: 's1',
    text: 'Record the demo',
    done: { by: 'Jonas', at: AT },
  },
  { id: 's2', type: 'sticky', index: 'a1', x: 400, y: 0, w: 200, h: 200, text: 'plain' },
];
const board = (): AnnotationElement[] => validateElements(raw()).elements;

describe('a format-1 reader', () => {
  test('knows checkitem as an unknown type and keeps every record byte for byte', () => {
    expect(isKnownType('checkitem')).toBe(true);
    expect(v1(() => isKnownType('checkitem'))).toBe(false);
    const text = serializeBoard(board());
    const read = v1(() => parseBoard(text));
    expect(read.dropped).toEqual([]);
    expect(read.elements.map((e) => e.id).sort()).toEqual(['c1', 'c2', 's1', 's2']);
    expect(v1(() => serializeBoard(read.elements))).toBe(text);
  });

  test('draws the sticky (its title) and no item; the items are carried, not drawn', () => {
    const strokes = v1(() => elementsToStrokes(board()));
    expect(strokes.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  test('a stroke-view write from the v1 UI path keeps every item', () => {
    v1(() => {
      const committed = new Map(board().map((e) => [e.id, e]));
      const strokes = elementsToStrokes(committed.values());
      const moved = strokes.map((s) => (s.id === 's2' ? { ...s, x: 460 } : s));
      const next = strokesToElementMap(moved, committed);
      for (const id of ['c1', 'c2']) expect(next.get(id)).toEqual(committed.get(id));
      const ops = diffToOps(strokesToElementMap(strokes, committed), next);
      expect(ops).toEqual([{ op: 'patch', id: 's2', set: { x: 460 }, expect: { x: 400 } }]);
    });
  });

  test('a v1 peer deleting the sticky view deletes only what it drew', () => {
    v1(() => {
      const committed = new Map(board().map((e) => [e.id, e]));
      const strokes = elementsToStrokes(committed.values()).filter((s) => s.id !== 's1');
      const next = strokesToElementMap(strokes, committed);
      expect(next.has('c1')).toBe(true);
      expect(next.has('c2')).toBe(true);
      expect(next.has('s1')).toBe(false);
    });
  });
});

describe('sync with a format-1 peer, both directions', () => {
  function pair() {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array, o: unknown) => {
      if (o !== 'wire') Y.applyUpdate(b, u, 'wire');
    });
    b.on('update', (u: Uint8Array, o: unknown) => {
      if (o !== 'wire') Y.applyUpdate(a, u, 'wire');
    });
    return { a, b };
  }

  test('v2 → v1: the v1 peer holds the same bytes and re-importing them is a no-op', () => {
    const { a, b } = pair();
    writeReplica(a, board());
    const bytes = replicaBoardText(a) as string;
    expect(v1(() => replicaBoardText(b))).toBe(bytes);
    expect(v1(() => writeReplicaText(b, bytes))).toBe(false);
  });

  test('v1 edits the sticky text; the v2 peer keeps the items and ticks they carry', () => {
    const { a, b } = pair();
    writeReplica(a, board());
    const r = v1(() =>
      applyOpsToReplica(b, [{ op: 'patch', id: 's1', set: { text: 'Launch day' } }])
    );
    expect(r.rejected).toEqual([]);
    const got = readReplica(a)?.elements ?? [];
    expect(got.find((e) => e.id === 's1')?.text).toBe('Launch day');
    expect(itemsOf(got, 's1').map((e) => e.id)).toEqual(['c1', 'c2']);
    expect(itemsOf(got, 's1')[1]?.done).toEqual({ by: 'Jonas', at: AT });
  });

  test('v2 ticks while the v1 peer re-texts the sticky — the tick lands on the v1 peer too', () => {
    const { a, b } = pair();
    writeReplica(a, board());
    applyOpsToReplica(a, [{ op: 'patch', id: 'c1', set: { done: { by: 'Ana', at: AT } } }]);
    v1(() => applyOpsToReplica(b, [{ op: 'patch', id: 's1', set: { text: 'Launch!' } }]));
    const onV1 = v1(() => readReplica(b)?.elements ?? []);
    expect(onV1.find((e) => e.id === 'c1')?.done).toEqual({ by: 'Ana', at: AT });
    expect(onV1.find((e) => e.id === 's1')?.text).toBe('Launch!');
    expect(v1(() => replicaBoardText(b))).toBe(replicaBoardText(a) as string);
  });
});
