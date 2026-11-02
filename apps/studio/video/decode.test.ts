// video/decode.test.ts — S7.2: audio decode (ffmpeg, else headless Chromium) and the WAV reader.
// ffmpeg is faked with a shell script that records its argv, so the tests run on a machine with
// none of the real tools (and prove nothing in a file name reaches a shell).

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { synth } from '../test/fixtures/video/synth.ts';
import {
  DecodeError,
  decodeAudio,
  encodeWav,
  findFfmpeg,
  MAX_DECODE_SEC,
  readWav,
} from './decode.ts';

const SR = 16000;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'maude-decode-test-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fake ffmpeg: logs argv (NUL-separated) to $FAKE_LOG and copies $FAKE_WAV to its last argument. */
function fakeFfmpeg(dir: string, opts: { fail?: boolean } = {}): string {
  const p = join(dir, 'ffmpeg');
  writeFileSync(
    p,
    [
      '#!/bin/sh',
      'if [ "$1" = "-version" ]; then echo "ffmpeg version fake"; exit 0; fi',
      'printf "%s\\0" "$@" > "$FAKE_LOG"',
      opts.fail ? 'echo "fake ffmpeg: Invalid data found" >&2; exit 1' : '',
      'for a; do last=$a; done',
      'cp "$FAKE_WAV" "$last"',
      '',
    ].join('\n')
  );
  chmodSync(p, 0o755);
  return p;
}

describe('encodeWav / readWav', () => {
  test('round-trips mono 16-bit PCM within one LSB', () => {
    const pcm = synth([{ start: 0.1, end: 0.4 }], 0.6);
    const back = readWav(encodeWav(pcm, SR));
    expect(back).not.toBeNull();
    expect(back?.sampleRate).toBe(SR);
    expect(back?.pcm.length).toBe(pcm.length);
    let worst = 0;
    for (let i = 0; i < pcm.length; i++)
      worst = Math.max(worst, Math.abs(pcm[i] - (back?.pcm[i] ?? 0)));
    expect(worst).toBeLessThanOrEqual(1 / 32767 + 1e-9);
  });

  test('mixes stereo down to mono', () => {
    // hand-built stereo header + two frames: L = 16384, R = -16384 → 0 ; L = R = 16384 → 0.5
    const data = new Int16Array([16384, -16384, 16384, 16384]);
    const buf = new Uint8Array(44 + data.byteLength);
    const dv = new DataView(buf.buffer);
    const tag = (o: number, s: string) =>
      [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    tag(0, 'RIFF');
    dv.setUint32(4, 36 + data.byteLength, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 2, true);
    dv.setUint32(24, 8000, true);
    dv.setUint32(28, 8000 * 4, true);
    dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true);
    tag(36, 'data');
    dv.setUint32(40, data.byteLength, true);
    new Int16Array(buf.buffer, 44).set(data);
    const r = readWav(buf);
    expect(r?.sampleRate).toBe(8000);
    expect(Array.from(r?.pcm ?? [])).toEqual([0, 0.5]);
  });

  test('anything that is not a PCM WAV is null, never a throw', () => {
    expect(readWav(new Uint8Array(0))).toBeNull();
    expect(readWav(new TextEncoder().encode('RIFF....WAVEjunk'))).toBeNull();
    expect(readWav(new Uint8Array(100).fill(7))).toBeNull();
  });
});

describe('decodeAudio', () => {
  test('a 16 kHz mono WAV is read directly: ffmpeg is never started', async () => {
    const d = tmp();
    const wav = join(d, 'a.wav');
    writeFileSync(wav, encodeWav(synth([{ start: 0.1, end: 0.3 }], 0.5), SR));
    const bomb = join(d, 'ffmpeg');
    writeFileSync(bomb, '#!/bin/sh\ntouch "$0.ran"\n');
    chmodSync(bomb, 0o755);
    const r = await decodeAudio(wav, { ffmpeg: bomb });
    expect(r.via).toBe('wav');
    expect(r.sampleRate).toBe(SR);
    expect(r.pcm.length).toBe(8000);
    expect(existsSync(`${bomb}.ran`)).toBe(false);
  });

  test('ffmpeg: the file name is ONE argument, in an args array — never a shell string', async () => {
    const d = tmp();
    const marker = join(d, 'PWNED');
    // if any of this reached a shell, `touch PWNED` would run in the child's cwd (= d, below)
    const hostile = join(d, 'a b\'; touch PWNED; $(touch PWNED) `touch PWNED` "x"\n-y.mp4');
    writeFileSync(hostile, 'not really media');
    const wavSrc = join(d, 'src.wav');
    writeFileSync(wavSrc, encodeWav(synth([{ start: 0.1, end: 0.3 }], 0.5), SR));
    const log = join(d, 'argv.log');
    process.env.FAKE_LOG = log;
    process.env.FAKE_WAV = wavSrc;
    const prev = process.cwd();
    process.chdir(d);
    try {
      const r = await decodeAudio(hostile, { ffmpeg: fakeFfmpeg(d) });
      expect(r.via).toBe('ffmpeg');
      expect(r.pcm.length).toBe(8000);
      const argv = readFileSync(log, 'utf8').split('\0').slice(0, -1);
      const i = argv.indexOf('-i');
      expect(i).toBeGreaterThanOrEqual(0);
      expect(argv[i + 1]).toBe(hostile); // byte for byte, newline and quotes included
      expect(existsSync(marker)).toBe(false); // nothing in the name ran
      // a private temp dir, not next to the source, and not a guessable name
      expect(argv[argv.length - 1].startsWith(tmpdir())).toBe(true);
      expect(argv).toContain('-ar');
      expect(argv[argv.indexOf('-ar') + 1]).toBe('16000');
      expect(argv[argv.indexOf('-ac') + 1]).toBe('1');
    } finally {
      process.chdir(prev);
      delete process.env.FAKE_LOG;
      delete process.env.FAKE_WAV;
    }
  });

  test('a name that starts with "-" cannot become an ffmpeg option (the path is absolute)', async () => {
    const d = tmp();
    const wavSrc = join(d, 'src.wav');
    writeFileSync(wavSrc, encodeWav(synth([{ start: 0.1, end: 0.3 }], 0.5), SR));
    const log = join(d, 'argv.log');
    process.env.FAKE_LOG = log;
    process.env.FAKE_WAV = wavSrc;
    try {
      const prev = process.cwd();
      process.chdir(d);
      writeFileSync('-f.mp4', 'x');
      await decodeAudio('-f.mp4', { ffmpeg: fakeFfmpeg(d) });
      process.chdir(prev);
      const argv = readFileSync(log, 'utf8').split('\0').slice(0, -1);
      expect(argv[argv.indexOf('-i') + 1].startsWith('/')).toBe(true);
    } finally {
      delete process.env.FAKE_LOG;
      delete process.env.FAKE_WAV;
    }
  });

  test('ffmpeg failing is a DecodeError("failed") that carries its last words', async () => {
    const d = tmp();
    const src = join(d, 'x.mp4');
    writeFileSync(src, 'x');
    process.env.FAKE_LOG = join(d, 'argv.log');
    process.env.FAKE_WAV = join(d, 'none.wav');
    try {
      const p = decodeAudio(src, { ffmpeg: fakeFfmpeg(d, { fail: true }) });
      await expect(p).rejects.toBeInstanceOf(DecodeError);
      await expect(p).rejects.toMatchObject({ code: 'failed' });
      await expect(p).rejects.toThrow(/Invalid data found/);
    } finally {
      delete process.env.FAKE_LOG;
      delete process.env.FAKE_WAV;
    }
  });

  test('no ffmpeg: the Chromium decoder is used; without that too it is DecodeError("no-decoder")', async () => {
    const d = tmp();
    const src = join(d, 'x.mp4');
    writeFileSync(src, 'x');
    const sine = new Float32Array(SR).fill(0.25);
    const viaChromium = await decodeAudio(src, { ffmpeg: null, chromium: () => sine });
    expect(viaChromium.via).toBe('chromium');
    expect(viaChromium.pcm).toBe(sine);
    await expect(decodeAudio(src, { ffmpeg: null })).rejects.toMatchObject({ code: 'no-decoder' });
  });

  test('a source longer than the cap is refused, not silently cut', async () => {
    const d = tmp();
    const src = join(d, 'x.mp4');
    writeFileSync(src, 'x');
    const long = new Float32Array((MAX_DECODE_SEC + 1) * 100); // 100 Hz "audio" keeps the test light
    await expect(
      decodeAudio(src, { ffmpeg: null, sampleRate: 100, chromium: () => long })
    ).rejects.toMatchObject({ code: 'too-long' });
  });

  test('a missing file is a DecodeError, before any decoder starts', async () => {
    await expect(decodeAudio(join(tmp(), 'nope.mp4'), { ffmpeg: null })).rejects.toMatchObject({
      code: 'failed',
    });
  });
});

describe('findFfmpeg', () => {
  test('finds a working ffmpeg on PATH, and null when none answers -version', () => {
    const d = tmp();
    const fake = fakeFfmpeg(d);
    expect(findFfmpeg({ path: d })).toBe(fake);
    mkdirSync(join(d, 'empty'));
    expect(findFfmpeg({ path: join(d, 'empty'), extraDirs: [] })).toBeNull();
  });
});
