import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { AbsoluteFill } from 'remotion';
import { Cursor } from '../../../vendor/maude-v2/_kit';
import { CUE, EASE, sp, tw, useT } from './motion';
import { BTN, SCR, SignUpScreen } from './screens';

/**
 * Beat 7 · The secret: good ol' HTML (53.5–63.2 s). "Oh, the secret? It's all good ol' HTML. The
 * language AI grew up on. So it's fluent. And the work is yours."
 *
 * The sign-up screen from wow 3 (the camera has just dived onto it) lifts off the canvas, the
 * world dims, and it flips like a playing card (perspective, preserve-3d). Its back is its own
 * code, every line at the height of the element it makes: <button> sits exactly behind the
 * button. It flips back and lands face up, and the button answers the cursor.
 */
export const FLIP_SCALE = 1.45;

/** One line of syntax-coloured markup, from tokens only. */
const tag = (
  name: string,
  attrs: [string, string][] = [],
  close = false,
  self = false
): ReactNode => (
  <>
    <span style={{ color: 'var(--fg-2)' }}>{close ? '</' : '<'}</span>
    <span style={{ color: 'var(--accent-text)' }}>{name}</span>
    {attrs.map(([a, v]) => (
      <Fragment key={a}>
        {' '}
        <span style={{ color: 'var(--object-lilac)' }}>{a}</span>
        <span style={{ color: 'var(--fg-2)' }}>=</span>
        <span style={{ color: 'var(--object-green)' }}>"{v}"</span>
      </Fragment>
    ))}
    <span style={{ color: 'var(--fg-2)' }}>{self ? ' />' : '>'}</span>
  </>
);
// [y centre in screen px, indent, content]: each line sits behind the element it makes.
const LINES: [number, number, ReactNode][] = [
  [22, 0, tag('section', [['class', 'signup']])],
  [64, 1, tag('img', [['src', 'mark.svg']], false, true)],
  [
    118,
    1,
    <>
      {tag('h1')}
      <span style={{ color: 'var(--fg-0)' }}>Create your account</span>
      {tag('h1', [], true)}
    </>,
  ],
  [
    158,
    1,
    <>
      {tag('p')}
      <span style={{ color: 'var(--fg-0)' }}>It takes a minute.</span>
      {tag('p', [], true)}
    </>,
  ],
  [228, 1, tag('input', [['placeholder', 'Email']])],
  [308, 1, tag('input', [['placeholder', 'Password']])],
  [
    BTN.y + BTN.h / 2,
    1,
    <>
      {tag('button')}
      <span style={{ color: 'var(--fg-0)' }}>Sign up</span>
      {tag('button', [], true)}
    </>,
  ],
  [
    476,
    1,
    <>
      {tag('p')}
      <span style={{ color: 'var(--fg-0)' }}>Already have an account?</span>
    </>,
  ],
  [
    502,
    2,
    <>
      {tag('a')}
      <span style={{ color: 'var(--fg-0)' }}>Log in</span>
      {tag('a', [], true)}
      {tag('p', [], true)}
    </>,
  ],
  [
    563,
    1,
    <>
      {tag('button')}
      <span style={{ color: 'var(--fg-0)' }}>Passkey</span>
      {tag('button', [], true)}
    </>,
  ],
  [600, 0, tag('section', [], true)],
];
const BUTTON_LINE = 6;
const LINE_IN = (i: number) => CUE.flip.flip + 0.55 + i * 0.15; // typed in, top to bottom, as the back turns into view

/** The code face: typed line by line; on "HTML" the <button> line and its footprint light up. */
const CodeBack = ({ t }: { t: number }) => {
  const pulse =
    tw(t, CUE.flip.html, CUE.flip.html + 0.25, 0, 1, EASE.enter) *
    (1 - tw(t, CUE.flip.html + 0.25, CUE.flip.html + 0.6, 0, 1, EASE.move));
  const lit = tw(t, CUE.flip.html, CUE.flip.html + 0.2);
  const sweep = tw(t, CUE.flip.sweep, CUE.flip.back + 0.1, -0.5, LINES.length - 0.5, (n) => n); // a reading highlight, top to bottom
  return (
    <div
      className="maude-v2"
      data-theme="dark"
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: SCR.r,
        background: 'var(--bg-1)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      {/* the button's own footprint, so it reads as "this is that" */}
      <i
        style={{
          position: 'absolute',
          left: BTN.x,
          top: BTN.y,
          width: BTN.w,
          height: BTN.h,
          borderRadius: 999,
          border: '2px dashed var(--accent)',
          background: 'var(--accent-muted)',
          opacity: 0.55 + 0.45 * lit,
          transform: `scale(${1 + 0.05 * pulse})`,
          boxShadow: `0 0 0 ${10 * pulse}px var(--accent-muted)`,
        }}
      />
      {LINES.map(([y, ind, node], i) => {
        const k = tw(t, LINE_IN(i), LINE_IN(i) + 0.16, 0, 1, (n) => n);
        const hl = Math.max(0, 1 - Math.abs(sweep - i));
        return (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: y - 11, height: 22 }}>
            {hl > 0 ? (
              <i
                style={{
                  position: 'absolute',
                  inset: '-1px 8px',
                  borderRadius: 5,
                  background: 'var(--fg-0)',
                  opacity: 0.08 * hl,
                }}
              />
            ) : null}
            <div
              style={{
                position: 'absolute',
                left: 14 + ind * 12,
                top: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: 15.5,
                lineHeight: '22px',
                whiteSpace: 'nowrap',
                clipPath: `inset(0 ${(1 - k) * 100}% 0 0)`,
                fontWeight: i === BUTTON_LINE && lit > 0.5 ? 700 : 400,
              }}
            >
              {node}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const Flip = () => {
  const t = useT();
  const { lift, flip, back, land, hover, press, off } = CUE.flip;
  if (t < lift || t >= off) return null;
  const up = sp(t, lift, 'calm');
  const a1 = tw(t, flip, flip + 0.9, 0, 180, EASE.move);
  const a2 = tw(t, back, land, 0, 180, EASE.move); // the return mirrors the flip: same ease, 0.7 s
  const angle = a1 + a2;
  const settle = sp(t, land, 'bouncy');
  const lifted = Math.max(0, Math.min(1, t < land ? up : 1 - settle)); // lands: back down onto the canvas, never below it
  // while the code holds: a slow parallax drift and a creep toward the camera, eased in and out
  const hold = tw(t, flip + 0.7, flip + 1.4) * (1 - tw(t, back - 0.4, back));
  const drift = Math.sin(((t - flip) / 6) * Math.PI * 2) * 2.5 * hold;
  const creep = 30 * tw(t, flip + 0.9, back, 0, 1, EASE.move) * (1 - tw(t, back, land));
  const dim = tw(t, lift, lift + 0.6) * (1 - tw(t, off - 0.45, off - 0.05, 0, 1, EASE.exit));
  const cur = tw(t, hover - 0.4, hover + 0.4, 0, 1, EASE.move);
  const isHover = t >= hover + 0.35;
  const pr = tw(t, press, press + 0.12, 0, 1, EASE.enter) * (1 - tw(t, press + 0.16, press + 0.4));
  const ripple = tw(t, press, press + 0.55, 0, 1, EASE.enter);
  const w = SCR.w * FLIP_SCALE;
  const h = SCR.h * FLIP_SCALE;
  const edge = Math.abs(Math.cos(((angle + drift) * Math.PI) / 180));
  return (
    <AbsoluteFill className="iv2" style={{ opacity: tw(t, lift, lift + 0.1) }}>
      {/* the world dims to the same dark the "no handoff" board is made of */}
      <AbsoluteFill
        className="maude-v2"
        data-theme="dark"
        style={{ background: 'var(--bg-0)', opacity: 0.94 * dim }}
      />
      {/* the shadow stays on the canvas under the card (the light does not turn with it) */}
      <i
        style={{
          position: 'absolute',
          left: 960 - (w / 2) * edge,
          top: 540 + h / 2 - 30,
          width: w * edge,
          height: 60,
          borderRadius: '50%',
          background: 'var(--object-ink)',
          filter: `blur(${18 + 22 * lifted}px)`,
          opacity: (0.25 + 0.35 * lifted) * dim,
          transform: `translateY(${24 * lifted}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 960 - w / 2,
          top: 540 - h / 2,
          width: w,
          height: h,
          perspective: 2200,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformStyle: 'preserve-3d',
            transform: `translateZ(${lifted * 120 + creep}px) rotateY(${angle + drift}deg) rotateZ(${Math.sin((angle * Math.PI) / 180) * -4}deg) scale(${1 + 0.035 * lifted})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              borderRadius: SCR.r * FLIP_SCALE,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: SCR.w,
                height: SCR.h,
                transform: `scale(${FLIP_SCALE})`,
                transformOrigin: '0 0',
              }}
            >
              <SignUpScreen press={pr} frame={false} />
              {isHover ? (
                <i
                  style={{
                    position: 'absolute',
                    left: BTN.x - 4,
                    top: BTN.y - 4,
                    width: BTN.w + 8,
                    height: BTN.h + 8,
                    borderRadius: 999,
                    boxShadow: `0 0 0 ${4 * (1 - ripple * 0.6)}px var(--accent-muted)`,
                  }}
                />
              ) : null}
              {ripple > 0 && ripple < 1 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: BTN.x,
                    top: BTN.y,
                    width: BTN.w,
                    height: BTN.h,
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <i
                    style={{
                      position: 'absolute',
                      left: 135 - 160 * ripple,
                      top: 30 - 160 * ripple,
                      width: 320 * ripple,
                      height: 320 * ripple,
                      borderRadius: '50%',
                      background: 'var(--bg-0)',
                      opacity: 0.45 * (1 - ripple),
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              borderRadius: SCR.r * FLIP_SCALE,
            }}
          >
            <div
              style={{
                width: SCR.w,
                height: SCR.h,
                transform: `scale(${FLIP_SCALE})`,
                transformOrigin: '0 0',
              }}
            >
              <CodeBack t={t} />
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1500 - 490 * cur,
          top: 980 - 280 * cur,
          opacity: tw(t, hover - 0.5, hover - 0.3) * (1 - tw(t, off - 0.4, off - 0.15)),
          transform: `scale(${1.6 * (1 - 0.1 * pr)})`,
          transformOrigin: '0 0',
        }}
      >
        <Cursor name="you" x={0} y={0} tag={false} />
      </div>
    </AbsoluteFill>
  );
};
