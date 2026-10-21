// photo-edit-api.test.ts — the /_api/photo-edit route + photo-store cap stack
// (feature-photo-editor, Task 23; pairs with Stage C). Mirrors asset-api.test.ts
// (real-server round-trip) + canvas-origin-gate.test.ts (dual-allowlist proof).
//
// Coverage per the plan: schema validation rejects malformed PhotoEdit JSON, the
// size cap is enforced, path containment holds against a crafted `asset` param,
// GET/PUT both work, and the route's presence in BOTH allowlists is asserted
// (reachable + method-gated from the segregated canvas origin — the DDR-088
// one-list-only 404 bug this test exists to prevent).

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assetSha8 } from '../photo-store.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const VALID_SHA = 'ab12cd34ef56';
const VALID_ASSET = `assets/${VALID_SHA}.png`;

// ── Pure: sha8 extraction is the primary traversal defense ───────────────────
describe('assetSha8 — extraction + traversal rejection (pure)', () => {
  test('accepts the forms a caller might hold', () => {
    expect(assetSha8(VALID_ASSET)).toBe(VALID_SHA);
    expect(assetSha8(`/assets/${VALID_SHA}.png`)).toBe(VALID_SHA);
    expect(assetSha8(`${VALID_SHA}.jpg`)).toBe(VALID_SHA);
    expect(assetSha8(VALID_SHA)).toBe(VALID_SHA);
  });
  test('rejects traversal / non-hex / empty', () => {
    for (const bad of [
      null,
      undefined,
      '',
      '../../etc/passwd',
      'assets/../../secret',
      'assets/..%2f..%2fx', // query-decoded to `../../x` before we see it
      '/etc/passwd',
      'not-hex-zzz',
      'ab12cd34/../x',
      '../ab12cd34',
    ]) {
      expect(assetSha8(bad)).toBeNull();
    }
  });
});

// ── Real-server round-trip ───────────────────────────────────────────────────
async function withServer(
  fn: (port: number, designRoot: string) => Promise<void>,
  extraEnv?: Record<string, string>
) {
  const sandbox = makeSandbox();
  const port = nextPort();
  const proc = await bootServer(sandbox.root, port, extraEnv);
  try {
    await fn(port, sandbox.designRoot);
  } finally {
    await killProc(proc);
  }
}

const put = (port: number, asset: string, body: unknown) =>
  fetch(`http://localhost:${port}/_api/photo-edit?asset=${encodeURIComponent(asset)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (port: number, asset: string) =>
  fetch(`http://localhost:${port}/_api/photo-edit?asset=${encodeURIComponent(asset)}`);

describe('/_api/photo-edit — GET/PUT round-trip + cap stack (main origin)', () => {
  test('PUT a valid edit persists it; GET reads it back; sidecar lands on disk', async () => {
    await withServer(async (port, designRoot) => {
      const edit = {
        adjustments: { contrast: 0.3, brightness: -0.1 },
        duotone: { enabled: true, colorA: '#1a1a2e', colorB: '#e94560', intensity: 0.8 },
      };
      const res = await put(port, VALID_ASSET, edit);
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.ok).toBe(true);
      expect(j.path).toBe(`assets/${VALID_SHA}.photo.json`);
      expect(j.edit.version).toBe(1); // stamped on write

      // GET round-trips the same params.
      const got = await (await get(port, VALID_ASSET)).json();
      expect(got.adjustments.contrast).toBe(0.3);
      expect(got.duotone.colorB).toBe('#e94560');

      // The sidecar actually exists at the content-addressed path.
      const disk = join(designRoot, 'assets', `${VALID_SHA}.photo.json`);
      expect(existsSync(disk)).toBe(true);
      expect(JSON.parse(readFileSync(disk, 'utf8')).version).toBe(1);
    });
  });

  test('GET of an unedited asset returns {}', async () => {
    await withServer(async (port) => {
      const got = await (await get(port, 'assets/00ff00ff.png')).json();
      expect(got).toEqual({});
    });
  });

  test('PUT malformed JSON is rejected (unknown key / bad type / out-of-range)', async () => {
    await withServer(async (port) => {
      expect((await put(port, VALID_ASSET, { bogusKey: 1 })).status).toBe(400);
      expect((await put(port, VALID_ASSET, { adjustments: { contrast: 'high' } })).status).toBe(
        400
      );
      expect((await put(port, VALID_ASSET, { adjustments: { contrast: 5 } })).status).toBe(400);
      expect((await put(port, VALID_ASSET, { duotone: { colorA: 'red' } })).status).toBe(400);
      // A crafted non-relative asset path in the body is rejected too.
      expect((await put(port, VALID_ASSET, { source: '/etc/passwd' })).status).toBe(400);
    });
  });

  test('PUT with a crafted asset param (traversal) is rejected 400', async () => {
    await withServer(async (port) => {
      expect((await put(port, '../../etc/passwd', { adjustments: { contrast: 0.1 } })).status).toBe(
        400
      );
      expect((await get(port, 'assets/../../secret')).status).toBe(200); // GET → {} (null-safe), never leaks
      const leaked = await (await get(port, 'assets/../../secret')).json();
      expect(leaked).toEqual({});
    });
  });

  test('PUT an oversized body is rejected (size cap)', async () => {
    await withServer(async (port) => {
      // `source` is a valid relative asset path with no length cap in the schema,
      // so it's the field that can legally exceed the 64 KB byte cap. Sits just
      // above the store cap but below the route's readJson ceiling.
      const big = { source: `assets/${'a'.repeat(66000)}` };
      const res = await put(port, VALID_ASSET, big);
      expect(res.status).toBe(413);
    });
  });

  test('method gate — DELETE is 405', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/_api/photo-edit?asset=${VALID_ASSET}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(405);
    });
  });
});

// ── Dual-allowlist: reachable + method-gated from the canvas origin ──────────
async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

/**
 * gate-b-c4 — the frame of a canvas that uses VALID_ASSET (the canvas origin answers nothing per
 * canvas without a capability, and a photo sidecar is writable only by a frame that may edit
 * every canvas using the photo).
 */
async function photoFrame(port: number, designRoot: string): Promise<string | null> {
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, VALID_ASSET), 'PNG-BYTES');
  writeFileSync(
    join(designRoot, 'ui', 'photo.tsx'),
    `export default function P(){return <img src="/assets/${VALID_SHA}.png" alt="" />}\n`
  );
  return frameCap({ base: `http://localhost:${port}` }, {}, 'ui/photo.tsx');
}

describe('/_api/photo-edit — dual-allowlist (canvas origin reachable, DDR-088)', () => {
  test('canvas origin: GET is reachable (200, not 404) and DELETE is method-gated (405)', async () => {
    await withServer(
      async (port, designRoot) => {
        const canvas = await readCanvasOrigin(designRoot);
        // gate-b-c4 — from inside the frame of the canvas that uses the photo.
        const fc = await photoFrame(port, designRoot);
        // If the route were in CANVAS_SAFE_API only (missing from server.ts's
        // `routes` map), Bun's fetch fall-through would serve it as a FILE → 404.
        // 200 here proves the handler runs → it's in the server.ts routes map too.
        const gRes = await fetch(withFc(`${canvas}/_api/photo-edit?asset=${VALID_ASSET}`, fc), {
          signal: AbortSignal.timeout(3000),
        });
        expect(gRes.status).toBe(200);
        // DELETE reaches the handler (405), not the file fall-through (404).
        const dRes = await fetch(withFc(`${canvas}/_api/photo-edit?asset=${VALID_ASSET}`, fc), {
          method: 'DELETE',
          signal: AbortSignal.timeout(3000),
        });
        expect(dRes.status).toBe(405);
      },
      { MAUDE_CANVAS_ORIGIN_SPLIT: '1' }
    );
  });

  test('canvas origin: PUT succeeds (no sameOriginWrite block — the headless harness needs this)', async () => {
    await withServer(
      async (port, designRoot) => {
        const canvas = await readCanvasOrigin(designRoot);
        const fc = await photoFrame(port, designRoot);
        const res = await fetch(withFc(`${canvas}/_api/photo-edit?asset=${VALID_ASSET}`, fc), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjustments: { saturation: 0.5 } }),
          signal: AbortSignal.timeout(3000),
        });
        expect(res.status).toBe(200);
      },
      { MAUDE_CANVAS_ORIGIN_SPLIT: '1' }
    );
  });
  test('the bg-remove harness frame (main-origin redirect) may PUT the sidecar of a photo a canvas uses', async () => {
    // gate-b-c4 — the real headless path: photo-bg-remove.sh opens the harness through the main
    // origin, whose 307 carries the frame capability; the harness PUTs the matte's PhotoEdit.
    await withServer(
      async (port, designRoot) => {
        await photoFrame(port, designRoot); // ui/photo.tsx uses the photo
        mkdirSync(join(designRoot, '_photo'), { recursive: true });
        writeFileSync(
          join(designRoot, '_photo', 'deadbeef.bgremove.tsx'),
          `export default function H(){return <img src="/assets/${VALID_SHA}.png" alt="" />}\n`
        );
        const r = await fetch(
          `http://localhost:${port}/_canvas-shell.html?canvas=_photo/deadbeef.bgremove.tsx`,
          { redirect: 'manual' }
        );
        expect(r.status).toBe(307);
        const loc = new URL(r.headers.get('location') ?? '');
        const fc = loc.searchParams.get('fc');
        expect(fc).toBeTruthy();
        const res = await fetch(withFc(`${loc.origin}/_api/photo-edit?asset=${VALID_ASSET}`, fc), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adjustments: { saturation: 0.5 } }),
          signal: AbortSignal.timeout(3000),
        });
        expect(res.status).toBe(200);
      },
      { MAUDE_CANVAS_ORIGIN_SPLIT: '1' }
    );
  });
});
