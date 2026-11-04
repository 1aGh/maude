import type { ReactNode } from 'react';
import { AbsoluteFill, Img, Sequence, staticFile, useVideoConfig } from 'remotion';
import { Cursor, Spark, Sticky } from '../../../vendor/maude-v2/_kit';
import { SiteStage, ShotLabel, at, tween, useMs } from './stage';

/**
 * Beat 5 (33.5–43.5 s). "Screens, reels, slides and print. A design system from a moodboard.
 * Your whole team, live, on one canvas."
 *
 * REAL CAPTURES of the Maude 2 studio on a throwaway demo project (scripts/capture-intro2.mjs),
 * cut on the VO's words, each moved by a slow camera. Two parts are recreations in the site's
 * own pieces: the moodboard tiles turning into a design system, and the live cursors and sticky
 * drawn over the real canvas capture for "your whole team, live".
 */

/**
 * A capture (taken at 2x, shown at 1920x1080) with a slow camera: `from`/`to` are
 * [scale, focusX, focusY], the focus in 1920x1080 capture px that the camera centres on.
 */
const Shot = ({ src, dur, from, to, label, ai = false }: { src: string; dur: number; from: [number, number, number]; to: [number, number, number]; label: ReactNode; ai?: boolean }) => {
  const ms = useMs();
  const { fps } = useVideoConfig();
  const end = (dur / fps) * 1000;
  const [s, fx, fy] = [0, 1, 2].map((i) => tween(ms, [0, end], [from[i], to[i]], (x) => x));
  return (
    <AbsoluteFill className="maude-v2" data-theme="light" style={{ background: 'var(--canvas-bg)', overflow: 'hidden' }}>
      <Img
        src={staticFile(`intro2/captures/${src}.jpg`)}
        style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transformOrigin: '0 0', transform: `translate(${960 - fx * s}px, ${540 - fy * s}px) scale(${s})` }}
      />
      <ShotLabel ms={ms} ai={ai}>{label}</ShotLabel>
    </AbsoluteFill>
  );
};

/** The moodboard tiles become a design system (the site's bento picture, played large). */
const Moodboard = () => {
  const ms = useMs();
  const tiles = ['var(--object-lilac)', 'var(--object-sky)', 'var(--object-yellow)', 'var(--object-green)'];
  return (
    <SiteStage t0={ms}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 56 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {tiles.map((bg, i) => (
            <i key={bg} className="ps-a ps-a--pop" style={{ display: 'block', width: 120, height: 120, borderRadius: 18, background: bg, ...at(i * 70) }} />
          ))}
        </div>
        <span className="ps-a ps-a--fade" style={{ display: 'inline-flex', color: 'var(--spark)', ...at(350) }}><Spark size={44} /></span>
        <div className="ps-card ps-a" style={{ ...at(500), padding: 28, gap: 18, width: 300 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 64, lineHeight: 1 }}>Aa</b>
          <span style={{ display: 'flex', gap: 8 }}>
            {['var(--accent)', 'var(--fg-0)', 'var(--object-yellow)', 'var(--object-sky)'].map((c) => (
              <i key={c} style={{ display: 'block', width: 34, height: 34, borderRadius: 999, background: c }} />
            ))}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="btn btn--primary">Button</span>
            <span className="btn">Button</span>
          </span>
        </div>
      </div>
    </SiteStage>
  );
};

/** Live together: the real canvas capture with people moving on it. */
const Together = () => {
  const ms = useMs();
  const glide = (d: number, fx: number, fy: number) => ({
    opacity: tween(ms, [d, d + 200], [0, 1]),
    transform: `translate(${tween(ms, [d, d + 1400], [fx, 0])}px, ${tween(ms, [d, d + 1400], [fy, 0])}px)`,
  });
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile('intro2/captures/canvas-landing.jpg')} style={{ width: 1920, height: 1080, transform: `scale(${tween(ms, [0, 4400], [1.06, 1.14], (x) => x)})`, transformOrigin: '50% 45%' }} />
      <AbsoluteFill className="maude-v2 i2-film" data-theme="light" style={{ ['--t0' as string]: `${ms}ms` }}>
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.5)', transformOrigin: '0 0' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, ...glide(100, -120, 60) }}>
            <Cursor name="tereza" x={420} y={520} />
          </div>
          <div style={{ position: 'absolute', left: 0, top: 0, ...glide(450, 140, 90) }}>
            <Cursor name="jonas" x={780} y={210} />
          </div>
          <div className="ps-a ps-a--land" style={{ position: 'absolute', left: 470, top: 450, width: 170, ...at(1500) }}>
            <Sticky color="yellow" x={0} y={0} rotate={3} w={170}>Bigger logo on the poster?</Sticky>
          </div>
          <div className="ps-a ps-a--land" style={{ position: 'absolute', left: 660, top: 90, width: 160, ...at(2300) }}>
            <Sticky color="green" x={0} y={0} rotate={-2} w={160}>Ship it ✓</Sticky>
          </div>
        </div>
      </AbsoluteFill>
      <ShotLabel ms={ms}>Live, together</ShotLabel>
    </AbsoluteFill>
  );
};

const Label = ({ text }: { text: string }) => <ShotLabel ms={useMs()} ai>{text}</ShotLabel>;

/** Cuts in frames on the scene clock (30 fps), on the VO words (VO starts at 0.4 s). */
const CUTS: { from: number; dur: number; node: ReactNode }[] = [
  { from: 0, dur: 37, node: <Shot src="canvas-site" dur={37} from={[1.3, 900, 640]} to={[1.38, 900, 630]} label="Screens" /> },
  { from: 37, dur: 19, node: <Shot src="reels" dur={19} from={[1.12, 960, 480]} to={[1.18, 960, 470]} label="Reels" /> },
  { from: 56, dur: 22, node: <Shot src="present" dur={22} from={[1.2, 960, 400]} to={[1.26, 960, 390]} label="Slides" /> },
  { from: 78, dur: 23, node: <Shot src="canvas-landing" dur={23} from={[1.25, 560, 760]} to={[1.32, 560, 770]} label="Print" /> },
  { from: 101, dur: 34, node: <><Moodboard /><Label text="From a moodboard" /></> },
  { from: 135, dur: 33, node: <Shot src="design-system" dur={33} from={[1.1, 1100, 640]} to={[1.17, 1100, 650]} label="A design system" /> },
  { from: 168, dur: 144, node: <Together /> },
];

export const I2Montage = () => (
  <AbsoluteFill className="maude-v2" data-theme="light" style={{ background: 'var(--canvas-bg)' }}>
    {CUTS.map((c) => (
      <Sequence key={c.from} from={c.from} durationInFrames={c.dur}>
        {c.node}
      </Sequence>
    ))}
  </AbsoluteFill>
);
