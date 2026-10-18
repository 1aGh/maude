// ACL L5 — the per-use photo edit and the generation sidecar (contract
// S8-asset-sidecars §5.6, V2-1.7 G2).
//
// A per-use edit `assets/<img8>.<edit8>.photo.json` belongs to the ONE use whose
// element carries `data-photo-edit="<edit8>"`. A canvas-only session reads it
// only when an owned file of a granted canvas carries that attribute on the
// asset's element — another canvas's per-use edit is invisible and answers
// exactly like a name that does not exist (U1). It may CREATE one only for an
// asset its editable canvas references, only when the body hashes to the name,
// and never over existing bytes. `assets/<sha8>.gen.json` rides with its image.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { closureFor, type ProjectReader } from '../access/closure.ts';
import { photoEditHash, resolveAccess, sees, writes } from '../access/scope.ts';

function reader(files: Record<string, string>): ProjectReader {
  return {
    list: () => Object.keys(files),
    text: (rel) => files[rel] ?? null,
    head: () => 'h1',
  };
}

const grant = (c: string, r: 'viewer' | 'member' = 'member') =>
  resolveAccess({ v: 1, role: null, grants: [{ c, r }] });

/** The contract's canonical JSON: keys sorted recursively, no whitespace. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}
const hex = (edit: unknown) => createHash('sha256').update(canonical(edit)).digest('hex');

const EDIT_A = { v: 1, adjust: { exposure: 0.2, contrast: 0.1 } };
const EDIT_B = { v: 1, adjust: { saturation: -0.4 } };
const EDIT_NEW = { v: 1, adjust: { warmth: 0.3, exposure: -0.1 } };
const EA = hex(EDIT_A).slice(0, 8);
const EB = hex(EDIT_B).slice(0, 8);

const IMG = 'a1b2c3d4';
const OTHER = 'c1c2c3c4'; // A uses it without a per-use edit
const B_ONLY = 'd1d2d3d4'; // only B references it

const FILES: Record<string, string> = {
  'config.json': JSON.stringify({ designSystems: [] }),
  'ui/A.tsx': [
    'export default () => (<>',
    `  <img src="../assets/${IMG}.png" data-photo-edit="${EA}" alt="hero" />`,
    `  <img alt="" src="../assets/${OTHER}.jpg" />`,
    // A literal path to B's per-use file is not a reference to it (only the attribute is).
    `  <p>{"assets/${IMG}.${EB}.photo.json"}</p>`,
    '</>);',
  ].join('\n'),
  'ui/B.tsx': [
    'export default () => (<>',
    `  <img data-photo-edit="${EB}" src="../assets/${IMG}.png" />`,
    `  <img src="../assets/${B_ONLY}.png" />`,
    '</>);',
  ].join('\n'),
  [`assets/${IMG}.png`]: 'png',
  [`assets/${IMG}.photo.json`]: '{}', // every use
  [`assets/${IMG}.${EA}.photo.json`]: canonical(EDIT_A),
  [`assets/${IMG}.${EB}.photo.json`]: canonical(EDIT_B),
  [`assets/${IMG}.gen.json`]: '{"format":"maude.gen","v":1}',
  [`assets/${OTHER}.jpg`]: 'jpg',
  // Same edit hash as A's, but on an element A does not tag — still invisible.
  [`assets/${OTHER}.${EA}.photo.json`]: canonical(EDIT_A),
  [`assets/${B_ONLY}.png`]: 'png',
  [`assets/${B_ONLY}.gen.json`]: '{"format":"maude.gen","v":1}',
};

describe('acl-l5-photo-use — read closure', () => {
  const project = reader(FILES);
  const a = grant('ui/A.tsx', 'viewer');
  const cl = closureFor(a, project);

  test('A reads its own per-use edit and the every-use file', () => {
    expect(sees(a, cl, `assets/${IMG}.png`)).toBe(true);
    expect(sees(a, cl, `assets/${IMG}.photo.json`)).toBe(true);
    expect(sees(a, cl, `assets/${IMG}.${EA}.photo.json`)).toBe(true);
  });

  test("B's per-use edit of the same image is invisible to A — and answers like a missing name", () => {
    const missing = `assets/${IMG}.0badf00d.photo.json`;
    expect(sees(a, cl, `assets/${IMG}.${EB}.photo.json`)).toBe(false);
    expect(sees(a, cl, missing)).toBe(sees(a, cl, `assets/${IMG}.${EB}.photo.json`));
    expect(cl.read.has(`assets/${IMG}.${EB}.photo.json`)).toBe(false);
  });

  test('the attribute binds to ITS element: another asset with the same edit name stays out', () => {
    expect(sees(a, cl, `assets/${OTHER}.jpg`)).toBe(true);
    expect(sees(a, cl, `assets/${OTHER}.${EA}.photo.json`)).toBe(false);
  });

  test('B sees its own per-use edit, not A’s', () => {
    const b = grant('ui/B.tsx', 'viewer');
    const clB = closureFor(b, project);
    expect(sees(b, clB, `assets/${IMG}.${EB}.photo.json`)).toBe(true);
    expect(sees(b, clB, `assets/${IMG}.${EA}.photo.json`)).toBe(false);
  });

  test('.gen.json follows its image’s access', () => {
    expect(sees(a, cl, `assets/${IMG}.gen.json`)).toBe(true);
    expect(sees(a, cl, `assets/${B_ONLY}.png`)).toBe(false);
    expect(sees(a, cl, `assets/${B_ONLY}.gen.json`)).toBe(false);
    const b = grant('ui/B.tsx', 'viewer');
    expect(sees(b, closureFor(b, project), `assets/${B_ONLY}.gen.json`)).toBe(true);
  });

  test('a project role still reads everything (the existing gates apply)', () => {
    const viewer = resolveAccess({ v: 1, role: 'viewer' });
    expect(sees(viewer, null, `assets/${IMG}.${EB}.photo.json`)).toBe(true);
  });
});

describe('acl-l5-photo-use — create, never overwrite', () => {
  const project = reader(FILES);
  const a = grant('ui/A.tsx', 'member');
  const cl = closureFor(a, project);
  const body = JSON.stringify(EDIT_NEW, null, 2); // any spelling; the hash is over canonical JSON
  const name8 = `assets/${IMG}.${hex(EDIT_NEW).slice(0, 8)}.photo.json`;

  test('photoEditHash is sha256 of the canonical JSON', () => {
    expect(photoEditHash(EDIT_NEW)).toBe(hex(EDIT_NEW));
    expect(photoEditHash({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(hex({ a: [{ c: 3, d: 2 }], b: 1 }));
  });

  test('may create a per-use edit whose body hashes to its name (8 or 12 hex)', () => {
    expect(writes(a, cl, name8, { exists: false, body })).toBe(true);
    const name12 = `assets/${IMG}.${hex(EDIT_NEW).slice(0, 12)}.photo.json`;
    expect(writes(a, cl, name12, { exists: false, body })).toBe(true);
    expect(
      writes(a, cl, `assets/${OTHER}.${hex(EDIT_NEW).slice(0, 8)}.photo.json`, {
        exists: false,
        body,
      })
    ).toBe(true);
  });

  test('refused: a body that does not hash to the name, no body, bad JSON, an odd name', () => {
    expect(writes(a, cl, name8, { exists: false, body: canonical(EDIT_A) })).toBe(false);
    expect(writes(a, cl, name8, { exists: false })).toBe(false);
    expect(writes(a, cl, name8, { exists: false, body: '{not json' })).toBe(false);
    const full = hex(EDIT_NEW);
    for (const n of [full.slice(0, 7), full.slice(0, 17), full.slice(0, 8).toUpperCase()]) {
      expect(writes(a, cl, `assets/${IMG}.${n}.photo.json`, { exists: false, body })).toBe(false);
    }
  });

  test('refused: overwriting an existing per-use file, even with hashing bytes', () => {
    const existing = `assets/${IMG}.${EA}.photo.json`;
    expect(writes(a, cl, existing, { exists: true, body: canonical(EDIT_A) })).toBe(false);
    expect(writes(a, cl, existing, { exists: true, body: canonical(EDIT_B) })).toBe(false);
  });

  test('refused: an asset no editable granted canvas references; a viewer grant', () => {
    const name = `assets/${B_ONLY}.${hex(EDIT_NEW).slice(0, 8)}.photo.json`;
    expect(writes(a, cl, name, { exists: false, body })).toBe(false);
    const viewer = grant('ui/A.tsx', 'viewer');
    expect(writes(viewer, closureFor(viewer, project), name8, { exists: false, body })).toBe(false);
  });

  test('the every-use file keeps the every-referrer rule; .gen.json is not a canvas-only write', () => {
    // B also uses the image, and A's grant cannot edit B.
    expect(writes(a, cl, `assets/${IMG}.photo.json`, { exists: true })).toBe(false);
    expect(writes(a, cl, `assets/${IMG}.gen.json`, { exists: true })).toBe(false);
    expect(writes(a, cl, `assets/${IMG}.gen.json`, { exists: false })).toBe(false);
  });
});
