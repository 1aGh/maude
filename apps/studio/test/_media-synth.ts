// Tiny synthetic clips for the media-probe tests (#128 §1, T3.4): made by the machine's own ffmpeg, so
// there is no binary fixture in the repo. `toolsFor()` says why a test is skipped when it cannot run.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { findTool } from '../bin/_media-probe.mjs';

export function toolsFor(): { ok: boolean; why: string } {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg || !findTool('ffprobe'))
    return { ok: false, why: 'ffmpeg/ffprobe are not installed' };
  const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
  for (const e of ['libx264', 'libx265', ' aac ']) {
    if (!enc.includes(e)) return { ok: false, why: `this ffmpeg has no ${e.trim()} encoder` };
  }
  return { ok: true, why: '' };
}

export interface SynthOpts {
  codec?: 'h264' | 'hevc';
  /** 0 = silent; each track is a different sine */
  audioTracks?: number;
  /** drop frames so the timestamps are irregular (average rate far below the peak) */
  vfr?: boolean;
}

/** Make `<dir>/<name>` (a 1.5 s, 64x64 clip). Returns its absolute path. */
export function synthClip(dir: string, name: string, o: SynthOpts = {}): string {
  const ffmpeg = findTool('ffmpeg') as string;
  const tracks = o.audioTracks ?? 1;
  const out = join(dir, name);
  const args = [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=64x64:rate=30:duration=1.5',
  ];
  for (let i = 0; i < tracks; i += 1) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=${440 * (i + 1)}:duration=1.5`);
  }
  for (let i = 0; i <= tracks; i += 1) args.push('-map', String(i));
  if (o.vfr) args.push('-vf', "select='lt(mod(n\\,5)\\,2)'", '-fps_mode', 'vfr');
  if (o.codec === 'hevc')
    args.push('-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'log-level=none');
  else args.push('-c:v', 'libx264');
  args.push('-pix_fmt', 'yuv420p');
  if (tracks > 0) args.push('-c:a', 'aac');
  args.push(out);
  const run = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ffmpeg could not make ${name}: ${run.stderr}`);
  return out;
}
