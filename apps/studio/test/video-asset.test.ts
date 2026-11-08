// POST /_api/asset — DDR-148 video/audio widening of the Phase 23 asset route.
//
// Two layers (mirroring asset-api.test.ts):
//   (1) the pure magic-byte sniff (`sniffAssetType`) — the ONE gate that decides
//       the stored type AND category (→ which cap applies); a header lie / SVG /
//       script is caught here;
//   (2) the streaming POST endpoint (boots a real server) — video/audio happy
//       path, per-category cap (image stays tighter than video; video honors
//       the MAUDE_ASSET_MAX_VIDEO_BYTES override), content-addressed dedupe.

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ASSET_MAX_BYTES, assetCapForCategory, sniffAssetType } from '../api.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

// ── Minimal valid magic-byte headers (padded so the ≥12-byte sniff has data). ──
const pad = (header: number[], len = 64): Uint8Array => {
  const out = new Uint8Array(len);
  out.set(header, 0);
  return out;
};
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const MP4 = pad([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')]);
const MOV = pad([0, 0, 0, 0x14, ...ascii('ftyp'), ...ascii('qt  ')]);
const M4A = pad([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('M4A ')]);
const WEBM = pad([0x1a, 0x45, 0xdf, 0xa3]);
const MP3_ID3 = pad([...ascii('ID3'), 0x03, 0x00]);
const MP3_SYNC = pad([0xff, 0xfb, 0x90, 0x00]);
const WAV = pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

describe('video-asset / sniffAssetType (the widened type gate)', () => {
  test('recognizes video containers by magic bytes', () => {
    expect(sniffAssetType(MP4)).toEqual({ ext: 'mp4', category: 'video' });
    expect(sniffAssetType(MOV)).toEqual({ ext: 'mov', category: 'video' });
    expect(sniffAssetType(WEBM)).toEqual({ ext: 'webm', category: 'video' });
  });

  test('recognizes audio containers by magic bytes', () => {
    expect(sniffAssetType(M4A)).toEqual({ ext: 'm4a', category: 'audio' });
    expect(sniffAssetType(MP3_ID3)).toEqual({ ext: 'mp3', category: 'audio' });
    expect(sniffAssetType(MP3_SYNC)).toEqual({ ext: 'mp3', category: 'audio' });
    expect(sniffAssetType(WAV)).toEqual({ ext: 'wav', category: 'audio' });
  });

  test('images still resolve through the same superset sniff', () => {
    expect(sniffAssetType(PNG)).toEqual({ ext: 'png', category: 'image' });
  });

  test('rejects SVG / script / text / empty (no script-bearing vector rides in)', () => {
    expect(sniffAssetType(SVG)).toBeNull();
    expect(sniffAssetType(new TextEncoder().encode('not media at all'))).toBeNull();
    expect(sniffAssetType(new Uint8Array(0))).toBeNull();
    // "RIFF" without "WAVE" (or "WEBP") must NOT match a media/image type.
    expect(sniffAssetType(pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('AVI ')]))).toBeNull();
  });

  test('caps: image stays tight, video/audio share the larger cap', () => {
    expect(assetCapForCategory('image')).toBe(ASSET_MAX_BYTES);
    expect(assetCapForCategory('video')).toBeGreaterThan(assetCapForCategory('image'));
    expect(assetCapForCategory('audio')).toBe(assetCapForCategory('video'));
  });
});

describe('video-asset / POST /_api/asset (streaming endpoint)', () => {
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

  const postAsset = (port: number, body: Uint8Array) =>
    fetch(`http://localhost:${port}/_api/asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });

  test('writes valid mp4/mov/webm/mp3/wav/m4a with the sniffed ext', async () => {
    await withServer(async (port, designRoot) => {
      for (const [bytes, ext] of [
        [MP4, 'mp4'],
        [MOV, 'mov'],
        [WEBM, 'webm'],
        [MP3_ID3, 'mp3'],
        [WAV, 'wav'],
        [M4A, 'm4a'],
      ] as const) {
        const res = await postAsset(port, bytes);
        expect(res.status).toBe(201);
        const json = (await res.json()) as { path: string };
        expect(json.path).toMatch(new RegExp(`^assets/[0-9a-f]{8}\\.${ext}$`));
        expect(existsSync(join(designRoot, json.path))).toBe(true);
      }
    });
  });

  test('bytes decide the ext, never the (octet-stream) upload header', async () => {
    await withServer(async (port) => {
      const res = await postAsset(port, MP4);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { path: string };
      expect(json.path.endsWith('.mp4')).toBe(true);
    });
  });

  test('rejects an SVG upload (script-bearing) with 415 even on the media route', async () => {
    await withServer(async (port) => {
      expect((await postAsset(port, SVG)).status).toBe(415);
    });
  });

  test('honors the MAUDE_ASSET_MAX_VIDEO_BYTES per-file cap (streamed → 413)', async () => {
    await withServer(
      async (port) => {
        const big = new Uint8Array(2048);
        big.set([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')], 0); // valid mp4 head
        expect((await postAsset(port, big)).status).toBe(413);
        // A small mp4 under the cap still writes.
        expect((await postAsset(port, MP4)).status).toBe(201);
      },
      { MAUDE_ASSET_MAX_VIDEO_BYTES: '1024' }
    );
  });

  test('identical media bytes dedupe to ONE content-addressed file', async () => {
    await withServer(async (port, designRoot) => {
      const a = await (await postAsset(port, MP4)).json();
      const b = await (await postAsset(port, MP4)).json();
      expect(a.path).toBe(b.path);
      // (#172: the `.added.json` record beside the file is a companion, not a second copy of the bytes.)
      const files = readdirSync(join(designRoot, 'assets')).filter(
        (f) => !f.startsWith('.tmp-') && !f.endsWith('.added.json')
      );
      expect(files.length).toBe(1);
    });
  });

  test('a rejected oversize upload leaves NO temp file behind (clean disk)', async () => {
    await withServer(
      async (port, designRoot) => {
        const big = new Uint8Array(2048);
        big.set([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')], 0);
        expect((await postAsset(port, big)).status).toBe(413);
        const assetsDir = join(designRoot, 'assets');
        const leftover = existsSync(assetsDir)
          ? readdirSync(assetsDir).filter((f) => f.startsWith('.tmp-'))
          : [];
        expect(leftover).toEqual([]);
      },
      { MAUDE_ASSET_MAX_VIDEO_BYTES: '1024' }
    );
  });
});
