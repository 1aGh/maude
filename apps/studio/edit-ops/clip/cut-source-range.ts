// edit-ops/clip/cut-source-range.ts — `clip.cut-source-range` (S7.6; V2-1.10 §5.6 + §5.7, test #8).
//
// Edit by transcript: remove the SOURCE range [srcStart, srcEnd] seconds from the clip `stableId`, as
// one write. The range is mapped to comp frames through the clip's trim and speed (DDR-163 clocks,
// `video/derive.ts compClips`), then the clip is split at both edges and the middle piece is
// ripple-removed — exactly `applySplitClip` × ≤ 2 + `applyRemoveClipRippled`, so a cut next to a
// transition answers the split's own refusal and the captions follow with no write of their own
// (they are derived, decision maude/v2-S7-derived-not-materialised).
//
// The CLI (`maude design cut-words`) and the Transcript panel turn word ids into the source range
// with `transcriptCut` first; this op only takes seconds. Pure: no IO.

import { CanvasEditError } from '../../canvas-edit.ts';
import { applyRemoveClipRippled, applySplitClip } from '../../clip-ops.ts';
import { compClips } from '../../video/derive.ts';

const bad = (file: string, id: string, message: string): never => {
  throw new CanvasEditError(message, { canvas: file, id });
};

export interface CutSourceRange {
  source: string;
  /** comp frames taken out of the clip (the storyline shortens by this when the clip is a beat) */
  removedFrames: number;
  /** comp frames of the removed piece, before the cut */
  fromFrame: number;
  toFrame: number;
}

export function applyCutSourceRange(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  srcStart: number,
  srcEnd: number
): CutSourceRange {
  if (!Number.isFinite(srcStart) || !Number.isFinite(srcEnd) || srcStart < 0)
    bad(file, stableId, 'The range to cut is not readable.');
  if (!(srcEnd > srcStart)) bad(file, stableId, 'Nothing to cut there.');
  const comp = compClips(file, source, artboard);
  const span = comp.clips.find((c) => c.stableId === stableId && !c.loose);
  if (!span) bad(file, stableId, 'That clip is not on the timeline.');
  const c = span as NonNullable<typeof span>;
  const end = c.from + c.durationInFrames;
  // source second → comp frame inside this clip, clamped to the clip
  const frameOf = (sec: number) =>
    Math.min(
      end,
      Math.max(c.from, Math.round(c.from + (sec * comp.fps - c.trimBefore) / c.playbackRate))
    );
  const fa = frameOf(srcStart);
  const fb = frameOf(srcEnd);
  if (fb - fa < 1) bad(file, stableId, 'That part of the source is not in this clip.');

  let out: string;
  if (fa <= c.from && fb >= end) {
    out = applyRemoveClipRippled(file, source, artboard, stableId, hash).source;
  } else if (fa <= c.from) {
    const r = applySplitClip(file, source, artboard, stableId, hash, fb);
    out = applyRemoveClipRippled(
      file,
      r.source,
      artboard,
      r.firstStableId ?? stableId,
      undefined
    ).source;
  } else if (fb >= end) {
    const r = applySplitClip(file, source, artboard, stableId, hash, fa);
    if (!r.secondStableId) bad(file, stableId, 'The cut could not find its piece; try again.');
    out = applyRemoveClipRippled(
      file,
      r.source,
      artboard,
      r.secondStableId as string,
      undefined
    ).source;
  } else {
    const r1 = applySplitClip(file, source, artboard, stableId, hash, fa);
    if (!r1.secondStableId) bad(file, stableId, 'The cut could not find its piece; try again.');
    const r2 = applySplitClip(
      file,
      r1.source,
      artboard,
      r1.secondStableId as string,
      undefined,
      fb
    );
    if (!r2.firstStableId) bad(file, stableId, 'The cut could not find its piece; try again.');
    out = applyRemoveClipRippled(
      file,
      r2.source,
      artboard,
      r2.firstStableId as string,
      undefined
    ).source;
  }
  return { source: out, removedFrames: fb - fa, fromFrame: fa, toFrame: fb };
}
