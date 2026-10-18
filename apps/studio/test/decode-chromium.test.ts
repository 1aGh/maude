// test/decode-chromium.test.ts — S7.2: the "no ffmpeg" decode (headless Chromium WebAudio) gives the
// same samples as the WAV reader, within the resample tolerance. Skips when no Chromium is installed
// (the shim exits 3), so it is green on a bare CI box and meaningful on a dev machine.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../video/decode.ts';
import { SR, synth } from './fixtures/video/synth.ts';

const SHIM = `${import.meta.dir}/../bin/_decode-chromium.mjs`;
const dir = mkdtempSync(join(tmpdir(), 'maude-dc-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('_decode-chromium.mjs', () => {
  test('a 16 kHz WAV decodes to the same length and shape (or skips: no Chromium)', () => {
    const pcm = synth([{ start: 0.2, end: 0.6 }], 1);
    const wav = join(dir, 'a.wav');
    const out = join(dir, 'a.f32');
    writeFileSync(wav, encodeWav(pcm, SR));
    const r = Bun.spawnSync([process.execPath, SHIM, wav, String(SR), out], {
      env: { ...process.env, NO_OPEN: '1' },
    });
    if (r.exitCode === 3) return; // no Chromium here — the shim said so cleanly
    expect(r.stderr.toString()).toBe('');
    expect(r.exitCode).toBe(0);
    const b = readFileSync(out);
    const got = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    expect(Math.abs(got.length - pcm.length)).toBeLessThanOrEqual(2);
    let err = 0;
    for (let i = 0; i < Math.min(got.length, pcm.length); i++)
      err = Math.max(err, Math.abs(got[i] - pcm[i]));
    expect(err).toBeLessThan(0.001);
  }, 60_000);

  test('bad usage is exit 2 and a file it cannot decode is exit 4 (never a hang)', () => {
    expect(Bun.spawnSync([process.execPath, SHIM, '/nope', 'abc', '/tmp/x']).exitCode).toBe(2);
    const junk = join(dir, 'junk.mp4');
    writeFileSync(junk, 'not media at all');
    const r = Bun.spawnSync([process.execPath, SHIM, junk, String(SR), join(dir, 'j.f32')]);
    expect([3, 4]).toContain(r.exitCode); // 3 = no browser on this machine
  }, 60_000);
});
