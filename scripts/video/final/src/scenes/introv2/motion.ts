import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
// The maude-v2 look, vendored from .design (tokens, kit components); no colour is defined here.
import '../../../vendor/maude-v2/colors_and_type.css';
import '../../../vendor/maude-v2/_components.css';
import '../../../vendor/maude-v2/_kit.css';

export const FPS = 30;

/**
 * The film's clock in seconds. IntroV2 is one continuous canvas, so every element reads the
 * same global clock and knows its own cue times (CUE below); nothing restarts per scene.
 */
export const useT = () => useCurrentFrame() / useVideoConfig().fps;

/** The easing language: one curve for moves, one for entrances, one for exits. */
export const EASE = {
  move: Easing.bezier(0.65, 0, 0.35, 1), // camera and carried objects
  enter: Easing.bezier(0.16, 1, 0.3, 1), // things arriving
  exit: Easing.bezier(0.7, 0, 0.84, 0), // things leaving
  whip: Easing.bezier(0.83, 0, 0.17, 1), // whip pans (motion-blurred)
};

/** interpolate() between two times (s), clamped. */
export const tw = (t: number, a: number, b: number, from = 0, to = 1, ease = EASE.move) =>
  interpolate(t, [a, b], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

/**
 * Spring progress from `start` (s). One calm, exact register: `calm` settles in ~0.9 s with no
 * overshoot, `snappy` is near-critical (~1 %), `bouncy` is a 5 % settle (the end mark, the Flip
 * landing). `pop` (~17 % overshoot) is reserved for the two hits that mean something: the
 * spark landing as the full stop and the Wow 3 snap.
 */
export type Spring = 'calm' | 'snappy' | 'bouncy' | 'pop';
export const sp = (t: number, start: number, kind: Spring = 'calm') => {
  const cfg = {
    calm: { damping: 40, stiffness: 90, mass: 1 },
    snappy: { damping: 26, stiffness: 220, mass: 0.9 },
    bouncy: { damping: 17, stiffness: 190, mass: 0.8 },
    pop: { damping: 11, stiffness: 160, mass: 0.8 },
  }[kind];
  return spring({ frame: (t - start) * FPS, fps: FPS, config: cfg });
};

/** Entrance + exit in one value: 0 before `inAt`, 1 while on, back to 0 after `outAt`. */
export const life = (t: number, inAt: number, outAt = Infinity, kind: Spring = 'snappy') =>
  sp(t, inAt, kind) * (1 - tw(t, outAt, outAt + 0.35, 0, 1, EASE.exit));

/** Piecewise-linear value through [t, v] keys, clamped at both ends. */
export const interpolateKeys = (t: number, keys: [number, number][]) =>
  interpolate(t, keys.map((k) => k[0]), keys.map((k) => k[1]), { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * The film's cue sheet (seconds), timed to the VO takes (scripts/video/introv2-script.md).
 * Beat starts: hook 0, wow1 6.4, wow2 18, wow3 27.5, handoff 38.5, team 46.6, flip 53.5, end 63.2.
 * Round 2 set the word cues from the whisper word times (Out come 20.53, On brand 22.43, design
 * 24.47, click 33.24, HTML 56.84).
 */
export const CUE = {
  vo: [0.3, 6.7, 18.5, 27.7, 38.8, 46.9, 53.7, 63.5],
  hook: { l1: 0.35, l2: 1.2, l3: 2.25, ai: 2.7, edit: 4.9 },
  w1: { drop: 6.6, count: 8.3, ring: 11.55, fly: 13.2, play: 14.5, cap: 15.6, out: 17.75 },
  w2: { drop: 18.6, fan: 20.53, brand: 22.43, made: 23.0, swap: 24.47 },
  w3: { draw: 27.8, ring: 30.9, snap: 31.8, tap: 33.25, slide: 33.4, tap2: 35.35, flow: 35.5 },
  nh: { s1: 39.8, s2: 40.4, s3: 44.4, line: 44.7 },
  team: { pull: 46.4, people: 47.5, stick: 49.1, link: 50.2 },
  flip: { lift: 53.95, flip: 55.15, html: 56.84, sweep: 57.7, back: 58.85, land: 59.55, hover: 60.6, press: 61.35, off: 62.8 },
  end: { mark: 63.55, line: 64.5, stop: 66.4, cta: 67.1 },
};

export const TOTAL_S = 70.5;
