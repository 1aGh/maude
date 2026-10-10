// V2-2.4b — `maude design place` (a free spot next to an artboard / element) and
// `maude design layout-check` (overlapping artboards, clipped elements), contract V2-1.11 §5.3,
// on top of the canvas-rects manifest. Red first: no layout module, no verbs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { layoutLint, placeNear, type RectsManifest } from '../layout/free-space.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');

const M: RectsManifest = {
  artboards: [
    { id: 'hero', x: 0, y: 0, w: 1000, h: 600 },
    { id: 'pricing', x: 1080, y: 0, w: 1000, h: 600 },
  ],
  elements: [
    { cdId: 'cta', artboard: 'hero', x: 100, y: 100, w: 200, h: 60, tag: 'button' },
    { cdId: 'wide', artboard: 'pricing', x: 1900, y: 50, w: 400, h: 40, tag: 'div' },
  ],
  elementsTruncated: false,
};

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('placeNear', () => {
  test('right of the target when free, else below', () => {
    expect(placeNear(M, 'pricing', { w: 800, h: 600 })).toMatchObject({
      x: 2160,
      y: 0,
      side: 'right',
    });
    // right of hero is taken by pricing → below
    expect(placeNear(M, 'hero', { w: 800, h: 600 })).toMatchObject({ x: 0, y: 680, side: 'below' });
  });

  test('never overlaps an artboard, even when every side is taken', () => {
    const boxed: RectsManifest = {
      artboards: [
        { id: 'c', x: 0, y: 0, w: 400, h: 400 },
        { id: 'r', x: 480, y: 0, w: 400, h: 400 },
        { id: 'l', x: -480, y: 0, w: 400, h: 400 },
        { id: 'a', x: 0, y: -480, w: 400, h: 400 },
        { id: 'b', x: 0, y: 480, w: 400, h: 400 },
      ],
      elements: [],
    };
    const p = placeNear(boxed, 'c', { w: 400, h: 400 });
    expect(p?.side).toBe('ring');
    for (const ab of boxed.artboards) expect(overlaps(p as never, ab)).toBe(false);
  });

  test('an element id works as the target; an unknown id is null', () => {
    expect(placeNear(M, 'cta', { w: 100, h: 100 })).not.toBeNull();
    expect(placeNear(M, 'nope', { w: 100, h: 100 })).toBeNull();
  });
});

describe('layoutLint', () => {
  test('a clean layout has no findings; overlap is an error; a spill is a warning', () => {
    expect(layoutLint({ ...M, elements: [M.elements[0] as never] }, 'ui/x.tsx')).toEqual([]);
    const f = layoutLint(
      { ...M, artboards: [...M.artboards, { id: 'stray', x: 500, y: 300, w: 400, h: 400 }] },
      'ui/x.tsx'
    );
    expect(f.map((x) => [x.code, x.severity])).toEqual([
      ['artboard-overlap', 'error'],
      ['element-clipped', 'warning'],
    ]);
    expect(f[1]?.where).toBe('ui/x.tsx#pricing @wide');
  });
});

describe('the verbs (with --rects, no browser)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maude-place-'));
    writeFileSync(join(dir, 'rects.json'), JSON.stringify(M));
    writeFileSync(
      join(dir, 'overlap.json'),
      JSON.stringify({ ...M, artboards: [...M.artboards, { id: 's', x: 10, y: 10, w: 10, h: 10 }] })
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...a: string[]) =>
    Bun.spawnSync(['node', MAUDE, 'design', ...a], {
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
    });

  test('place prints the spot (exit 0); unknown id → 1; usage → 2', () => {
    const r = run(
      'place',
      'ui/x.tsx',
      '--near',
      'pricing',
      '--size',
      '800x600',
      '--rects',
      join(dir, 'rects.json'),
      '--json'
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toMatchObject({
      x: 2160,
      y: 0,
      w: 800,
      h: 600,
      near: 'pricing',
    });
    expect(
      run(
        'place',
        'ui/x.tsx',
        '--near',
        'nope',
        '--size',
        '8x6',
        '--rects',
        join(dir, 'rects.json')
      ).exitCode
    ).toBe(1);
    expect(
      run(
        'place',
        'ui/x.tsx',
        '--near',
        'hero',
        '--size',
        'big',
        '--rects',
        join(dir, 'rects.json')
      ).exitCode
    ).toBe(2);
    expect(
      run('place', 'ui/x.tsx', '--size', '8x6', '--rects', join(dir, 'rects.json')).exitCode
    ).toBe(2);
  });

  test('layout-check: warnings only → 0; an overlap → 1; --json carries the findings', () => {
    expect(run('layout-check', 'ui/x.tsx', '--rects', join(dir, 'rects.json')).exitCode).toBe(0);
    const bad = run('layout-check', 'ui/x.tsx', '--rects', join(dir, 'overlap.json'), '--json');
    expect(bad.exitCode).toBe(1);
    const out = JSON.parse(bad.stdout.toString()) as { ok: boolean; findings: { code: string }[] };
    expect(out.ok).toBe(false);
    expect(out.findings.map((f) => f.code)).toContain('artboard-overlap');
  });
});
