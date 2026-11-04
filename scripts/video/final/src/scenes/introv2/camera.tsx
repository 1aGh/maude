import { CameraMotionBlur } from '@remotion/motion-blur';
import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { EASE, lerp, tw, useT } from './motion';

/**
 * The one camera over the one canvas. Every beat change is a camera move (a whip, a dive, a
 * pull-back), never a cross-fade. Keys are [t, x, y, zoom]: (x, y) is the world point at the
 * frame's centre. A key holds until the next one; the segment's ease shapes the move into it.
 */
type Key = { t: number; x: number; y: number; z: number; ease?: (n: number) => number };

// World layout (px at zoom 1): hook (0,0) · wow1 (2600,0) · wow2 (5200,0) · wow3 (7800,0)
// · the dark "no handoff" artboard (7800,1500) · end card (5200,1500).
export const WORLD = { hook: [0, 0], w1: [2600, 0], w2: [5200, 0], w3: [7800, 0], nh: [7800, 1500], end: [5200, 1500] } as const;

const KEYS: Key[] = [
  { t: 0, x: 0, y: 20, z: 1.0 },
  { t: 6.0, x: 0, y: 0, z: 1.07, ease: EASE.move }, // slow push on the hook
  { t: 6.65, x: 2420, y: 10, z: 1.0, ease: EASE.whip }, // whip to wow 1
  { t: 13.0, x: 2470, y: 0, z: 1.02, ease: EASE.move }, // drift while the AI watches
  { t: 14.1, x: 2720, y: 40, z: 0.94, ease: EASE.move }, // follow the clips into the timeline
  { t: 17.6, x: 2740, y: 40, z: 0.96, ease: EASE.move },
  { t: 18.25, x: 5160, y: 0, z: 1.0, ease: EASE.whip }, // whip to wow 2
  { t: 27.1, x: 5240, y: 0, z: 1.03, ease: EASE.move },
  { t: 27.7, x: 7360, y: 10, z: 1.25, ease: EASE.whip }, // whip in close on the sketch
  { t: 31.6, x: 7380, y: 10, z: 1.28, ease: EASE.move },
  { t: 32.5, x: 7560, y: 10, z: 1.0, ease: EASE.move }, // pull out as it snaps into screens
  { t: 35.4, x: 7700, y: 10, z: 1.02, ease: EASE.move },
  { t: 36.6, x: 7750, y: 10, z: 0.86, ease: EASE.move }, // the flow of screens
  { t: 38.25, x: 7750, y: 10, z: 0.86 },
  { t: 38.85, x: 7800, y: 1500, z: 0.96, ease: EASE.whip }, // dive into the dark artboard
  { t: 46.35, x: 7800, y: 1500, z: 1.0, ease: EASE.move },
  { t: 47.75, x: 5090, y: 40, z: 0.29, ease: EASE.move }, // the wide pull-back over all three wows
  { t: 53.2, x: 5090, y: 40, z: 0.3, ease: EASE.move },
  { t: 53.95, x: 7300, y: 0, z: 1.45, ease: EASE.whip }, // dive onto the sign-up screen
  { t: 62.9, x: 7300, y: 0, z: 1.45 },
  { t: 63.55, x: 5200, y: 1500, z: 1.22, ease: EASE.whip }, // to the end card
  { t: 71, x: 5200, y: 1500, z: 1.27, ease: EASE.move },
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
const speed = (t: number) => {
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

/** The canvas plane under the camera. Fast moves get real motion blur (sub-frame samples). */
export const World = ({ children }: { children: ReactNode }) => {
  const t = useT();
  return speed(t) > 24 ? (
    <CameraMotionBlur shutterAngle={180} samples={12}>
      <Plane>{children}</Plane>
    </CameraMotionBlur>
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
