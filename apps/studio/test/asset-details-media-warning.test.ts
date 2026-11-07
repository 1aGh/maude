// #128 §1 (burndown T3.4) — the asset details of a clip that plays but cannot be exported with sound
// (HEVC, variable frame rate, a second audio track) carry a heads-up naming the codec and the fix.
// The seam is `probe`; one case runs the real ffprobe on a synthetic clip (skips without ffmpeg).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assetDetails } from '../asset-details.ts';
import { synthClip, toolsFor } from './_media-synth.ts';

const T = toolsFor();
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const project = () => {
  const r = mkdtempSync(path.join(tmpdir(), 'asset-details-mw-'));
  roots.push(r);
  mkdirSync(path.join(r, 'assets'), { recursive: true });
  return r;
};
const opts = (root: string, extra: Record<string, unknown> = {}) => ({
  designRoot: root,
  usedIn: [] as string[],
  readCanvas: () => null,
  includeOriginal: false,
  ...extra,
});
const fake =
  (video: Record<string, unknown>, audio = 1) =>
  () => ({
    video: { codec: 'h264', vfr: false, ...video },
    audio: Array.from({ length: audio }, () => ({ codec: 'aac' })),
  });

describe('assetDetails — mediaWarnings', () => {
  test('an HEVC clip: one warning naming the asset, the codec and the fix', () => {
    const root = project();
    writeFileSync(path.join(root, 'assets', '3b165be8.mp4'), 'x');
    const d = assetDetails('assets/3b165be8.mp4', opts(root, { probe: fake({ codec: 'hevc' }) }));
    expect(d?.mediaWarnings?.length).toBe(1);
    expect(d?.mediaWarnings?.[0]).toContain('assets/3b165be8.mp4');
    expect(d?.mediaWarnings?.[0]).toContain('HEVC (H.265)');
    expect(d?.mediaWarnings?.[0]).toContain('maude design video-proxy assets/3b165be8.mp4');
  });

  test('a plain clip has none; a picture and a sound are never probed', () => {
    const root = project();
    writeFileSync(path.join(root, 'assets', 'aaaaaaaa.mp4'), 'x');
    writeFileSync(path.join(root, 'assets', 'bbbbbbbb.png'), 'x');
    writeFileSync(path.join(root, 'assets', 'cccccccc.mp3'), 'x');
    let probed = 0;
    const probe = (...a: unknown[]) => {
      probed += 1;
      return fake({})(...(a as []));
    };
    expect(
      assetDetails('assets/aaaaaaaa.mp4', opts(root, { probe }))?.mediaWarnings
    ).toBeUndefined();
    expect(
      assetDetails('assets/bbbbbbbb.png', opts(root, { probe }))?.mediaWarnings
    ).toBeUndefined();
    expect(
      assetDetails('assets/cccccccc.mp3', opts(root, { probe }))?.mediaWarnings
    ).toBeUndefined();
    expect(probed).toBe(1);
  });

  test('no ffprobe (probe answers null): no warning, no throw', () => {
    const root = project();
    writeFileSync(path.join(root, 'assets', 'dddddddd.mov'), 'x');
    const d = assetDetails('assets/dddddddd.mov', opts(root, { probe: () => null }));
    expect(d).not.toBeNull();
    expect(d?.mediaWarnings).toBeUndefined();
  });

  test.skipIf(!T.ok)('the real ffprobe, a real HEVC clip', () => {
    const root = project();
    synthClip(path.join(root, 'assets'), 'eeeeeeee.mov', { codec: 'hevc' });
    const d = assetDetails('assets/eeeeeeee.mov', opts(root));
    expect(d?.mediaWarnings?.[0]).toContain('HEVC (H.265)');
  });
});
