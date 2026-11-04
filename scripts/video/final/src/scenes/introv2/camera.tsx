import type { ReactNode } from 'react';
import { AbsoluteFill, Freeze, useCurrentFrame } from 'remotion';
import { EASE, lerp, tw, useT } from './motion';

/**
 * The one camera over the one canvas. Every beat change is a camera move (a whip, a dive, a
 * pull-back), never a cross-fade. Keys are [t, x, y, zoom]: (x, y) is the world point at the
 * frame's centre. A key holds until the next one; the segment's ease shapes the move into it.
 */
type Key = { t: number; x: number; y: number; z: number; ease?: (n: number) => number };

// World layout (px at zoom 1): hook (0,0) · wow1 pile (2225,90), timeline + reel (1900–3665)
// · wow2 grid (5257,0) · wow3 screens (7135–8395, 0) · the dark "no handoff" artboard (7800,2300)
// · end card (5200,1500). Round 2: every wow is framed at hero scale (its payoff ≥ half the
// frame), the long whips run 0.8 s, and the hits land on a held camera.
export const WORLD = { hook: [0, 0], w1: [2225, 90], w2: [5257, 0], w3: [7300, 0], nh: [7800, 2300], end: [5200, 1500] } as const;

const KEYS: Key[] = [
  { t: 0, x: 0, y: 10, z: 1.12 },
  { t: 5.95, x: 0, y: 0, z: 1.2, ease: EASE.move }, // slow push on the hook
  { t: 6.75, x: 2225, y: 95, z: 1.45, ease: EASE.whip }, // whip in close on the clip pile
  { t: 11.4, x: 2240, y: 80, z: 1.6, ease: EASE.move }, // slow push while the clips play
  { t: 12.9, x: 2200, y: 40, z: 1.38, ease: EASE.move }, // ease back as the AI's ring draws
  { t: 14.25, x: 2550, y: 118, z: 0.93, ease: EASE.move }, // the reel rises out of the pile, the timeline under it
  { t: 15.35, x: 2550, y: 118, z: 0.95, ease: EASE.move },
  { t: 16.25, x: 2550, y: -66, z: 1.2, ease: EASE.move }, // punch in on the finished reel
  { t: 17.75, x: 2550, y: -66, z: 1.24, ease: EASE.move },
  { t: 18.55, x: 5257, y: 0, z: 1.12, ease: EASE.whip }, // whip to wow 2 (0.8 s)
  { t: 20.55, x: 5257, y: 0, z: 1.16, ease: EASE.move },
  { t: 21.35, x: 5257, y: 0, z: 1.04, ease: EASE.move }, // ease out as the grid snaps in
  { t: 26.95, x: 5257, y: 0, z: 1.09, ease: EASE.move },
  { t: 27.75, x: 7300, y: 10, z: 1.25, ease: EASE.whip }, // whip in close on the sketch
  { t: 31.8, x: 7300, y: 10, z: 1.28, ease: EASE.move }, // held through the snap
  { t: 31.9, x: 7300, y: 10, z: 1.32, ease: EASE.enter }, // 3-frame punch on the hit
  { t: 32.1, x: 7300, y: 10, z: 1.28, ease: EASE.move },
  { t: 32.35, x: 7300, y: 10, z: 1.28 },
  { t: 33.2, x: 7480, y: 0, z: 1.12, ease: EASE.move }, // pull out, room for the next screen
  { t: 34.0, x: 7490, y: 0, z: 1.11, ease: EASE.move },
  { t: 35.0, x: 7765, y: 0, z: 1.04, ease: EASE.move }, // the three screens of the flow
  { t: 38.1, x: 7765, y: 0, z: 1.08, ease: EASE.move },
  { t: 38.9, x: 7800, y: 2300, z: 0.96, ease: EASE.whip }, // dive into the dark artboard
  { t: 46.35, x: 7800, y: 2300, z: 1.0, ease: EASE.move },
  { t: 47.75, x: 5090, y: 150, z: 0.285, ease: EASE.move }, // the wide pull-back over all three wows
  { t: 53.2, x: 5400, y: 120, z: 0.36, ease: EASE.move }, // slow push toward the flip target
  { t: 53.95, x: 7300, y: 0, z: 1.45, ease: EASE.whip }, // dive onto the sign-up screen
  { t: 62.85, x: 7300, y: 0, z: 1.45 },
  { t: 63.6, x: 5200, y: 1500, z: 1.22, ease: EASE.whip }, // to the end card
  { t: 71, x: 5200, y: 1500, z: 1.3, ease: EASE.move },
];

export const cameraAt = (t: number) => {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  if (!b) return { x: a.x, y: a.y, z: a.z };
  const k = tw(t, a.t, b.t, 0, 1, b.ease ?? EASE.move);
  // Zoom moves in log space so a pull-back reads as constant speed.
  const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), k));
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z };
};

/** World → screen for a camera state. */
export const toScreen = (cam: { x: number; y: number; z: number }, wx: number, wy: number) => ({
  x: 960 + (wx - cam.x) * cam.z,
  y: 540 + (wy - cam.y) * cam.z,
});

/** Screen-space speed of the camera (px per frame), measured at the frame's centre. */
export const speed = (t: number) => {
  const a = cameraAt(t - 1 / 30);
  const b = cameraAt(t);
  const pan = Math.hypot((b.x - a.x) * b.z, (b.y - a.y) * b.z);
  const zoom = Math.abs(Math.log(b.z / a.z)) * 900;
  return pan + zoom;
};

/** The plane reads the clock itself, so the motion-blur samples (sub-frames) each move it. */
const Plane = ({ children }: { children: ReactNode }) => {
  const cam = cameraAt(useT());
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <DotGrid cam={cam} />
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: 1, height: 1, transformOrigin: '0 0',
          transform: `translate(${960 - cam.x * cam.z}px, ${540 - cam.y * cam.z}px) scale(${cam.z})`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Sub-frame samples for a given speed: a 180° shutter smears half the frame's travel, and the
 * samples are spaced at most ~3.5 px apart along it so the blur reads as a smear, never a comb
 * of ghost copies. Slow frames (< 18 px/frame) get no blur at all.
 */
export const blurSamples = (pxPerFrame: number) => (pxPerFrame < 18 ? 0 : Math.max(10, Math.min(48, Math.round((pxPerFrame * 0.5) / 3.5))));

/**
 * Camera motion blur as a running average: sample i is drawn over the stack at opacity
 * 1/(i+1) with normal blending, which leaves the exact mean of the samples. (Remotion's
 * CameraMotionBlur sums N copies at opacity 1/N with plus-lighter; at 48 samples the 8-bit
 * rounding of each copy adds up and tints flat canvas cyan or navy. Here a flat area is exact.)
 * The samples span half a frame (180° shutter), centred on the frame.
 */
const MotionBlur = ({ samples, children }: { samples: number; children: ReactNode }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ isolation: 'isolate' }}>
      {Array.from({ length: samples }, (_, i) => (
        <AbsoluteFill key={i} style={{ opacity: 1 / (i + 1) }}>
          <Freeze frame={Math.max(0, f - 0.25 + (0.5 * (i + 0.5)) / samples)}>{children}</Freeze>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

/** The canvas plane under the camera. Fast moves get real motion blur (sub-frame samples). */
export const World = ({ children }: { children: ReactNode }) => {
  const t = useT();
  const n = blurSamples(speed(t));
  return n > 0 ? (
    <MotionBlur samples={n}>
      <Plane>{children}</Plane>
    </MotionBlur>
  ) : (
    <Plane>{children}</Plane>
  );
};

/** The dot grid, drawn in screen space from the camera so it stays crisp at every zoom. */
export const DotGrid = ({ cam }: { cam: { x: number; y: number; z: number } }) => {
  const step = 24 * cam.z;
  const ox = (960 - cam.x * cam.z) % step;
  const oy = (540 - cam.y * cam.z) % step;
  const r = Math.max(0.6, Math.min(1.4, 1.1 * cam.z));
  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'var(--canvas-bg)',
        backgroundImage: step > 5 ? `radial-gradient(var(--canvas-dot) ${r}px, transparent ${r + 0.4}px)` : undefined,
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${ox}px ${oy}px`,
      }}
    />
  );
};
