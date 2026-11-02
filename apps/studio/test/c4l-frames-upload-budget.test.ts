// gate-b-c4l (LOW, ethical hacker + defender L-a) — c4k gave each frame its own upload budget, but
// N frames (one per canvas the opener can open) still summed to the whole `ASSET_SESSION_BUDGET` and
// locked the owner's main-origin uploads out. Every frame-originated upload now also draws on ONE
// shared counter capped below the global budget (half of it by default,
// `MAUDE_ASSET_FRAMES_BUDGET` overrides), so the main origin always keeps the rest.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const CANVASES = ['ui/one.tsx', 'ui/two.tsx', 'ui/three.tsx'];
/** ~86 bytes a PNG: the global budget holds ~4, the frames' half ~2, one frame alone ~11. */
const SESSION_BUDGET = 400;

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
}

async function boot(): Promise<Booted> {
  const { root, designRoot } = makeSandbox();
  for (const rel of CANVASES) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), 'export default () => <p>x</p>;\n');
  }
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_ASSET_SESSION_BUDGET: String(SESSION_BUDGET),
    MAUDE_ASSET_FRAME_BUDGET: '1000',
  });
  let canvasBase = '';
  for (let i = 0; i < 40 && !canvasBase; i++) {
    try {
      canvasBase = String(
        JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')).canvasOrigin ?? ''
      );
    } catch {
      /* not written yet */
    }
    if (!canvasBase) await Bun.sleep(50);
  }
  return { proc, base: `http://localhost:${port}`, canvasBase };
}

const freshPng = () => Buffer.concat([PNG, Buffer.from(`${Math.random()}`.slice(0, 18))]);

async function upload(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/png' },
    body: freshPng(),
  });
  return r.status;
}

describe('a desktop — frames together cannot spend the owner’s upload budget', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot();
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test('three frames share half the budget; the owner’s shell still uploads after', async () => {
    const statuses: number[] = [];
    for (const c of CANVASES) {
      const fc = (await frameCap(b, {}, c)) as string;
      const url = withFc(`${b.canvasBase}/_api/asset`, fc);
      statuses.push(await upload(url), await upload(url));
    }
    // two land (≈172 of the 200 the frames share), every later frame upload is refused
    expect(statuses.filter((s) => s === 201).length).toBe(2);
    expect(statuses.slice(2).every((s) => s === 429)).toBe(true);
    const fc = (await frameCap(b, {}, CANVASES[2] as string)) as string;
    const start = await fetch(withFc(`${b.canvasBase}/_api/asset/chunk-start`, fc), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalSize: 150 }),
    });
    expect(start.status).toBe(429);
    expect(await upload(`${b.base}/_api/asset`, { origin: b.base })).toBe(201);
    expect(await upload(`${b.base}/_api/asset`, { origin: b.base })).toBe(201);
  }, 30000);
});
