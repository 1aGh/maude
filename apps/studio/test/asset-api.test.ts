// POST /_api/asset — Phase 23 content-addressed image upload (Task 5).
//
// Two layers:
//   (1) the pure magic-byte sniff (`sniffImageType`) — the ONE gate that decides
//       the stored type; a header lie / SVG is caught here;
//   (2) the POST endpoint round-trip (boots a real server against a sandbox) —
//       happy path for all four types, header-lie, oversize, SVG-reject,
//       content-addressed dedupe, method gate.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ASSET_MAX_BYTES, sniffImageType } from '../api.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

// ── Minimal valid magic-byte headers (padded so length checks pass). ──────────
const pad = (header: number[], len = 64): Uint8Array => {
  const out = new Uint8Array(len);
  out.set(header, 0);
  return out;
};
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const GIF = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // RIFF????WEBP
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

describe('asset-api / sniffImageType (the type gate)', () => {
  test('recognizes each supported raster type by magic bytes', () => {
    expect(sniffImageType(PNG)).toBe('png');
    expect(sniffImageType(JPEG)).toBe('jpg');
    expect(sniffImageType(GIF)).toBe('gif');
    expect(sniffImageType(WEBP)).toBe('webp');
  });

  test('rejects SVG / text / empty / truncated headers', () => {
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('not an image'))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    // Truncated PNG signature (only 4 of 8 bytes) must NOT match.
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    // RIFF without the WEBP fourcc (e.g. a WAV) must NOT match.
    expect(
      sniffImageType(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))
    ).toBeNull();
  });

  test('content addresses the stored ext (a .png NAME with GIF bytes sniffs gif)', () => {
    // The route names the file from sniffImageType(bytes), never the upload name.
    expect(sniffImageType(GIF)).toBe('gif');
  });
});

describe('asset-api / POST /_api/asset (endpoint round-trip)', () => {
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

  const postAsset = (port: number, body: Uint8Array, contentType = 'application/octet-stream') =>
    fetch(`http://localhost:${port}/_api/asset`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

  test('writes a valid PNG/JPEG/WEBP/GIF and returns its assets path', async () => {
    await withServer(async (port, designRoot) => {
      for (const [bytes, ext] of [
        [PNG, 'png'],
        [JPEG, 'jpg'],
        [WEBP, 'webp'],
        [GIF, 'gif'],
      ] as const) {
        const res = await postAsset(port, bytes);
        expect(res.status).toBe(201);
        const json = (await res.json()) as { path: string };
        expect(json.path).toMatch(new RegExp(`^assets/[0-9a-f]{8}\\.${ext}$`));
        expect(existsSync(join(designRoot, json.path))).toBe(true);
      }
    });
  });

  test('a header-lie (declared image/png, GIF bytes) is stored as .gif (sniff wins)', async () => {
    await withServer(async (port) => {
      const res = await postAsset(port, GIF, 'image/png');
      expect(res.status).toBe(201);
      const json = (await res.json()) as { path: string };
      expect(json.path.endsWith('.gif')).toBe(true);
    });
  });

  test('rejects an SVG upload (no script-bearing vector) with 415', async () => {
    await withServer(async (port) => {
      const res = await postAsset(port, SVG, 'image/svg+xml');
      expect(res.status).toBe(415);
    });
  });

  test('rejects an oversize body (> ASSET_MAX_BYTES) with 413', async () => {
    await withServer(async (port) => {
      const big = new Uint8Array(ASSET_MAX_BYTES + 1);
      big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // valid PNG header
      const res = await postAsset(port, big);
      expect(res.status).toBe(413);
    });
  });

  test('identical bytes dedupe to ONE file (content-addressed; disk-fill guard)', async () => {
    await withServer(async (port, designRoot) => {
      const a = await (await postAsset(port, PNG)).json();
      const b = await (await postAsset(port, PNG)).json();
      expect(a.path).toBe(b.path);
      const files = readdirSync(join(designRoot, 'assets'));
      expect(files.length).toBe(1);
    });
  });

  test('a planted file under the content name is never returned as the dedupe hit (A4)', async () => {
    await withServer(async (port, designRoot) => {
      const a = await (await postAsset(port, PNG)).json();
      // Someone landed different bytes under the name the real bytes hash to.
      const planted = join(designRoot, a.path);
      const evil = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad]);
      writeFileSync(planted, evil);
      const res = await postAsset(port, PNG);
      expect(res.status).toBe(201);
      const b = await res.json();
      expect(b.path).not.toBe(a.path);
      expect(Buffer.from(readFileSync(join(designRoot, b.path)))).toEqual(Buffer.from(PNG));
      // The real bytes now dedupe against their own (verified) copy, not the planted one.
      const c = await (await postAsset(port, PNG)).json();
      expect(c.path).toBe(b.path);
    });
  });

  test('GET /_api/asset is method-not-allowed (write-only)', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/_api/asset`);
      expect(res.status).toBe(405);
    });
  });

  test('enforces the aggregate session write budget (disk-fill guard → 429)', async () => {
    // Budget = 100 bytes; each padded magic-byte image is 64 bytes. The first
    // DISTINCT write fits (64); a second distinct image (64) would total 128 >
    // 100 → rejected. A dedupe hit (same bytes) is free and must NOT count.
    await withServer(
      async (port) => {
        expect((await postAsset(port, PNG)).status).toBe(201); // 64 written
        expect((await postAsset(port, PNG)).status).toBe(201); // dedupe — free
        expect((await postAsset(port, JPEG)).status).toBe(429); // 64+64 > 100
      },
      { MAUDE_ASSET_SESSION_BUDGET: '100' }
    );
  });
});
