// #128 §1 (burndown T3.4) — importing footage names a clip that plays but cannot be exported with sound
// (HEVC, variable frame rate, a second audio track), with the asset and the codec. A plain clip is silent
// about it; with no ffprobe nothing is invented. Tiny synthetic clips from ffmpeg (skips without it).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ingestFootage } from '../bin/_ingest-footage.mjs';
import { synthClip, toolsFor } from './_media-synth.ts';

const T = toolsFor();
if (!T.ok) console.warn(`ingest-footage-media-warning.test: skipped — ${T.why}`);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'maude-t34-ing-'));
  dirs.push(base);
  const src = join(base, 'podklady');
  const root = join(base, 'repo');
  mkdirSync(src);
  mkdirSync(root);
  return { src, root };
}

describe.skipIf(!T.ok)('ingest-footage — the media warning', () => {
  test('an HEVC iPhone-style clip comes back with a warning naming its asset and codec', async () => {
    const { src, root } = setup();
    synthClip(src, 'IMG_0001.mov', { codec: 'hevc', vfr: true });
    synthClip(src, 'IMG_0002.mp4', {});
    const r = await ingestFootage({ dir: src, root });
    expect(r.clips.length).toBe(2);
    const bad = r.clips.find((c: { src: string }) => c.src.endsWith('IMG_0001.mov'));
    const ok = r.clips.find((c: { src: string }) => c.src.endsWith('IMG_0002.mp4'));
    expect(bad.warning).toContain(bad.asset);
    expect(bad.warning).toContain('HEVC (H.265)');
    expect(bad.warning).toContain('variable frame rate');
    expect(bad.warning).toContain(`maude design video-proxy ${bad.asset}`);
    expect(ok.warning).toBeUndefined();
    expect(r.warnings).toEqual([bad.warning]);
  });

  test('without ffprobe the import is unchanged: no warning, nothing thrown', async () => {
    const { src, root } = setup();
    synthClip(src, 'IMG_0003.mov', { codec: 'hevc' });
    const r = await ingestFootage({ dir: src, root, probe: null });
    expect(r.clips.length).toBe(1);
    expect(r.clips[0].warning).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });
});
