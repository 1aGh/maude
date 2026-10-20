// video-cap.ts — S8.6 / C22: how long one video export may be, enforced on the SERVER.
//
//   A video past 3 600 frames (2 min at 30 fps) warns in the sheet, and "Allow longer" lets it go up to
//   the artboard's own `maxFrames` (`artboardMeta[id].maxFrames`, ≤ 18 000), else the exporter's ceiling.
//   The sheet only SHOWS this; the number that decides is made here, from the canvas source, so a stale
//   tab, a script or `maude design export` cannot ask for more (the cap is never taken from the client).
//
// Two halves, both pure given a reader:
//   `videoInfo`   the facts the sheet and the estimate draw from (frames, fps, cap, over, a strip of the cut)
//   `enforceVideoCap`  stamps `options.maxFrames = cap` on every temporal unit (so the engine refuses too,
//                 exporters/video.ts) and refuses a unit whose comp is longer than its cap, with a line.
// A comp whose length cannot be read (not a VideoComp, a length that is not a literal) is not refused here;
// the engine's own ceiling still holds, because `maxFrames` is stamped regardless.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_MAX_FRAMES, MAX_FRAMES_CEILING, readArtboardVideoMeta } from '../kinds/meta.ts';
import { compClips } from '../video/derive.ts';
import type { SpecUnit } from './scope.ts';

export { DEFAULT_MAX_FRAMES, MAX_FRAMES_CEILING };

/** The formats that render the comp over time (the same set as scope.ts `TEMPORAL`). */
export const TEMPORAL_FORMATS: ReadonlySet<string> = new Set(['mp4', 'webm', 'gif', 'audio']);

export interface StripClip {
  track: string;
  from: number;
  frames: number;
}

/** What the canvas says about one video artboard. */
export interface VideoFacts {
  /** length in frames, null when the source does not say (not a literal) */
  frames: number | null;
  fps: number;
  /** `artboardMeta[id].maxFrames`, null when the artboard never allowed longer */
  stored: number | null;
  /** the cut, for the sheet's filmstrip (clips and music beds; the pictures are not drawn) */
  clips: StripClip[];
}

export type VideoFactsReader = (canvasRel: string, artboardId: string) => VideoFacts | null;

/** The cap one export has: 3 600, or with "Allow longer" the artboard's own ceiling, else the exporter's. */
export function capFor(allowLonger: boolean, stored: number | null): number {
  if (!allowLonger) return DEFAULT_MAX_FRAMES;
  return Math.max(DEFAULT_MAX_FRAMES, stored ?? MAX_FRAMES_CEILING);
}

const within = (root: string, abs: string) => abs === root || abs.startsWith(root + path.sep);

/** The default reader: `<designRoot>/<canvas>.tsx` and its `.meta.json`, never anything outside the root. */
export function defaultVideoFacts(designRoot: string): VideoFactsReader {
  return (canvasRel, artboardId) => {
    try {
      const root = realpathSync(path.resolve(designRoot));
      const abs = realpathSync(path.resolve(root, canvasRel));
      if (!within(root, abs) || !abs.endsWith('.tsx')) return null;
      const cc = compClips(abs, readFileSync(abs, 'utf8'), artboardId);
      let meta: unknown = null;
      try {
        meta = JSON.parse(readFileSync(abs.replace(/\.tsx$/, '.meta.json'), 'utf8'));
      } catch {
        /* no sidecar, or a malformed one: the artboard never allowed longer */
      }
      return {
        frames: cc.total > 0 ? cc.total : null,
        fps: cc.fps,
        stored: readArtboardVideoMeta(meta, artboardId).maxFrames ?? null,
        clips: cc.clips.map((c) => ({ track: c.track, from: c.from, frames: c.durationInFrames })),
      };
    } catch {
      return null; // unreadable: unknown, never an error
    }
  };
}

/** `2:40` for a frame count at an fps. */
export function clock(frames: number, fps: number): string {
  const s = Math.round(frames / Math.max(1, fps));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface VideoInfo {
  canvas: string;
  artboard: string;
  label: string;
  w: number | null;
  h: number | null;
  frames: number | null;
  fps: number;
  cap: number;
  over: boolean;
  clips: StripClip[];
}

const unitAllowsLonger = (u: SpecUnit) => u.v2.video?.allowLonger === true;

/** One row per video artboard the units reach, for the sheet (numbers only). */
export function videoInfo(units: readonly SpecUnit[], read: VideoFactsReader | null): VideoInfo[] {
  const out: VideoInfo[] = [];
  const seen = new Set<string>();
  for (const u of units) {
    if (!TEMPORAL_FORMATS.has(u.format) || !u.canvas) continue;
    const b = u.artboards[0];
    if (!b || seen.has(`${u.canvas}\u0000${b.id}`)) continue;
    seen.add(`${u.canvas}\u0000${b.id}`);
    const f = read ? read(u.canvas, b.id) : null;
    const cap = capFor(unitAllowsLonger(u), f?.stored ?? null);
    out.push({
      canvas: u.canvas,
      artboard: b.id,
      label: b.label ?? b.id,
      w: b.w,
      h: b.h,
      frames: f?.frames ?? null,
      fps: f?.fps ?? 30,
      cap,
      over: f?.frames != null && f.frames > cap,
      clips: f?.clips ?? [],
    });
  }
  return out;
}

export type CapVerdict =
  | { ok: true; units: SpecUnit[] }
  | {
      ok: false;
      error: 'too-long';
      field: 'options.video.allowLonger';
      artboard: string;
      frames: number;
      cap: number;
      message: string;
    };

/** Stamp the cap on every temporal unit; refuse the first whose comp is longer than it. */
export function enforceVideoCap(units: SpecUnit[], read: VideoFactsReader | null): CapVerdict {
  const info = videoInfo(units, read);
  const bad = info.find((i) => i.over);
  if (bad && bad.frames != null) {
    const more = bad.cap > DEFAULT_MAX_FRAMES;
    return {
      ok: false,
      error: 'too-long',
      field: 'options.video.allowLonger',
      artboard: bad.artboard,
      frames: bad.frames,
      cap: bad.cap,
      message: more
        ? `${bad.label} is ${clock(bad.frames, bad.fps)} long — this artboard allows up to ${clock(bad.cap, bad.fps)} (${bad.cap.toLocaleString('en-US')} frames).`
        : `${bad.label} is ${clock(bad.frames, bad.fps)} long — one export goes up to ${clock(bad.cap, bad.fps)} (${bad.cap.toLocaleString('en-US')} frames at ${bad.fps} fps). Turn on Allow longer to export more.`,
    };
  }
  return {
    ok: true,
    units: units.map((u) => {
      if (!TEMPORAL_FORMATS.has(u.format)) return u;
      const stored =
        u.canvas && u.artboards[0] ? (read?.(u.canvas, u.artboards[0].id)?.stored ?? null) : null;
      return { ...u, options: { ...u.options, maxFrames: capFor(unitAllowsLonger(u), stored) } };
    }),
  };
}
