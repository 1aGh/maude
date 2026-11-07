// _media-probe.mjs — what a video clip is made of, and the three things that make an export of it
// fail (#128 §1, root cause of #127).
//
// An iPhone clip is HEVC and variable frame rate; a `.mov` can carry a second (spatial) audio track.
// All of them PLAY in the Player, then the export's audio renderer (`renderMediaOnWeb`) cannot decode
// them, the exporter falls back to frame-by-frame capture, and the file ships with no sound — with
// nothing said at import. This module is the one place that reads a clip with `ffprobe` and says so:
//
//   probeMedia(abs)            → { video, audio[], durationSec } or null (no ffprobe / unreadable)
//   mediaIssues(probe)         → [{ kind: 'hevc' | 'vfr' | 'audio-tracks', label }]
//   describeMedia(rel, probe)  → one sentence naming the asset and the codec, or null when all is well
//   makeProxy({ src, outDir }) → an H.264 / constant-frame-rate / one-AAC copy next to the original
//
// A soft dependency, like decode.ts: ffmpeg/ffprobe are never bundled (DDR-177). Without them every
// function answers "nothing to say" — a warning is never invented, and an import is never blocked.
// Arguments always go to the tools as an args array (never a shell string), and the file is always an
// ABSOLUTE path, so a name starting with "-" can never be read as an option.
//
// Plain Node ESM so the `maude design` verbs (node) and the studio (bun) share it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const EXTRA_TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
const PROBE_TIMEOUT_MS = 20_000;
const PROXY_TIMEOUT_MS = 30 * 60_000;
/** The constant frame rates a variable-rate clip is conformed to (nearest to its average). */
const CFR_CHOICES = [24, 25, 30, 50, 60];
/** avg vs. peak frame rate further apart than this is "variable" (a CFR clip's two are equal). */
const VFR_TOLERANCE = 0.05;

/** A working `<dir>/<name>` (PATH, then Homebrew's dirs) that answers `-version`, or null. */
export function findTool(name, o = {}) {
  const dirs = [
    ...(o.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...(o.extraDirs ?? EXTRA_TOOL_DIRS),
  ];
  for (const d of dirs) {
    const c = join(d, name);
    if (!existsSync(c)) continue;
    const probe = spawnSync(c, ['-version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return c;
  }
  return null;
}

/** `"30000/1001"` → 29.97; anything unusable → 0. */
function rate(v) {
  if (typeof v !== 'string') return 0;
  const [n, d] = v.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Read a clip. Returns null when ffprobe is absent, fails, or the file has no video stream.
 * `o.ffprobe`: a path (or `null` = "pretend there is none"); default = look it up.
 */
export function probeMedia(abs, o = {}) {
  const ffprobe = o.ffprobe === undefined ? findTool('ffprobe') : o.ffprobe;
  if (!ffprobe) return null;
  const run = spawnSync(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', abs],
    { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
  );
  if (run.error || run.status !== 0) return null;
  let j;
  try {
    j = JSON.parse(run.stdout);
  } catch {
    return null;
  }
  const streams = Array.isArray(j?.streams) ? j.streams : [];
  const v = streams.find((s) => s?.codec_type === 'video' && s?.disposition?.attached_pic !== 1);
  if (!v) return null;
  const avg = rate(v.avg_frame_rate);
  const peak = rate(v.r_frame_rate);
  const vfr = avg > 0 && peak > 0 && Math.abs(avg - peak) / Math.max(avg, peak) > VFR_TOLERANCE;
  return {
    video: {
      codec: String(v.codec_name ?? 'unknown'),
      profile: typeof v.profile === 'string' ? v.profile : undefined,
      width: num(v.width),
      height: num(v.height),
      avgFps: avg || undefined,
      peakFps: peak || undefined,
      rFrameRate: typeof v.r_frame_rate === 'string' ? v.r_frame_rate : undefined,
      vfr,
    },
    audio: streams
      .filter((s) => s?.codec_type === 'audio')
      .map((s) => ({ codec: String(s.codec_name ?? 'unknown') })),
    durationSec: num(j?.format?.duration),
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** What is wrong with this clip for an export. Empty = nothing. */
export function mediaIssues(probe) {
  if (!probe?.video) return [];
  const out = [];
  const c = probe.video.codec.toLowerCase();
  if (c === 'hevc' || c === 'h265') out.push({ kind: 'hevc', label: 'HEVC (H.265)' });
  if (probe.video.vfr) {
    const fps = probe.video.avgFps;
    out.push({
      kind: 'vfr',
      label: fps ? `variable frame rate (about ${round1(fps)} fps)` : 'variable frame rate',
    });
  }
  if (probe.audio.length > 1) {
    out.push({
      kind: 'audio-tracks',
      label: `${probe.audio.length} audio tracks (${probe.audio.map((a) => a.codec).join(', ')})`,
    });
  }
  return out;
}

/** The labels as one phrase: `HEVC (H.265), variable frame rate (about 32.5 fps)`. */
export function issuesPhrase(issues) {
  return issues.map((i) => i.label).join(', ');
}

/**
 * The sentence that names the asset and the codec. `null` when the clip is fine (or unreadable).
 * `rel` is shown as given (`assets/3b165be8.mp4`).
 */
export function describeMedia(rel, probe) {
  const issues = mediaIssues(probe);
  if (!issues.length) return null;
  return (
    `${rel} is ${issuesPhrase(issues)}: the export may not be able to decode it, and then the ` +
    `video would have no sound. Make an H.264 copy next to it with \`maude design video-proxy ${rel}\`.`
  );
}

/** The constant frame rate a proxy of this clip gets. */
export function proxyFps(probe) {
  const v = probe?.video;
  if (v && !v.vfr && v.rFrameRate && rate(v.rFrameRate) > 0) return v.rFrameRate;
  const avg = v?.avgFps ?? 30;
  let best = CFR_CHOICES[0];
  for (const c of CFR_CHOICES) if (Math.abs(c - avg) < Math.abs(best - avg)) best = c;
  return String(best);
}

/** The ffmpeg arguments for the proxy: first video + first audio only, H.264 / CFR / yuv420p / AAC. */
export function proxyArgs(src, out, probe) {
  return [
    '-nostdin',
    '-y',
    '-v',
    'error',
    '-i',
    src,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `fps=${proxyFps(probe)},format=yuv420p`,
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    out,
  ];
}

export class ProxyError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/**
 * Write the proxy of `src` (absolute) into `outDir` (absolute) as `<sha8>.mp4` — content-addressed like
 * every asset, so it resolves everywhere an asset does. The original is only ever read. Returns
 * `{ file, name, reused, probe, issues }`. Throws ProxyError (code 3 = no ffmpeg/ffprobe, 4 = not a
 * readable video, 1 = the encode failed).
 */
export function makeProxy({ src, outDir, ffmpeg, ffprobe }) {
  const ff = ffmpeg === undefined ? findTool('ffmpeg') : ffmpeg;
  const fp = ffprobe === undefined ? findTool('ffprobe') : ffprobe;
  if (!ff || !fp) throw new ProxyError('ffmpeg and ffprobe are needed to make an H.264 copy', 3);
  const probe = probeMedia(src, { ffprobe: fp });
  if (!probe) throw new ProxyError('this file has no video that ffprobe can read', 4);
  const part = join(outDir, `.proxy-${process.pid}-${Date.now()}.part`);
  try {
    const run = spawnSync(ff, proxyArgs(src, part, probe), {
      encoding: 'utf8',
      timeout: PROXY_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (run.error) throw new ProxyError(`ffmpeg could not start: ${run.error.message}`);
    if (run.status !== 0) {
      const tail = (run.stderr || '').trim().split('\n').slice(-3).join(' ');
      throw new ProxyError(`ffmpeg could not convert this file: ${tail || `exit ${run.status}`}`);
    }
    if (!statSync(part).size) throw new ProxyError('ffmpeg wrote an empty file');
    const sha8 = createHash('sha256').update(readFileSync(part)).digest('hex').slice(0, 8);
    const name = `${sha8}.mp4`;
    const file = join(outDir, name);
    const reused = existsSync(file);
    if (reused) rmSync(part, { force: true });
    else renameSync(part, file);
    return { file, name, reused, probe, issues: mediaIssues(probe) };
  } finally {
    rmSync(part, { force: true });
  }
}
