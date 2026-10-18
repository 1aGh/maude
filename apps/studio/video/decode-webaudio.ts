// video/decode-webaudio.ts — decode a media file to mono Float32 PCM in headless Chromium (WebAudio
// `decodeAudioData`), for machines with no ffmpeg (S7.3, V2-1.10 §5.6 step 1 / §6.3 "Decode without ffmpeg").
//
// The browser work lives in `bin/_decode-webaudio.mjs`, spawned under node or bun like every other
// playwright shim (`exporters/_runtime.ts`): this module is importable from the compiled studio server
// without linking playwright. The shim writes raw little-endian float32 to a private temp file (never next
// to the source) which is read back and removed here. The same samples fed to `analyzeBeats` give the same
// beats as the ffmpeg path; for 16-bit PCM at the target rate the two are bit-identical.
//
// A missing Chromium ends the shim with exit 3 and `_pw-launch`'s one-line install hint; that surfaces
// here as a `DecodeError` of kind 'no-browser' with the hint as its message.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportShimPath, resolveExportRuntime } from '../exporters/_runtime.ts';

export type DecodeErrorKind = 'no-runtime' | 'no-browser' | 'undecodable' | 'failed';

export class DecodeError extends Error {
  readonly kind: DecodeErrorKind;
  constructor(kind: DecodeErrorKind, message: string) {
    super(message);
    this.name = 'DecodeError';
    this.kind = kind;
  }
}

export interface WebAudioDecodeOptions {
  /** target sample rate (the browser resamples); default 22 050 */
  sampleRate?: number;
  /** keep at most this many seconds; default 1 800 */
  maxSeconds?: number;
  /** kill the browser after this long; default 120 000 */
  timeoutMs?: number;
}

const SHIM = 'decode-webaudio.mjs';

/** Decode `file` to mono Float32 samples at `sampleRate` using headless Chromium. */
export async function decodeWithChromium(
  file: string,
  opts: WebAudioDecodeOptions = {}
): Promise<Float32Array> {
  const sampleRate = opts.sampleRate ?? 22_050;
  const maxSeconds = opts.maxSeconds ?? 1800;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let runtime: string;
  try {
    runtime = resolveExportRuntime();
  } catch (e) {
    throw new DecodeError('no-runtime', e instanceof Error ? e.message : String(e));
  }
  const shim = exportShimPath(`_${SHIM}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'maude-decode-'));
  const out = path.join(dir, 'pcm.f32le');
  try {
    const { code, stderr } = await run(
      runtime,
      [
        shim,
        '--in',
        file,
        '--out',
        out,
        '--rate',
        String(sampleRate),
        '--max-seconds',
        String(maxSeconds),
      ],
      timeoutMs
    );
    if (code !== 0) {
      const msg = stderr.trim().split('\n').pop() || `the decoder exited ${code}`;
      throw new DecodeError(code === 3 ? 'no-browser' : code === 4 ? 'undecodable' : 'failed', msg);
    }
    const bytes = readFileSync(out);
    const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Float32Array(aligned, 0, Math.floor(aligned.byteLength / 4));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, NO_OPEN: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 8192) stderr += d.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new DecodeError('failed', e.message));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 137 : 1), stderr });
    });
  });
}
