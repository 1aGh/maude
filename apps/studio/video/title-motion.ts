// video/title-motion.ts — S7.10: the six motion presets a title can take (07 ve-text, "Motion": None · Fade ·
// Slide up · Pop · Type on · Per word).
//
// The PURE half of `<TitleMotion preset frames>` (video-vocab.tsx): what the picture does at a frame, and the
// list the inspector, the op and the agent path all check against. NO IMPORTS, on purpose — canvas-lib reaches
// this file (the canvas iframe's module graph may hold no npm package outside the runtime externals), and the
// client's inspector imports it for the picker's tiles. Deterministic (DDR-148): a function of its inputs.

export const TITLE_MOTIONS = ['none', 'fade', 'slide-up', 'pop', 'type-on', 'per-word'] as const;
export type TitleMotionId = (typeof TITLE_MOTIONS)[number];

/** What each preset is called in the picker (CONTRACT §3 words, the order the canvas draws them). */
export const TITLE_MOTION_LABELS: Readonly<Record<TitleMotionId, string>> = Object.freeze({
  none: 'None',
  fade: 'Fade',
  'slide-up': 'Slide up',
  pop: 'Pop',
  'type-on': 'Type on',
  'per-word': 'Per word',
});

/** The length of the entrance, in frames, when the title says none (Advanced › enter slide-up 12f). */
export const TITLE_MOTION_FRAMES = 12;
export const TITLE_MOTION_MAX_FRAMES = 90;

export const isTitleMotion = (v: unknown): v is TitleMotionId =>
  typeof v === 'string' && (TITLE_MOTIONS as readonly string[]).includes(v);

/** ease-out, the curve Advanced names (`cubic-bezier(0.22, 1, 0.36, 1)`, approximated by a quintic). */
const easeOut = (t: number): number => 1 - (1 - t) ** 5;

const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

export interface MotionStyle {
  opacity: number;
  /** px, positive = lower */
  y: number;
  scale: number;
}

/** The title's box at `frame` (the frame since its Sequence started). `type-on` and `per-word` move nothing. */
export function motionAt(
  preset: TitleMotionId,
  frame: number,
  frames: number = TITLE_MOTION_FRAMES
): MotionStyle {
  const n = Math.max(1, frames);
  const t = clamp01(frame / n);
  switch (preset) {
    case 'fade':
      return { opacity: t, y: 0, scale: 1 };
    case 'slide-up':
      return { opacity: clamp01(easeOut(t) * 1.4), y: 48 * (1 - easeOut(t)), scale: 1 };
    case 'pop': {
      // a small overshoot: 0.8 → 1.06 at 70 % → 1
      const s = t < 0.7 ? 0.8 + 0.26 * easeOut(t / 0.7) : 1.06 - 0.06 * easeOut((t - 0.7) / 0.3);
      return { opacity: clamp01(t * 2), y: 0, scale: s };
    }
    default:
      return { opacity: 1, y: 0, scale: 1 };
  }
}

/** Type on: how many of `length` characters show at `frame` — the whole entrance spans `frames`. */
export function typedChars(
  length: number,
  frame: number,
  frames: number = TITLE_MOTION_FRAMES
): number {
  const shown = Math.floor(clamp01(frame / Math.max(1, frames)) * length + 1e-9);
  return Math.min(length, Math.max(0, shown));
}

/** Per word: word `i` of `n` — a fade and a short rise, each word starting a few frames after the last. */
export function wordMotionAt(
  i: number,
  n: number,
  frame: number,
  frames: number = TITLE_MOTION_FRAMES
): MotionStyle {
  const span = Math.max(1, frames);
  const gap = n > 1 ? Math.max(1, Math.floor(span / n)) : 0;
  const t = clamp01((frame - i * gap) / Math.max(1, Math.round(span * 0.6)));
  return { opacity: t, y: 16 * (1 - easeOut(t)), scale: 1 };
}
