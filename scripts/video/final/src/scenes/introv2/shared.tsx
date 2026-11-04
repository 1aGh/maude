import type { CSSProperties, ReactNode } from 'react';
import { Spark } from '../../../vendor/maude-v2/_kit';
import { EASE, tw } from './motion';
import './film.css';

/** Absolute placement in world px (centre-anchored when `c`). */
export const At = ({ x, y, c = false, style, children }: { x: number; y: number; c?: boolean; style?: CSSProperties; children: ReactNode }) => (
  <div style={{ position: 'absolute', left: x, top: y, transform: c ? 'translate(-50%, -50%)' : undefined, ...style }}>{children}</div>
);

/** A small chip; `ai` = the spark's colours (only ever when the AI acts). */
export const Chip = ({ ai = false, children, style }: { ai?: boolean; children: ReactNode; style?: CSSProperties }) => (
  <span
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, whiteSpace: 'nowrap',
      fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22,
      color: ai ? 'var(--spark-fg)' : 'var(--fg-0)', background: ai ? 'var(--spark)' : 'var(--bg-1)',
      boxShadow: ai ? '0 6px 18px var(--spark-muted)' : 'var(--shadow-sm)', border: ai ? 'none' : '1px solid var(--border-subtle)',
      ...style,
    }}
  >
    {ai ? <Spark size={16} color="currentColor" /> : null}
    {children}
  </span>
);

/**
 * The AI's working ring: a rounded frame that draws itself around what the AI is working on,
 * with a soft spark glow. `draw` 0→1 draws the stroke, `out` 0→1 lets it go.
 */
export const SparkRing = ({ x, y, w, h, draw, out = 0, r = 28 }: { x: number; y: number; w: number; h: number; draw: number; out?: number; r?: number }) => {
  const per = 2 * (w + h);
  return (
    <svg style={{ position: 'absolute', left: x - 12, top: y - 12, overflow: 'visible', opacity: 1 - out, pointerEvents: 'none' }} width={w + 24} height={h + 24}>
      <rect x={12} y={12} width={w} height={h} rx={r} fill="none" stroke="var(--spark-muted)" strokeWidth={14 * draw} />
      <rect x={12} y={12} width={w} height={h} rx={r} fill="none" stroke="var(--spark)" strokeWidth={4} strokeLinecap="round" strokeDasharray={per} strokeDashoffset={per * (1 - draw)} />
    </svg>
  );
};

/** Deterministic noise for hand-drawn wobble. */
const rnd = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A hand-drawn line through points: every segment gets a little wobble, the ends overshoot. */
export const wobble = (pts: [number, number][], seed: number, amp = 3.2) => {
  let d = '';
  pts.forEach(([x, y], i) => {
    const jx = (rnd(seed + i * 3.1) - 0.5) * amp * 2;
    const jy = (rnd(seed + i * 7.7) - 0.5) * amp * 2;
    if (i === 0) {
      d += `M${x + jx},${y + jy}`;
      return;
    }
    const [px, py] = pts[i - 1];
    const mx = (px + x) / 2 + (rnd(seed + i * 5.3) - 0.5) * amp * 3;
    const my = (py + y) / 2 + (rnd(seed + i * 9.1) - 0.5) * amp * 3;
    d += ` Q${mx},${my} ${x + jx},${y + jy}`;
  });
  return d;
};

/** A box as a wobbly closed stroke (corners slightly overshot like a quick pen). */
export const wobblyBox = (x: number, y: number, w: number, h: number, seed: number, r = 0) => {
  const k = r ? Math.min(r, h / 2) : 0;
  const pts: [number, number][] = k
    ? [[x + k, y], [x + w - k, y], [x + w - k * 0.3, y + k * 0.3], [x + w, y + k], [x + w, y + h - k], [x + w - k * 0.3, y + h - k * 0.3], [x + w - k, y + h], [x + k, y + h], [x + k * 0.3, y + h - k * 0.3], [x, y + h - k], [x, y + k], [x + k * 0.3, y + k * 0.3], [x + k + 6, y - 3]]
    : [[x - 3, y], [x + w / 2, y + 1], [x + w + 4, y - 1], [x + w, y + h / 2], [x + w + 1, y + h + 3], [x + w / 2, y + h], [x - 1, y + h + 1], [x, y + h / 2], [x + 2, y - 4]];
  return wobble(pts, seed);
};

/** An SVG path that draws itself between `a` and `b` (s). */
export const DrawnPath = ({ d, t, a, b, width = 3.2, color = 'var(--fg-0)', opacity = 1 }: { d: string; t: number; a: number; b: number; width?: number; color?: string; opacity?: number }) => {
  const k = tw(t, a, b, 0, 1, EASE.enter);
  return <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={1 - k} opacity={k > 0 ? opacity : 0} />;
};
