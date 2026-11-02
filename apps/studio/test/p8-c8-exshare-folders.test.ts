// P8 c8 (09 ex-batch): Folders › "One per canvas" — a real second layout. The files of each canvas sit under
// `<canvas path>/` inside the result zip; "One folder" (the default) stays flat, byte for byte.

import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';

import { canvasDir } from '../exporters/file-names.ts';
import type { SpecUnit } from '../exporters/scope.ts';
import { collectGroup, itemsFor, packGroup } from '../exporters/spec-run.ts';
import { validateSpecV2 } from '../exporters/spec-v2.ts';

const board = (id: string, label: string) => ({ id, label, kind: 'digital', w: 1080, h: 1350 });
const unit = (canvas: string | null, boards: ReturnType<typeof board>[]): SpecUnit =>
  ({
    id: `u-${canvas}`,
    format: 'png',
    scope: 'canvas-as-separate',
    options: {},
    canvas,
    artboards: boards,
    kind: 'digital',
    v2: {},
    degraded: [],
  }) as unknown as SpecUnit;

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
async function run(folders: 'one' | 'per-canvas' | undefined, units: SpecUnit[]) {
  const plan = {
    spec: {
      v: 2,
      scope: 'folder',
      format: 'png',
      ...(folders ? { options: { folders } } : {}),
    },
    units,
    project: 'Alligators',
    date: new Date(2026, 9, 18),
  } as never;
  const items = itemsFor(plan);
  const got = await collectGroup(
    plan,
    items,
    async () => ({ filename: 'x.png', contentType: 'image/png', body: png }),
    () => {}
  );
  const res = await packGroup(plan, got);
  return { res, items, names: got.files.map((f) => f.name) };
}

describe('canvasDir', () => {
  test("the canvas path without .tsx and without the design root's own ui/", () => {
    expect(canvasDir('ui/social/matchday/DOMA.tsx')).toBe('social/matchday/DOMA');
    expect(canvasDir('social/matchday/DOMA.tsx')).toBe('social/matchday/DOMA');
    expect(canvasDir('ui/Combine.tsx')).toBe('Combine');
    expect(canvasDir(null)).toBe('');
  });
  test('every segment is made safe; no dot-dot, no empty segment', () => {
    expect(canvasDir('ui/a:b/../c*.tsx')).toBe('ab/c');
    expect(canvasDir('..//x.tsx')).toBe('x');
  });
});

describe('options.folders', () => {
  const ok = (folders: unknown) =>
    validateSpecV2({ v: 2, scope: 'canvas', format: 'png', options: { folders } });
  test('one | per-canvas are accepted, anything else is refused', () => {
    expect(ok('per-canvas')).toMatchObject({ ok: true });
    expect(ok('one')).toMatchObject({ ok: true });
    expect(ok('nested')).toMatchObject({ ok: false });
    expect(ok(3)).toMatchObject({ ok: false });
  });
});

describe('a group job with folders: per-canvas', () => {
  test('one folder (default) stays flat', async () => {
    const { names } = await run(undefined, [
      unit('ui/social/matchday/DOMA.tsx', [board('a', 'Post 1'), board('b', 'Post 2')]),
      unit('ui/social/score/MVP.tsx', [board('a', 'Post 1')]),
    ]);
    expect(names.length).toBe(2);
    for (const n of names) expect(n.includes('/')).toBe(false);
  });
  test('per canvas: each file sits under its canvas path, inside the zip', async () => {
    const { res, items } = await run('per-canvas', [
      unit('ui/social/matchday/DOMA.tsx', [board('a', 'Post 1')]),
      unit('ui/social/score/MVP.tsx', [board('a', 'Post 1')]),
    ]);
    const zip = await JSZip.loadAsync(res.body);
    expect(
      Object.keys(zip.files)
        .filter((n) => !zip.files[n]?.dir)
        .sort()
    ).toEqual([
      'social/matchday/DOMA/DOMA — Post 1@1x.png',
      'social/score/MVP/MVP — Post 1@1x.png',
    ]);
    expect(items[0]?.files).toEqual(['social/matchday/DOMA/DOMA — Post 1@1x.png']);
  });
  test('the same file name in two canvases is not a duplicate; in one canvas it is', async () => {
    const { names } = await run('per-canvas', [
      unit('ui/a.tsx', [board('x', 'Hero')]),
      unit('ui/b.tsx', [board('x', 'Hero')]),
      unit('ui/b.tsx', [board('x', 'Hero')]),
    ]);
    expect(names).toEqual(['a/a — Hero@1x.png', 'b/b — Hero@1x.png', 'b/b — Hero@1x (2).png']);
  });
  test('one file is still one file: the download name is the file, not the path', async () => {
    const { res } = await run('per-canvas', [unit('ui/social/DOMA.tsx', [board('a', 'Post 1')])]);
    expect(res.filename).toBe('DOMA — Post 1@1x.png');
    expect(res.contentType).toBe('image/png');
  });
});
