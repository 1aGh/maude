import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { Cursor } from '../../../vendor/maude-v2/_kit';
import { BTN, SCR, SignUpScreen } from './screens';
import { CUE, EASE, sp, tw, useT } from './motion';

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
const tag = (name: string, attrs: [string, string][] = [], close = false, self = false): ReactNode => (
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
  [118, 1, <>{tag('h1')}<span style={{ color: 'var(--fg-0)' }}>Create your account</span>{tag('h1', [], true)}</>],
  [158, 1, <>{tag('p')}<span style={{ color: 'var(--fg-0)' }}>It takes a minute.</span>{tag('p', [], true)}</>],
  [228, 1, tag('input', [['placeholder', 'Email']])],
  [308, 1, tag('input', [['placeholder', 'Password']])],
  [BTN.y + BTN.h / 2, 1, <>{tag('button')}<span style={{ color: 'var(--fg-0)' }}>Sign up</span>{tag('button', [], true)}</>],
  [486, 1, <>{tag('p')}<span style={{ color: 'var(--fg-0)' }}>Already have an account?</span></>],
  [512, 2, <>{tag('a')}<span style={{ color: 'var(--fg-0)' }}>Log in</span>{tag('a', [], true)}{tag('p', [], true)}</>],
  [592, 0, tag('section', [], true)],
];

const CodeBack = () => (
  <div className="maude-v2" data-theme="dark" style={{ position: 'absolute', inset: 0, borderRadius: SCR.r, background: 'var(--bg-0)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
    {/* the button's own footprint, so it reads as "this is that" */}
    <i style={{ position: 'absolute', left: BTN.x, top: BTN.y, width: BTN.w, height: BTN.h, borderRadius: 999, border: '2px dashed var(--accent)', background: 'var(--accent-muted)' }} />
    {LINES.map(([y, ind, node], i) => (
      <div key={i} style={{ position: 'absolute', left: 16 + ind * 14, top: y - 10, fontFamily: 'var(--font-mono)', fontSize: 14.5, lineHeight: '20px', whiteSpace: 'nowrap' }}>{node}</div>
    ))}
  </div>
);

export const Flip = () => {
  const t = useT();
  const { lift, flip, back, land, hover, press } = CUE.flip;
  if (t < lift - 0.05 || t > 63.0) return null;
  const up = sp(t, lift, 'calm');
  const a1 = tw(t, flip, flip + 0.8, 0, 180, EASE.move);
  const a2 = tw(t, back, land, 0, 180, EASE.enter);
  const angle = a1 + a2;
  const settle = sp(t, land, 'bouncy');
  const lifted = t < land ? up : 1 - settle; // lands: back down onto the canvas
  const dim = tw(t, lift, lift + 0.6) * (1 - tw(t, 62.6, 62.95, 0, 1, EASE.exit));
  const cur = tw(t, hover - 0.4, hover + 0.4, 0, 1, EASE.move);
  const isHover = t >= hover + 0.35;
  const pr = tw(t, press, press + 0.2, 0, 1, (n) => n);
  const w = SCR.w * FLIP_SCALE;
  const h = SCR.h * FLIP_SCALE;
  return (
    <AbsoluteFill className="iv2">
      <AbsoluteFill style={{ background: 'var(--fg-0)', opacity: 0.9 * dim }} />
      <div style={{ position: 'absolute', left: 960 - w / 2, top: 540 - h / 2, width: w, height: h, perspective: 2200 }}>
        <div
          style={{
            position: 'absolute', inset: 0, transformStyle: 'preserve-3d',
            transform: `translateZ(${lifted * 120}px) rotateY(${angle}deg) rotateZ(${Math.sin((angle * Math.PI) / 180) * -4}deg) scale(${1 + 0.035 * lifted})`,
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: SCR.r * FLIP_SCALE, boxShadow: `0 ${20 + 40 * lifted}px ${50 + 60 * lifted}px var(--object-ink)` }}>
            <div style={{ width: SCR.w, height: SCR.h, transform: `scale(${FLIP_SCALE})`, transformOrigin: '0 0' }}>
              <SignUpScreen press={pr} frame={false} />
              {isHover && pr === 0 ? <i style={{ position: 'absolute', left: BTN.x - 4, top: BTN.y - 4, width: BTN.w + 8, height: BTN.h + 8, borderRadius: 999, boxShadow: '0 0 0 4px var(--accent-muted)' }} /> : null}
            </div>
          </div>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: SCR.r * FLIP_SCALE, boxShadow: `0 ${20 + 40 * lifted}px ${50 + 60 * lifted}px var(--object-ink)` }}>
            <div style={{ width: SCR.w, height: SCR.h, transform: `scale(${FLIP_SCALE})`, transformOrigin: '0 0' }}>
              <CodeBack />
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1500 - 490 * cur, top: 980 - 280 * cur, opacity: tw(t, hover - 0.5, hover - 0.3) * (1 - tw(t, 62.5, 62.8)), transform: `scale(${1.6 * (1 - 0.12 * Math.sin(Math.PI * pr))})`, transformOrigin: '0 0' }}>
        <Cursor name="you" x={0} y={0} tag={false} />
      </div>
    </AbsoluteFill>
  );
};
