import { DesignCanvas, DCSection, DCArtboard, VideoComp } from '@maude/canvas-lib';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
// Media elements come from @remotion/media — `remotion`'s Audio IS Html5Audio,
// which the export's audio renderer rejects (RCA
// issue-mp4-audio-export-html5audio-silent-degrade). This file was the in-repo
// casualty: Maude's own trailer could not export with sound.
import { Audio, Video } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';

// ═══════════════════════════════════════════════════════════════════════════
// Maude Photo Editor — TRAILER  ·  /design:reel cut
//
// Source: one raw 8-minute screen recording of the photo-editor feature in
// use, split into 8 ~60s segments, watched by footage-analyst, and directed
// into this 9-beat EDL by footage-director
// (.design/assets/photo-editor-trailer.edl.json). Arc: raw photo + editor UI
// → the AI kicks off → automatic background removal + template compositing
// (before/after) → a second "in seconds" payoff → handoff back to the human
// → the human manually iterates → close on the mark.
//
// Music: assets/5087c59a.mp3, ElevenLabs Music (BYOK, see .audio.json sidecar
// for the prompt) — commercial-rights tier follows the user's ElevenLabs plan.
// ═══════════════════════════════════════════════════════════════════════════

const FPS = 30;
const W = 1920;
const H = 1080;

// TOTAL = Σ beat frames − Σ transition frames, literal sum (Timeline-resolvable).
const TOTAL = 30 + 75 + 70 + 100 + 70 + 90 + 55 + 85 + 90 - 10 - 12 - 15;

const cover: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };

// ── VFX: the Maude canvas dot-grid, echoed as a texture (not decoration
// borrowed from stock trailer VFX — this is literally the product's own
// infinite-canvas background motif) ───────────────────────────────────────
const CanvasGrid = ({ opacity = 0.14 }: { opacity?: number }) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      opacity,
      backgroundImage: 'radial-gradient(circle, var(--canvas-dot) 1.4px, transparent 1.4px)',
      backgroundSize: 'var(--canvas-grid) var(--canvas-grid)',
    }}
  />
);

// ── VFX: an accent-tint halo ping — the brand's own "a node that just lit
// up" motif (system/maude/preview/logo.tsx), reused as a sting on the two
// beats where the AI visibly does something, instead of a generic flash/glitch.
const AccentPing = () => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: 'clamp' });
  const opacity = interpolate(frame, [0, 5, 24], [0, 0.5, 0], { extrapolateRight: 'clamp' });
  const size = 90 + grow * 620;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-tint) 0%, transparent 72%)',
          opacity,
        }}
      />
    </AbsoluteFill>
  );
};

// ── overlay: opener title (panel-reveal beat) — small mono "sku" kicker
// (mirrors the DS specimen's crumb convention) + the headline ─────────────
const Title = ({ kicker, text }: { kicker: string; text: string }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(e, [0, 1], [26, 0]);
  const opacity = interpolate(frame, [0, 14, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: 72 }}>
      <div style={{ transform: `translateY(${y}px)`, opacity }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 10,
          }}
        >
          {kicker}
        </div>
        <div
          style={{
            color: 'var(--fg-0)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 64,
            letterSpacing: '-0.02em',
            textShadow: '0 4px 28px rgba(0,0,0,0.55)',
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── overlay: bottom-center pill caption (the two "wow" payoff beats) ─────
const Caption = ({ text }: { text: string }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 16 } });
  const scale = interpolate(e, [0, 1], [0.92, 1]);
  const opacity = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 96 }}>
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          background: 'color-mix(in oklab, var(--bg-0) 72%, transparent)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-pill)',
          padding: '16px 34px',
          color: 'var(--fg-0)',
          fontFamily: 'var(--font-body)',
          fontWeight: 600,
          fontSize: 32,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ── overlay: closing brand mark — lifted from system/maude/preview/logo.tsx
// (DDR-141: the spark-on-bubble mark + "maude" wordmark, never redrawn) ────
const Spark = () => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: '100%', height: '100%' }}>
    <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
  </svg>
);

const Logo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 18 } });
  const scale = interpolate(e, [0, 1], [0.85, 1]);
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 16,
          background: 'color-mix(in oklab, var(--bg-0) 72%, transparent)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-pill)',
          padding: '20px 40px',
        }}
      >
        <div
          style={{
            // Tile stays subordinate to the wordmark (mark = 0.6x, word = 0.8x
            // of a shared height, per system/maude/preview/logo.tsx's Lockup).
            width: 39,
            height: 39,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            borderRadius: '24% 24% 0 24%',
            boxShadow: '0 0 0 4px var(--accent-tint)',
            padding: 10,
          }}
        >
          <Spark />
        </div>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 52,
            letterSpacing: '-0.03em',
            color: 'var(--fg-0)',
          }}
        >
          maude
        </span>
      </div>
    </AbsoluteFill>
  );
};

// ── the close-logo beat's own body — kept as one component so the video's
// dim curve can be frame-driven. It stays at FULL brightness through the
// incoming 15f crossfade (frames 0–15) so that transition blends two real
// video frames — not a video dissolving into an already-dark composite,
// which is what read as "fading through black". Only after the crossfade
// settles does the clip dim down to make room for the mark. ───────────────
const CloseLogo = () => {
  const frame = useCurrentFrame();
  const dim = interpolate(frame, [15, 46], [1, 0.32], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill>
      <Video src="assets/c34ec202.mov" startFrom={Math.round(53.5 * FPS)} style={{ ...cover, opacity: dim }} />
      <CanvasGrid opacity={0.12} />
      <Logo />
    </AbsoluteFill>
  );
};

// ── the cut — 9 literal beats (never a .map() over an array — the Timeline
// reads this file as text) ────────────────────────────────────────────────
const Reel = () => (
  <AbsoluteFill style={{ background: 'var(--bg-0)' }}>
    <TransitionSeries>
      <TransitionSeries.Sequence name="open" durationInFrames={30}>
        <Video src="assets/b409185a.mov" startFrom={Math.round(7.6 * FPS)} style={cover} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence name="panel-reveal" durationInFrames={75} premountFor={24}>
        <AbsoluteFill>
          <Video src="assets/b409185a.mov" startFrom={Math.round(10 * FPS)} style={cover} />
          <CanvasGrid opacity={0.1} />
          <Title kicker="Maude" text="Photo Editor" />
        </AbsoluteFill>
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence name="kickoff" durationInFrames={70} premountFor={24}>
        <Video src="assets/30783aa8.mov" startFrom={Math.round(24 * FPS)} style={cover} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence name="before-after" durationInFrames={100} premountFor={24}>
        <AbsoluteFill>
          <Video src="assets/df1fd2f2.mov" startFrom={Math.round(16.3 * FPS)} style={cover} />
          <AccentPing />
          <Caption text="AI removes the background — automatically" />
        </AbsoluteFill>
      </TransitionSeries.Sequence>

      {/* Softer merge out of the money-shot reveal into its confirmation
          beat — was a hard cut, now a gentle 10f crossfade. */}
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 10 })} />
      <TransitionSeries.Sequence name="badge-proof" durationInFrames={70} premountFor={24}>
        <Video src="assets/c34ec202.mov" startFrom={Math.round(15 * FPS)} style={cover} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence name="recrop-payoff" durationInFrames={90} premountFor={24}>
        <AbsoluteFill>
          <Video src="assets/ac68f707.mov" startFrom={Math.round(56.5 * FPS)} style={cover} />
          <AccentPing />
          <Caption text="Done in seconds" />
        </AbsoluteFill>
      </TransitionSeries.Sequence>

      {/* Ease down out of the second "wow" into the calm handoff beat —
          was a hard cut, now a 12f crossfade. */}
      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 12 })} />
      <TransitionSeries.Sequence name="ready-handoff" durationInFrames={55} premountFor={24}>
        <Video src="assets/df1fd2f2.mov" startFrom={Math.round(55 * FPS)} style={cover} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Sequence name="manual-edit" durationInFrames={85} premountFor={24}>
        <Video src="assets/c34ec202.mov" startFrom={Math.round(25.8 * FPS)} style={cover} />
      </TransitionSeries.Sequence>

      <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: 15 })} />
      <TransitionSeries.Sequence name="close-logo" durationInFrames={90} premountFor={24}>
        <CloseLogo />
      </TransitionSeries.Sequence>
    </TransitionSeries>

    {/* Music bed — ElevenLabs-generated (BYOK), fades out under the close. */}
    <Audio
      src="assets/5087c59a.mp3"
      volume={(f) => interpolate(f, [TOTAL - 30, TOTAL], [0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
    />
  </AbsoluteFill>
);

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection title="Photo Editor Trailer">
        <DCArtboard id="trailer" label="Trailer" width={W} height={H}>
          <VideoComp component={Reel} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
