// edit-ops/clip/cut-to-beat.ts — `video.cut-to-beat` (S7.6; V2-1.10 §5.6 "Cut to the beat", test #9).
//
// Each storyline cut point (a hard cut between two series beats) moves to the nearest comp beat
// within ±½ beat, as a ROLL edit: the left clip's out-point and the right clip's in-point move
// together, so the total length — and every overlay — stays where it was. A cut whose clips lack the
// source handle for the move is left in place and reported, never stretched past its media.
//
// Pure (the op table's rule): the beats come in as comp frames (`compBeats` over the comp's beat
// sidecars — the CLI `cut-to-beat` and the Music inspector compute them), and the source lengths the
// handle check needs come in as `sources: { [src]: seconds }`. A source whose length is not given has
// no known handle after its out-point, so a cut that would extend it is reported (conservative).

import { applyRetimeSequenceByClip, CanvasEditError } from '../../canvas-edit.ts';
import { applyTrimIn } from '../../clip-ops.ts';
import { applyRippleAfterClip } from '../../ripple.ts';
import { type ClipSpan, compClips } from '../../video/derive.ts';

export const MAX_BEATS = 20_000;

export interface KeptCut {
  /** comp frame of the cut that stayed */
  at: number;
  reason: 'no-handle' | 'transition';
}

export interface CutToBeat {
  source: string;
  moved: number;
  kept: KeptCut[];
}

const bad = (file: string, message: string): never => {
  throw new CanvasEditError(message, { canvas: file, id: '' });
};

/** The beats the snap uses: sorted, unique, every `every`-th one. */
export function beatsEvery(beats: readonly number[], every: 1 | 2 | 4): number[] {
  const sorted = [...new Set(beats.map((b) => Math.round(b)))].sort((a, b) => a - b);
  return sorted.filter((_, i) => i % every === 0);
}

/** Half the median spacing of the beats (the snap window), 0 when there are fewer than two. */
export function halfBeat(beats: readonly number[]): number {
  if (beats.length < 2) return 0;
  const gaps = beats
    .slice(1)
    .map((b, i) => b - (beats[i] as number))
    .sort((a, b) => a - b);
  return (gaps[Math.floor(gaps.length / 2)] as number) / 2;
}

function nearest(beats: readonly number[], f: number): number | null {
  let best: number | null = null;
  for (const b of beats) if (best === null || Math.abs(b - f) < Math.abs(best - f)) best = b;
  return best;
}

/** The storyline's consecutive pairs (series beats on the Video track, in order). */
function storyline(spans: readonly ClipSpan[]): ClipSpan[] {
  return spans.filter((s) => s.track === 'video' && !s.loose).sort((a, b) => a.from - b.from);
}

export function applyCutToBeat(
  file: string,
  source: string,
  artboard: string | undefined,
  beatsIn: readonly number[],
  every: 1 | 2 | 4,
  sources: Readonly<Record<string, number>>
): CutToBeat {
  if (beatsIn.length > MAX_BEATS) bad(file, 'Too many beats.');
  const beats = beatsEvery(beatsIn, every);
  const window = halfBeat(beats);
  const kept: KeptCut[] = [];
  let out = source;
  let moved = 0;
  if (!window) return { source: out, moved, kept };

  // Cut points are re-read after every roll (ids are names or stable positions; a roll adds none).
  const first = compClips(file, out, artboard);
  const fps = first.fps;
  const pairs = storyline(first.clips).length - 1;
  for (let i = 0; i < pairs; i++) {
    const comp = compClips(file, out, artboard);
    const line = storyline(comp.clips);
    const left = line[i];
    const right = line[i + 1];
    if (!left || !right) break;
    const cut = left.from + left.durationInFrames;
    // a transition between them overlaps the two (right starts before the left ends): not a hard cut
    if (right.from !== cut) {
      kept.push({ at: right.from, reason: 'transition' });
      continue;
    }
    const b = nearest(beats, cut);
    if (b === null || b === cut || Math.abs(b - cut) > window) continue;
    const d = b - cut;
    const leftSrcFrames = (sources[left.src] ?? Number.NaN) * fps;
    const leftNeeds = left.trimBefore + (left.durationInFrames + d) * left.playbackRate;
    const handle =
      d < 0
        ? right.trimBefore + d * right.playbackRate >= 0 && left.durationInFrames + d >= 1
        : right.durationInFrames - d >= 1 &&
          Number.isFinite(leftSrcFrames) &&
          leftNeeds <= leftSrcFrames;
    if (!handle) {
      kept.push({ at: cut, reason: 'no-handle' });
      continue;
    }
    // Right: in-point moves by d. trimIn ripples −d, but only what starts at or after the clip's OLD end
    // (a piece starting inside its span stays); the roll undoes exactly that ripple, so nothing else moves.
    // The undo needs the same threshold. Going later (d > 0) the shifted pieces sit at ≥ oldEnd − d after the
    // ripple, a window an unshifted piece can also be in — so the undo runs FIRST, on the original positions.
    // Going earlier (d < 0) they sit at ≥ oldEnd + |d|, beyond anything unshifted — so it runs after.
    const oldEnd = right.from + right.durationInFrames;
    let next = out;
    if (d > 0) {
      next = applyRippleAfterClip(file, next, artboard, right.stableId, d, {
        fromFrame: oldEnd,
      }).source;
    }
    next = applyTrimIn(file, next, artboard, right.stableId, undefined, d).source;
    if (d < 0) {
      next = applyRippleAfterClip(file, next, artboard, right.stableId, d, {
        fromFrame: oldEnd - d,
      }).source;
    }
    // Left: out-point moves by d (a duration retime, no ripple).
    next = applyRetimeSequenceByClip(file, next, artboard, left.stableId, undefined, {
      durationInFrames: left.durationInFrames + d,
    }).source;
    out = next;
    moved++;
  }
  return { source: out, moved, kept };
}
