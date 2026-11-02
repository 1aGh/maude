/**
 * @canvas      Cloud Collab Teaser — sneak-peek loop for the "maude, now in the
 *              cloud" social post (maude DS) · 1 comp
 * @ds          maude
 * @platform    web
 * @opt_out     palette
 * @artboards   teaser
 * @brief       A short (~5.7s) frame-driven Remotion loop for the Bluesky /
 *              LinkedIn sneak-peek post. Ported 1:1 from the REAL maude.sh
 *              marketing recipe — scripts/video/final/src/scenes/v5/00-cold-open
 *              + lib/v5-stage.tsx + lib/maude-tokens.ts (the exact code that
 *              produced the shipped hero: dotted void, "maude" wordmark +
 *              blinking caret, three labelled presence cursors converging
 *              around it) — NOT the app-chrome LiveCollab.tsx documentation
 *              style, which a first pass wrongly leaned on and read off-brand.
 *              Same relative geometry (offsets from center, scaled 2/3 for a
 *              1280×720 canvas vs. the source's 1920×1080), same cursor SVG,
 *              same pill recipe (white text, mono, small rect radius — NOT a
 *              999px stadium), same dot pitch/opacity, same font stacks. Only
 *              the labels/tagline are adapted to the cloud-collab narrative,
 *              and the cursors keep a gentle orbit after converging so the
 *              loop reads as "flying," not a frozen screenshot.
 * @stack       React 19 · TSX · Remotion · @maude/canvas-lib VideoComp
 * @history     .design/_history/cloud-collab-teaser/
 */

import "../../system/maude/colors_and_type.css";
import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const W = 1280;
const H = 720;
const FPS = 30;
const TOTAL = 170; // ~5.7s

// scripts/video/final/src/lib/maude-tokens.ts `maude.dark` — verbatim values,
// the same ones the shipped maude.sh hero video was rendered with.
const T = {
  bg0: "oklch(0.165 0.012 255)",
  fg0: "oklch(0.955 0.005 250)",
  fg2: "oklch(0.660 0.010 250)",
  accent: "oklch(0.680 0.180 268)",
  success: "oklch(0.760 0.150 162)", // "AI agent" hue in the source cold-open
  info: "oklch(0.720 0.120 238)", // "Claude Code" hue in the source cold-open
  presence: "oklch(0.700 0.190 322)", // "you" hue in the source cold-open
  canvasBg: "oklch(0.165 0.012 255)",
  canvasDot: "oklch(0.340 0.012 255)",
} as const;

const FONT = {
  display: "'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

const easeOut = (p: number) => 1 - (1 - p) ** 3;
const lerp = (frame: number, inR: [number, number], outR: [number, number]) =>
  interpolate(frame, inR, outR, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

// v5-stage.tsx `Void` — the dotted infinite-canvas background, verbatim recipe
// (30px pitch / 1.4px dot, not the app-chrome `.lc-stage` recipe — this is the
// marketing-video void, confirmed against the shipped hero).
const Void: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: T.canvasBg,
      backgroundImage: `radial-gradient(${T.canvasDot} 1.4px, transparent 1.4px)`,
      backgroundSize: "30px 30px",
      color: T.fg0,
      overflow: "hidden",
      fontFamily: FONT.display,
    }}
  >
    {children}
  </AbsoluteFill>
);

// v5-stage.tsx `Pointer` — verbatim SVG path + pill recipe (white label text,
// small-radius rect, NOT a stadium pill — the exact thing the first pass got
// wrong), scaled 2/3 for this 1280×720 canvas vs. the source's 1920×1080.
const S = 2 / 3;
const Pointer: React.FC<{ x: number; y: number; color: string; label: string; opacity: number }> = ({
  x,
  y,
  color,
  label,
  opacity,
}) => {
  const size = 36 * S;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity, pointerEvents: "none", zIndex: 50 }}>
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.45))" }}
      >
        <path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={color} stroke="#fff" strokeWidth={0.5} />
      </svg>
      <span
        style={{
          position: "absolute",
          left: size * 0.5,
          top: size * 0.55,
          whiteSpace: "nowrap",
          background: color,
          color: "#fff",
          fontFamily: FONT.mono,
          fontSize: 15 * S,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
        }}
      >
        {label}
      </span>
    </div>
  );
};

const Teaser = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const cx = width / 2;
  const cy = height / 2;

  const typeIn = lerp(frame, [14, 46], [0, 1]);
  const wmReveal = easeOut(typeIn) * 453 * S * 1.5; // proportional to the source's 680 @1920w
  const caretOn = Math.floor(frame / 14) % 2 === 0;

  const peers = [
    { color: T.presence, label: "you", fromX: cx + 620 * S, fromY: cy - 420 * S, toX: cx + 300 * S, toY: cy + 30 * S, delay: 8, phase: 0 },
    { color: T.info, label: "Anna", fromX: cx - 720 * S, fromY: cy + 360 * S, toX: cx - 470 * S, toY: cy + 70 * S, delay: 20, phase: 2.1 },
    { color: T.success, label: "agent", fromX: cx + 480 * S, fromY: cy + 440 * S, toX: cx + 210 * S, toY: cy - 150 * S, delay: 32, phase: 4.3 },
  ];

  // tagline crossfade — "now in the cloud." replaces the shipped hero's own
  // "design — inside your code." so the teaser reads as a continuation, not a
  // copy.
  const tagEnter = lerp(frame, [58, 76], [0, 1]);
  const tagRise = interpolate(tagEnter, [0, 1], [16, 0]);
  const subEnter = lerp(frame, [78, 96], [0, 1]);

  return (
    <Void>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-block",
              maxWidth: wmReveal,
              overflow: "hidden",
              whiteSpace: "nowrap",
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 104,
              lineHeight: 1,
              letterSpacing: "-0.025em",
              color: T.fg0,
            }}
          >
            maude
          </span>
          <span
            style={{
              display: "inline-block",
              width: 5,
              height: 74,
              background: T.accent,
              opacity: caretOn ? 1 : 0,
              borderRadius: 2,
            }}
          />
        </div>
      </AbsoluteFill>

      {peers.map((p) => {
        const s = spring({ frame: frame - p.delay, fps, config: { damping: 12, mass: 0.7 }, durationInFrames: 46 });
        const op = lerp(frame, [p.delay, p.delay + 12], [0, 1]);
        const settled = frame - (p.delay + 46);
        // a gentle continuous orbit once converged, so the loop reads as
        // "flying" rather than a single frozen arrangement.
        const driftX = settled > 0 ? Math.sin(settled / 26 + p.phase) * 14 * S : 0;
        const driftY = settled > 0 ? Math.cos(settled / 21 + p.phase) * 11 * S : 0;
        return (
          <Pointer
            key={p.label}
            x={interpolate(s, [0, 1], [p.fromX, p.toX]) + driftX}
            y={interpolate(s, [0, 1], [p.fromY, p.toY]) + driftY}
            color={p.color}
            label={p.label}
            opacity={op}
          />
        );
      })}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 130,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          opacity: tagEnter,
          transform: `translateY(${tagRise}px)`,
        }}
      >
        <span
          style={{
            fontFamily: FONT.display,
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: T.fg0,
            textShadow: "0 2px 24px rgba(0,0,0,0.5)",
          }}
        >
          now in the cloud.
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 14,
            color: T.fg2,
            opacity: subEnter,
          }}
        >
          real-time collaboration, built in.
        </span>
      </div>
    </Void>
  );
};

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection
        id="cloud-collab-teaser"
        title="Cloud Collab Teaser · maude"
        subtitle="Sneak-peek loop — ported from the real v5-stage cold-open recipe → maude, now in the cloud"
      >
        <DCArtboard id="teaser" label="Teaser · 1280×720" width={W} height={H}>
          <VideoComp component={Teaser} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
