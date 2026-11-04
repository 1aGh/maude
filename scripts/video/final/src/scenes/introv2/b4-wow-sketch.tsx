import { Cursor } from '../../../vendor/maude-v2/_kit';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';
import { BTN, HomeScreen, SCR, SignUpScreen, WelcomeScreen } from './screens';
import { Chip, DrawnPath, SparkRing, wobble, wobblyBox } from './shared';

/**
 * Beat 4 · Wow 3 (27.5–38.5 s). "Draw your idea. Badly. I do. The AI turns it into real screens
 * you can click through."
 *
 * A recreation, at hero scale (the phone is ~70 % of the frame height). A hand sketch draws
 * itself stroke by stroke while the music is silent; the spark ring wraps it; on the hit, with
 * the camera held, a scan line sweeps down the phone and leaves the real sign-up screen above it
 * (the sketch still below), with a 3-frame camera punch and the spark riding the line. Then the
 * camera eases out and the user clicks: the cursor dips, presses Sign up on "click", a ripple
 * fires and the prototype link draws out of the button to the Welcome screen as it slides in;
 * a second click on Continue draws the link to the third screen.
 */
export const S1 = { x: 7135, y: -310 }; // the sketch, then screen 1 (world px, top-left)
const S2 = { x: 7600, y: -310 };
const S3 = { x: 8065, y: -310 };

// The sketch, in screen coordinates, in drawing order: [path, start s, end s].
const W = SCR.w;
const STROKES: [string, number, number][] = [
  [wobblyBox(4, 4, W - 8, SCR.h - 8, 1, 40), 27.8, 28.55],
  [
    wobble(
      [
        [150, 52],
        [180, 50],
        [182, 70],
        [150, 72],
        [148, 50],
      ],
      2
    ),
    28.55,
    28.75,
  ],
  [
    wobble(
      [
        [60, 116],
        [110, 104],
        [150, 122],
        [200, 102],
        [250, 118],
        [270, 110],
      ],
      3,
      4
    ),
    28.75,
    29.05,
  ],
  [
    wobble(
      [
        [110, 154],
        [160, 146],
        [210, 156],
      ],
      4,
      3
    ),
    29.05,
    29.2,
  ],
  [wobblyBox(30, 200, 270, 56, 5), 29.2, 29.5],
  [wobblyBox(30, 280, 270, 56, 6), 29.5, 29.8],
  [wobblyBox(30, 380, 270, 60, 7, 30), 29.8, 30.15],
  [
    wobble(
      [
        [120, 412],
        [140, 402],
        [160, 418],
        [180, 404],
        [205, 414],
      ],
      8,
      3
    ),
    30.15,
    30.35,
  ],
  [
    wobble(
      [
        [90, 482],
        [240, 478],
      ],
      9,
      2
    ),
    30.35,
    30.5,
  ],
  [
    wobble(
      [
        [40, 560],
        [150, 556],
      ],
      10,
      2
    ),
    30.5,
    30.62,
  ],
  [
    wobble(
      [
        [180, 560],
        [290, 562],
      ],
      11,
      2
    ),
    30.62,
    30.74,
  ],
];
const ARROW = (from: { x: number; y: number }, to: { x: number; y: number }) =>
  `M${from.x},${from.y} C${from.x + 110},${from.y} ${to.x - 110},${to.y} ${to.x},${to.y}`;

/** A press with anticipation: 0 → 1 → 0 around `at` (the dip before, the spring back after). */
const pressAt = (t: number, at: number) =>
  tw(t, at, at + 0.12, 0, 1, EASE.enter) * (1 - tw(t, at + 0.16, at + 0.4, 0, 1, EASE.move));
const cursorScale = (t: number, at: number) =>
  1.5 *
  (1 -
    0.08 * tw(t, at - 0.13, at - 0.03, 0, 1, EASE.move) * (1 - sp(t, at + 0.02, 'snappy')) -
    0.06 * pressAt(t, at));

/** The click ripple, clipped to the button it fires in. */
const Ripple = ({ x, y, t, at }: { x: number; y: number; t: number; at: number }) => {
  const k = tw(t, at, at + 0.55, 0, 1, EASE.enter);
  if (k <= 0 || k >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: BTN.w,
        height: BTN.h,
        borderRadius: 999,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <i
        style={{
          position: 'absolute',
          left: 170 - 160 * k,
          top: 30 - 160 * k,
          width: 320 * k,
          height: 320 * k,
          borderRadius: '50%',
          background: 'var(--bg-0)',
          opacity: 0.45 * (1 - k),
        }}
      />
    </div>
  );
};

export const WowSketch = ({ hideScreen1 = false }: { hideScreen1?: boolean }) => {
  const t = useT();
  if (t < 26.5 || (t > 39.2 && t < 46) || t > 64) return null;
  const { snap, tap, slide, tap2, flow } = CUE.w3;
  const ring = tw(t, CUE.w3.ring, CUE.w3.ring + 0.75, 0, 1, EASE.move);
  const ringOut = tw(t, snap + 0.05, snap + 0.4);
  const scan = tw(t, snap, snap + 0.45, 0, 1, EASE.enter); // the scan line: sketch above → real
  const device = sp(t, snap, 'pop'); // the hit: one of the film's two big overshoots
  const flash = tw(t, snap - 0.06, snap) * (1 - tw(t, snap + 0.04, snap + 0.6));
  // the user's cursor: comes in as the camera eases out, clicks Sign up, then Continue
  const c1 = tw(t, 32.45, 33.1, 0, 1, EASE.move);
  const c2 = tw(t, 34.55, 35.2, 0, 1, EASE.move);
  const b1 = { x: S1.x + 200, y: S1.y + 415 };
  const b2 = { x: S2.x + 200, y: S2.y + 495 };
  const cx = lerp(lerp(S1.x + 520, b1.x, c1), b2.x, c2);
  const cy = lerp(lerp(S1.y + 760, b1.y, c1), b2.y, c2) - Math.sin(Math.PI * c2) * 60;
  const s2 = sp(t, slide, 'snappy');
  const s3 = sp(t, flow, 'snappy');
  const a1 = tw(t, tap + 0.08, tap + 0.6, 0, 1, EASE.enter);
  const a2 = tw(t, tap2 + 0.08, tap2 + 0.6, 0, 1, EASE.enter);
  return (
    <>
      {/* screen 1: sketch → real, swept by the scan line */}
      <div
        style={{
          position: 'absolute',
          left: S1.x,
          top: S1.y,
          width: SCR.w,
          height: SCR.h,
          opacity: hideScreen1 ? 0 : 1,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `scale(${0.97 + 0.03 * device})`,
            clipPath: `inset(0 -40px ${(1 - scan) * 100}% -40px)`,
            opacity: scan > 0 ? 1 : 0,
          }}
        >
          <SignUpScreen press={pressAt(t, tap)} />
        </div>
        <Ripple x={BTN.x} y={BTN.y} t={t} at={tap} />
        <div
          style={{
            position: 'absolute',
            inset: -12,
            borderRadius: SCR.r + 12,
            boxShadow: `0 0 0 ${22 * flash}px var(--spark-muted)`,
            opacity: flash,
          }}
        />
        <svg
          width={SCR.w}
          height={SCR.h}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            overflow: 'visible',
            clipPath: `inset(${scan * 100}% -20px -20px -20px)`,
            opacity: scan < 1 ? 1 : 0,
          }}
        >
          {STROKES.map(([d, a, b], i) => (
            <DrawnPath key={i} d={d} t={t} a={a} b={b} width={3.4} />
          ))}
        </svg>
        {scan > 0 && scan < 1 ? (
          <i
            style={{
              position: 'absolute',
              left: -24,
              right: -24,
              top: scan * SCR.h - 2,
              height: 4,
              borderRadius: 2,
              background: 'var(--spark)',
              boxShadow: '0 0 22px 6px var(--spark-muted)',
              opacity: 1 - tw(t, snap + 0.36, snap + 0.45),
            }}
          />
        ) : null}
      </div>
      <SparkRing
        x={S1.x - 30}
        y={S1.y - 30}
        w={SCR.w + 60}
        h={SCR.h + 60}
        draw={ring}
        out={ringOut}
        r={56}
      />
      <div
        style={{
          position: 'absolute',
          left: S1.x + 140,
          top: S1.y - 96,
          opacity: (ring > 0 ? 1 : 0) * (1 - ringOut),
          transform: `scale(${sp(t, CUE.w3.ring + 0.2, 'snappy')})`,
          transformOrigin: '0 100%',
        }}
      >
        <Chip ai>AI is building</Chip>
      </div>

      {/* the flow: each click draws its prototype link out of the button, the next screen slides in */}
      <svg
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        width={1}
        height={1}
      >
        {a1 > 0.002 ? (
          <path
            d={ARROW(
              { x: S1.x + BTN.x + BTN.w + 4, y: S1.y + BTN.y + BTN.h / 2 },
              { x: S2.x - 8, y: S2.y + 310 }
            )}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - a1}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={5}
            strokeLinecap="round"
          />
        ) : null}
        {a2 > 0.002 ? (
          <path
            d={ARROW(
              { x: S2.x + BTN.x + BTN.w + 4, y: S2.y + 490 },
              { x: S3.x - 8, y: S3.y + 310 }
            )}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - a2}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={5}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div
        style={{
          position: 'absolute',
          left: lerp(S2.x + 260, S2.x, s2),
          top: S2.y,
          opacity: Math.min(1, s2 * 1.4),
        }}
      >
        <WelcomeScreen press={pressAt(t, tap2)} />
        <Ripple x={BTN.x} y={460} t={t} at={tap2} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: lerp(S3.x + 260, S3.x, s3),
          top: S3.y,
          opacity: Math.min(1, s3 * 1.4),
        }}
      >
        <HomeScreen />
      </div>

      <div
        style={{
          position: 'absolute',
          left: cx,
          top: cy,
          opacity: tw(t, 32.45, 32.7) * (1 - tw(t, 37.6, 38.0)),
          transform: `scale(${t < 34.5 ? cursorScale(t, tap) : cursorScale(t, tap2)})`,
          transformOrigin: '0 0',
        }}
      >
        <Cursor name="you" x={0} y={0} tag={false} />
      </div>
    </>
  );
};
