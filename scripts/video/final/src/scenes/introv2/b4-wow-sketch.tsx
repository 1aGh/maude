import { Cursor } from '../../../vendor/maude-v2/_kit';
import { HomeScreen, SCR, SignUpScreen, WelcomeScreen } from './screens';
import { Chip, DrawnPath, SparkRing, wobble, wobblyBox } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 4 · Wow 3 (27.5–38.5 s). "Draw your idea. Badly. I do. The AI turns it into real screens
 * you can click through."
 *
 * A recreation. A hand sketch draws itself stroke by stroke (wobbly SVG paths) while the music is
 * silent; the spark ring wraps it; on the hit it snaps into a real sign-up screen (each sketched
 * part becomes its real element, staggered); the cursor taps Sign up and the next screens slide
 * in, linked by prototype arrows.
 */
export const S1 = { x: 7135, y: -310 }; // the sketch, then screen 1 (world px, top-left)
const S2 = { x: 7600, y: -310 };
const S3 = { x: 8065, y: -310 };

// The sketch, in screen coordinates, in drawing order: [path, start s, end s].
const W = SCR.w;
const STROKES: [string, number, number][] = [
  [wobblyBox(4, 4, W - 8, SCR.h - 8, 1, 40), 27.8, 28.55],
  [wobble([[150, 52], [180, 50], [182, 70], [150, 72], [148, 50]], 2), 28.55, 28.75],
  [wobble([[60, 116], [110, 104], [150, 122], [200, 102], [250, 118], [270, 110]], 3, 4), 28.75, 29.05],
  [wobble([[110, 154], [160, 146], [210, 156]], 4, 3), 29.05, 29.2],
  [wobblyBox(30, 200, 270, 56, 5), 29.2, 29.5],
  [wobblyBox(30, 280, 270, 56, 6), 29.5, 29.8],
  [wobblyBox(30, 380, 270, 60, 7, 30), 29.8, 30.15],
  [wobble([[120, 412], [140, 402], [160, 418], [180, 404], [205, 414]], 8, 3), 30.15, 30.35],
  [wobble([[90, 482], [240, 478]], 9, 2), 30.35, 30.5],
];
const ARROW = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  `M${from.x},${from.y} C${from.x + 90},${from.y} ${to.x - 90},${to.y} ${to.x},${to.y}`;

export const WowSketch = ({ hideScreen1 = false }: { hideScreen1?: boolean }) => {
  const t = useT();
  if (t < 26.5) return null;
  const { snap, tap, slide, flow } = CUE.w3;
  const ring = tw(t, CUE.w3.ring, CUE.w3.ring + 0.75, 0, 1, EASE.move);
  const ringOut = tw(t, snap + 0.15, snap + 0.5);
  const sketchOut = tw(t, snap, snap + 0.22, 0, 1, EASE.exit);
  const real = (i: number) => sp(t, snap + 0.04 + i * 0.045, 'snappy');
  const device = sp(t, snap, 'snappy');
  const flash = tw(t, snap, snap + 0.1) * (1 - tw(t, snap + 0.12, snap + 0.6));
  // the user's cursor: comes in after the snap, taps Sign up, then rests
  const cur = tw(t, 32.9, 33.95, 0, 1, EASE.move);
  const press = tw(t, tap, tap + 0.22, 0, 1, (n) => n);
  const s2 = sp(t, slide, 'snappy');
  const s3 = sp(t, flow, 'snappy');
  const a1 = tw(t, slide + 0.1, slide + 0.55, 0, 1, EASE.enter);
  const a2 = tw(t, flow + 0.1, flow + 0.55, 0, 1, EASE.enter);
  return (
    <>
      {/* screen 1: sketch → real */}
      <div style={{ position: 'absolute', left: S1.x, top: S1.y, width: SCR.w, height: SCR.h, opacity: hideScreen1 ? 0 : 1 }}>
        <div style={{ position: 'absolute', inset: 0, opacity: device, transform: `scale(${0.97 + 0.03 * device})` }}>
          <SignUpScreen k={real} press={press} />
        </div>
        <div style={{ position: 'absolute', inset: -12, borderRadius: SCR.r + 12, boxShadow: `0 0 0 ${18 * flash}px var(--spark-muted)`, opacity: flash }} />
        <svg width={SCR.w} height={SCR.h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: 1 - sketchOut, transform: `scale(${1 + 0.04 * sketchOut})` }}>
          {STROKES.map(([d, a, b], i) => <DrawnPath key={i} d={d} t={t} a={a} b={b} width={3.4} />)}
        </svg>
      </div>
      <SparkRing x={S1.x - 30} y={S1.y - 30} w={SCR.w + 60} h={SCR.h + 60} draw={ring} out={ringOut} r={56} />
      <div style={{ position: 'absolute', left: S1.x + 140, top: S1.y - 96, opacity: 1 - ringOut, transform: `scale(${sp(t, CUE.w3.ring + 0.2, 'bouncy')})`, transformOrigin: '0 100%' }}>
        <Chip ai>AI is building</Chip>
      </div>

      {/* the flow: screen 2 and 3 slide in, linked by prototype arrows */}
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={1} height={1}>
        <path d={ARROW({ x: S1.x + SCR.w + 6, y: S1.y + 410 }, { x: S2.x - 8, y: S2.y + 310 })} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - a1} fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" />
        <path d={ARROW({ x: S2.x + SCR.w + 6, y: S2.y + 490 }, { x: S3.x - 8, y: S3.y + 310 })} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - a2} fill="none" stroke="var(--accent)" strokeWidth={4} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: lerp(S2.x + 260, S2.x, s2), top: S2.y, opacity: Math.min(1, s2 * 1.4) }}>
        <WelcomeScreen />
      </div>
      <div style={{ position: 'absolute', left: lerp(S3.x + 260, S3.x, s3), top: S3.y, opacity: Math.min(1, s3 * 1.4) }}>
        <HomeScreen />
      </div>

      <div style={{ position: 'absolute', left: lerp(7560, S1.x + 190, cur), top: lerp(380, S1.y + 420, cur), opacity: tw(t, 32.8, 33.1) * (1 - tw(t, 37.6, 38.0)), transform: `scale(${1.5 * (1 - 0.12 * Math.sin(Math.PI * press))})`, transformOrigin: '0 0' }}>
        <Cursor name="you" x={0} y={0} tag={false} />
      </div>
    </>
  );
};
