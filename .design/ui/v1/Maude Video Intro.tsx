// Maude Video Intro — a video-comp smoke/demo (DDR-148).
// A ~4s branded intro authored AS a canvas: two beats joined by a crossfade,
// everything frame-driven (deterministic → exports frame-perfect). Open it in
// Maude, scrub it in the Timeline panel, and ⌘E → MP4/GIF.

import { DCArtboard, DCSection, DesignCanvas, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
// <Video>/<Audio> from @remotion/media (decode-to-canvas) — required for
// audio export via renderMediaOnWeb; also compatible with the preview Player
// and the frame-step capture spine (screenshot-after-seek, verified DDR-148 addendum).
import { Audio, Video } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';

// Real MP4 footage (downloaded, lives in .design/assets/) — referenced by the
// server-resolved path so both the preview iframe and the export capture load it.
const CLIPS = [
  { src: '/.design/assets/reel-a.mp4', label: 'Aerial', tag: 'drone · 24fps' },
  { src: '/.design/assets/reel-b.mp4', label: 'Nature', tag: 'jellyfish · 4K' },
  { src: '/.design/assets/reel-c.mp4', label: 'Motion', tag: 'animation' },
];
const SHOT = 72; // frames per clip
const RXF = 18; // reel crossfade
const CARD = 42; // title / end card frames
// title + 3 clips + end, minus the 4 overlapping transitions
const REEL_TOTAL = CARD + SHOT * 3 + CARD - RXF * 4;

const INK = '#0b0e16';
const CREAM = '#f5efe6';
const AMBER = '#e0761f';
const RUST = '#8a2f12';

const A = 66; // beat A frames
const XF = 16; // crossfade frames
const B = 62; // beat B frames
const TOTAL = A + B - XF;

// Beat A — the wordmark springs up letter-by-letter, an amber rule wipes in,
// a spark blinks, and the tagline fades up.
const Intro = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = 'maude'.split('');
  const rule = interpolate(frame, [12, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sparkOn = Math.floor(frame / 8) % 2 === 0 && frame > 6;
  const tagY = interpolate(frame, [26, 42], [16, 0], { extrapolateRight: 'clamp' });
  const tagO = interpolate(frame, [26, 42], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 30%, #131a2b 0%, ${INK} 70%)`,
        color: CREAM,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
      }}
    >
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center' }}>
          {letters.map((ch, i) => {
            const s = spring({ frame: frame - i * 4, fps, config: { damping: 200, mass: 0.7 } });
            const y = interpolate(s, [0, 1], [46, 0]);
            const o = interpolate(s, [0, 1], [0, 1]);
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  fontSize: 132,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  transform: `translateY(${y}px)`,
                  opacity: o,
                  color: "#fefefe",
                }}
              >
                {ch}
              </span>
            );
          })}
          <span
            style={{
              display: 'inline-block',
              width: 22,
              height: 96,
              marginLeft: 14,
              borderRadius: 4,
              background: AMBER,
              opacity: sparkOn ? 1 : 0.15,
              boxShadow: sparkOn ? `0 0 24px ${AMBER}` : 'none',
            }}
          />
        </div>
        <div
          style={{
            height: 4,
            marginTop: 14,
            borderRadius: 999,
            background: AMBER,
            transform: `scaleX(${rule})`,
            transformOrigin: 'left center',
          }}
        />
        <div
          style={{
            marginTop: 26,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: '0.02em',
            color: '#b9b2a6',
            transform: `translateY(${tagY}px)`,
            opacity: tagO,
          }}
        >
          design at the speed
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Beat B — the payoff: "now moves." with a play mark drawing in.
const Payoff = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 180 } });
  const scale = interpolate(pop, [0, 1], [0.86, 1]);
  const triX = interpolate(frame, [10, 24], [-12, 0], { extrapolateRight: 'clamp' });
  const triO = interpolate(frame, [10, 22], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${AMBER} 0%, ${RUST} 100%)`,
        color: INK,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, transform: `scale(${scale})` }}>
        <svg width="84" height="84" viewBox="0 0 84 84" style={{ opacity: triO, transform: `translateX(${triX}px)` }} aria-hidden>
          <circle cx="42" cy="42" r="40" fill="rgba(11,14,22,0.16)" />
          <path d="M32 26 L62 42 L32 58 Z" fill={INK} />
        </svg>
        <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: '-0.03em' }}>Asdada</div>
      </div>
    </AbsoluteFill>
  );
};

function Movie() {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={A}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
      <TransitionSeries.Sequence durationInFrames={B}>
        <Payoff />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}

// ── Artboard 2 — a REAL MP4 edit (downloaded footage) + motion-graphics ──────

// Animated lower-third caption over each clip (springs in, fades near the cut).
const LowerThird = ({ label, tag }: { label: string; tag: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 200 } });
  const x = interpolate(inn, [0, 1], [-40, 0]);
  const out = interpolate(frame, [SHOT - 14, SHOT], [1, 0], { extrapolateLeft: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: 40,
        bottom: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        transform: `translateX(${x}px)`,
        opacity: Math.min(inn, out),
      }}
    >
      <div style={{ width: 4, height: 42, background: AMBER, borderRadius: 2 }} />
      <div>
        <div
          style={{
            color: '#fff',
            fontSize: 30,
            fontWeight: 800,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            textShadow: '0 2px 14px rgba(0,0,0,0.7)',
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: 'rgba(255,255,255,0.8)',
            fontSize: 14,
            fontFamily: 'ui-monospace, monospace',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {tag}
        </div>
      </div>
    </div>
  );
};

// One video clip filling the frame — subtle ken-burns push, a bottom gradient
// scrim for legibility, and its lower-third.
const ClipShot = ({ clip }: { clip: (typeof CLIPS)[number] }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, SHOT], [1.08, 1]);
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Video
          src={clip.src}
          startFrom={18}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{ background: 'linear-gradient(180deg, transparent 52%, rgba(0,0,0,0.6) 100%)' }}
      />
      <LowerThird label={clip.label} tag={clip.tag} />
    </AbsoluteFill>
  );
};

const TitleCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 200 } });
  const rule = interpolate(frame, [6, 22], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        background: INK,
        color: CREAM,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center', transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`, opacity: s }}>
        <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: '-0.03em' }}>SHOWREEL</div>
        <div
          style={{
            height: 3,
            margin: '14px auto 0',
            width: 220,
            background: AMBER,
            transform: `scaleX(${rule})`,
          }}
        />
        <div
          style={{
            marginTop: 18,
            fontSize: 20,
            color: '#b9b2a6',
            fontFamily: 'ui-monospace, monospace',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          cut in maude
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 180 } });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${AMBER} 0%, ${RUST} 100%)`,
        color: INK,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 116, fontWeight: 800, letterSpacing: '-0.04em', transform: `scale(${interpolate(s, [0, 1], [0.88, 1])})` }}>
        maude
      </div>
    </AbsoluteFill>
  );
};

function Reel() {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, REEL_TOTAL - 1], [0, 1], { extrapolateRight: 'clamp' });
  const rec = Math.floor(frame / 15) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={CARD}>
          <TitleCard />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: RXF })} />
        <TransitionSeries.Sequence durationInFrames={SHOT}>
          <ClipShot clip={CLIPS[0]} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={linearTiming({ durationInFrames: RXF })} />
        <TransitionSeries.Sequence durationInFrames={SHOT}>
          <ClipShot clip={CLIPS[1]} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={wipe({ direction: 'from-left' })} timing={linearTiming({ durationInFrames: RXF })} />
        <TransitionSeries.Sequence durationInFrames={SHOT}>
          <ClipShot clip={CLIPS[2]} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: RXF })} />
        <TransitionSeries.Sequence durationInFrames={CARD}>
          <EndCard />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* motion-graphics HUD on top of the cut */}
      <div
        style={{
          position: 'absolute',
          top: 22,
          right: 26,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
          color: '#fff',
          opacity: 0.9,
          textShadow: '0 1px 6px rgba(0,0,0,0.6)',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: '#ff3b30', opacity: rec ? 1 : 0.25 }} />
        REC
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,0.14)' }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: AMBER }} />
      </div>

      {/* music bed — fades in at the top, ducks out under the end card */}
      <Audio
        src="/.design/assets/music.mp3"
        volume={(f) =>
          interpolate(f, [0, 18, REEL_TOTAL - 28, REEL_TOTAL - 1], [0, 0.7, 0.7, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          })
        }
      />
    </AbsoluteFill>
  );
}

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Video intro">
        <DCArtboard id="intro" label="Maude Intro" width={960} height={540}>
          <VideoComp component={Movie} durationInFrames={TOTAL} fps={30} width={960} height={540} />
        </DCArtboard>
        <DCArtboard id="reel" label="MP4 Showreel" width={960} height={540}>
          <VideoComp component={Reel} durationInFrames={REEL_TOTAL} fps={30} width={960} height={540} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
