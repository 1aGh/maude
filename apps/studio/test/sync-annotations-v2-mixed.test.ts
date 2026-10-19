// S4.1 / standing rule 15 — a format-1 peer and a format-2 peer on the same
// board over the in-memory Yjs transport, in BOTH directions (memory: sync is
// asymmetric; test it both ways). The format-1 peer runs the registry under
// `withFormat1Reader` — every format-2 field is an opaque preserved key, every
// format-2 type an unknown type — which is what a 1.x peer with the V2-2.14
// lossless readers does.
//
//   v2 → v1: the v1 peer keeps everything it does not understand, renders what
//            it does (an arrow bound to an artboard draws frozen at its cached
//            ends), edits what it knows, and its disk projection is the v2
//            peer's exact bytes (R5 — lane hashes agree).
//   v1 → v2: a format-1 board reads whole on v2 with nothing invented, and v2
//            data added concurrently with a v1 edit of the same element merges.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { ballotId } from '../annotations/elements/ballot.model.ts';
import { stampId } from '../annotations/elements/stamp.model.ts';
import { voteResultId } from '../annotations/elements/vote.model.ts';
import { diffToOps } from '../annotations/ops.ts';
import { withFormat1Reader } from '../annotations/registry.ts';
import {
  applyOpsToReplica,
  readReplica,
  replicaBoardText,
  writeReplica,
  writeReplicaText,
} from '../annotations/replica.ts';
import { serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { castOps, endOps, startOps } from '../annotations/votes-local.ts';

const AT = '2026-10-01T10:00:00Z';
const v1 = <T>(fn: () => T): T => withFormat1Reader(fn);

/** Two docs joined by the in-memory transport; `cut()` partitions them, `heal()` re-syncs. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  let live = true;
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (live && origin !== 'wire') Y.applyUpdate(b, u, 'wire');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (live && origin !== 'wire') Y.applyUpdate(a, u, 'wire');
  });
  return {
    a,
    b,
    cut: () => {
      live = false;
    },
    heal: () => {
      live = true;
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'wire');
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'wire');
    },
  };
}

const base = (): Record<string, unknown>[] => [
  { id: 's1', type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 120, text: 'one' },
  { id: 's2', type: 'sticky', index: 'a1', x: 300, y: 0, w: 200, h: 120, text: 'two' },
  { id: 'ar', type: 'arrow', index: 'a2', start: { x: 200, y: 60 }, end: { x: 900, y: 60 } },
];

/** The format-2 additions a v2 peer makes to `base()`. */
const format2 = (): Record<string, unknown>[] => {
  const [s1, s2, ar] = base() as [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  return [
    {
      ...s1,
      parentArtboard: 'hero',
      resolved: { by: 'Jonas', at: AT },
      timeRange: { artboard: 'reel', start: 0, end: 2 },
    },
    { ...s2, source: { kind: 'figjam', author: 'Ana' } },
    {
      ...ar,
      endHost: { ref: 'ab:mobile', label: 'Mobile', box: { x: 880, y: 0, w: 390, h: 844 } },
    },
    { id: 'sec', type: 'section', index: 'a3', x: 0, y: 400, w: 600, h: 300, folded: true },
    {
      id: stampId({ spot: 's1', author: 'u_ana', kind: 'heart' }),
      type: 'stamp',
      index: 'a4',
      x: 180,
      y: 0,
      w: 32,
      h: 32,
      kind: 'heart',
      target: 's1',
    },
    { id: 'vote1', type: 'vote', index: 'a5', targets: ['ab:dir-a', 'ab:dir-b'] },
    {
      id: ballotId('vote1', 'u_ana'),
      type: 'ballot',
      index: 'a6',
      vote: 'vote1',
      voter: 'u_ana',
      picks: { 'ab:dir-a': 2 },
    },
  ];
};

const els = (doc: Y.Doc) => new Map((readReplica(doc)?.elements ?? []).map((e) => [e.id, e]));
const canonical = (raw: Record<string, unknown>[]) => validateElements(raw).elements;

describe('v2 → v1 (a format-1 peer receives a format-2 board)', () => {
  test('the v1 peer keeps every field and type, and projects the v2 peer’s exact bytes', () => {
    const { a, b } = pair();
    writeReplica(a, canonical(format2()));
    const v2Bytes = replicaBoardText(a) as string;
    const read = v1(() => readReplica(b));
    expect(read?.dropped).toEqual([]);
    expect(read?.elements.map((e) => e.id).sort()).toEqual(
      format2()
        .map((e) => e.id as string)
        .sort()
    );
    // R5: the v1 disk projection == the v2 one, byte for byte (DDR-241 lane hashes agree).
    expect(v1(() => replicaBoardText(b))).toBe(v2Bytes);
    // Re-importing its own projection from disk is a no-op (nothing to "fix").
    expect(v1(() => writeReplicaText(b, v2Bytes))).toBe(false);
  });

  test('R2: the v1 UI draws a bound arrow frozen at its cached ends, and no vote/ballot', () => {
    const { a, b } = pair();
    writeReplica(a, canonical(format2()));
    const strokes = v1(() => elementsToStrokes(readReplica(b)?.elements ?? []));
    const arrow = strokes.find((s) => s.id === 'ar') as unknown as Record<string, unknown>;
    expect(arrow).toMatchObject({ x1: 200, y1: 60, x2: 900, y2: 60 });
    expect(arrow.endBind).toBeUndefined(); // an `ab:` host is not an annotation bind
    // format-2 types are unknown to v1: not drawn as strokes, carried as-is
    expect(strokes.some((s) => ['vote1', ballotId('vote1', 'u_ana')].includes(s.id))).toBe(false);
  });

  test('the v1 peer edits what it knows — the v2 peer keeps its fields on the SAME element', () => {
    const { a, b } = pair();
    writeReplica(a, canonical(format2()));
    // v1: re-text s1 (which carries v2 fields), move s2, move the arrow's free end.
    const r = v1(() =>
      applyOpsToReplica(b, [
        { op: 'patch', id: 's1', set: { text: 'edited on 1.x' } },
        { op: 'patch', id: 's2', set: { x: 340 } },
        { op: 'patch', id: 'ar', set: { end: { x: 920, y: 60 } } },
      ])
    );
    expect(r.rejected).toEqual([]);
    const got = els(a);
    expect(got.get('s1')).toMatchObject({
      text: 'edited on 1.x',
      parentArtboard: 'hero',
      resolved: { by: 'Jonas', at: AT },
      timeRange: { artboard: 'reel', start: 0, end: 2 },
    });
    expect(got.get('s2')).toMatchObject({ x: 340, source: { kind: 'figjam', author: 'Ana' } });
    expect(got.get('ar')).toMatchObject({ end: { x: 920, y: 60 }, endHost: { ref: 'ab:mobile' } });
    for (const id of ['sec', 'vote1', ballotId('vote1', 'u_ana')]) expect(got.has(id)).toBe(true);
  });

  test('the v1 peer’s whiteboard UI round trip (strokes → board) loses nothing', () => {
    const { a, b } = pair();
    writeReplica(a, canonical(format2()));
    v1(() => {
      const committed = els(b);
      const strokes = elementsToStrokes(committed.values());
      const moved = strokes.map((s) => (s.id === 's2' ? { ...s, x: 360 } : s));
      const ops = diffToOps(
        strokesToElementMap(strokes, committed),
        strokesToElementMap(moved, committed)
      );
      expect(ops).toEqual([{ op: 'patch', id: 's2', set: { x: 360 }, expect: { x: 300 } }]);
      applyOpsToReplica(b, ops);
    });
    expect(els(a).get('s2')).toMatchObject({ x: 360, source: { kind: 'figjam' } });
    expect(els(a).size).toBe(format2().length);
  });
});

describe('v1 → v2 (a format-2 peer receives a format-1 board)', () => {
  test('a format-1 board reads whole on v2, nothing invented, byte-equal', () => {
    const { a, b } = pair();
    v1(() => writeReplica(b, canonical(base())));
    const read = readReplica(a);
    expect(read?.dropped).toEqual([]);
    expect(replicaBoardText(a)).toBe(v1(() => replicaBoardText(b)) as string);
    for (const el of read?.elements ?? [])
      for (const k of ['parentArtboard', 'resolved', 'source', 'timeRange', 'startHost', 'endHost'])
        expect(k in el).toBe(false);
  });

  test('concurrent: v2 resolves + votes while v1 re-texts the same sticky — both land, both ways', () => {
    for (const first of ['v2', 'v1'] as const) {
      const { a, b, cut, heal } = pair();
      v1(() => writeReplica(b, canonical(base())));
      cut();
      const v2Edit = () =>
        applyOpsToReplica(a, [
          {
            op: 'patch',
            id: 's1',
            set: { resolved: { by: 'Jonas', at: AT }, parentArtboard: 'hero' },
          },
          { op: 'patch', id: 'ar', set: { startHost: { ref: 'el:hero/cta', label: 'CTA' } } },
          ...canonical(format2().slice(5)).map((el) => ({ op: 'put' as const, el })),
        ]);
      const v1Edit = () =>
        v1(() => applyOpsToReplica(b, [{ op: 'patch', id: 's1', set: { text: 'v1 text' } }]));
      if (first === 'v2') {
        expect(v2Edit().rejected).toEqual([]);
        expect(v1Edit().rejected).toEqual([]);
      } else {
        expect(v1Edit().rejected).toEqual([]);
        expect(v2Edit().rejected).toEqual([]);
      }
      heal();
      const onV2 = els(a);
      expect(onV2.get('s1')).toMatchObject({
        text: 'v1 text',
        resolved: { by: 'Jonas', at: AT },
        parentArtboard: 'hero',
      });
      expect(onV2.get('ar')?.startHost).toEqual({ ref: 'el:hero/cta', label: 'CTA' });
      expect(onV2.get(ballotId('vote1', 'u_ana'))?.picks).toEqual({ 'ab:dir-a': 2 });
      // …and the v1 peer holds the same bytes.
      expect(v1(() => replicaBoardText(b))).toBe(replicaBoardText(a) as string);
    }
  });

  test('two voters cast concurrently: two ballot elements, neither overwrites the other', () => {
    const { a, b, cut, heal } = pair();
    writeReplica(a, canonical(format2().slice(5, 6))); // the vote only
    cut();
    const cast = (doc: Y.Doc, voter: string, pick: string) =>
      applyOpsToReplica(doc, [
        {
          op: 'put',
          el: canonical([
            {
              id: ballotId('vote1', voter),
              type: 'ballot',
              index: 'a9',
              vote: 'vote1',
              voter,
              picks: { [pick]: 1 },
            },
          ])[0] as AnnotationElement,
        },
      ]);
    cast(a, 'u_ana', 'ab:dir-a');
    cast(b, 'u_jonas', 'ab:dir-b');
    heal();
    const ballots = [...els(a).values()]
      .filter((e) => e.type === 'ballot')
      .map((e) => e.voter)
      .sort();
    expect(ballots).toEqual(['u_ana', 'u_jonas']);
    expect(serializeBoard(readReplica(b)?.elements ?? [])).toBe(replicaBoardText(a) as string);
  });

  // S4.14 — a vote ended on v2 (the counts on the vote element, `expected`, the result section and its
  // text member — annotations/votes-local.ts endOps) reaches a v1 peer whole, both ways, and the v1
  // peer reads the result as an ordinary section + text (what a 1.x reader and AI see).
  test('an ended vote + its result section survive a v1 peer both ways', () => {
    const { a, b } = pair();
    const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);
    const start = startOps(
      [],
      { targets: ['ab:dir-a', 'ab:dir-b'], title: 'Helmy', expected: 3 },
      'You',
      T0,
      'vote-abcdefghij'
    );
    if ('refused' in start) throw new Error('start refused');
    let board = canonical([start.vote as Record<string, unknown>]);
    const cast = castOps(board, 'vote-abcdefghij', 'u_ana', { 'ab:dir-a': 2 }, T0 + 1000);
    if ('refused' in cast) throw new Error('cast refused');
    board = canonical([
      ...board,
      ...cast.ops.flatMap((o) => (o.op === 'put' ? [o.el] : [])),
    ] as never);
    const end = endOps(board, 'vote-abcdefghij', 'ui/j.tsx', T0 + 60_000, {
      labels: { 'ab:dir-a': 'A' },
    });
    if ('refused' in end) throw new Error('end refused');
    writeReplica(a, board);
    applyOpsToReplica(a, end.ops);
    const v2Bytes = replicaBoardText(a) as string;
    expect(v1(() => replicaBoardText(b))).toBe(v2Bytes);
    const onV1 = v1(() => els(b));
    expect(onV1.get('vote-abcdefghij')?.tallies).toEqual({ 'ab:dir-a': 2 });
    expect(onV1.get('vote-abcdefghij')?.expected).toBe(3);
    const sec = onV1.get(voteResultId('vote-abcdefghij'));
    expect(sec?.label).toBe('Vote · Helmy · 1 Oct');
    // v1 re-texts the result; v2 keeps it and every vote field
    v1(() =>
      applyOpsToReplica(b, [
        {
          op: 'patch',
          id: `${voteResultId('vote-abcdefghij')}-t`,
          set: { text: 'A · 2 (checked)' },
        },
      ])
    );
    const onV2 = els(a);
    expect(onV2.get(`${voteResultId('vote-abcdefghij')}-t`)?.text).toBe('A · 2 (checked)');
    expect(onV2.get('vote-abcdefghij')?.state).toBe('ended');
    expect(onV2.get(ballotId('vote-abcdefghij', 'u_ana'))?.picks).toEqual({ 'ab:dir-a': 2 });
  });
});
