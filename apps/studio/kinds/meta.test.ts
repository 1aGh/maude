// S7.1 — kinds/meta.ts: S7's `artboardMeta[id]` keys (poster, snap, maxFrames, madeFrom). Tolerant
// readers with today's defaults, a strict patch parser, and a writer that keeps every key it was not
// asked to change (S3's notes, V2-1.5 madeBy, S8's exports, a newer peer's key) in its place.

import { describe, expect, test } from 'bun:test';

import {
  applyArtboardMetaPatch,
  DEFAULT_MAX_FRAMES,
  parseArtboardMetaPatch,
  readArtboardVideoMeta,
  resolvedMaxFrames,
  resolvedPoster,
  resolvedSnap,
} from './meta.ts';

const META = {
  title: 'Recap',
  layout: { artboards: [{ id: 'reels', x: 0, y: 0 }] },
  artboardMeta: {
    reels: {
      notes: 'Open on the goal.',
      poster: 120,
      exports: [{ format: 'mp4', scale: 1 }],
      snap: 'beat',
      zz: { newer: true },
    },
    story: { madeBy: { kind: 'ai' } },
  },
  tail: 1,
};

describe('readers are tolerant and default to today', () => {
  test('reads the S7 keys, ignores everything else', () => {
    expect(readArtboardVideoMeta(META, 'reels')).toEqual({ poster: 120, snap: 'beat' });
    expect(readArtboardVideoMeta(META, 'story')).toEqual({});
    expect(readArtboardVideoMeta(META, 'gone')).toEqual({});
  });

  test('a malformed member reads as absent; nothing throws', () => {
    const bad = {
      artboardMeta: {
        a: { poster: -1, snap: 'bar', maxFrames: 18001, madeFrom: { artboard: 'x y', label: 'L' } },
        b: { poster: 1.5, maxFrames: 0, madeFrom: { artboard: 'src' } },
        c: 'nope',
      },
    };
    for (const id of ['a', 'b', 'c', '__proto__', 'constructor'])
      expect(readArtboardVideoMeta(bad, id)).toEqual({});
    for (const junk of [null, 1, 'x', [], { artboardMeta: [] }, { artboardMeta: null }])
      expect(readArtboardVideoMeta(junk, 'a')).toEqual({});
  });

  test('defaults: 3 600-frame cap, poster at 35 %, snap on only with a beat grid', () => {
    expect(resolvedMaxFrames({}, 'a')).toBe(DEFAULT_MAX_FRAMES);
    expect(resolvedMaxFrames({ artboardMeta: { a: { maxFrames: 5400 } } }, 'a')).toBe(5400);
    expect(resolvedPoster({}, 'a', 300)).toBe(105);
    expect(resolvedPoster(META, 'reels', 300)).toBe(120);
    expect(resolvedPoster(META, 'reels', 60)).toBe(59); // clamped into a comp cut shorter since
    expect(resolvedPoster({}, 'a', 0)).toBe(0);
    expect(resolvedSnap({}, 'a', true)).toBe('beat');
    expect(resolvedSnap({}, 'a', false)).toBe('off');
    expect(resolvedSnap({ artboardMeta: { a: { snap: 'off' } } }, 'a', true)).toBe('off');
  });
});

describe('the patch parser is exact', () => {
  test('accepts the documented shape', () => {
    expect(
      parseArtboardMetaPatch({
        reels: {
          poster: 12,
          snap: 'off',
          maxFrames: 18000,
          madeFrom: { artboard: 'feed', label: 'Feed' },
        },
        story: { poster: null },
      })
    ).toEqual({
      ok: true,
      patch: {
        reels: {
          poster: 12,
          snap: 'off',
          maxFrames: 18000,
          madeFrom: { artboard: 'feed', label: 'Feed' },
        },
        story: { poster: null },
      },
    });
  });

  test('refuses an unknown key, a bad value, a bad id', () => {
    const cases: [unknown, string, string][] = [
      [{ a: { notes: 'x' } }, 'unknown-key', 'a.notes'],
      [{ a: { exports: [] } }, 'unknown-key', 'a.exports'],
      [{ a: { poster: 1.5 } }, 'bad-field', 'a.poster'],
      [{ a: { maxFrames: 18001 } }, 'bad-field', 'a.maxFrames'],
      [{ a: { snap: 'bar' } }, 'bad-field', 'a.snap'],
      [{ a: { madeFrom: { artboard: 'b', label: 'B', at: 1 } } }, 'bad-field', 'a.madeFrom'],
      [{ 'bad id': { poster: 1 } }, 'bad-field', 'bad id'],
    ];
    for (const [body, error, field] of cases)
      expect(parseArtboardMetaPatch(body)).toEqual({ ok: false, error, field } as never);
    expect(parseArtboardMetaPatch([])).toMatchObject({ ok: false, error: 'bad-body' });
  });
});

describe('the writer keeps what it was not asked to change', () => {
  test('sets and removes only the named members, in place', () => {
    const p = parseArtboardMetaPatch({
      reels: { maxFrames: 5400, snap: null },
      story: { madeFrom: { artboard: 'reels', label: 'Reels' } },
    });
    if (!p.ok) throw new Error('parse');
    const r = applyArtboardMetaPatch(META, p.patch, new Set(['reels', 'story']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.next)).toEqual(['title', 'layout', 'artboardMeta', 'tail']);
    expect(r.next.layout).toBe(META.layout);
    const m = r.next.artboardMeta as Record<string, Record<string, unknown>>;
    expect(Object.keys(m.reels as object)).toEqual([
      'notes',
      'poster',
      'exports',
      'zz',
      'maxFrames',
    ]);
    expect(m.reels).toMatchObject({
      notes: 'Open on the goal.',
      exports: [{ format: 'mp4', scale: 1 }],
      zz: { newer: true },
    });
    expect(m.story).toEqual({
      madeBy: { kind: 'ai' },
      madeFrom: { artboard: 'reels', label: 'Reels' },
    });
    expect(META.artboardMeta.reels.snap).toBe('beat'); // input untouched
  });

  test('an emptied entry and an emptied map disappear; a no-op is reported', () => {
    const cur = { title: 'C', artboardMeta: { a: { poster: 3 } } };
    const r = applyArtboardMetaPatch(cur, { a: { poster: null } }, null);
    expect(r).toEqual({ ok: true, next: { title: 'C' }, changed: true });
    const same = applyArtboardMetaPatch(cur, { a: { poster: 3 } }, null);
    expect(same).toMatchObject({ ok: true, changed: false });
  });

  test('a write to an artboard the canvas does not have is refused; a removal is allowed', () => {
    expect(applyArtboardMetaPatch({}, { ghost: { poster: 1 } }, new Set(['a']))).toEqual({
      ok: false,
      error: 'unknown-artboard',
      ids: ['ghost'],
    });
    const stale = { artboardMeta: { ghost: { poster: 1 } } };
    expect(applyArtboardMetaPatch(stale, { ghost: { poster: null } }, new Set(['a']))).toEqual({
      ok: true,
      next: {},
      changed: true,
    });
  });
});
