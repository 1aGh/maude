// edit-ops/clip/take-swap.ts — `video.take.swap` (S7.6c; V2-1.10 §5.9 "Other takes", 07 ve-ai-adjust
// "Swapping keeps the length and the beat").
//
// Another take of the same source swapped in: the clip's media starts at `srcStart` seconds of its
// source (`trimBefore`, in output frames — DDR-163 clocks) and keeps its length, speed and place, so
// nothing ripples and the cut stays on the beat. The takes come from the clip's footage sidecar (a
// person's ordinary edit, not an AI one); the op is pure, so the source's length arrives as
// `sourceSeconds` when the caller knows it, and a take that would run past the end is refused.

import MagicString from 'magic-string';

import { compClips } from '../../video/derive.ts';
import {
  bad,
  finish,
  firstIn,
  jsxElements,
  literalProp,
  parseProgram,
  resolveClip,
  setProp,
} from './jsx.ts';

const MEDIA = new Set(['Video', 'OffthreadVideo', 'Audio', 'MaudeVideo', 'MaudeAudio']);

export function applyTakeSwap(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  srcStart: number,
  sourceSeconds: number | undefined
): { source: string; trimBefore: number } {
  if (!Number.isFinite(srcStart) || srcStart < 0)
    bad(file, 'The take’s start is not readable.', stableId);
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  const dur = clip.durationInFrames;
  if (dur == null) bad(file, 'This clip’s length is not a number; edit the JSX by hand.', stableId);
  const program = parseProgram(file, source);
  const media = firstIn(jsxElements(program), clip.start, clip.end, MEDIA)?.el;
  if (!media) bad(file, 'This clip has no footage to swap.', stableId);
  const rateRaw = literalProp(file, media, 'playbackRate', stableId);
  const rate = typeof rateRaw === 'number' && rateRaw > 0 ? rateRaw : 1;
  const fps = compClips(file, source, artboard).fps;
  const trim = Math.round(srcStart * fps);
  if (sourceSeconds !== undefined && trim + (dur as number) * rate > sourceSeconds * fps + 0.5)
    bad(file, 'That take is shorter than the clip.', stableId);
  const s = new MagicString(source);
  setProp(s, media, 'trimBefore', trim === 0 ? null : `{${trim}}`);
  setProp(s, media, 'startFrom', null); // the legacy spelling retires
  return { source: finish(file, s, stableId), trimBefore: trim };
}
