// gen-sidecar.test.ts — `assets/<sha8>.gen.json`, format `maude.gen` v1 (contract
// S8-asset-sidecars §5.2, §5.5): the lenient reader keeps unknown keys, holds the
// limits, treats `v > 1` as absent; the schema gives the reader's verdict; `check
// --strict` runs it; the FormatId row exists.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { checkFile, kindOf } from '../check/index.ts';
import { GEN_MAX_BYTES, readGen, validateGen } from '../generation/gen-sidecar.ts';
import { FORMAT_SCHEMA_BY_ID } from '../schema/formats.ts';

const STUDIO = join(import.meta.dir, '..');

const TAKE = {
  format: 'maude.gen',
  v: 1,
  prompt: 'night touchdown, stadium lights, 4:5',
  provider: 'fal',
  model: 'flux-pro-1.1',
  at: '2026-10-18T09:12:00Z',
  licence: 'You own the output; provider terms apply.',
  group: 'g_3f9a1c2e7b40',
  takes: ['a1b2c3d4', 'e5f60718', '9a0b1c2d', '3e4f5a6b'],
  by: 'Tereza',
};

const BAD: Array<[string, Record<string, unknown>]> = [
  ['wrong format', { ...TAKE, format: 'maude.photo' }],
  ['v missing', { ...TAKE, v: undefined }],
  ['prompt too long', { ...TAKE, prompt: 'x'.repeat(4001) }],
  ['prompt missing', { ...TAKE, prompt: undefined }],
  ['provider shape', { ...TAKE, provider: 'fal ai' }],
  ['model too long', { ...TAKE, model: 'm'.repeat(81) }],
  ['licence too long', { ...TAKE, licence: 'l'.repeat(301) }],
  ['takes empty', { ...TAKE, takes: [] }],
  ['takes > 8', { ...TAKE, takes: Array.from({ length: 9 }, (_, i) => `0000000${i}`) }],
  ['take not sha8', { ...TAKE, takes: ['A1B2C3D4'] }],
  ['at not UTC', { ...TAKE, at: '2026-10-18T09:12:00+02:00' }],
  ['at not a date', { ...TAKE, at: 'yesterday' }],
  ['by is an e-mail', { ...TAKE, by: 'tereza@example.com' }],
  ['group shape', { ...TAKE, group: 'g 1' }],
  ['not an object', [] as unknown as Record<string, unknown>],
];

const drop = (o: Record<string, unknown>) =>
  JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

describe('maude.gen v1 — the lenient reader', () => {
  test('the contract example is valid and reads back whole', () => {
    expect(validateGen(TAKE)).toEqual({ ok: true, errors: [] });
    expect(readGen(JSON.stringify(TAKE))).toEqual(TAKE);
  });

  test('unknown keys are KEPT (R8 does not apply to this format)', () => {
    const later = { ...TAKE, seed: 42, negativePrompt: 'blur', future: { nested: true } };
    expect(validateGen(later).ok).toBe(true);
    expect(readGen(JSON.stringify(later))).toEqual(later);
  });

  test('optional keys may be absent (by, licence, group)', () => {
    const { by: _b, licence: _l, group: _g, ...min } = TAKE;
    expect(validateGen(min).ok).toBe(true);
    expect(validateGen({ ...TAKE, licence: '' }).ok).toBe(true); // empty → the line is omitted (O3)
  });

  test.each(BAD)('invalid: %s', (_label, doc) => {
    const d = Array.isArray(doc) ? doc : drop(doc);
    expect(validateGen(d).ok).toBe(false);
    expect(readGen(JSON.stringify(d))).toBeNull();
  });

  test('v > 1 is treated as absent (no "Made by AI" line), never an error to rewrite', () => {
    const v2 = { ...TAKE, v: 2, somethingNew: 1 };
    expect(readGen(JSON.stringify(v2))).toBeNull();
    const r = validateGen(v2);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('newer');
  });

  test('takes must name the file itself when the reader knows it', () => {
    expect(validateGen(TAKE, { self: 'e5f60718' }).ok).toBe(true);
    expect(validateGen(TAKE, { self: 'ffffffff' }).ok).toBe(false);
    expect(readGen(JSON.stringify(TAKE), { self: 'ffffffff' })).toBeNull();
  });

  test('a file over 16 KiB or not JSON is absent', () => {
    expect(GEN_MAX_BYTES).toBe(16 * 1024);
    const big = JSON.stringify({ ...TAKE, pad: 'p'.repeat(GEN_MAX_BYTES) });
    expect(readGen(big)).toBeNull();
    expect(readGen('{nope')).toBeNull();
  });
});

describe('maude.gen v1 — schema, FormatId row, check --strict', () => {
  const row = FORMAT_SCHEMA_BY_ID.get('gen');

  test('the FormatId row names the hand schema and the reader', () => {
    expect(row).toMatchObject({
      format: 'gen',
      schema: 'schema/gen.v1.schema.json',
      id: 'https://maude.sh/schema/gen/v1',
      source: 'hand',
      skill: 'design:ai-generation',
    });
    expect(row?.check).toContain('validateGen');
  });

  test('the schema gives the reader’s verdict on the corpus', () => {
    const schema = JSON.parse(readFileSync(join(STUDIO, 'schema/gen.v1.schema.json'), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    const corpus: unknown[] = [
      TAKE,
      { ...TAKE, extra: [1, 2] },
      ...BAD.map(([, d]) => (Array.isArray(d) ? d : drop(d))),
    ];
    for (const doc of corpus) {
      expect({ doc, schema: validate(doc) }).toEqual({ doc, schema: validateGen(doc).ok });
    }
  });

  test('check --strict runs validateGen on a .gen.json; lenient only parses', () => {
    expect(kindOf('assets/a1b2c3d4.gen.json')).toBe('gen');
    const bad = JSON.stringify({ ...TAKE, takes: [] });
    expect(checkFile('assets/a1b2c3d4.gen.json', bad, { strict: true }).ok).toBe(false);
    expect(checkFile('assets/a1b2c3d4.gen.json', bad).ok).toBe(true);
    expect(checkFile('assets/a1b2c3d4.gen.json', JSON.stringify(TAKE), { strict: true }).ok).toBe(
      true
    );
    // the per-use photo edit stays `photo-edit` (one schema, two shapes)
    expect(kindOf('assets/a1b2c3d4.9f8e7d6c.photo.json')).toBe('photo-edit');
  });
});
