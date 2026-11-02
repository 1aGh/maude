// gate-b-c4k (LOW, c4i follow-up) — a frame's uploads draw on a budget of their own, per frame
// (subject + canvas set), so canvas code in one frame cannot spend the whole server's asset budget
// (`ASSET_SESSION_BUDGET`, still the global backstop) and lock the owner out of their own uploads.
// `MAUDE_ASSET_FRAME_BUDGET` sizes it (tiny here).

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
const ONE = 'ui/one.tsx';
const TWO = 'ui/two.tsx';
/** Room for two fresh PNGs (~90 bytes each), not three. */
const FRAME_BUDGET = 200;

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
}

async function boot(): Promise<Booted> {
  const { root, designRoot } = makeSandbox();
  for (const rel of [ONE, TWO]) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), 'export default () => <p>x</p>;\n');
  }
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_ASSET_FRAME_BUDGET: String(FRAME_BUDGET),
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

describe('a desktop — a frame cannot spend the owner’s upload budget', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot();
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test('one frame: two uploads land, the third is refused (429), a chunk start too', async () => {
    const fc = (await frameCap(b, {}, ONE)) as string;
    const url = withFc(`${b.canvasBase}/_api/asset`, fc);
    expect([await upload(url), await upload(url), await upload(url)]).toEqual([201, 201, 429]);
    const start = await fetch(withFc(`${b.canvasBase}/_api/asset/chunk-start`, fc), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totalSize: 1024 * 1024 }),
    });
    expect(start.status).toBe(429);
  }, 30000);

  test('the owner’s own shell still uploads, and so does another frame', async () => {
    expect(await upload(`${b.base}/_api/asset`, { origin: b.base })).toBe(201);
    const fc = (await frameCap(b, {}, TWO)) as string;
    expect(await upload(withFc(`${b.canvasBase}/_api/asset`, fc))).toBe(201);
  }, 30000);
});
