// V2-1.12 P2 — the whole-board replica writers and the hub kernel's three-way
// merge are lossless for extension fields, because both go through the shared
// registry.
//
// Probe E (before): the replica held v2 fields on `s1`; a 1.x op that patched
// `s2` re-wrote the whole validated board and deleted every key the validated
// `s1` lacked. Probe G (before): the hub kernel took a v2 proposal verbatim
// only when nothing raced; as soon as a concurrent edit forced the diff replay,
// `resolved` was stripped.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import * as lanes from '../../hub/src/project-transactions/lanes.mjs';
import { applyOpsToReplica, readReplica, writeReplica } from '../annotations/replica.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const el = (id: string, index: string, extra: Record<string, unknown> = {}) =>
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

const V2 = { folded: true, parentArtboard: 'hero', resolved: true, timeRange: { from: 1, to: 2 } };

describe('replica + kernel keep extension fields (P2)', () => {
  test('a 1.x-style op on s2 leaves s1’s v2 fields in the replica (probe E)', () => {
    const doc = new Y.Doc();
    const board = parseBoard(serializeBoard([el('s1', 'a0', V2), el('s2', 'a1')])).elements;
    writeReplica(doc, board);
    applyOpsToReplica(doc, [{ op: 'patch', id: 's2', set: { x: 50 } }]);
    const s1 = readReplica(doc)?.elements.find((e) => e.id === 's1') as Record<string, unknown>;
    expect(s1).toMatchObject(V2);
  });

  test('a patch that sets an extension field merges like any field', () => {
    const doc = new Y.Doc();
    writeReplica(doc, parseBoard(serializeBoard([el('s1', 'a0')])).elements);
    applyOpsToReplica(doc, [{ op: 'patch', id: 's1', set: { resolved: true } }]);
    expect(readReplica(doc)?.elements[0]).toMatchObject({ resolved: true });
  });

  test('the kernel’s concurrent merge keeps `resolved` (probe G)', () => {
    const base = serializeBoard([el('s1', 'a0'), el('s2', 'a1')]);
    const ours = serializeBoard([el('s1', 'a0', { resolved: true }), el('s2', 'a1')]); // v2: resolve a sticky
    const theirs = serializeBoard([el('s1', 'a0'), el('s2', 'a1', { x: 300 })]); // a peer moved another one
    const m = lanes.mergeLane('annotations', base, ours, theirs) as {
      ok: boolean;
      content: string;
    };
    expect(m.ok).toBe(true);
    const merged = parseBoard(m.content).elements;
    expect(merged.find((e) => e.id === 's1')).toMatchObject({ resolved: true });
    expect(merged.find((e) => e.id === 's2')).toMatchObject({ x: 300 });
  });
});
