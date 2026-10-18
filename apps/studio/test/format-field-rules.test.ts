// V2-1.12 §7 — the field rules, as a ratchet. This file holds the R6 half for S7's keys (S7.1):
// `artboardMeta[id].{poster, snap, maxFrames, madeFrom}` live under the reserved TOP-LEVEL map only —
// never under `layout`, never inside `layout.artboards[]` (v1's `patchCanvasMeta` drops both) — and
// what kinds/meta.ts writes is valid under schema/canvas-meta.v2.schema.json.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { compileSchema } from '../../../cli/lib/json-schema-lite.mjs';
import { applyArtboardMetaPatch, S7_ARTBOARD_KEYS } from '../kinds/meta.ts';
import { RESERVED_META_KEYS } from '../migrate/steps.ts';

const schema = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'schema', 'canvas-meta.v2.schema.json'), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
const lite = compileSchema(schema);
/** Ajv's verdict, held to the lite validator `maude design check` runs. */
function valid(doc: unknown): boolean {
  const a = ajv(doc) === true;
  expect(lite(doc).length === 0).toBe(a);
  return a;
}

const S7 = {
  poster: 120,
  snap: 'beat',
  maxFrames: 5400,
  madeFrom: { artboard: 'feed', label: 'Feed' },
};
const base = () => ({ title: 'Recap', layout: { artboards: [{ id: 'reels', x: 0, y: 0 }] } });

describe('R6 — S7 artboard keys are top-level only', () => {
  test('accepted under artboardMeta[id]', () => {
    expect(valid({ ...base(), artboardMeta: { reels: S7 } })).toBe(true);
  });

  for (const k of S7_ARTBOARD_KEYS) {
    const v = S7[k];
    test(`${k}: refused inside layout.artboards[] and under layout`, () => {
      const inRow = base();
      (inRow.layout.artboards[0] as Record<string, unknown>)[k] = v;
      expect(valid(inRow)).toBe(false);
      const underLayout = base() as Record<string, unknown>;
      (underLayout.layout as Record<string, unknown>)[k] = v;
      expect(valid(underLayout)).toBe(false);
      expect(valid({ ...base(), [k]: v })).toBe(false); // nor as a bare top-level key
    });
  }

  test('madeFrom is exactly { artboard, label }', () => {
    for (const madeFrom of [
      { artboard: 'feed' },
      { artboard: 'bad id', label: 'x' },
      { artboard: 'feed', label: 'x'.repeat(201) },
      { artboard: 'feed', label: 'x', at: 'now' },
    ])
      expect(valid({ ...base(), artboardMeta: { reels: { madeFrom } } })).toBe(false);
  });

  test("kinds/meta.ts's writer output is valid, and leaves layout alone", () => {
    const r = applyArtboardMetaPatch(base(), { reels: { ...S7, snap: 'off' } }, new Set(['reels']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(valid(r.next)).toBe(true);
    expect(r.next.layout).toEqual(base().layout);
  });

  test('`maude migrate v2 --reverse --strip` knows the map it lives in', () => {
    expect(RESERVED_META_KEYS).toContain('artboardMeta');
  });
});
