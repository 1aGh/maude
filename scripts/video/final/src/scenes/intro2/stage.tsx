import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
// The maude-v2 look, vendored from .design (see vendor/maude-v2/README.md): tokens, kit, site CSS.
import '../../../vendor/maude-v2/colors_and_type.css';
import '../../../vendor/maude-v2/_components.css';
import '../../../vendor/maude-v2/_kit.css';
import '../../../vendor/maude-v2/public-site-v2.css';
import './film.css';

/** The site is laid out at 1440 px; the film is 1920 px wide, so the page is scaled by 4/3. */
export const SITE_W = 1440;
export const SITE_H = 810;
export const SITE_SCALE = 1920 / SITE_W;

/** The scene's own clock in ms, for the site's `--d` delays. */
export const useMs = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (frame / fps) * 1000;
};

/** A timed entrance, like the site's `at()`: `d` is the delay in ms on the scene clock. */
export const at = (d: number): CSSProperties => ({ ['--d' as string]: `${d}ms` });

/** interpolate() over ms on the scene clock, clamped, eased out by default. */
export const tween = (ms: number, [a, b]: [number, number], [from, to]: [number, number], ease = Easing.bezier(0.2, 0.8, 0.2, 1)) =>
  interpolate(ms, [a, b], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

/**
 * The site page: maude-v2 light tokens, the canvas dot grid edge to edge, the site's own
 * animations scrubbed by `t0` (ms). Children are laid out on a 1440x810 page.
 */
export const SiteStage = ({ t0, children, style }: { t0: number; children: ReactNode; style?: CSSProperties }) => (
  <AbsoluteFill className="maude-v2 i2-film" data-theme="light" style={{ background: 'var(--canvas-bg)', ['--t0' as string]: `${t0}ms` }}>
    <div
      className="ps-page"
      style={{ position: 'absolute', left: 0, top: 0, width: SITE_W, height: SITE_H, transform: `scale(${SITE_SCALE})`, transformOrigin: '0 0', minHeight: 0, overflow: 'hidden', ...style }}
    >
      {children}
    </div>
  </AbsoluteFill>
);

/** A small island label in the corner of a montage shot. */
export const ShotLabel = ({ children, ms, ai = false }: { children: ReactNode; ms: number; ai?: boolean }) => {
  const o = tween(ms, [80, 280], [0, 1]);
  const y = tween(ms, [80, 280], [10, 0]);
  return (
    <div className="maude-v2 i2-film" data-theme="light" style={{ position: 'absolute', left: 56, bottom: 56, opacity: o, transform: `translateY(${y}px)` }}>
      <span
        className="island"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 999, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, color: ai ? 'var(--spark-text)' : 'var(--fg-0)' }}
      >
        {children}
      </span>
    </div>
  );
};
