import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
// <Video> from @remotion/media, not <Video> — only @remotion/media
// elements survive the export's audio path (RCA
// issue-mp4-audio-export-html5audio-silent-degrade).
import { Video } from '@remotion/media';

// ═══════════════════════════════════════════════════════════════════════════
// Alligators Brno — CINEMATIC CUT  ·  Remotion max-potential showcase
//
// Same footage + arc as the /design:reel trailer, pushed HARD: every value is a
// PURE FUNCTION OF THE FRAME INDEX (the determinism iron law — no CSS
// animation/transition, no Date.now/Math.random; Remotion's seeded random()
// only). NB: the runtime bundles Framer Motion (`motion`), but it animates on
// WALL-CLOCK, which the frame-stepping capture can't seek — so motion here is
// all Remotion-driven (interpolate/spring), never `motion`'s `animate`.
//
// EFFECT + MOTION-GRAPHICS CATALOGUE
//   look     · cinematic teal/orange grade · moving film grain · vignette · letterbox
//   camera   · Ken-Burns push/pan · slow-mo speed ramp (playbackRate) · impact shake
//   type     · per-letter spring stagger + RGB chromatic split · 3D perspective CTA
//   vfx      · freeze/hit white flash · RGB-split glitch stabs · radial speed-lines
//              · light-leak sweep · VHS scanlines + REC bug + timecode (archival)
//   infogfx  · animated chalkboard PLAY DIAGRAM (self-drawing route + moving ball)
//              · animated value-bar INFOGRAPHIC (spring-fill bars + counting %)
//   1280×720 · 30fps · ~24s
// ═══════════════════════════════════════════════════════════════════════════

const FPS = 30;
const W = 1280;
const H = 720;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const ORANGE = '#ff7a1a';
const TEAL = '#0fb59a';

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

const shake = (frame: number, amp: number, seed: string) => ({
  x: (random(`${seed}x${Math.floor(frame)}`) - 0.5) * amp,
  y: (random(`${seed}y${Math.floor(frame)}`) - 0.5) * amp,
  r: (random(`${seed}r${Math.floor(frame)}`) - 0.5) * amp * 0.15,
});

// ── graded clip: Ken-Burns + slow-mo + impact shake + impact zoom-punch ──────
const Clip = ({
  src,
  startFrom,
  playbackRate = 1,
  zoom = 'in',
  amp = 0,
  seed = 's',
  grade = 'teal-orange',
  punch = false,
}: {
  src: string;
  startFrom: number;
  playbackRate?: number;
  zoom?: 'in' | 'out' | 'left' | 'right' | 'none';
  amp?: number;
  seed?: string;
  grade?: 'teal-orange' | 'cold' | 'warm' | 'none';
  punch?: boolean;
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp' });
  const kb = 1.04 + 0.1 * (zoom === 'in' ? p : zoom === 'out' ? 1 - p : 0.5);
  const punchS = punch ? interpolate(frame, [0, 3, 10], [1.14, 1.06, 1], { extrapolateRight: 'clamp' }) : 1;
  const tx = zoom === 'left' ? -18 * p : zoom === 'right' ? 18 * p : 0;
  const j = amp ? shake(frame, amp, seed) : { x: 0, y: 0, r: 0 };
  const gradeCss =
    grade === 'teal-orange'
      ? 'contrast(1.16) saturate(1.28) brightness(0.94)'
      : grade === 'cold'
        ? 'contrast(1.2) saturate(0.85) brightness(0.9) hue-rotate(-8deg)'
        : grade === 'warm'
          ? 'contrast(1.12) saturate(1.35) brightness(1.02) sepia(0.12)'
          : 'none';
  const wash =
    grade === 'teal-orange'
      ? 'radial-gradient(120% 90% at 30% 20%, rgba(255,150,60,0.18), transparent 55%), radial-gradient(120% 100% at 80% 90%, rgba(20,170,150,0.22), transparent 60%)'
      : 'none';
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate(${tx + j.x}px, ${j.y}px) scale(${kb * punchS}) rotate(${j.r}deg)`,
        }}
      >
        <Video
          src={src}
          startFrom={startFrom}
          playbackRate={playbackRate}
          style={{ width: '100%', height: '100%', objectFit: 'cover', filter: gradeCss }}
        />
      </div>
      {wash !== 'none' && (
        <div style={{ position: 'absolute', inset: 0, background: wash, opacity: 0.6 }} />
      )}
    </AbsoluteFill>
  );
};

// ── kinetic title — per-letter spring stagger + RGB chromatic split ──────────
const Kinetic = ({ text, size = 90, y = 0 }: { text: string; size?: number; y?: number }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const settle = interpolate(frame, [0, 18], [1, 0], { extrapolateRight: 'clamp' });
  const split = 6 * settle;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `translateY(${y}px)`, opacity: out, textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 2 }}>
          {text.split('').map((ch, i) => {
            const e = spring({ frame: frame - i * 2, fps, config: { damping: 12, stiffness: 200, mass: 0.6 } });
            const ty = interpolate(e, [0, 1], [40, 0]);
            const blur = interpolate(e, [0, 1], [8, 0]);
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  transform: `translateY(${ty}px)`,
                  filter: `blur(${blur}px)`,
                  opacity: e,
                  fontSize: size,
                  fontWeight: 900,
                  color: '#fff',
                  letterSpacing: 2,
                  fontFamily: FONT,
                  textShadow: `${split}px 0 rgba(255,60,60,0.75), ${-split}px 0 rgba(0,200,255,0.75), 0 6px 30px rgba(0,0,0,0.6)`,
                  whiteSpace: 'pre',
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 14,
            height: 5,
            width: interpolate(frame, [6, 22], [0, 150], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            background: `linear-gradient(90deg,${ORANGE},${TEAL})`,
            margin: '14px auto 0',
            borderRadius: 3,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const LowerThird = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 18 } });
  const x = interpolate(e, [0, 1], [-40, 0]);
  const op = interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: 54 }}>
      <div style={{ transform: `translateX(${x}px)`, opacity: op, display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 6, height: 34, background: ORANGE, borderRadius: 3 }} />
        <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', letterSpacing: 1, textShadow: '0 3px 16px rgba(0,0,0,0.7)', fontFamily: FONT }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── VHS/scanline chrome for the archival 2008 semifinal ──────────────────────
const VHS = ({ label }: { label: string }) => {
  const frame = useCurrentFrame();
  const rec = Math.floor(frame / 8) % 2 === 0;
  const tc = `00:0${Math.floor(frame / 30)}:${String(frame % 30).padStart(2, '0')}`;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 2px, transparent 4px)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(255,0,0,0.06), transparent 8%, transparent 92%, rgba(0,255,255,0.06))' }} />
      <div style={{ position: 'absolute', top: 22, left: 26, display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, color: '#fff', fontSize: 20, letterSpacing: 1 }}>
        <span style={{ width: 13, height: 13, borderRadius: 99, background: '#ff2b2b', opacity: rec ? 1 : 0.25 }} />
        REC
      </div>
      <div style={{ position: 'absolute', top: 24, right: 26, fontFamily: MONO, color: '#fff', fontSize: 20, letterSpacing: 1 }}>{tc}</div>
      <div style={{ position: 'absolute', bottom: 22, left: 26, fontFamily: MONO, color: '#dfe', fontSize: 15, letterSpacing: 2, opacity: 0.85 }}>{label}</div>
    </AbsoluteFill>
  );
};

const SplitThree = ({ clips }: { clips: { src: string; startFrom: number }[] }) => {
  const frame = useCurrentFrame();
  const wipe = interpolate(frame, [0, 12], [0, 100], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', background: '#000' }}>
      {clips.map((c, i) => (
        <div key={i} style={{ position: 'relative', flex: 1, overflow: 'hidden', clipPath: `inset(0 0 ${100 - wipe}% 0)`, borderRight: i < 2 ? '2px solid #0b0b0b' : 'none' }}>
          <Video src={c.src} startFrom={c.startFrom} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.18) saturate(0.7) brightness(0.92)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(0,20,18,0.5))' }} />
        </div>
      ))}
    </AbsoluteFill>
  );
};

const Flash = () => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 2, 8], [0, 0.92, 0], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ background: '#fff', opacity: op }} />;
};

const Glitch = () => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 1, 5], [0, 0.6, 0], { extrapolateRight: 'clamp' });
  const off = (random(`g${Math.floor(frame)}`) - 0.5) * 40;
  return (
    <AbsoluteFill style={{ opacity: op, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${off}px)`, background: 'rgba(255,0,80,0.5)', mixBlendMode: 'screen', clipPath: 'inset(30% 0 45% 0)' }} />
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-off}px)`, background: 'rgba(0,220,255,0.5)', mixBlendMode: 'screen', clipPath: 'inset(55% 0 20% 0)' }} />
    </AbsoluteFill>
  );
};

// ── radial speed-lines (anime-style burst on the hero run) ───────────────────
const SpeedLines = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const op = interpolate(frame, [0, 6, durationInFrames - 8, durationInFrames], [0, 0.5, 0.5, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const N = 40;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: op }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="sl" cx="50%" cy="50%" r="50%">
            <stop offset="35%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.9)" />
          </radialGradient>
          <mask id="slm">
            {Array.from({ length: N }).map((_, i) => {
              const a = (i / N) * Math.PI * 2;
              const len = 300 + random(`sl${i}`) * 500;
              const x2 = W / 2 + Math.cos(a) * len;
              const y2 = H / 2 + Math.sin(a) * len;
              const w = 3 + random(`slw${i}`) * 9;
              return <line key={i} x1={W / 2} y1={H / 2} x2={x2} y2={y2} stroke="#fff" strokeWidth={w} />;
            })}
          </mask>
        </defs>
        <rect width={W} height={H} fill="url(#sl)" mask="url(#slm)" />
      </svg>
    </AbsoluteFill>
  );
};

const LightLeak = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const x = interpolate(frame, [0, durationInFrames], [-30, 130]);
  const op = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 0.55, 0.55, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: op }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(40% 120% at ${x}% 40%, rgba(255,170,80,0.9), rgba(255,90,40,0.3) 40%, transparent 70%)`, mixBlendMode: 'screen' }} />
    </AbsoluteFill>
  );
};

// ── neutral brand line for the crest (no fabricated facts) ───────────────────
const BrandLine = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 20 } });
  const w = interpolate(e, [0, 1], [0, 260]);
  const op = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 92, opacity: op }}>
      <div style={{ fontFamily: MONO, color: '#dfe', fontSize: 20, letterSpacing: 8 }}>BRNO · CZ</div>
      <div style={{ height: 3, width: w, background: `linear-gradient(90deg,${ORANGE},${TEAL})`, marginTop: 12, borderRadius: 2 }} />
    </AbsoluteFill>
  );
};

// ═══ MOTION-GRAPHIC 1 — animated chalkboard play diagram ═════════════════════
// A self-drawing offensive route (SVG strokeDashoffset) with a ball-carrier dot
// walking the same waypoints, defenders (O) + line (X). Pure parametric geometry
// (no DOM measurement) so it's frame-deterministic.
const WP: [number, number][] = [
  [30, 62],
  [46, 62],
  [52, 40],
  [78, 20],
];
const segLen = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const ROUTE_LEN = WP.slice(1).reduce((s, p, i) => s + segLen(WP[i], p), 0);
const pointAt = (t: number): [number, number] => {
  let d = t * ROUTE_LEN;
  for (let i = 1; i < WP.length; i += 1) {
    const l = segLen(WP[i - 1], WP[i]);
    if (d <= l) {
      const f = l === 0 ? 0 : d / l;
      return [WP[i - 1][0] + (WP[i][0] - WP[i - 1][0]) * f, WP[i - 1][1] + (WP[i][1] - WP[i - 1][1]) * f];
    }
    d -= l;
  }
  return WP[WP.length - 1];
};

const ChalkPlay = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const inOp = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const outOp = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  const draw = interpolate(frame, [10, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const path = `M ${WP.map((p) => p.join(' ')).join(' L ')}`;
  const [bx, by] = pointAt(draw);
  const defenders: [number, number][] = [[42, 40], [58, 40], [50, 30], [66, 26], [74, 34]];
  const line: number[] = [20, 30, 40, 50, 60];
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 40%, #12332b 0%, #08150f 80%)', opacity: inOp * outOp }}>
      <svg width={W} height={H} viewBox="0 0 100 72" preserveAspectRatio="xMidYMid slice">
        {/* yard hashes */}
        {[12, 24, 36, 48, 60].map((y) => (
          <line key={y} x1={4} y1={y} x2={96} y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth={0.3} />
        ))}
        <line x1={4} y1={62} x2={96} y2={62} stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />
        {/* offensive line (X) */}
        {line.map((x) => (
          <g key={`x${x}`} stroke="rgba(255,255,255,0.6)" strokeWidth={0.7}>
            <line x1={x - 1.6} y1={64.4} x2={x + 1.6} y2={67.6} />
            <line x1={x + 1.6} y1={64.4} x2={x - 1.6} y2={67.6} />
          </g>
        ))}
        {/* defenders (O) */}
        {defenders.map(([x, y], i) => (
          <circle key={`o${i}`} cx={x} cy={y} r={1.8} fill="none" stroke={ORANGE} strokeWidth={0.7} />
        ))}
        {/* the drawn route */}
        <path
          d={path}
          fill="none"
          stroke={TEAL}
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={ROUTE_LEN}
          strokeDashoffset={ROUTE_LEN * (1 - draw)}
        />
        {/* arrowhead appears near the end */}
        {draw > 0.9 && <circle cx={WP[3][0]} cy={WP[3][1]} r={2.4} fill={TEAL} />}
        {/* the ball carrier */}
        <circle cx={bx} cy={by} r={2.2} fill="#fff" stroke={TEAL} strokeWidth={0.8} />
      </svg>
      <Kinetic text="NAUČÍME TĚ HRÁT" size={52} y={-250} />
    </AbsoluteFill>
  );
};

// ═══ MOTION-GRAPHIC 2 — animated value-bar infographic ═══════════════════════
// Motivational, no fabricated stats: four qualities fill to full with a spring +
// counting %. Staggered rows, gradient bars, chalk-dark backdrop.
const ROWS: [string, number][] = [
  ['SÍLA', 94],
  ['RYCHLOST', 88],
  ['TÝM', 100],
  ['SRDCE', 100],
];
const ValueBars = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const inOp = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const outOp = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 30% 20%, #101b18 0%, #060a09 80%)', opacity: inOp * outOp, justifyContent: 'center', padding: '0 130px' }}>
      <div style={{ marginBottom: 34 }}>
        <Kinetic text="PROČ ALLIGATORS" size={46} y={-190} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {ROWS.map(([label, target], i) => {
          const e = spring({ frame: frame - 8 - i * 8, fps, config: { damping: 16, stiffness: 120, overshootClamping: true } });
          const pct = Math.round(target * Math.min(1, e));
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: e }}>
              <div style={{ width: 210, textAlign: 'right', color: '#fff', fontFamily: FONT, fontWeight: 800, fontSize: 30, letterSpacing: 1 }}>{label}</div>
              <div style={{ position: 'relative', flex: 1, height: 22, background: 'rgba(255,255,255,0.08)', borderRadius: 11, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `linear-gradient(90deg,${ORANGE},${TEAL})`, borderRadius: 11, boxShadow: `0 0 18px ${TEAL}66` }} />
              </div>
              <div style={{ width: 96, fontFamily: MONO, color: '#dfe', fontSize: 30, fontWeight: 700 }}>{pct}%</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ═══ persistent look layers ══════════════════════════════════════════════════
const LookLayers = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const gx = (random(`gx${Math.floor(frame)}`) - 0.5) * 140;
  const gy = (random(`gy${Math.floor(frame)}`) - 0.5) * 140;
  const bar = interpolate(frame, [0, 14], [0, 68], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* grain — plain blend (NOT mix-blend-mode) so the capture Chromium doesn't
          do a full-frame readback every frame (that pressure was crashing the
          renderer mid-export → "Execution context destroyed"). */}
      <div style={{ position: 'absolute', inset: -40, backgroundImage: GRAIN, backgroundRepeat: 'repeat', transform: `translate(${gx}px, ${gy}px)`, opacity: 0.07 }} />
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 240px rgba(0,0,0,0.62)' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: bar, background: '#000' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: bar, background: '#000' }} />
      <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: 1 - fadeOut }} />
    </AbsoluteFill>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// The cut — clip spine (back-to-back by explicit `from`) + overlay fx layers.
// ═══════════════════════════════════════════════════════════════════════════
const TOTAL =
  54 + 34 + 50 + 54 + 40 + 38 + 18 + 16 + 16 + 18 + 40 + 56 + 34 + 66 + 46 + 66 + 68; // = 714 (23.8s)

const Movie = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    {/* ── clip / motion-graphic spine ─────────────────────────────────────── */}
    <Sequence from={0} durationInFrames={54} name="cold-open">
      <Clip src="assets/74678a8e.mp4" startFrom={Math.round(0.7 * FPS)} zoom="in" grade="cold" />
    </Sequence>
    <Sequence from={54} durationInFrames={34} name="hook-hit">
      <Clip src="assets/66c0d998.mp4" startFrom={Math.round(3.8 * FPS)} zoom="in" amp={10} seed="hit" punch />
    </Sequence>
    <Sequence from={88} durationInFrames={50} name="grind-split">
      <SplitThree
        clips={[
          { src: 'assets/66c0d998.mp4', startFrom: Math.round(11.3 * FPS) },
          { src: 'assets/66c0d998.mp4', startFrom: Math.round(16.8 * FPS) },
          { src: 'assets/74678a8e.mp4', startFrom: Math.round(9.6 * FPS) },
        ]}
      />
    </Sequence>
    <Sequence from={138} durationInFrames={54} name="chalk-play">
      <ChalkPlay />
    </Sequence>
    <Sequence from={192} durationInFrames={40} name="hero-run-slowmo">
      <Clip src="assets/314d43a3.mp4" startFrom={Math.round(90.2 * FPS)} playbackRate={0.5} zoom="left" grade="warm" />
    </Sequence>
    <Sequence from={232} durationInFrames={38} name="archival-2008">
      <Clip src="assets/2e81036d.mp4" startFrom={Math.round(261 * FPS)} zoom="in" grade="cold" />
      <VHS label="PRAGUE LIONS vs BRNO ALLIGATORS · SEMIFINAL 2008" />
    </Sequence>
    <Sequence from={270} durationInFrames={18} name="barrage-1">
      <Clip src="assets/2e81036d.mp4" startFrom={Math.round(212 * FPS)} zoom="none" amp={12} seed="b1" grade="cold" punch />
    </Sequence>
    <Sequence from={288} durationInFrames={16} name="barrage-2">
      <Clip src="assets/9cab63a9.mp4" startFrom={Math.round(44 * FPS)} zoom="none" amp={12} seed="b2" grade="warm" />
    </Sequence>
    <Sequence from={304} durationInFrames={16} name="barrage-3">
      <Clip src="assets/2e81036d.mp4" startFrom={Math.round(163 * FPS)} zoom="none" amp={12} seed="b3" grade="cold" />
    </Sequence>
    <Sequence from={320} durationInFrames={18} name="barrage-4">
      <Clip src="assets/6f213920.mp4" startFrom={Math.round(130 * FPS)} zoom="none" amp={10} seed="b4" grade="teal-orange" punch />
    </Sequence>
    <Sequence from={338} durationInFrames={40} name="celebration">
      <Clip src="assets/74678a8e.mp4" startFrom={Math.round(45.6 * FPS)} zoom="out" grade="warm" />
    </Sequence>
    <Sequence from={378} durationInFrames={56} name="huddle">
      <Clip src="assets/74678a8e.mp4" startFrom={Math.round(49.9 * FPS)} zoom="in" grade="teal-orange" />
    </Sequence>
    <Sequence from={434} durationInFrames={34} name="coach">
      <Clip src="assets/9cab63a9.mp4" startFrom={Math.round(168 * FPS)} zoom="right" grade="warm" />
    </Sequence>
    <Sequence from={468} durationInFrames={66} name="value-bars">
      <ValueBars />
    </Sequence>
    <Sequence from={534} durationInFrames={46} name="join-us">
      <Clip src="assets/66c0d998.mp4" startFrom={Math.round(6.9 * FPS)} zoom="in" grade="cold" />
    </Sequence>
    <Sequence from={580} durationInFrames={66} name="cta-walk">
      <Clip src="assets/74678a8e.mp4" startFrom={Math.round(54.3 * FPS)} zoom="in" grade="teal-orange" />
    </Sequence>
    <Sequence from={646} durationInFrames={68} name="crest">
      <Clip src="assets/9cab63a9.mp4" startFrom={Math.round(271.5 * FPS)} zoom="in" grade="warm" />
    </Sequence>

    {/* ── overlay fx layers ───────────────────────────────────────────────── */}
    <Sequence from={10} durationInFrames={54} name="fx-title-open">
      <Kinetic text="ALLIGATORS BRNO" size={92} />
    </Sequence>
    <Sequence from={70} durationInFrames={9} name="fx-hit-flash">
      <Flash />
    </Sequence>
    <Sequence from={90} durationInFrames={44} name="fx-title-drina">
      <Kinetic text="DŘINA" size={110} />
    </Sequence>
    <Sequence from={192} durationInFrames={40} name="fx-speedlines">
      <SpeedLines />
    </Sequence>
    <Sequence from={194} durationInFrames={38} name="fx-title-rychlost">
      <Kinetic text="RYCHLOST" size={96} />
    </Sequence>
    <Sequence from={288} durationInFrames={6} name="fx-glitch-1">
      <Glitch />
    </Sequence>
    <Sequence from={320} durationInFrames={6} name="fx-glitch-2">
      <Glitch />
    </Sequence>
    <Sequence from={378} durationInFrames={56} name="fx-leak-huddle">
      <LightLeak />
    </Sequence>
    <Sequence from={384} durationInFrames={46} name="fx-title-srdce">
      <Kinetic text="SRDCE" size={104} />
    </Sequence>
    <Sequence from={436} durationInFrames={30} name="fx-lt-bratrstvi">
      <LowerThird text="BRATRSTVÍ" />
    </Sequence>
    <Sequence from={588} durationInFrames={58} name="fx-cta">
      <CTA3D text="STAŇ SE ALLIGATOREM" />
    </Sequence>
    <Sequence from={654} durationInFrames={60} name="fx-crest-graphics">
      <BrandLine />
      <LowerThird text="alligators.cz" />
    </Sequence>

    {/* ── persistent look wash ────────────────────────────────────────────── */}
    <Sequence from={0} durationInFrames={TOTAL} name="look">
      <LookLayers />
    </Sequence>
  </AbsoluteFill>
);

// ── 3D perspective CTA card ──────────────────────────────────────────────────
function CTA3D({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const ry = interpolate(e, [0, 1], [70, 0]);
  const tz = interpolate(e, [0, 1], [-400, 0]);
  const op = interpolate(frame, [0, 8, durationInFrames - 6, durationInFrames], [0, 1, 1, 0.85], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shock = interpolate(frame, [6, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', perspective: 1200 }}>
      <div style={{ position: 'absolute', width: 40, height: 40, borderRadius: 999, border: '3px solid rgba(255,140,50,0.6)', transform: `scale(${1 + shock * 22})`, opacity: (1 - shock) * 0.8 }} />
      <div style={{ transform: `perspective(1200px) rotateY(${ry}deg) translateZ(${tz}px)`, opacity: op, textAlign: 'center' }}>
        <div style={{ fontSize: 84, fontWeight: 900, color: '#fff', letterSpacing: 3, textShadow: `0 10px 50px rgba(0,0,0,0.7), 0 0 40px ${TEAL}59`, fontFamily: FONT }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
}

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Alligators Brno — Cinematic Cut">
        <DCArtboard id="cinematic" label="Cinematic" width={W} height={H}>
          <VideoComp component={Movie} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
