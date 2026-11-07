// #128 §1 / #127 (burndown T3.4) — a clip that PLAYS but cannot be exported with sound (HEVC, variable
// frame rate, a second audio track) is named at import, and a proxy can be made next to it. The clips
// are tiny synthetic ones made by ffmpeg here; without ffmpeg (+ the encoder) the test says so and skips.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  describeMedia,
  findTool,
  makeProxy,
  mediaIssues,
  probeMedia,
  proxyFps,
} from '../bin/_media-probe.mjs';
import { synthClip, toolsFor } from './_media-synth.ts';

const T = toolsFor();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'maude-t34-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

if (!T.ok) console.warn(`media-probe.test: skipped — ${T.why}`);

describe.skipIf(!T.ok)('probeMedia + mediaIssues — the three export killers', () => {
  test('an HEVC clip is named as HEVC', () => {
    const f = synthClip(tmp(), 'phone.mov', { codec: 'hevc' });
    const p = probeMedia(f);
    expect(p?.video.codec).toBe('hevc');
    expect(mediaIssues(p).map((i) => i.kind)).toEqual(['hevc']);
  });

  test('a variable-frame-rate clip is flagged, a constant one is not', () => {
    const d = tmp();
    const vfr = probeMedia(synthClip(d, 'vfr.mp4', { vfr: true }));
    expect(mediaIssues(vfr).map((i) => i.kind)).toEqual(['vfr']);
    const cfr = probeMedia(synthClip(d, 'cfr.mp4', {}));
    expect(mediaIssues(cfr)).toEqual([]);
  });

  test('more than one audio track is flagged', () => {
    const p = probeMedia(synthClip(tmp(), 'two.mov', { audioTracks: 2 }));
    expect(p?.audio.length).toBe(2);
    expect(mediaIssues(p).map((i) => i.kind)).toEqual(['audio-tracks']);
  });

  test('a plain H.264 / CFR / one-audio clip says nothing', () => {
    const f = synthClip(tmp(), 'ok.mp4', {});
    expect(describeMedia('assets/aaaaaaaa.mp4', probeMedia(f))).toBeNull();
  });

  test('the warning names the asset and the codec, and the remedy', () => {
    const f = synthClip(tmp(), 'phone.mov', { codec: 'hevc', audioTracks: 2 });
    const text = describeMedia('assets/3b165be8.mov', probeMedia(f)) ?? '';
    expect(text).toContain('assets/3b165be8.mov');
    expect(text).toContain('HEVC');
    expect(text).toContain('2 audio tracks');
    expect(text).toContain('maude design video-proxy assets/3b165be8.mov');
  });

  test('no ffprobe, or not a video: null, never a throw', () => {
    const f = synthClip(tmp(), 'ok.mp4', {});
    expect(probeMedia(f, { ffprobe: null })).toBeNull();
    const junk = join(tmp(), 'junk.mp4');
    writeFileSync(junk, 'not a video');
    expect(probeMedia(junk)).toBeNull();
  });
});

describe('proxyFps', () => {
  test('a variable clip is conformed to the nearest standard rate; a constant one keeps its own', () => {
    const v = (avg: number, vfr: boolean, r = '30/1') => ({
      video: { codec: 'h264', avgFps: avg, vfr, rFrameRate: r },
      audio: [],
    });
    expect(proxyFps(v(32.45, true, '60/1'))).toBe('30');
    expect(proxyFps(v(24.2, true, '60/1'))).toBe('24');
    expect(proxyFps(v(29.97, false, '30000/1001'))).toBe('30000/1001');
  });
});

describe.skipIf(!T.ok)('makeProxy — an H.264 / CFR / single-AAC copy next to the original', () => {
  test('HEVC + two audio tracks in, one H.264 constant-rate AAC file out; the original is untouched', () => {
    const d = tmp();
    const assets = join(d, 'assets');
    mkdirSync(assets);
    const src = synthClip(assets, 'cafe0001.mov', { codec: 'hevc', audioTracks: 2, vfr: true });
    const before = sha(src);

    const r = makeProxy({ src, outDir: assets });
    const out = probeMedia(r.file);
    expect(out?.video.codec).toBe('h264');
    expect(out?.video.vfr).toBe(false);
    expect(out?.audio.map((a) => a.codec)).toEqual(['aac']);
    expect(mediaIssues(out)).toEqual([]);
    // content-addressed, like every asset: assets/<sha8>.mp4
    expect(r.name).toBe(`${sha(r.file).slice(0, 8)}.mp4`);
    // next to the original, original byte-identical, no scratch left behind
    expect(sha(src)).toBe(before);
    expect(readdirSync(assets).sort()).toEqual(['cafe0001.mov', r.name].sort());
  });

  test('a silent clip gets a silent proxy (no audio is invented)', () => {
    const assets = join(tmp(), 'assets');
    mkdirSync(assets);
    const src = synthClip(assets, 'cafe0002.mp4', { codec: 'hevc', audioTracks: 0 });
    const r = makeProxy({ src, outDir: assets });
    expect(probeMedia(r.file)?.audio).toEqual([]);
  });

  test('not a video: ProxyError code 4, nothing written', () => {
    const assets = join(tmp(), 'assets');
    mkdirSync(assets);
    const junk = join(assets, 'junk.mp4');
    writeFileSync(junk, 'nope');
    expect(() => makeProxy({ src: junk, outDir: assets })).toThrow(/ffprobe can read/);
    expect(readdirSync(assets)).toEqual(['junk.mp4']);
  });

  test('without ffmpeg it refuses by name (code 3)', () => {
    expect(() => makeProxy({ src: '/x.mp4', outDir: '/tmp', ffmpeg: null })).toThrow(
      /ffmpeg and ffprobe/
    );
  });
});

test('findTool answers null for a tool that does not exist', () => {
  expect(findTool('definitely-not-a-real-tool-xyz')).toBeNull();
});
