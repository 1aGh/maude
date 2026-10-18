// apps/studio/video/decode.ts — S7.2, V2-1.10 §5.6 step 1: decode a source's sound to mono PCM.
//
//   ffmpeg first (a soft dependency, never bundled — DDR-177), else headless Chromium WebAudio
//   (the footage pipeline's own decode-in-Chromium precedent, DDR-163 — no new dependency; S7.3's
//   beats reuse this module at 22.05 kHz). The Chromium half is INJECTED (`opts.chromium`): this
//   module imports no browser, so it stays loadable in the compiled server and in tests.
//
// A file name is data. Every child process gets an ARGS ARRAY and an ABSOLUTE path — no shell, no
// string interpolation, and a name starting with "-" can never be read as an option. ffmpeg writes
// into a FRESH 0700 temp dir (mkdtemp), never beside the source and never at a guessable path (the
// symlink-plant primitive of the existing transcribe shim's Finding 1).
//
// A WAV that is already 16 kHz mono is read directly. Anything else goes through a decoder.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

/** Sources longer than this are refused (the 2 h of 16 kHz mono is ~460 MB of Float32). */
export const MAX_DECODE_SEC = 2 * 3600;
export const DEFAULT_SAMPLE_RATE = 16000;
/** Where a GUI-launched app (stripped PATH) finds Homebrew's tools. */
export const EXTRA_TOOL_DIRS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin'];

export type DecodeErrorCode = 'no-decoder' | 'failed' | 'too-long' | 'no-audio';

export class DecodeError extends Error {
  readonly code: DecodeErrorCode;
  constructor(code: DecodeErrorCode, message: string) {
    super(message);
    this.name = 'DecodeError';
    this.code = code;
  }
}

export interface Decoded {
  /** mono, -1..1 */
  pcm: Float32Array;
  sampleRate: number;
  via: 'wav' | 'ffmpeg' | 'chromium';
}

/** Headless-Chromium decode: the bin shim supplies it (video/ imports no browser). Mono, at `sampleRate`. */
export type ChromiumDecoder = (
  file: string,
  sampleRate: number
) => Float32Array | Promise<Float32Array>;

export interface DecodeOptions {
  sampleRate?: number;
  /** undefined = look for one; null = none (go to Chromium); a string = this binary */
  ffmpeg?: string | null;
  chromium?: ChromiumDecoder;
}

// ── WAV ────────────────────────────────────────────────────────────────────────────────────────

/** Mono 16-bit PCM WAV bytes. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const n = pcm.length;
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tag(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}

/** PCM (8/16/24/32-bit) or float32 WAV → mono Float32 (channels averaged). Null = not such a WAV. */
export function readWav(bytes: Uint8Array): { pcm: Float32Array; sampleRate: number } | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let o = 12;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.channels < 1 || fmt.rate < 1) return null;
      const { format, channels, rate, bits } = fmt;
      const isFloat = format === 3 && bits === 32;
      const isInt = (format === 1 || format === 0xfffe) && [8, 16, 24, 32].includes(bits);
      if (!isFloat && !isInt) return null;
      const bps = bits / 8;
      const end = Math.min(bytes.length, body + size);
      const frames = Math.floor((end - body) / (bps * channels));
      const pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bps;
          if (isFloat) sum += dv.getFloat32(p, true);
          else if (bits === 16) sum += dv.getInt16(p, true) / 32768;
          else if (bits === 8) sum += (dv.getUint8(p) - 128) / 128;
          else if (bits === 24) {
            const v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16);
            sum += v / 8388608;
          } else sum += dv.getInt32(p, true) / 2147483648;
        }
        pcm[i] = sum / channels;
      }
      return { pcm, sampleRate: rate };
    }
    o = body + size + (size % 2);
  }
  return null;
}

// ── ffmpeg ─────────────────────────────────────────────────────────────────────────────────────

/** A working ffmpeg: the first `<dir>/ffmpeg` (PATH, then Homebrew's dirs) that answers `-version`. */
export function findFfmpeg(
  o: { path?: string; extraDirs?: readonly string[] } = {}
): string | null {
  const dirs = [
    ...(o.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...(o.extraDirs ?? EXTRA_TOOL_DIRS),
  ];
  for (const d of dirs) {
    const c = join(d, 'ffmpeg');
    if (!existsSync(c)) continue;
    const probe = spawnSync(c, ['-version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return c;
  }
  return null;
}

function ffmpegDecode(ffmpeg: string, abs: string, sampleRate: number): Float32Array {
  // a FRESH private dir (mkdtemp, 0700): a co-tenant cannot pre-plant a symlink for `-y` to follow
  const dir = mkdtempSync(join(tmpdir(), 'maude-decode-'));
  const out = join(dir, 'audio.wav');
  try {
    const run = spawnSync(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-i',
        abs,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-c:a',
        'pcm_s16le',
        '-t',
        String(MAX_DECODE_SEC + 1),
        out,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' }
    );
    const tail = String(run.stderr ?? '')
      .trim()
      .split('\n')
      .slice(-3)
      .join(' · ');
    if (run.error) throw new DecodeError('failed', `ffmpeg could not start: ${run.error.message}`);
    if (run.status !== 0 || !existsSync(out)) {
      if (/does not contain any stream|matches no streams/i.test(tail))
        throw new DecodeError('no-audio', 'this file has no sound');
      throw new DecodeError(
        'failed',
        `ffmpeg could not read this file: ${tail || `exit ${run.status}`}`
      );
    }
    const wav = readWav(readFileSync(out));
    if (!wav) throw new DecodeError('failed', 'ffmpeg wrote something that is not a WAV');
    return wav.pcm;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Decode `file` to mono PCM at `sampleRate` (default 16 kHz). Throws `DecodeError` — never a bare
 * Error — so a caller can tell "install ffmpeg" (`no-decoder`) from "this file is bad" (`failed`).
 */
export async function decodeAudio(file: string, opts: DecodeOptions = {}): Promise<Decoded> {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const abs = resolve(file); // absolute: never an option, never a URL scheme
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(abs);
  } catch {
    throw new DecodeError('failed', `no such file: ${abs}`);
  }
  if (!st.isFile()) throw new DecodeError('failed', `not a file: ${abs}`);

  const tooLong = (n: number): DecodeError | null =>
    n / sampleRate > MAX_DECODE_SEC
      ? new DecodeError('too-long', `longer than ${MAX_DECODE_SEC / 3600} hours — split it first`)
      : null;

  if (/\.wav$/i.test(abs) && st.size <= 1 << 30) {
    const wav = readWav(new Uint8Array(readFileSync(abs)));
    if (wav && wav.sampleRate === sampleRate) {
      const e = tooLong(wav.pcm.length);
      if (e) throw e;
      return { pcm: wav.pcm, sampleRate, via: 'wav' };
    }
  }

  const ffmpeg = opts.ffmpeg === undefined ? findFfmpeg() : opts.ffmpeg;
  if (ffmpeg) {
    const pcm = ffmpegDecode(ffmpeg, abs, sampleRate);
    const e = tooLong(pcm.length);
    if (e) throw e;
    return { pcm, sampleRate, via: 'ffmpeg' };
  }
  if (opts.chromium) {
    const pcm = await opts.chromium(abs, sampleRate);
    const e = tooLong(pcm.length);
    if (e) throw e;
    return { pcm, sampleRate, via: 'chromium' };
  }
  throw new DecodeError(
    'no-decoder',
    'nothing on this Mac can read this file’s sound (install ffmpeg, or Chrome)'
  );
}
