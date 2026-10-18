// video/decode.ts — one entry for "give me mono Float32 PCM of this file": ffmpeg when it is on PATH,
// headless-Chromium WebAudio when it is not (or when ffmpeg cannot read the file). S7.3 uses it at
// 22.05 kHz for beats; any later analyser that needs another rate passes `sampleRate`.
//
// Every spawn is an args array (never a shell). The decoded samples are the only thing that leaves.

import { spawn } from 'node:child_process';

import { DecodeError, decodeWithChromium } from './decode-webaudio.ts';

export type DecodeVia = 'ffmpeg' | 'chromium';

export interface DecodeOptions {
  sampleRate?: number;
  maxSeconds?: number;
  /** 'auto' (default): ffmpeg, then Chromium. A forced decoder never falls back. */
  prefer?: 'auto' | DecodeVia;
  /** called once when a fallback happens, so a CLI can say so */
  onFallback?: (reason: string) => void;
}

export interface Decoded {
  samples: Float32Array;
  via: DecodeVia;
}

/** ffmpeg → mono f32le at `sampleRate`. Throws `DecodeError` ('no-runtime' = ffmpeg missing). */
export function decodeWithFfmpeg(
  file: string,
  sampleRate = 22_050,
  maxSeconds = 1800
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        file,
        '-vn',
        '-t',
        String(maxSeconds),
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-f',
        'f32le',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 4096) stderr += d.toString('utf8');
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      reject(
        e.code === 'ENOENT'
          ? new DecodeError('no-runtime', 'ffmpeg is not installed')
          : new DecodeError('failed', e.message)
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new DecodeError('undecodable', stderr.trim().split('\n').pop() || 'ffmpeg failed'));
        return;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 4) {
        reject(new DecodeError('undecodable', 'the file has no audio'));
        return;
      }
      const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      resolve(new Float32Array(aligned, 0, Math.floor(aligned.byteLength / 4)));
    });
  });
}

export async function decodeAudio(file: string, opts: DecodeOptions = {}): Promise<Decoded> {
  const sampleRate = opts.sampleRate ?? 22_050;
  const maxSeconds = opts.maxSeconds ?? 1800;
  const prefer = opts.prefer ?? 'auto';
  if (prefer === 'chromium') {
    return { samples: await decodeWithChromium(file, { sampleRate, maxSeconds }), via: 'chromium' };
  }
  try {
    return { samples: await decodeWithFfmpeg(file, sampleRate, maxSeconds), via: 'ffmpeg' };
  } catch (e) {
    if (prefer === 'ffmpeg' || !(e instanceof DecodeError)) throw e;
    opts.onFallback?.(
      e.kind === 'no-runtime'
        ? 'ffmpeg not found; decoding with headless Chromium'
        : `ffmpeg could not read the file (${e.message}); trying headless Chromium`
    );
    return { samples: await decodeWithChromium(file, { sampleRate, maxSeconds }), via: 'chromium' };
  }
}
