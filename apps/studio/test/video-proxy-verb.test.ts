// #128 §1 (burndown T3.4) — `maude design video-proxy assets/<clip>`: an explicit action that writes an
// H.264 / constant-rate / single-AAC copy next to a clip, never touches the original, and reads nothing
// outside the project's assets/. Run through the real shim, like the verb is. Skips without ffmpeg.

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mediaIssues, probeMedia } from '../bin/_media-probe.mjs';
import { synthClip, toolsFor } from './_media-synth.ts';

const T = toolsFor();
if (!T.ok) console.warn(`video-proxy-verb.test: skipped — ${T.why}`);

const SHIM = join(import.meta.dir, '..', 'bin', 'video-proxy.sh');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function project() {
  const root = mkdtempSync(join(tmpdir(), 'maude-t34-verb-'));
  dirs.push(root);
  const assets = join(root, '.design', 'assets');
  mkdirSync(assets, { recursive: true });
  return { root, assets };
}
function run(root: string, ...args: string[]) {
  const p = Bun.spawnSync(['bash', SHIM, ...args, '--root', root], { env: process.env });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

describe.skipIf(!T.ok)('video-proxy', () => {
  test('HEVC + two audio tracks in: an H.264 / CFR / one-AAC asset out, original untouched', () => {
    const { root, assets } = project();
    const src = synthClip(assets, '3b165be8.mov', { codec: 'hevc', audioTracks: 2, vfr: true });
    const before = sha(src);
    const r = run(root, 'assets/3b165be8.mov');
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.source).toBe('assets/3b165be8.mov');
    expect(j.proxy).toMatch(/^assets\/[0-9a-f]{8}\.mp4$/);
    expect(j.found.join(' ')).toContain('HEVC');
    const p = probeMedia(join(root, '.design', j.proxy));
    expect(p?.video.codec).toBe('h264');
    expect(mediaIssues(p)).toEqual([]);
    expect(sha(src)).toBe(before);
    expect(readdirSync(assets).length).toBe(2);
  });

  test('a path outside assets/ is refused (6) and nothing is written', () => {
    const { root, assets } = project();
    const outside = mkdtempSync(join(tmpdir(), 'maude-t34-out-'));
    dirs.push(outside);
    synthClip(outside, 'secret.mp4', { codec: 'hevc' });
    expect(run(root, join(outside, 'secret.mp4')).code).toBe(6);
    // a symlink inside assets/ that points out is outside too
    symlinkSync(join(outside, 'secret.mp4'), join(assets, 'linkrel0.mp4'));
    expect(run(root, 'assets/linkrel0.mp4').code).toBe(6);
    expect(readdirSync(assets)).toEqual(['linkrel0.mp4']);
  });

  test('not a video is 4, a missing asset is 2', () => {
    const { root, assets } = project();
    writeFileSync(join(assets, 'aaaaaaaa.png'), 'x');
    expect(run(root, 'assets/aaaaaaaa.png').code).toBe(4);
    expect(run(root, 'assets/nope0000.mp4').code).toBe(2);
  });
});
