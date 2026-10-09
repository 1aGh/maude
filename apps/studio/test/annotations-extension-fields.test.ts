// V2-1.12 P2 / R5 — the shared annotations registry keeps unknown keys on
// KNOWN types exactly like it already keeps them on unknown types: bounded,
// sanitized, sorted, after the tail fields (`groups`, `author`, `locked`).
//
// Before (probe A): `parseFields` dropped every key the 1.x spec does not name,
// so a 1.x reader erased a v2 sticky's `parentArtboard` / `resolved` /
// `timeRange` / `folded` on its next write. After: a preserving reader produces
// the v2 writer's exact bytes, so DDR-241 lane hashes agree across peers.

import { describe, expect, test } from 'bun:test';

import { canonicalAnnotations } from '../annotations/board-text.ts';
import { MAX_ELEMENT_BYTES } from '../annotations/constants.ts';
import { validateElement } from '../annotations/registry.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';

const sticky = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  type: 'sticky',
  index: 'a0',
  x: 10,
  y: 20,
  w: 200,
  h: 120,
  text: 'Ship it',
  ...extra,
});

const V2_FIELDS = {
  timeRange: { from: 1.5, to: 3 },
  resolved: true,
  parentArtboard: 'hero',
  folded: true,
};

describe('annotation extension fields on known types (P2)', () => {
  test('kept, sorted by key, after the tail fields', () => {
    const r = validateElement(sticky({ ...V2_FIELDS, locked: true, author: { kind: 'ai' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r.el);
    expect(keys.slice(-6)).toEqual([
      'author',
      'locked',
      'folded',
      'parentArtboard',
      'resolved',
      'timeRange',
    ]);
    expect(r.el).toMatchObject(V2_FIELDS);
  });

  test('a v2 writer that obeys R5 and a preserving reader produce the same bytes', () => {
    // The v2 board as a v2 writer serializes it: spec order, defaults omitted,
    // extension fields sorted after the tail.
    const v2 = serializeBoard([
      {
        id: 's1',
        type: 'sticky',
        index: 'a0',
        x: 10,
        y: 20,
        w: 200,
        h: 120,
        text: 'Ship it',
        folded: true,
        parentArtboard: 'hero',
        resolved: true,
        timeRange: { from: 1.5, to: 3 },
      } as never,
      { id: 's2', type: 'sticky', index: 'a1', x: 0, y: 0, w: 200, h: 120, text: 'Next' } as never,
    ]);
    const parsed = parseBoard(v2);
    expect(parsed.dropped).toEqual([]);
    expect(serializeBoard(parsed.elements)).toBe(v2);
    expect(canonicalAnnotations(v2)).toBe(v2); // the DDR-241 lane value is unchanged
  });

  test('bounded: at most 64 extension keys, field-shaped names only, dangerous keys never', () => {
    const extra: Record<string, unknown> = {};
    for (let i = 0; i < 70; i++) extra[`x${String(i).padStart(2, '0')}`] = i;
    // As JSON from a peer: `__proto__` arrives as an OWN key after JSON.parse.
    const raw = JSON.parse(
      JSON.stringify(sticky({ ...extra, 'bad key': 1, '~v': 3, constructor: 'x' })).replace(
        /^\{/,
        '{"__proto__":{"polluted":true},'
      )
    ) as Record<string, unknown>;
    expect(Object.hasOwn(raw, '__proto__')).toBe(true);
    const r = validateElement(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ext = Object.keys(r.el).filter((k) => /^x\d\d$/.test(k));
    expect(ext).toHaveLength(64);
    expect(ext[0]).toBe('x00');
    expect(Object.hasOwn(r.el, 'bad key')).toBe(false);
    expect(Object.hasOwn(r.el, '~v')).toBe(false);
    expect(Object.hasOwn(r.el, 'constructor')).toBe(false);
    expect(Object.hasOwn(r.el, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test('a KNOWN field with an invalid value is still dropped, not resurrected as an extension', () => {
    const r = validateElement(sticky({ fill: 'not-a-colour', resolved: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.el, 'fill')).toBe(false); // sticky's colour field is `fill`
    expect(r.el.resolved).toBe(true);
  });

  test('extension values are sanitized JSON', () => {
    const r = validateElement(sticky({ meta: { a: [1, 'two', { b: null }] }, bad: Number.NaN }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.el.meta).toEqual({ a: [1, 'two', { b: null }] });
  });

  test('the per-element byte cap still holds with extensions', () => {
    // strings are capped at 20 000 chars each, so it takes several keys to pass the cap
    const keys = Math.ceil(MAX_ELEMENT_BYTES / 20_000) + 1;
    const big = Object.fromEntries(
      Array.from({ length: keys }, (_, i) => [`blob${i}`, 'x'.repeat(20_000)])
    );
    const r = validateElement(sticky(big));
    expect(r.ok).toBe(false);
  });

  test('unknown TYPES keep working exactly as before (probe C)', () => {
    const r = validateElement({
      id: 'v1',
      type: 'vote-stamp',
      index: 'a2',
      x: 1,
      y: 2,
      emoji: '👍',
      by: 'tereza',
    });
    expect(r.ok && r.el).toEqual({
      id: 'v1',
      type: 'vote-stamp',
      index: 'a2',
      by: 'tereza',
      emoji: '👍',
      x: 1,
      y: 2,
    });
  });
});
