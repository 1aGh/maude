import { Cursor } from '../../../vendor/maude-v2/_kit';
import { cameraAt } from './camera';
import { CUE, EASE, interpolateKeys, tw, useT } from './motion';
import { ringPoint } from './shared';

/**
 * The spark: the AI's signature, one object that travels the whole film. It is the AI cursor,
 * on screen only while the AI acts (hook edit, wow 1 cut, wow 2 posts, wow 3 snap) and gone
 * while people act (the sketch, no handoff, the team, the flip). It ends as the end card's full
 * stop (b8-end lands that one itself).
 *
 * Round 2: it moves in RUNS, not hops. Each run is one smooth path (a centripetal Catmull-Rom
 * spline through its points, walked by arc length) on one ease, so velocity carries through
 * every point and the spark only stops where it really rests. The two ring runs ride exactly
 * on the ring's stroke as it draws; the whip runs use the camera's whip ease and window, so the
 * spark rides the camera instead of sliding against it. While it rests it hovers a little.
 * World px throughout.
 */
type P = [number, number];
type Run = { a: number; b: number; ease: (n: number) => number; at: (u: number) => P };

/** Centripetal Catmull-Rom through `pts`, sampled and walked by arc length (u 0→1). */
const spline = (pts: P[]): ((u: number) => P) => {
  if (pts.length === 2) return (u) => [pts[0][0] + (pts[1][0] - pts[0][0]) * u, pts[0][1] + (pts[1][1] - pts[0][1]) * u];
  const ext: P[] = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
    ...pts,
    [2 * pts[pts.length - 1][0] - pts[pts.length - 2][0], 2 * pts[pts.length - 1][1] - pts[pts.length - 2][1]],
  ];
  const samples: P[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const d = (a: P, b: P) => Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);
    for (let s = 0; s < 40; s++) {
      const tt = t1 + ((t2 - t1) * s) / 40;
      const L = (a: P, b: P, ta: number, tb: number): P => [((tb - tt) * a[0] + (tt - ta) * b[0]) / (tb - ta), ((tb - tt) * a[1] + (tt - ta) * b[1]) / (tb - ta)];
      const A1 = L(p0, p1, t0, t1);
      const A2 = L(p1, p2, t1, t2);
      const A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2);
      const B2 = L(A2, A3, t1, t3);
      samples.push(L(B1, B2, t1, t2));
    }
  }
  samples.push(pts[pts.length - 1]);
  const acc = [0];
  for (let i = 1; i < samples.length; i++) acc.push(acc[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  const total = acc[acc.length - 1] || 1;
  return (u) => {
    const target = Math.max(0, Math.min(1, u)) * total;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < target) i++;
    const k = (target - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    return [samples[i - 1][0] + (samples[i][0] - samples[i - 1][0]) * k, samples[i - 1][1] + (samples[i][1] - samples[i - 1][1]) * k];
  };
};

const run = (a: number, b: number, pts: P[], ease = EASE.move): Run => ({ a, b, ease, at: spline(pts) });

// The rings it draws (same geometry as the SparkRings in b2 and b4).
const RING1 = { x: 1820, y: -250, w: 720, h: 570, r: 28 };
const RING3 = { x: 7105, y: -340, w: 390, h: 680, r: 56 };
const r1 = (u: number) => ringPoint(RING1.x, RING1.y, RING1.w, RING1.h, RING1.r, u);
const r3 = (u: number) => ringPoint(RING3.x, RING3.y, RING3.w, RING3.h, RING3.r, u);
// Wow 2's grid (b3): post and story centres in build order.
const G: P[] = [[4622, -192], [5006, -192], [4622, 192], [5006, 192], [5419, 0], [5862, 0]];
const MADE: P = [4950, 425]; // the "Made by AI" chip (b3)

export const RUNS: Run[] = [
  run(2.6, 3.25, [[620, 360], [430, 250], [215, 150]], EASE.enter), // glides in on "Meet Maude."
  run(4.5, 4.98, [[215, 150], [-130, 250], [-470, 150]]), // an arc back under the line
  run(4.98, 5.95, [[-470, 150], [260, 140]]), // runs the weight wave through "Meet Maude."
  run(5.95, 6.75, [[260, 140], [2560, -170]], EASE.whip), // rides the whip to the clip pile
  run(11.0, 11.55, [[2560, -170], [2200, -310], [r1(0)[0], r1(0)[1]]]), // to where the ring starts
  { a: CUE.w1.ring, b: CUE.w1.ring + 1.3, ease: EASE.move, at: r1 }, // draws the ring round the pile
  run(13.0, 14.4, [r1(1), [1990, 470], [2700, 520], [2785, -230]]), // leads the picks to the cut, then rests beside the reel
  run(17.75, 18.55, [[2785, -230], [4980, -300]], EASE.whip), // rides the whip to the photos
  run(22.35, 23.25, [[4980, -300], ...G, MADE]), // through every post as the brand wipes up
  run(24.4, 25.3, [MADE, G[5], G[4], G[3], G[2], G[1], G[0], [4700, -420]]), // and again on "design system"
  run(26.3, 26.95, [[4700, -420], [5600, -560]], EASE.exit), // leaves: a person draws the next idea
  run(30.5, 30.9, [[7330, -560], r3(0)]),
  { a: CUE.w3.ring, b: CUE.w3.ring + 0.75, ease: EASE.move, at: r3 }, // round the sketch
  run(31.65, 31.8, [r3(1), [RING3.x + RING3.w + 4, RING3.y + 30]], EASE.enter),
  run(31.8, 32.25, [[RING3.x + RING3.w + 4, RING3.y + 30], [RING3.x + RING3.w + 4, RING3.y + RING3.h - 30]], EASE.enter), // rides the scan line
  run(32.35, 32.85, [[RING3.x + RING3.w + 4, RING3.y + RING3.h - 30], [7640, -200]], EASE.exit),
];

const OPACITY: [number, number][] = [[0, 0], [2.6, 0], [3.1, 1], [26.4, 1], [26.9, 0], [30.5, 0], [30.85, 1], [32.4, 1], [32.85, 0], [99, 0]];

export const sparkAt = (t: number) => {
  let i = 0;
  while (i < RUNS.length - 1 && RUNS[i + 1].a <= t) i++;
  const r = RUNS[i];
  const [x, y] = t < r.a ? r.at(0) : r.at(tw(t, r.a, r.b, 0, 1, r.ease));
  // resting: a small hover that fades in and out at the run edges, so it never jumps
  const next = RUNS[i + 1]?.a ?? 99;
  const rest = t > r.b ? Math.max(0, Math.min(1, (t - r.b) / 0.5, (next - t) / 0.5)) : 0;
  return { x: x + Math.sin(t * 2.1) * 5 * rest, y: y + Math.sin(t * 1.7 + 1) * 6 * rest, o: interpolateKeys(t, OPACITY) };
};

/** One spark, in world space, sized to stay readable at the camera's zoom. */
const SparkAt = ({ t, alpha }: { t: number; alpha: number }) => {
  const zoom = cameraAt(t).z;
  const s = sparkAt(t);
  if (s.o * alpha <= 0.001) return null;
  return (
    <div style={{ position: 'absolute', left: s.x, top: s.y, opacity: s.o * alpha, transform: `scale(${(2.6 / Math.max(zoom, 0.6)) * (0.7 + 0.3 * s.o)})`, transformOrigin: '0 0', zIndex: 50 }}>
      <Cursor name="AI" agent x={0} y={0} />
    </div>
  );
};

/**
 * The spark plus its comet tail: a tapered streak along where it was over the last two frames
 * (a continuous stroke, not ghost copies), only while it moves.
 */
export const SparkTraveler = () => {
  const t = useT();
  const pts = Array.from({ length: 9 }, (_, k) => sparkAt(t - (k * 2) / 30 / 8));
  const len = pts.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - pts[k].x, p.y - pts[k].y), 0);
  const z = cameraAt(t).z;
  const tail = Math.max(0, Math.min(1, (len * z - 6) / 30)) * pts[0].o;
  return (
    <>
      {tail > 0.01 ? (
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', zIndex: 49 }} width={1} height={1}>
          {pts.slice(1).map((p, k) => (
            <line key={k} x1={pts[k].x} y1={pts[k].y} x2={p.x} y2={p.y} stroke="var(--spark)" strokeLinecap="round" strokeWidth={(9 * (1 - k / 8)) / Math.max(z, 0.6)} opacity={0.55 * tail * (1 - k / 8)} />
          ))}
        </svg>
      ) : null}
      <SparkAt t={t} alpha={1} />
    </>
  );
};
