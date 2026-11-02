// S4.1 — the board's format-2 fields and types (contract S4 §2, V2-1.12 R1–R7).
//
// Every new field is an EXTENSION field: typed for a format-2 reader, opaque
// (and preserved) for a format-1 reader, serialized after the tail in sorted
// order so both readers write the same bytes (R5). New kinds are new types (R4).
// No existing field gains a shape (R3). The format-1 reading is the registry
// under `withFormat1Reader` — what a 1.x peer (V2-2.14 lossless readers) does.

import { describe, expect, test } from 'bun:test';

import { annotationsJsonSchema } from '../annotations/board-schema.ts';
import { parseHostRef } from '../annotations/elements/_shared.ts';
import { ballotId, tallyBallots, visibleBallots } from '../annotations/elements/ballot.model.ts';
import { stampCell, stampId, stampSpotOf } from '../annotations/elements/stamp.model.ts';
import { voteResultId } from '../annotations/elements/vote.model.ts';
import { diffToOps } from '../annotations/ops.ts';
import {
  COMMON_EXT_FIELDS,
  extSpecOf,
  FORMAT2_TYPES,
  HEAD_FIELDS,
  isKnownType,
  specOf,
  TAIL_FIELDS,
  validateElement,
  withFormat1Reader,
} from '../annotations/registry.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { elementsToStrokes, strokesToElementMap } from '../annotations/v1-adapter.ts';
import { validateBoard } from '../annotations/validate-board.ts';

const AT = '2026-10-01T10:00:00.000Z';
const host = (ref: string, extra: Record<string, unknown> = {}) => ({
  ref,
  label: 'Post 1:1',
  ...extra,
});

/** One element of every format-2 shape, as a format-2 writer emits it. */
const V2_ELEMENTS: Record<string, unknown>[] = [
  {
    id: 's1',
    type: 'sticky',
    index: 'a0',
    x: 10,
    y: 20,
    w: 200,
    h: 120,
    text: 'make it bigger',
    author: { kind: 'human', name: 'Tereza', id: 'u-tereza' },
    parentArtboard: 'post-1x1',
    resolved: { by: 'Jonas', at: AT },
    source: { kind: 'figjam', author: 'Ana' },
    timeRange: { artboard: 'reel', start: 1.5, end: 3.25 },
  },
  {
    id: 'sec',
    type: 'section',
    index: 'a1',
    x: 0,
    y: 400,
    w: 600,
    h: 400,
    label: 'Ideas',
    folded: true,
    parentArtboard: 'post-1x1',
  },
  {
    id: 'ar',
    type: 'arrow',
    index: 'a2',
    start: { x: 210, y: 80 },
    end: { x: 900, y: 300 },
    startHost: host('el:post-1x1/hero-cta#2', { nx: 1, ny: 0.5 }),
    endHost: host('ab:mobile', { box: { x: 880, y: 0, w: 390, h: 844 } }),
  },
  {
    id: 'img',
    type: 'image',
    index: 'a3',
    x: 50,
    y: 50,
    w: 160,
    h: 160,
    href: 'assets/0123abcd.png',
    sticker: { pack: 'figjam-doodle', id: 'star', flip: true },
  },
  {
    id: stampId({ spot: 's1', author: 'u_tereza', kind: 'heart' }),
    type: 'stamp',
    index: 'a4',
    x: 190,
    y: 10,
    w: 32,
    h: 32,
    kind: 'heart',
    target: 's1',
    author: { kind: 'human', name: 'Tereza', id: 'u_tereza' },
  },
  {
    id: 'vote1',
    type: 'vote',
    index: 'a5',
    targets: ['ab:dir-a', 'ab:dir-b', 'ab:dir-c'],
    title: 'Vote 3 directions',
    startedBy: 'Tereza',
    startedAt: AT,
    endsAt: '2026-10-01T10:02:00.000Z',
  },
  {
    id: ballotId('vote1', 'u_jonas'),
    type: 'ballot',
    index: 'a6',
    vote: 'vote1',
    voter: 'u_jonas',
    picks: { 'ab:dir-a': 2, 'ab:dir-c': 1 },
    castAt: AT,
  },
];

const canon = (raw: Record<string, unknown>) => {
  const r = validateElement(raw);
  if (!r.ok) throw new Error(`${raw.id}: ${r.reason}`);
  return r.el;
};
const format1 = (raw: Record<string, unknown>) => withFormat1Reader(() => canon(raw));

describe('format-2 fields parse, round-trip, and are typed', () => {
  test('every element keeps every format-2 field through a format-2 read', () => {
    for (const raw of V2_ELEMENTS) {
      const el = canon(raw);
      for (const k of Object.keys(raw)) expect(el[k]).toEqual(raw[k] as never);
    }
  });

  test('canonical form is a fixed point (parse ∘ serialize ∘ parse)', () => {
    const once = serializeBoard(V2_ELEMENTS.map(canon));
    const parsed = parseBoard(once);
    expect(parsed.dropped).toEqual([]);
    expect(serializeBoard(parsed.elements)).toBe(once);
  });

  test('a format-2 field with an invalid value is dropped, never resurrected as opaque', () => {
    const el = canon({
      id: 's',
      type: 'sticky',
      index: 'a0',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      resolved: true, // not {by, at}
      parentArtboard: 'has space',
      timeRange: { artboard: 'reel', start: 5, end: 1 }, // reversed
      source: { kind: 'Not A Word' },
    });
    for (const k of ['resolved', 'parentArtboard', 'timeRange', 'source'])
      expect(el[k]).toBeUndefined();
  });

  test('R1: a default value is omitted; absence is the previous behaviour', () => {
    const el = canon({
      id: 'x',
      type: 'section',
      index: 'a0',
      x: 0,
      y: 0,
      w: 99,
      h: 99,
      folded: false,
    });
    expect('folded' in el).toBe(false);
    const flip = canon({
      id: 'i',
      type: 'image',
      index: 'a0',
      x: 0,
      y: 0,
      w: 40,
      h: 40,
      sticker: { pack: 'p', id: 'q', flip: false },
    });
    expect(flip.sticker).toEqual({ pack: 'p', id: 'q' });
  });

  test('a half-specified magnet on a canvas host collapses to none; refs must be durable', () => {
    const ar = canon({
      id: 'a',
      type: 'arrow',
      index: 'a0',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
      startHost: { ref: 'ab:hero', label: 'Hero', nx: 1 },
      endHost: { ref: 'el:hero/0a1b2c3d', label: 'computed id' }, // never durable (V2-1.4)
    });
    expect(ar.startHost).toEqual({ ref: 'ab:hero', label: 'Hero' });
    expect(ar.endHost).toBeUndefined();
    expect(parseHostRef('el:post-1x1/hero-cta#2')).toEqual({
      kind: 'el',
      artboard: 'post-1x1',
      element: 'hero-cta',
      occurrence: 2,
    });
    expect(parseHostRef('ab:')).toBeNull();
    expect(parseHostRef('el:hero')).toBeNull();
    expect(parseHostRef('el:hero/Hero')).toBeNull();
    expect(parseHostRef('xy:hero')).toBeNull();
  });

  test('stamp / vote / ballot are registered types and the strict schema accepts the canonical board', () => {
    for (const t of ['stamp', 'vote', 'ballot']) expect(isKnownType(t)).toBe(true);
    expect([...FORMAT2_TYPES].sort()).toEqual(['ballot', 'stamp', 'vote']);
    const text = serializeBoard(V2_ELEMENTS.map(canon));
    const res = validateBoard(text, { strict: true, against: null });
    // Only the author rule may fire (a new element must be `author.kind: ai`).
    expect(res.errors.filter((e) => !/author/.test(`${e.code} ${e.what}`))).toEqual([]);
    const defs = (annotationsJsonSchema() as { $defs: Record<string, { properties: object }> })
      .$defs;
    expect(Object.keys(defs['el-arrow']?.properties ?? {})).toContain('startHost');
    expect(Object.keys(defs['el-sticky']?.properties ?? {})).toContain('parentArtboard');
  });
});

describe('R5 — a format-1 reader writes the format-2 reader’s exact bytes', () => {
  test('per element and per board, byte-equal', () => {
    for (const raw of V2_ELEMENTS) {
      const written = canon(raw); // what a format-2 writer puts on disk
      expect(JSON.stringify(format1(JSON.parse(JSON.stringify(written))))).toBe(
        JSON.stringify(written)
      );
    }
    const v2 = serializeBoard(V2_ELEMENTS.map(canon));
    const v1 = withFormat1Reader(() => serializeBoard(parseBoard(v2).elements));
    expect(v1).toBe(v2);
  });

  test('extension fields sit after the tail, sorted, interleaved with unknown keys', () => {
    const el = canon({ ...(V2_ELEMENTS[0] as object), zz_future: 1, aa_future: 2 });
    const keys = Object.keys(el);
    const tailAt = Math.max(...Object.keys(TAIL_FIELDS).map((k) => keys.indexOf(k)));
    const after = keys.slice(tailAt + 1);
    expect(after).toEqual([...after].sort());
    expect(after).toEqual([
      'aa_future',
      'parentArtboard',
      'resolved',
      'source',
      'timeRange',
      'zz_future',
    ]);
  });

  test('a format-2 type serializes its non-head keys sorted — the unknown-type order', () => {
    for (const raw of V2_ELEMENTS.filter((e) => FORMAT2_TYPES.has(e.type as string))) {
      const keys = Object.keys(canon(raw)).slice(3); // after id, type, index (no parent here)
      expect(keys).toEqual([...keys].sort());
    }
  });

  test('format-2 types read as unknown types under format 1 — kept verbatim', () => {
    const v2 = serializeBoard(V2_ELEMENTS.map(canon));
    withFormat1Reader(() => {
      for (const t of FORMAT2_TYPES) expect(isKnownType(t)).toBe(false);
      const { elements, dropped } = parseBoard(v2);
      expect(dropped).toEqual([]);
      expect(elements.map((e) => e.type).sort()).toEqual(
        V2_ELEMENTS.map((e) => e.type as string).sort()
      );
    });
    expect(isKnownType('vote')).toBe(true); // the scope ends with the call
  });
});

describe('R3 — no new shape in a format-1 field', () => {
  /** The format-1 field sets, frozen. A format-2 field added here instead of to
   *  `ext` would serialize in spec order and break R5. */
  const FORMAT1_KEYS: Record<string, string[]> = {
    sticky: [
      'x',
      'y',
      'w',
      'h',
      'rot',
      'fill',
      'text',
      'fontSize',
      'radius',
      'bold',
      'italic',
      'strike',
      'underline',
      'list',
      'align',
    ],
    section: ['x', 'y', 'w', 'h', 'label', 'color'],
    arrow: ['start', 'end', 'color', 'width', 'startHead', 'endHead', 'dashed', 'line'],
    image: ['x', 'y', 'w', 'h', 'rot', 'href', 'alt'],
  };

  test('the format-1 field sets are unchanged', () => {
    const frame = [...Object.keys(HEAD_FIELDS), ...Object.keys(TAIL_FIELDS)];
    for (const [type, keys] of Object.entries(FORMAT1_KEYS)) {
      const own = Object.keys(specOf(type) ?? {}).filter((k) => !frame.includes(k));
      expect(own).toEqual(keys);
    }
  });

  test('a format-2 arrow still parses as a format-1 arrow: start/end are free points', () => {
    const ar = format1(V2_ELEMENTS[2] as Record<string, unknown>);
    expect(ar.start).toEqual({ x: 210, y: 80 });
    expect(ar.end).toEqual({ x: 900, y: 300 });
    // A host in an OLD field is the shape R3 forbids — and format 1 drops the arrow for it (probe B).
    const bad = withFormat1Reader(() =>
      validateElement({
        id: 'b',
        type: 'arrow',
        index: 'a0',
        start: { el: 'ab:hero' },
        end: { x: 1, y: 1 },
      })
    );
    expect(bad.ok).toBe(false);
  });

  test('no extension key shadows a format-1 field, and every key is field-shaped', () => {
    for (const t of [
      'sticky',
      'text',
      'shape',
      'arrow',
      'pen',
      'image',
      'link',
      'mediaref',
      'section',
      'stamp',
      'vote',
      'ballot',
    ]) {
      const ext = extSpecOf(t) ?? {};
      for (const k of Object.keys(COMMON_EXT_FIELDS)) expect(Object.hasOwn(ext, k)).toBe(true);
      for (const k of Object.keys(ext)) {
        expect(Object.hasOwn(specOf(t) ?? {}, k)).toBe(false);
        expect(k).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/);
      }
    }
  });
});

describe('the whiteboard UI seam (v1-adapter) is lossless for format-2 data', () => {
  test('board → strokes → board is the identity: no unset of an extension field, votes carried', () => {
    const board = new Map(V2_ELEMENTS.map(canon).map((e) => [e.id, e]));
    const strokes = elementsToStrokes(board.values());
    // metadata records (vote, ballot) are never drawn
    expect(strokes.some((s) => s.id === 'vote1' || s.id.startsWith('ballot-'))).toBe(false);
    expect(diffToOps(board, strokesToElementMap(strokes, board))).toEqual([]);
  });

  test('a UI move of a sticky keeps its membership, resolution and time pin', () => {
    const board = new Map(V2_ELEMENTS.map(canon).map((e) => [e.id, e]));
    const strokes = elementsToStrokes(board.values()).map((s) =>
      s.id === 's1' ? ({ ...s, x: 40 } as typeof s) : s
    );
    const next = strokesToElementMap(strokes, board);
    expect(next.get('s1')).toMatchObject({
      x: 40,
      parentArtboard: 'post-1x1',
      resolved: { by: 'Jonas', at: AT },
      timeRange: { artboard: 'reel', start: 1.5, end: 3.25 },
    });
  });
});

describe('deterministic ids (contract S4 Q5 / Q7)', () => {
  test('one stamp per person, kind and spot — a second drop is the same element', () => {
    const a = stampId({ spot: 's1', author: 'u_tereza', kind: 'heart' });
    expect(a).toBe('stamp-s1-u_tereza-heart');
    expect(stampId({ spot: 's1', author: 'u_tereza', kind: 'heart' })).toBe(a);
    expect(stampId({ spot: 's1', author: 'u_jonas', kind: 'heart' })).not.toBe(a);
    expect(stampId({ spot: 's1', author: 'u_tereza', kind: 'plus-one' })).not.toBe(a);
    // Ambiguous parts (a `-` after the first) take the digest form, still ≤ 64 and id-safe.
    const x = stampId({ spot: 'a', author: 'b-c', kind: 'd' });
    const y = stampId({ spot: 'a-b', author: 'c', kind: 'd' });
    expect(x).not.toBe(y);
    const long = stampId({ spot: 'el:post-1x1/hero-cta#2', author: 'x'.repeat(64), kind: 'check' });
    expect(long).toMatch(/^stamp-[0-9a-z]{14}$/);
  });

  test('a free stamp’s spot is its 40 px world cell', () => {
    expect(stampCell(0, 0)).toBe('c0_0');
    expect(stampCell(39.9, 80)).toBe('c0_2');
    expect(stampCell(-1, -41)).toBe('cn1_n2');
    const el = canon({
      id: 'st',
      type: 'stamp',
      index: 'a0',
      x: 0,
      y: 0,
      w: 32,
      h: 32,
      kind: 'heart',
    });
    expect(stampSpotOf(el)).toBe('c0_0');
  });

  test('ballots: one element per voter, so concurrent voters never write the same id', () => {
    expect(ballotId('vote1', 'u_jonas')).toBe('ballot-vote1-u_jonas');
    expect(ballotId('vote1', 'u_ana')).not.toBe(ballotId('vote1', 'u_jonas'));
    expect(voteResultId('vote1')).toBe('vote-vote1-result');
  });
});

describe('ballot secrecy and tallies (model rules for S4.14)', () => {
  const board = (state?: string): AnnotationElement[] =>
    [
      { ...V2_ELEMENTS[5], ...(state ? { state } : {}) },
      V2_ELEMENTS[6],
      {
        id: ballotId('vote1', 'u_ana'),
        type: 'ballot',
        index: 'a7',
        vote: 'vote1',
        voter: 'u_ana',
        picks: { 'ab:dir-a': 1 },
      },
      // Forged: an id that is not the one (vote, voter) derive — counts nothing.
      {
        id: 'ballot-forged',
        type: 'ballot',
        index: 'a8',
        vote: 'vote1',
        voter: 'u_eve',
        picks: { 'ab:dir-b': 3 },
      },
      // Over budget (perVoter 3).
      {
        id: ballotId('vote1', 'u_max'),
        type: 'ballot',
        index: 'a9',
        vote: 'vote1',
        voter: 'u_max',
        picks: { 'ab:dir-b': 4 },
      },
    ].map((e) => canon(e as Record<string, unknown>));

  test('while open, a viewer sees only their own ballot', () => {
    expect(visibleBallots(board(), 'vote1', 'u_ana').map((b) => b.voter)).toEqual(['u_ana']);
    expect(visibleBallots(board(), 'vote1', 'u_nobody')).toEqual([]);
  });

  test('once ended, every genuine ballot is visible', () => {
    expect(
      visibleBallots(board('ended'), 'vote1', 'u_ana')
        .map((b) => b.voter)
        .sort()
    ).toEqual(['u_ana', 'u_jonas', 'u_max']);
  });

  test('tallies count genuine, in-budget picks on targets only', () => {
    expect(tallyBallots(board('ended'), 'vote1')).toEqual({
      tallies: { 'ab:dir-a': 3, 'ab:dir-c': 1 },
      voters: 2,
    });
  });
});
