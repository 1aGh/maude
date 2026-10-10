// V2-2.17 — serving pictures (contract V2-1.17 §5.3, §5.8 R4–R7).
//
//   R4 GET /_api/thumb/<key> and POST /_api/thumbs/want answer on the MAIN origin only: the canvas
//      and capture origins refuse them at their door, and neither is in CANVAS_SAFE_API.
//   R5 image/jpeg + nosniff; a non-JPEG file in the cache is never served.
//   R6 only keys this project references are served; missing, unreferenced and malformed keys are
//      the SAME 404; a picture in another project's cache is not this project's.
//   R7 a cell's service renders nothing.

import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pidOf } from '../index/snapshot.ts';
import { thumbResponse, wantResponse } from '../thumbs/routes.ts';
import { createThumbService, type ThumbService } from '../thumbs/service.ts';
import { thumbPath, writeThumb } from '../thumbs/store.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { b64, fakeJpeg, fakeShim } from './_thumbs-fake.ts';
import { captureOriginOf, indexFor, settle, writeFiles } from './_thumbs-helpers.ts';

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function A() {
  return (<DesignCanvas><DCSection id="s" title="A">
    <DCArtboard id="one" label="One" width={480} height={300}><div /></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;
const COVER = { canvas: 'ui/A.tsx', artboard: null, size: 'card', priority: 'visible' } as const;

const services: ThumbService[] = [];
const procs: Array<import('bun').Subprocess> = [];
afterAll(async () => {
  for (const s of services) s.stop();
  for (const p of procs) await killProc(p);
});

function project(opts: { enabled?: boolean } = {}) {
  const { root, designRoot } = makeSandbox();
  writeFiles(designRoot, { 'ui/A.tsx': CANVAS });
  const index = indexFor(root, designRoot);
  const shim = fakeShim(() => ({
    ok: true,
    shots: [{ target: 0, artboard: 'one', jpeg: b64(fakeJpeg(480, 300)) }],
  }));
  const svc = createThumbService({
    pid: pidOf(root),
    designRoot,
    index,
    config: () => ({ theme: 'dark' }),
    serverOrigin: () => 'http://localhost:1',
    captureOrigin: () => 'http://localhost:2',
    spawnShim: shim.handle,
    enabled: opts.enabled,
  });
  services.push(svc);
  return { root, svc, pid: pidOf(root) };
}

const snapshotOf = async (r: Response) => ({
  status: r.status,
  body: await r.text(),
  headers: [...r.headers.entries()].sort(),
});

describe('picture responses (V2-2.17 R5/R6)', () => {
  test('R5: a referenced picture is image/jpeg with nosniff and an immutable cache', async () => {
    const { svc } = project();
    const r = await settle(svc, COVER);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    const res = thumbResponse(svc, r.key);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fakeJpeg(480, 300));
  });

  test('R5: a non-JPEG file under a referenced key is not served', async () => {
    const { svc, pid } = project();
    const r = await settle(svc, COVER);
    if (r.status !== 'ready') throw new Error('not ready');
    writeFileSync(thumbPath(pid, r.key), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(thumbResponse(svc, r.key).status).toBe(404);
  });

  test('R6: missing, unreferenced-but-cached and malformed keys are the same 404', async () => {
    const { svc, pid } = project();
    await settle(svc, COVER);
    const cachedButUnreferenced = randomBytes(32).toString('hex');
    writeThumb(pid, cachedButUnreferenced, fakeJpeg(100, 100));
    const missing = randomBytes(32).toString('hex');
    const a = await snapshotOf(thumbResponse(svc, cachedButUnreferenced));
    const b = await snapshotOf(thumbResponse(svc, missing));
    const c = await snapshotOf(thumbResponse(svc, '../../../etc/passwd'));
    expect(a.status).toBe(404);
    expect(a).toEqual(b);
    expect(c).toEqual(b);
  });

  test('R6: another project’s picture is not this project’s, even under the same key', async () => {
    const one = project();
    const two = project();
    const r = await settle(one.svc, COVER);
    if (r.status !== 'ready') throw new Error('not ready');
    expect(thumbResponse(one.svc, r.key).status).toBe(200);
    expect(await snapshotOf(thumbResponse(two.svc, r.key))).toEqual(
      await snapshotOf(thumbResponse(two.svc, randomBytes(32).toString('hex')))
    );
  });

  test('R6: want answers nothing about any key', async () => {
    const { svc } = project();
    const r = await settle(svc, COVER);
    if (r.status !== 'ready') throw new Error('not ready');
    const ask = (keys: string[]) =>
      wantResponse(
        svc,
        new Request('http://x/_api/thumbs/want', { method: 'POST', body: JSON.stringify({ keys }) })
      );
    const known = await snapshotOf(await ask([r.key]));
    const unknown = await snapshotOf(await ask([randomBytes(32).toString('hex')]));
    expect(known).toEqual(unknown);
  });

  test('R7: a cell renders nothing', async () => {
    const { svc } = project({ enabled: false });
    expect(await svc.thumb(COVER)).toEqual({ status: 'unavailable', reason: 'no-engine' });
    expect(await svc.assetTile('ui/x.png', 'card')).toEqual({
      status: 'unavailable',
      reason: 'no-engine',
    });
  });
});

describe('picture routes answer on the main origin only (V2-2.17 R4)', () => {
  test('canvas and capture origins refuse both routes; the main origin answers', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_UI_PREFS_PATH: join(root, 'prefs.json'),
    });
    procs.push(proc);
    const info = JSON.parse(readFileSync(join(root, '.design', '_server.json'), 'utf8'));
    const capture = await captureOriginOf(port);
    expect(typeof info.canvasOrigin).toBe('string');
    expect(capture).not.toBeNull();
    const key = randomBytes(32).toString('hex');
    const main = `http://localhost:${port}`;

    const mainGet = await fetch(`${main}/_api/thumb/${key}`);
    expect(mainGet.status).toBe(404);
    expect(await mainGet.text()).toBe('Not found');
    const mainWant = await fetch(`${main}/_api/thumbs/want`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: [key] }),
    });
    expect(mainWant.status).toBe(200);

    for (const origin of [info.canvasOrigin as string, capture as string]) {
      const get = await fetch(`${origin}/_api/thumb/${key}`);
      expect(`${origin} GET ${get.status}`).toBe(`${origin} GET 403`);
      const want = await fetch(`${origin}/_api/thumbs/want`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [key] }),
      });
      expect([403, 405]).toContain(want.status);
    }
    // a cross-site page cannot read a picture off the main origin either
    const xsite = await fetch(`${main}/_api/thumb/${key}`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(xsite.status).toBe(403);
  }, 30_000);

  test('neither route is in CANVAS_SAFE_API', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const start = src.indexOf('const CANVAS_SAFE_API = new Set([');
    const end = src.indexOf(']);', start);
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end)).not.toMatch(/thumb/);
  });
});
