// S7.8 — `video.poster.set` writes `artboardMeta[id].poster` through the one meta route
// (`PATCH /_api/present-meta { file, poster: { [artboardId]: frame | null } }`, Can edit and up — the route's
// own read-only refusal, test/present-meta-route.test.ts). This pins the schema half: the exact body, what
// the write keeps, and what a peer's malformed value reads as.
import { describe, expect, test } from 'bun:test';

import {
  applyPresentPatch,
  PATCH_KEYS,
  parsePresentPatch,
  readPosters,
} from '../present/meta-schema.ts';

const parse = (poster: unknown) => parsePresentPatch({ file: '.design/a.tsx', poster });

describe('the body', () => {
  test('poster is part of the route’s vocabulary', () => {
    expect(PATCH_KEYS).toContain('poster');
  });

  test('a frame or null per artboard id, nothing else', () => {
    expect(parse({ reels: 210, wide: null })).toMatchObject({
      ok: true,
      patch: { poster: { reels: 210, wide: null } },
    });
    expect(parse({ reels: 0 }).ok).toBe(true);
    for (const bad of [-1, 1.5, '7', true, {}, [1]])
      expect(parse({ reels: bad })).toMatchObject({ ok: false, error: 'bad-field' });
    expect(parse([1])).toMatchObject({ ok: false });
    expect(parse({ 'no spaces': 3 })).toMatchObject({ ok: false });
  });
});

describe('the write', () => {
  const current = {
    title: 'Recap',
    layout: { artboards: [{ id: 'reels', x: 0, y: 0 }] },
    artboardMeta: { reels: { notes: 'kept', snap: 'beat' }, wide: { poster: 90 } },
  };
  const apply = (poster: Record<string, number | null>, known: string[] | null = null) => {
    const p = parse(poster);
    if (!p.ok) throw new Error('parse');
    return applyPresentPatch(current, p.patch, known ? new Set(known) : null);
  };

  test('sets the frame and keeps every other key — notes, snap, layout, a peer’s fields', () => {
    const r = apply({ reels: 210 });
    expect(r.ok && r.changed).toBe(true);
    if (!r.ok) return;
    expect(r.next.artboardMeta).toEqual({
      reels: { notes: 'kept', snap: 'beat', poster: 210 },
      wide: { poster: 90 },
    });
    expect(r.next.layout).toEqual(current.layout);
    expect(r.next.title).toBe('Recap');
  });

  test('null takes it back to the default, and an entry left empty is dropped', () => {
    const r = apply({ wide: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.artboardMeta).toEqual({ reels: { notes: 'kept', snap: 'beat' } });
  });

  test('the same frame again changes nothing', () => {
    const r = apply({ wide: 90 });
    expect(r.ok && r.changed).toBe(false);
  });

  test('an artboard the canvas does not have is refused, a clearing one is not', () => {
    expect(apply({ ghost: 5 }, ['reels', 'wide'])).toMatchObject({
      ok: false,
      error: 'unknown-artboard',
      ids: ['ghost'],
    });
    expect(apply({ ghost: null }, ['reels', 'wide']).ok).toBe(true);
  });
});

describe('the read', () => {
  test('whole frames only; a peer’s malformed poster reads as absent', () => {
    expect(
      readPosters({
        artboardMeta: {
          a: { poster: 12 },
          b: { poster: -3 },
          c: { poster: 'x' },
          d: { poster: 1.5 },
          e: {},
          'bad id': { poster: 4 },
        },
      })
    ).toEqual({ a: 12 });
    expect(readPosters(null)).toEqual({});
    expect(readPosters({ artboardMeta: [] })).toEqual({});
  });
});
