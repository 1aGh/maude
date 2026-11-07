// The clips of a comp that an export may not be able to use — HEVC, variable frame rate, a second audio
// track (#128 §1, root cause of #127). The export reads this before the render and, when the audio renderer
// then gives up and the file is captured frame by frame, names the clip and the codec in the notice
// (`undecodableMediaGap`, exporters/degraded.ts) instead of leaving "the video could not be decoded".
//
// Soft on every side: no ffprobe, a clip that is not in `assets/`, a path that leaves the design root — each
// answers "nothing to say". Never throws, never blocks an export.

import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { issuesPhrase, mediaIssues, probeMedia } from '../bin/_media-probe.mjs';

export interface RiskyMedia {
  /** `assets/<sha8>.<ext>` as the canvas names it */
  asset: string;
  /** the codec and the other findings: `HEVC (H.265), variable frame rate (about 32.5 fps)` */
  what: string;
}

/** How many clips are probed per export (each is one ffprobe run). */
const MAX_PROBED = 12;
const CLIP_RE = /assets\/[A-Za-z0-9_][A-Za-z0-9._-]*\.(?:mp4|m4v|mov|webm)\b/g;

/** The video clips a canvas source names, once each, in order of appearance. */
export function clipsNamedIn(source: string): string[] {
  return [...new Set(source.match(CLIP_RE) ?? [])].slice(0, MAX_PROBED);
}

/**
 * Probe every `assets/*` clip the source names and return the ones with something to say.
 * `probe` is a seam for the tests; production passes nothing.
 */
export function riskyMediaIn(
  source: string,
  designRoot: string,
  probe: typeof probeMedia = probeMedia
): RiskyMedia[] {
  const out: RiskyMedia[] = [];
  let designReal: string;
  try {
    designReal = realpathSync(designRoot);
  } catch {
    return out;
  }
  for (const rel of clipsNamedIn(source)) {
    try {
      const abs = realpathSync(path.join(designRoot, ...rel.split('/')));
      // a clip that is a symlink out of the design root is not ours to feed to a media parser
      if (!abs.startsWith(designReal + path.sep) || !statSync(abs).isFile()) continue;
      const issues = mediaIssues(probe(abs));
      if (issues.length) out.push({ asset: rel, what: issuesPhrase(issues) });
    } catch {
      /* a clip that is missing or unreadable has no codec to name */
    }
  }
  return out;
}
