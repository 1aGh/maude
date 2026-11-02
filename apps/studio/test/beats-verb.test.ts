// `maude design beats` (bin/beats.mjs): the sidecar it writes, `--bpm` keeping the phase and a newer peer's
// keys, `--dry-run`, argument refusals, and the ffmpeg-missing path — a stub PATH with no ffmpeg decodes in
// headless Chromium and writes the same beats (V2-1.10 #7, S7.3). Every Chromium launch is closed by the shim;
// the test asserts no browser it started is left behind.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { downbeatsOf } from '../video/beats.ts';
import { readBeats } from '../video/schema.ts';
import { fMeasure, render, SYNTH_SR, wavBytes } from './_beats-synth.ts';

const BIN = path.join(import.meta.dir, '..', 'bin', 'beats.mjs');
const hasFfmpeg = Bun.which('ffmpeg') !== null;

let project: string;
let stubBin: string;
const track = render({ name: 'v', bpm: 92, pattern: 'hiphop', swing: 0.62, durationSec: 24 });

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function beats(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const proc = Bun.spawn([process.execPath, 'run', BIN, '--root', project, ...args], {
    env: { ...process.env, NO_OPEN: '1', MAUDE_BEATS_NOW: '2026-10-18T09:00:00.000Z', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

const sidecar = (base: string) => path.join(project, '.design', 'assets', `${base}.beats.json`);
const readGrid = (base: string) => {
  const r = readBeats(readFileSync(sidecar(base), 'utf8'), `assets/${base}.beats.json`);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.value;
};

beforeAll(() => {
  project = mkdtempSync(path.join(tmpdir(), 'maude-beats-'));
  mkdirSync(path.join(project, '.design', 'assets'), { recursive: true });
  writeFileSync(path.join(project, '.design', 'assets', 'm.wav'), wavBytes(track.samples));
  // a 44.1 kHz copy: the two decoders resample differently, so this one is a tolerance check
  const up = new Float32Array(track.samples.length * 2);
  for (let i = 0; i < track.samples.length; i++) {
    const a = track.samples[i] as number;
    const b = (track.samples[i + 1] ?? a) as number;
    up[2 * i] = a;
    up[2 * i + 1] = (a + b) / 2;
  }
  writeFileSync(path.join(project, '.design', 'assets', 'hi.wav'), wavBytes(up, 2 * SYNTH_SR));
  stubBin = mkdtempSync(path.join(tmpdir(), 'maude-nopath-'));
  symlinkSync(process.execPath, path.join(stubBin, 'bun')); // bun runs the verb; ffmpeg is not on this PATH
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(stubBin, { recursive: true, force: true });
});

describe.skipIf(!hasFfmpeg)('maude design beats — ffmpeg path', () => {
  test('writes assets/m.beats.json through the strict writer', async () => {
    const r = await beats(['assets/m.wav', '--decode', 'ffmpeg']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('assets/m.beats.json');
    const g = readGrid('m');
    expect(g.asset).toBe('assets/m.wav');
    expect(g.analyzer).toEqual({ id: 'maude-beats', version: 1, decode: 'ffmpeg' });
    expect(g.bpmSource).toBe('detected');
    expect(Math.abs(g.bpm - 92) / 92).toBeLessThan(0.04);
    expect(fMeasure(g.beats, track.truth)).toBeGreaterThanOrEqual(0.85);
  });

  test('--bpm re-tracks at that tempo, keeps the bar phase and a newer peer’s keys', async () => {
    const before = readGrid('m');
    const peer = {
      ...before,
      futureKey: { kept: true },
      analyzer: { ...before.analyzer, extra: 7 },
    };
    writeFileSync(sidecar('m'), `${JSON.stringify(peer, null, 2)}\n`);
    const r = await beats(['assets/m.wav', '--bpm', String(before.bpm), '--decode', 'ffmpeg']);
    expect(r.code).toBe(0);
    const after = readGrid('m') as unknown as Record<string, unknown> & typeof before;
    expect(after.bpm).toBe(before.bpm);
    expect(after.bpmSource).toBe('set');
    expect(after.bar.phase).toBe(before.bar.phase);
    expect(after.futureKey).toEqual({ kept: true });
    expect((after.analyzer as Record<string, unknown>).extra).toBe(7);
    expect(downbeatsOf(after).length).toBeGreaterThan(5);
  });

  test('--dry-run prints and writes nothing', async () => {
    rmSync(sidecar('m'), { force: true });
    const r = await beats(['assets/m.wav', '--dry-run', '--json', '--decode', 'ffmpeg']);
    expect(r.code).toBe(0);
    expect(existsSync(sidecar('m'))).toBe(false);
    const j = JSON.parse(r.out);
    expect(j.written).toBe(false);
    expect(j.sidecar).toBe('assets/m.beats.json');
    expect(j.grid.beats.length).toBeGreaterThan(20);
  });
});

describe('maude design beats — ffmpeg missing → headless Chromium, identical output', () => {
  test('a PATH with no ffmpeg decodes in Chromium and says so', async () => {
    const r = await beats(['assets/m.wav', '--json', '--dry-run'], { PATH: stubBin });
    expect(r.err).toContain('ffmpeg not found');
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.grid.analyzer.decode).toBe('chromium');
    expect(fMeasure(j.grid.beats, track.truth)).toBeGreaterThanOrEqual(0.85);
  }, 60_000);

  test.skipIf(!hasFfmpeg)(
    '16-bit PCM at the analysis rate: both decoders give the same grid, byte for byte',
    async () => {
      const a = JSON.parse(
        (await beats(['assets/m.wav', '--json', '--dry-run', '--decode', 'ffmpeg'])).out
      );
      const b = JSON.parse(
        (await beats(['assets/m.wav', '--json', '--dry-run'], { PATH: stubBin })).out
      );
      expect(a.grid.analyzer.decode).toBe('ffmpeg');
      expect(b.grid.analyzer.decode).toBe('chromium');
      a.grid.analyzer.decode = b.grid.analyzer.decode = 'x';
      expect(b.grid).toEqual(a.grid);
    },
    60_000
  );

  test.skipIf(!hasFfmpeg)(
    'a file at another rate is resampled by each decoder: beats agree within 30 ms',
    async () => {
      const a = JSON.parse(
        (await beats(['assets/hi.wav', '--json', '--dry-run', '--decode', 'ffmpeg'])).out
      );
      const b = JSON.parse(
        (await beats(['assets/hi.wav', '--json', '--dry-run', '--decode', 'chromium'])).out
      );
      expect(fMeasure(b.grid.beats, a.grid.beats, 0.03)).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(a.grid.bpm - b.grid.bpm)).toBeLessThan(0.5);
    },
    60_000
  );

  test('--decode ffmpeg never falls back: a PATH with no ffmpeg exits 3', async () => {
    const r = await beats(['assets/m.wav', '--dry-run', '--decode', 'ffmpeg'], { PATH: stubBin });
    expect(r.code).toBe(3);
    expect(r.err).toContain('ffmpeg is not installed');
  });
});

describe('maude design beats — refusals', () => {
  test('usage errors exit 2 and name the problem', async () => {
    for (const args of [
      [],
      ['assets/m.wav', '--bpm', 'fast'],
      ['assets/m.wav', '--bpm', '5'],
      ['assets/m.wav', '--bpm'],
      ['assets/m.wav', '--decode', 'sox'],
      ['assets/m.wav', '--nope'],
      ['../outside.wav'],
      ['assets/sub/m.wav'],
    ]) {
      const r = await beats(args);
      expect(r.code).toBe(2);
      expect(r.err).toContain('beats:');
    }
  });

  test('a missing asset exits 4', async () => {
    const r = await beats(['assets/nope.wav', '--dry-run']);
    expect(r.code).toBe(4);
    expect(r.err).toContain('asset not found');
  });

  test('an asset that is not audio exits 4 and writes nothing', async () => {
    writeFileSync(path.join(project, '.design', 'assets', 'junk.wav'), 'not audio at all');
    const r = await beats(['assets/junk.wav', '--decode', 'chromium'], {});
    expect(r.code).toBe(4);
    expect(existsSync(sidecar('junk'))).toBe(false);
  }, 60_000);
});
