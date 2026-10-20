// client/v2/timeline/joins/join-model.js — S7.10: a join between two clips (07 · ve-transition).
//
// "Click the dot between Oslava and Logo; the picker opens right there. Hover a tile and it plays; Fade over 0.5 s
// is chosen. Six transitions, all of today's." The six tiles, the title, the Length slider's range, and what each
// tile does to the two shots on hover. No DOM, no React.

/** [label, key] in the order the canvas draws them. `key` is what `video.transition.set` takes. */
export const JOIN_TILES = Object.freeze([
  Object.freeze(['Cut', 'cut']),
  Object.freeze(['Fade', 'fade']),
  Object.freeze(['Slide', 'slide']),
  Object.freeze(['Wipe', 'wipe']),
  Object.freeze(['Flip', 'flip']),
  Object.freeze(['Clock wipe', 'clock']),
]);

/** The presentation a join plays (as the comp spells it) → the tile that is lit. */
export function tileOfPresentation(presentation) {
  if (presentation === 'none') return 'cut';
  if (presentation === 'clock-wipe') return 'clock';
  return JOIN_TILES.some(([, k]) => k === presentation) ? presentation : null;
}

/** "Oslava → Logo" — the picker's title. A clip without a name is "Clip N". */
export function joinTitle(a, b) {
  return `${a || 'Clip'} → ${b || 'Clip'}`;
}

/** The Length slider: a join is between a tenth of a second and two (the canvas's 0.5 s sits at 25 %). */
export const JOIN_SECONDS = Object.freeze({ min: 0.1, max: 2, step: 0.1 });

export const joinSeconds = (frames, fps) =>
  Math.round((Math.max(0, frames) / Math.max(1, Math.round(fps) || 30)) * 10) / 10;

export const joinFrames = (seconds, fps) =>
  Math.max(1, Math.round(seconds * Math.max(1, Math.round(fps) || 30)));

/** "0.5 s" */
export const joinSecondsWords = (seconds) => `${Number(seconds.toFixed(1))} s`;

/** How long a hover plays the join, in ms (a loop pauses a beat on the finished picture). */
export const PREVIEW_MS = 800;

const WEDGE = [
  'polygon(50% 50%, 50% 0%, 50% 0%)',
  'polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%)',
  'polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 50% 100%)',
  'polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 50%)',
  'polygon(50% 50%, 50% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 50% 0%)',
];

/**
 * What the two shots do while a tile plays: Web Animations keyframes for the outgoing shot (`a`) and the incoming
 * one (`b`, stacked over it). The animation has to end where `b` fills the frame. `rm` (reduced motion) plays
 * nothing: the incoming shot just shows.
 */
export function previewKeyframes(key, { rm = false } = {}) {
  if (rm) return { a: [{ opacity: 0 }, { opacity: 0 }], b: [{ opacity: 1 }, { opacity: 1 }] };
  switch (key) {
    case 'cut':
      return {
        a: [
          { opacity: 1 },
          { opacity: 1, offset: 0.5 },
          { opacity: 0, offset: 0.5 },
          { opacity: 0 },
        ],
        b: [
          { opacity: 0 },
          { opacity: 0, offset: 0.5 },
          { opacity: 1, offset: 0.5 },
          { opacity: 1 },
        ],
      };
    case 'fade':
      return {
        a: [{ opacity: 1 }, { opacity: 1 }],
        b: [{ opacity: 0 }, { opacity: 1 }],
      };
    case 'slide':
      return {
        a: [{ transform: 'translateX(0)' }, { transform: 'translateX(-30%)' }],
        b: [
          { opacity: 1, transform: 'translateX(100%)' },
          { opacity: 1, transform: 'translateX(0)' },
        ],
      };
    case 'wipe':
      return {
        a: [{ opacity: 1 }, { opacity: 1 }],
        b: [
          { opacity: 1, clipPath: 'inset(0 100% 0 0)' },
          { opacity: 1, clipPath: 'inset(0 0 0 0)' },
        ],
      };
    case 'flip':
      return {
        a: [
          { transform: 'perspective(400px) rotateY(0deg)', opacity: 1 },
          { transform: 'perspective(400px) rotateY(-90deg)', opacity: 1, offset: 0.5 },
          { transform: 'perspective(400px) rotateY(-90deg)', opacity: 0 },
        ],
        b: [
          { transform: 'perspective(400px) rotateY(90deg)', opacity: 0 },
          { transform: 'perspective(400px) rotateY(90deg)', opacity: 0, offset: 0.5 },
          { transform: 'perspective(400px) rotateY(0deg)', opacity: 1 },
        ],
      };
    case 'clock':
      return {
        a: [{ opacity: 1 }, { opacity: 1 }],
        b: WEDGE.map((clipPath, i) => ({ opacity: 1, clipPath, offset: i / (WEDGE.length - 1) })),
      };
    default:
      return { a: [{ opacity: 1 }, { opacity: 1 }], b: [{ opacity: 1 }, { opacity: 1 }] };
  }
}

/**
 * The still of each shot the preview holds: the outgoing clip's LAST second and the incoming clip's FIRST (a media
 * fragment, `#t=`), from the numbers the clip carries. A clip with no media of its own has none (it is drawn flat).
 * @param {{ mediaSrc?: string|null, duration?: number, mediaProps?: { trimBefore?: number|null, playbackRate?: number|null }|null }} seq
 * @param {'last'|'first'} end
 */
export function stillSecond(seq, end, fps) {
  if (!seq?.mediaSrc) return null;
  const f = Math.max(1, Math.round(fps) || 30);
  const rate = seq.mediaProps?.playbackRate > 0 ? seq.mediaProps.playbackRate : 1;
  const inSec = (seq.mediaProps?.trimBefore ?? 0) / f;
  if (end === 'first') return Math.round((inSec + 0.1) * 100) / 100;
  const outSec = inSec + (Math.max(1, seq.duration ?? 1) / f) * rate;
  return Math.max(0, Math.round((outSec - 0.1) * 100) / 100);
}
