// S8.7 — the canvas-rects runner behind the Print preflight (exporters/rects-runner.ts): one render at a
// time, a memory per file version, and every failure is "unmeasured" (null) — never a thrown error.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRectsRunner, parseRects } from '../exporters/rects-runner.ts';

const MANIFEST = {
  artboards: [{ id: 'a', x: 10, y: 20, w: 420, h: 582, label: 'ignored' }],
  elements: [
    {
      cdId: 'qr',
      selector: '[x]',
      index: 0,
      artboard: 'a',
      x: 50,
      y: 60,
      w: 80,
      h: 80,
      tag: 'div',
      text: 'QR',
    },
    { cdId: null, artboard: 'a', x: 'nope', y: 1, w: 1, h: 1 },
  ],
  elementsTruncated: false,
};
const out = (m: unknown) => `→ diagnostics\n${JSON.stringify(m)}\n`;

let tmp = '';
let designRoot = '';
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'maude-rects-'));
  designRoot = join(tmp, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'x');
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('parseRects', () => {
  test('keeps the geometry, drops what is not a number, cuts the text short', () => {
    const m = parseRects(out(MANIFEST));
    expect(m?.artboards).toEqual([{ id: 'a', x: 10, y: 20, w: 420, h: 582 }]);
    expect(m?.elements).toHaveLength(1);
    expect(m?.elements[0]).toMatchObject({ cdId: 'qr', artboard: 'a', x: 50, text: 'QR' });
  });

  test('anything that is not a manifest is null', () => {
    expect(parseRects('')).toBeNull();
    expect(parseRects('not json')).toBeNull();
    expect(parseRects('{"artboards":1}')).toBeNull();
  });
});

describe('createRectsRunner', () => {
  const make = (spawn: (cmd: string[]) => Promise<{ code: number; stdout: string }>) =>
    createRectsRunner({ repoRoot: tmp, designRoot, script: '/x/canvas-rects.sh', spawn });

  test('asks the script for the designRoot-relative canvas, once per file version', async () => {
    const seen: string[][] = [];
    const run = make(async (cmd) => {
      seen.push(cmd);
      return { code: 0, stdout: out(MANIFEST) };
    });
    const a = await run('ui/a.tsx');
    const b = await run('ui/a.tsx');
    expect(a?.elements).toHaveLength(1);
    expect(b).toEqual(a);
    expect(seen).toEqual([['bash', '/x/canvas-rects.sh', 'ui/a.tsx', '--root', tmp]]);
    // the canvas changed on disk: measured again
    const later = new Date(Date.now() + 5000);
    utimesSync(join(designRoot, 'ui', 'a.tsx'), later, later);
    await run('ui/a.tsx');
    expect(seen).toHaveLength(2);
  });

  test('renders are one at a time', async () => {
    writeFileSync(join(designRoot, 'ui', 'b.tsx'), 'y');
    let live = 0;
    let peak = 0;
    const run = make(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 15));
      live -= 1;
      return { code: 0, stdout: out(MANIFEST) };
    });
    await Promise.all([run('ui/a.tsx'), run('ui/b.tsx')]);
    expect(peak).toBe(1);
  });

  test('a failed render, a throw, a static fallback and a bad path are all "unmeasured"', async () => {
    expect(await make(async () => ({ code: 1, stdout: out(MANIFEST) }))('ui/a.tsx')).toBeNull();
    expect(
      await make(async () => {
        throw new Error('no browser');
      })('ui/a.tsx')
    ).toBeNull();
    // the script's static fallback: artboards and no elements
    expect(
      await make(async () => ({
        code: 0,
        stdout: out({ artboards: MANIFEST.artboards, elements: [] }),
      }))('ui/a.tsx')
    ).toBeNull();
    const never = make(async () => ({ code: 0, stdout: out(MANIFEST) }));
    for (const bad of ['', '/etc/passwd', '../x.tsx', 'ui/a.css', 'ui/missing.tsx'])
      expect(await never(bad)).toBeNull();
  });
});
