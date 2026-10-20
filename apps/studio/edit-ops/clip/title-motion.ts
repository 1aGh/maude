// edit-ops/clip/title-motion.ts — `video.title.motion` (S7.10; 07 ve-text "Motion": None · Fade · Slide up ·
// Pop · Type on · Per word).
//
// `<TitleMotion preset="slide-up" frames={12}>` holds a title clip's content. The op sets the preset (and
// optionally the entrance's length), wrapping the content the first time; `none` takes the wrapper off again —
// a title with no motion is the plain title it always was. When the title also sits in a `<Place>`, the motion
// goes INSIDE it (Place > TitleMotion > content): a transform on the wrapper would otherwise become the
// containing block of Place's absolutely positioned box. Pure: no IO.

import MagicString from 'magic-string';

import {
  isTitleMotion,
  TITLE_MOTION_FRAMES,
  TITLE_MOTION_MAX_FRAMES,
  TITLE_MOTIONS,
} from '../../video/title-motion.ts';
import {
  bad,
  ensureCanvasLibImport,
  finish,
  firstIn,
  innerText,
  jsxElements,
  literalProp,
  parseProgram,
  resolveClip,
  setProp,
  tagOf,
} from './jsx.ts';

const MOTION = new Set(['TitleMotion']);
const PLACE = new Set(['Place']);

export interface TitleMotionPatch {
  preset: (typeof TITLE_MOTIONS)[number];
  /** the entrance's length; null drops the prop (the default length); undefined leaves it */
  frames?: number | null;
}

export function titleMotionPatch(
  file: string,
  p: Record<string, unknown>,
  id: string
): TitleMotionPatch {
  if (!isTitleMotion(p.preset)) bad(file, `The motion is one of: ${TITLE_MOTIONS.join(', ')}.`, id);
  const out: TitleMotionPatch = { preset: p.preset as TitleMotionPatch['preset'] };
  if (p.frames !== undefined) {
    if (p.frames === null) out.frames = null;
    else {
      const n = Number(p.frames);
      if (!Number.isInteger(n) || n < 1 || n > TITLE_MOTION_MAX_FRAMES)
        bad(file, `The entrance is 1 to ${TITLE_MOTION_MAX_FRAMES} frames.`, id);
      out.frames = n === TITLE_MOTION_FRAMES ? null : n;
    }
  }
  return out;
}

export function applyTitleMotion(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  patch: TitleMotionPatch
): { source: string; motion: string } {
  const { clip } = resolveClip(file, source, artboard, stableId, hash);
  const program = parseProgram(file, source);
  const els = jsxElements(program);
  const own = els.find((e) => e.el.start === clip.start)?.el;
  if (!own) bad(file, 'That clip is not on the timeline.', stableId);
  const have = firstIn(els, clip.start, clip.end, MOTION)?.el ?? null;
  const s = new MagicString(source);

  if (patch.preset === 'none') {
    if (!have) return { source, motion: 'none' };
    s.overwrite(have.start, have.end, innerText(source, have));
    return { source: finish(file, s, stableId), motion: 'none' };
  }
  if (have) {
    // an unreadable preset is the author's own code: refuse to rewrite what we cannot read
    literalProp(file, have, 'preset', stableId);
    setProp(s, have, 'preset', JSON.stringify(patch.preset));
    if (patch.frames !== undefined)
      setProp(s, have, 'frames', patch.frames === null ? null : `{${patch.frames}}`);
    return { source: finish(file, s, stableId), motion: patch.preset };
  }
  const place = firstIn(els, clip.start, clip.end, PLACE)?.el ?? null;
  const host = place ?? own;
  if (!host.closingElement || tagOf(host) === 'TransitionSeries.Transition')
    bad(file, 'This clip has nothing to move.', stableId);
  const inner = innerText(source, host);
  if (!inner.trim()) bad(file, 'This clip has nothing to move.', stableId);
  const frames = patch.frames ? ` frames={${patch.frames}}` : '';
  s.overwrite(
    host.openingElement.end,
    host.closingElement.start,
    `<TitleMotion preset=${JSON.stringify(patch.preset)}${frames}>${inner}</TitleMotion>`
  );
  ensureCanvasLibImport(s, program, 'TitleMotion');
  return { source: finish(file, s, stableId), motion: patch.preset };
}
