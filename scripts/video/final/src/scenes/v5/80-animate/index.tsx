import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Sparky } from '../../../lib/sparky';
import { easeOut, font, lerp, maude, PANEL_SHADOW, Phrase, Void } from '../../../lib/v5-stage';

/**
 * Beat 80 · Animate once (180f / 6s).
 *
 * The Sparky mark from beat 70 comes alive — waves, blinks, antenna twinkles,
 * bobs — emits a single .lottie, then the SAME motion plays in sync on a desktop
 * frame + a phone frame, frame for frame. Grounded: /design-video:to-lottie.
 * VO: "Animate it once. Ship a single file — web and native, frame for frame."
 */
const t = maude.dark;

const Bob: React.FC<{ frame: number; children: React.ReactNode; amp?: number }> = ({
  frame,
  children,
  amp = 6,
}) => <div style={{ transform: `translateY(${Math.sin(frame / 16) * amp}px)` }}>{children}</div>;

export const V5Animate = () => {
  const frame = useCurrentFrame();

  const intro = easeOut(lerp(frame, [0, 18], [0, 1]));
  const split = easeOut(lerp(frame, [54, 88], [0, 1]));
  const lottie = lerp(frame, [56, 72], [0, 1]) * (1 - lerp(frame, [86, 98], [0, 1]));
  const heroScale = interpolate(split, [0, 1], [1, 0]);
  const devicesIn = split;

  return (
    <AbsoluteFill>
      <Void theme="dark" style={{ alignItems: 'center', justifyContent: 'center' }}>
        {/* hero live mascot (recedes into the .lottie) */}
        {heroScale > 0.01 ? (
          <div
            style={{
              position: 'absolute',
              opacity: intro * heroScale,
              transform: `scale(${heroScale})`,
              marginTop: -40,
            }}
          >
            <Bob frame={frame} amp={10}>
              <Sparky size={400} liveFrame={frame} />
            </Bob>
          </div>
        ) : null}

        {/* the single .lottie file emitting */}
        <div
          style={{
            position: 'absolute',
            opacity: lottie,
            transform: `translateY(${interpolate(lottie, [0, 1], [10, -10])}px)`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: font.mono,
            fontSize: 22,
            color: t.accent,
            background: t.accentTint,
            border: `1px solid ${t.accentMuted}`,
            borderRadius: 99,
            padding: '10px 22px',
          }}
        >
          ✦ sparky.lottie
        </div>

        {/* device frames playing the SAME motion in sync */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 80,
            opacity: devicesIn,
            transform: `translateY(${interpolate(devicesIn, [0, 1], [20, 0])}px) scale(${interpolate(devicesIn, [0, 1], [0.94, 1])})`,
          }}
        >
          {/* desktop / web */}
          <div
            style={{
              width: 720,
              height: 460,
              background: t.bg1,
              border: `1px solid ${t.border}`,
              borderRadius: 16,
              boxShadow: PANEL_SHADOW,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 40,
                background: t.bg2,
                borderBottom: `1px solid ${t.border}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 16px',
              }}
            >
              {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
              ))}
              <span style={{ marginLeft: 14, fontFamily: font.mono, fontSize: 14, color: t.fg2 }}>
                web · React
              </span>
            </div>
            <div
              style={{
                height: 'calc(100% - 40px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Bob frame={frame}>
                <Sparky size={210} liveFrame={frame} />
              </Bob>
            </div>
          </div>

          {/* phone / native */}
          <div
            style={{
              width: 230,
              height: 460,
              background: t.bg1,
              border: `2px solid ${t.border}`,
              borderRadius: 36,
              boxShadow: PANEL_SHADOW,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 80,
                height: 18,
                background: t.bg0,
                borderRadius: 99,
                zIndex: 2,
              }}
            />
            <div
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
              }}
            >
              <Bob frame={frame}>
                <Sparky size={130} liveFrame={frame} />
              </Bob>
              <span style={{ fontFamily: font.mono, fontSize: 13, color: t.fg2 }}>
                native · Lottie
              </span>
            </div>
          </div>
        </div>

        <Phrase
          frame={frame}
          from={98}
          text="web + native — frame for frame"
          align="center"
          size={32}
          bottom={70}
        />
      </Void>
    </AbsoluteFill>
  );
};
