// Maude Native Launch — launch video-comp for the native desktop app (DDR-148).
// Callback to the 22.6 sneak peek (a single diff-viewer screen) → the whole app.
// Six frame-driven beats joined by crossfades, on the maude design system:
//   1 june diff (dimmed archival)  2 zoom out → the app  3 six-phase montage
//   4 ready for non-technical people  5 runs on macOS + Windows  6 download CTA
// Everything is frame-driven (deterministic → exports frame-perfect). Open in
// Maude, scrub the Timeline, ⌘E → MP4/GIF (or /design:export mp4 --scope artboard).

import { DCArtboard, DCSection, DesignCanvas, VideoComp } from '@maude/canvas-lib';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
// <Audio> from @remotion/media (decode-to-canvas) — export-safe + preview-safe.
import { Audio } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';

// ── maude DS tokens (dark theme values, .design/system/maude/colors_and_type.css)
const BG = 'oklch(0.165 0.012 255)';
const BG1 = 'oklch(0.205 0.012 255)';
const BG2 = 'oklch(0.232 0.013 255)';
const BORDER = 'oklch(0.360 0.013 252)';
const FG = 'oklch(0.965 0.005 250)';
const FG1 = 'oklch(0.790 0.008 250)';
const FG2 = 'oklch(0.660 0.010 250)';
const ACCENT = 'oklch(0.680 0.180 268)';
const ACCENT_FG = 'oklch(0.995 0.004 268)';
const ACCENT_TINT = 'color-mix(in oklab, oklch(0.680 0.180 268) 16%, transparent)';
// diff colours — used ONLY for the literal git-diff callback (beat 1)
const ADD = '#4bc57c';
const DEL = '#d1656b';

const SANS = '"Inter Tight", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const PHASES = ['shell', 'git', 'identity', 'collab', 'chat', 'distribution'];

// ── beat lengths @30fps + crossfade
const S1 = 54;
const S2 = 24;
const S3 = 150;
const S4 = 66;
const S5 = 60;
const S6 = 78;
const XF = 14;
const TOTAL = S1 + S2 + S3 + S4 + S5 + S6 - XF * 5; // 362f ≈ 12.1s

// ── The maude mark — the four-point spark on its rounded bubble tile (squared
// bottom-right corner = message bubble). Same construction as system/maude logo.
function Mark({ size = 72 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '24% 24% 6% 24%',
        background: ACCENT,
        display: 'grid',
        placeItems: 'center',
        boxShadow: `0 0 0 ${Math.round(size * 0.16)}px ${ACCENT_TINT}`,
      }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} aria-hidden="true">
        <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill={ACCENT_FG} />
      </svg>
    </span>
  );
}

function Wordmark({ size = 72 }: { size?: number }) {
  return (
    <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: size, letterSpacing: '-0.03em', color: FG }}>
      maude
    </span>
  );
}

const AppleGlyph = ({ s = 30, fill = FG }: { s?: number; fill?: string }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill={fill}
      d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z"
    />
  </svg>
);

const WindowsGlyph = ({ s = 28, fill = FG }: { s?: number; fill?: string }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill={fill}
      d="M1 3.5 10.5 2.2v9.3H1zM11.6 2.05 23 .5v11H11.6zM1 12.5h9.5v9.3L1 20.5zM11.6 12.5H23v11l-11.4-1.55z"
    />
  </svg>
);

// ── Beat 1 — the sneak-peek diff viewer, dimmed to feel archival. ────────────
const JuneDiff = () => {
  const f = useCurrentFrame();
  const rise = interpolate(f, [0, 14], [16, 0], { extrapolateRight: 'clamp' });
  const op = interpolate(f, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const fade = interpolate(f, [30, S1], [1, 0.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const rows = [
    { g: '−', t: 'one screen', c: DEL, strike: true },
    { g: '+', t: 'a whole native app', c: ADD },
    { g: '+', t: 'shell / git / identity', c: ADD },
  ];
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ opacity: op * fade, transform: `translateY(${rise}px)`, width: 620 }}>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: BG1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '12px 16px', borderBottom: `1px solid ${BORDER}` }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 11, height: 11, borderRadius: 999, background: BORDER }} />
            ))}
            <span style={{ marginLeft: 8, color: FG2, fontFamily: MONO, fontSize: 14 }}>diff viewer</span>
          </div>
          <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10, fontFamily: MONO, fontSize: 22 }}>
            {rows.map((r) => (
              <div key={r.t} style={{ display: 'flex', gap: 14, color: r.c }}>
                <span style={{ opacity: 0.8 }}>{r.g}</span>
                <span style={{ textDecoration: r.strike ? 'line-through' : 'none', opacity: r.strike ? 0.7 : 1 }}>{r.t}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 18, color: FG1, fontSize: 22, fontWeight: 500 }}>june. one screen.</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Beat 2 — zoom out: that one window becomes the whole app. ────────────────
const ZoomOut = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 200, mass: 0.8 } });
  const scale = interpolate(s, [0, 1], [1.6, 1]);
  const arrowO = interpolate(f, [10, 22], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ position: 'relative', width: 620, height: 360, transform: `scale(${scale})` }}>
        <div style={{ position: 'absolute', inset: 0, border: `1px solid ${BORDER}`, borderRadius: 14, background: BG1 }} />
        <div
          style={{
            position: 'absolute',
            left: '32%',
            top: '30%',
            width: 200,
            height: 132,
            borderRadius: 8,
            border: `2px solid ${ACCENT}`,
            background: BG2,
            boxShadow: `0 0 0 6px ${ACCENT_TINT}`,
          }}
        />
      </div>
      <div style={{ position: 'absolute', bottom: 60, right: 90, color: ACCENT, fontSize: 30, fontWeight: 600, opacity: arrowO }}>
        now →
      </div>
    </AbsoluteFill>
  );
};

// ── Beat 3 — six-phase montage, each area lights up in turn. ─────────────────
const Phases = () => {
  const f = useCurrentFrame();
  const step = 20;
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <div style={{ color: FG1, fontSize: 22, fontWeight: 500, letterSpacing: '0.02em' }}>a native desktop app</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, width: 720 }}>
          {PHASES.map((p, i) => {
            const on = f >= i * step;
            const pop = interpolate(f, [i * step, i * step + 8], [0.9, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div
                key={p}
                style={{
                  transform: `scale(${on ? pop : 0.9})`,
                  opacity: on ? 1 : 0.28,
                  border: `1px solid ${on ? ACCENT : BORDER}`,
                  background: on ? ACCENT_TINT : BG1,
                  borderRadius: 12,
                  padding: '20px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 999, background: on ? ACCENT : BORDER }} />
                <span style={{ color: on ? FG : FG2, fontSize: 24, fontWeight: 600, fontFamily: MONO }}>{p}</span>
              </div>
            );
          })}
        </div>
        <div style={{ color: FG2, fontSize: 18, fontFamily: MONO }}>phases 26–32 · all merged</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Beat 4 — ready for non-technical people. No terminal. ────────────────────
const ReadyForEveryone = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 190 } });
  const scale = interpolate(s, [0, 1], [0.92, 1]);
  const click = interpolate(f, [30, 36, 44], [1, 0.86, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cursorX = interpolate(f, [8, 30], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, transform: `scale(${scale})` }}>
        <div style={{ position: 'relative', width: 380, border: `1px solid ${BORDER}`, borderRadius: 14, background: BG1, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 10, borderRadius: 6, background: BORDER, width: '80%' }} />
          <div style={{ height: 10, borderRadius: 6, background: BORDER, width: '55%' }} />
          <div style={{ marginTop: 6, alignSelf: 'flex-start', transform: `scale(${click})`, padding: '10px 18px', borderRadius: 10, background: ACCENT, color: ACCENT_FG, fontSize: 18, fontWeight: 700 }}>
            Publish
          </div>
          <div style={{ position: 'absolute', right: 90, bottom: 26, transform: `translateX(${cursorX}px)`, color: FG, fontSize: 26 }}>➤</div>
        </div>
        <div style={{ color: FG, fontSize: 30, fontWeight: 600 }}>ready for everyone. no terminal.</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Beat 5 — runs on macOS + Windows. ────────────────────────────────────────
const Platforms = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = [
    { glyph: <AppleGlyph s={40} fill={FG} />, label: 'macOS' },
    { glyph: <WindowsGlyph s={38} fill={FG} />, label: 'Windows' },
  ];
  return (
    <AbsoluteFill style={{ background: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <div style={{ color: FG1, fontSize: 22, fontWeight: 500 }}>one download, native on</div>
        <div style={{ display: 'flex', gap: 24 }}>
          {items.map((it, i) => {
            const s = spring({ frame: f - i * 8, fps, config: { damping: 180 } });
            const y = interpolate(s, [0, 1], [24, 0]);
            const o = interpolate(s, [0, 1], [0, 1]);
            return (
              <div
                key={it.label}
                style={{
                  transform: `translateY(${y}px)`,
                  opacity: o,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '18px 26px',
                  border: `1px solid ${BORDER}`,
                  borderRadius: 14,
                  background: BG1,
                }}
              >
                {it.glyph}
                <span style={{ color: FG, fontSize: 30, fontWeight: 600 }}>{it.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ color: FG2, fontSize: 17, fontFamily: MONO }}>free · open source · keeps itself up to date</div>
      </div>
    </AbsoluteFill>
  );
};

// ── Beat 6 — the CTA end card: download it now. ──────────────────────────────
const DownloadCTA = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 160 } });
  const scale = interpolate(s, [0, 1], [0.9, 1]);
  const btn = spring({ frame: f - 18, fps, config: { damping: 170 } });
  const btnO = interpolate(btn, [0, 1], [0, 1]);
  const btnY = interpolate(btn, [0, 1], [14, 0]);
  const pulse = 1 + 0.02 * Math.sin(f / 6);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(130% 100% at 50% 30%, ${BG1} 0%, ${BG} 68%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: SANS,
        gap: 30,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, transform: `scale(${scale})` }}>
        <Mark size={82} />
        <Wordmark size={82} />
      </div>
      <div
        style={{
          transform: `translateY(${btnY}px) scale(${pulse})`,
          opacity: btnO,
          padding: '16px 34px',
          borderRadius: 14,
          background: ACCENT,
          color: ACCENT_FG,
          fontSize: 30,
          fontWeight: 700,
        }}
      >
        download it now
      </div>
      <div style={{ opacity: btnO, color: FG1, fontSize: 24, fontFamily: MONO, letterSpacing: '0.01em' }}>maude.sh/desktop</div>
    </AbsoluteFill>
  );
};

// ── The full launch cut. ─────────────────────────────────────────────────────
function Movie() {
  return (
    <AbsoluteFill style={{ background: BG }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={S1}>
          <JuneDiff />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
        <TransitionSeries.Sequence durationInFrames={S2}>
          <ZoomOut />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: 'from-right' })} timing={linearTiming({ durationInFrames: XF })} />
        <TransitionSeries.Sequence durationInFrames={S3}>
          <Phases />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
        <TransitionSeries.Sequence durationInFrames={S4}>
          <ReadyForEveryone />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
        <TransitionSeries.Sequence durationInFrames={S5}>
          <Platforms />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XF })} />
        <TransitionSeries.Sequence durationInFrames={S6}>
          <DownloadCTA />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Optional music bed (same asset the intro comp uses). Remove if silent. */}
      <Audio
        src="/.design/assets/music.mp3"
        volume={(fr) =>
          interpolate(fr, [0, 18, TOTAL - 26, TOTAL - 1], [0, 0.65, 0.65, 0], {
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
      <DCSection title="Maude Native Launch">
        <DCArtboard id="launch" label="Launch cut (~12s)" width={960} height={540}>
          <VideoComp component={Movie} durationInFrames={TOTAL} fps={30} width={960} height={540} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
