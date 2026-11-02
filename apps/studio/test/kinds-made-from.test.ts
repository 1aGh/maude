// S7.25 — `artboardMeta[id].madeFrom` through the one meta route (PATCH /_api/present-meta { madeFrom }): the copy Change
// kind makes remembers what it was made from, every other key of the sidecar stays, and a v1 peer's rewrite keeps it.

import { describe, expect, test } from 'bun:test';

import { applyPresentPatch, parsePresentPatch, readMadeFrom } from '../present/meta-schema.ts';

const parse = (madeFrom: unknown) => parsePresentPatch({ file: 'ui/K.tsx', madeFrom });

describe('parsePresentPatch — madeFrom', () => {
  test('exactly { artboard, label } per id, null forgets, anything else is a 400 with the field named', () => {
    expect(parse({ 'ig-a6': { artboard: 'ig', label: 'Oznámení' } })).toMatchObject({ ok: true });
    expect(parse({ 'ig-a6': null })).toMatchObject({ ok: true });
    for (const bad of [
      { 'ig-a6': { artboard: 'ig' } },
      { 'ig-a6': { artboard: 'ig', label: 'x', extra: 1 } },
      { 'ig-a6': { artboard: 'bad id', label: 'x' } },
      { 'ig-a6': { artboard: 'ig', label: 'x'.repeat(201) } },
      { 'bad id': null },
      [],
    ])
      expect(parse(bad)).toMatchObject({ ok: false, error: 'bad-field' });
  });
});

describe('applyPresentPatch — madeFrom', () => {
  const meta = {
    layout: { artboards: [{ id: 'ig', x: 0, y: 0 }] },
    artboardMeta: { ig: { notes: 'keep', exports: [{ format: 'png', scale: 1 }] } },
    futureKey: { a: 1 },
  };
  const patch = (madeFrom: unknown) => {
    const r = parse(madeFrom);
    if (!r.ok) throw new Error('bad patch');
    return r.patch;
  };

  test('stores it beside the artboard’s other keys and leaves everything else as it was', () => {
    const r = applyPresentPatch(
      meta,
      patch({ 'ig-a6': { artboard: 'ig', label: 'Oznámení' } }),
      new Set(['ig', 'ig-a6'])
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.futureKey).toEqual({ a: 1 });
    expect(r.next.layout).toEqual(meta.layout);
    expect((r.next.artboardMeta as Record<string, unknown>).ig).toEqual(meta.artboardMeta.ig);
    expect(readMadeFrom(r.next)).toEqual({ 'ig-a6': { artboard: 'ig', label: 'Oznámení' } });
  });

  test('an artboard that is not on the canvas is a 422; null forgets it and drops an empty entry', () => {
    const bad = applyPresentPatch(
      meta,
      patch({ ghost: { artboard: 'ig', label: 'x' } }),
      new Set(['ig'])
    );
    expect(bad).toMatchObject({ ok: false, error: 'unknown-artboard' });
    const stored = applyPresentPatch(meta, patch({ a: { artboard: 'ig', label: 'x' } }), null);
    if (!stored.ok) throw new Error('not stored');
    const gone = applyPresentPatch(stored.next, patch({ a: null }), null);
    expect(gone.ok && readMadeFrom(gone.next)).toEqual({});
    expect(gone.ok && (gone.next.artboardMeta as Record<string, unknown>).a).toBeUndefined();
  });

  test('readMadeFrom is tolerant: a malformed member reads as absent', () => {
    expect(readMadeFrom(null)).toEqual({});
    expect(
      readMadeFrom({
        artboardMeta: {
          a: { madeFrom: { artboard: 'ig' } },
          b: { madeFrom: 4 },
          c: { madeFrom: { artboard: 'ig', label: 'ok' } },
        },
      })
    ).toEqual({ c: { artboard: 'ig', label: 'ok' } });
  });
});
