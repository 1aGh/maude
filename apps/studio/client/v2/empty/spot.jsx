// client/v2/empty/spot.jsx — S11.1: the spot art and its one drop of spring.
//
// `Spot({ name, w, quiet, land })` draws one of the eight spots (spot-art.jsx, built with the draw engine).
// `land` plays the DS spring once on the notes only — the page frame, the words and Ask AI are there from
// the first frame. The motion is CSS (empty.css: `--dur-spring` · `--ease-spring`, 48 ms between notes,
// transform + opacity); with reduced motion every duration is 1 ms and the animation is dropped outright.
//
// `frame` freezes the spring at a moment (ms after the canvas opens) — how 05's filmstrip shows 0 / 90 /
// 200 / 520 ms. The numbers below only freeze frames; the live animation always reads the tokens.

import { DOTS, SPOT_ART } from './spot-art.jsx';

/* Mirrors colors_and_type.css: --dur-spring 420ms · --ease-spring linear(0, 0.24 8%, 0.62 19%, 0.93 32%,
   1.045 45%, 1.03 57%, 0.997 74%, 1). */
const SPRING_STOPS = [
  [0, 0],
  [0.08, 0.24],
  [0.19, 0.62],
  [0.32, 0.93],
  [0.45, 1.045],
  [0.57, 1.03],
  [0.74, 0.997],
  [1, 1],
];
export const DUR_SPRING = 420;
/** = --dur-flip × 0.4, the CSS delay step between two notes. */
export const STAGGER = 48;

/** The four frames of 05 · es-landing. */
export const FRAMES = Object.freeze([
  { ms: 0, t: '0 ms' },
  { ms: 90, t: '90 ms' },
  { ms: 200, t: '200 ms' },
  { ms: 520, t: '520 ms' },
]);

/** The spring's progress (0 → ~1.045 → 1) at fraction `p` of its duration. */
export function springAt(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  for (let i = 1; i < SPRING_STOPS.length; i++) {
    const [p1, v1] = SPRING_STOPS[i];
    if (p <= p1) {
      const [p0, v0] = SPRING_STOPS[i - 1];
      return v0 + ((v1 - v0) * (p - p0)) / (p1 - p0);
    }
  }
  return 1;
}

/** Note `i`'s pose `ms` after the canvas opens: drops 34 px, untilts 8°, grows from 86 %, overshoots a hair. */
export function pose(ms, i) {
  const v = springAt((ms - i * STAGGER) / DUR_SPRING);
  return {
    opacity: Math.min(1, v * 1.6),
    transform: `translateY(${((1 - v) * -34).toFixed(1)}px) scale(${(0.86 + 0.14 * v).toFixed(3)}) rotate(${((1 - v) * -8).toFixed(1)}deg)`,
  };
}

/**
 * @param {{ name: 'canvas'|'ai'|'none'|'comment'|'image'|'done'|'offline'|'trash', w?: number,
 *   quiet?: boolean, land?: boolean, frame?: number, className?: string }} props
 */
export function Spot({ name, w = 240, quiet = false, land = false, frame, className = '' }) {
  const art = SPOT_ART[name];
  if (!art) return null;
  const frozen = frame !== undefined;
  const cls = [
    'es-spot',
    quiet ? 'es-spot--quiet' : '',
    land && !frozen ? 'es-spot--land' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      className={cls}
      width={w}
      height={(w * 2) / 3}
      viewBox="0 0 240 160"
      fill="none"
      aria-hidden="true"
      data-testid={`empty-spot-${name}`}
    >
      {DOTS}
      {art.base}
      {art.stickies.map((layer, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the layers are a fixed, ordered set
        <g key={i} className="es-st" style={frozen ? pose(frame, i) : { '--i': i }}>
          {layer()}
        </g>
      ))}
    </svg>
  );
}
