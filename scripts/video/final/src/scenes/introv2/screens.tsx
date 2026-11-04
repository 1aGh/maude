import type { CSSProperties, ReactNode } from 'react';
import { Mark } from '../../../vendor/maude-v2/_kit';

/** The app screens the sketch becomes (330x620, maude-v2 tokens). Shared by wow 3 and the Flip. */
export const SCR = { w: 330, h: 620, r: 40 };
/** Where the sign-up button sits on the screen (the Flip puts <button> exactly behind it). */
export const BTN = { x: 30, y: 380, w: 270, h: 60 };

/** `k(i)` 0→1 is the entrance of element i (the morph staggers them); `press` 0→1 the tap. */
type Reveal = (i: number) => number;
const show = (k: number): CSSProperties => ({
  opacity: k,
  transform: `scale(${0.9 + 0.1 * k})`,
  transformOrigin: '50% 50%',
});

const Frame = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div
    style={{
      position: 'relative',
      width: SCR.w,
      height: SCR.h,
      borderRadius: SCR.r,
      overflow: 'hidden',
      background: 'var(--bg-0)',
      fontFamily: 'var(--font-body)',
      ...style,
    }}
  >
    {children}
  </div>
);

const Field = ({ y, label, k }: { y: number; label: string; k: number }) => (
  <div
    style={{
      position: 'absolute',
      left: 30,
      top: y,
      width: 270,
      height: 56,
      borderRadius: 14,
      border: '1.5px solid var(--border-strong, var(--border-subtle))',
      background: 'var(--bg-1)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 18px',
      fontSize: 17,
      color: 'var(--fg-2)',
      ...show(k),
    }}
  >
    {label}
  </div>
);

export const SignUpScreen = ({
  k = () => 1,
  press = 0,
  frame = true,
}: {
  k?: Reveal;
  press?: number;
  frame?: boolean;
}) => (
  <Frame style={{ boxShadow: frame ? 'var(--shadow-lg)' : undefined }}>
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 44,
        display: 'grid',
        placeItems: 'center',
        ...show(k(0)),
      }}
    >
      <Mark size={40} />
    </div>
    <b
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 104,
        textAlign: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: 27,
        color: 'var(--fg-0)',
        ...show(k(1)),
      }}
    >
      Create your account
    </b>
    <span
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 146,
        textAlign: 'center',
        fontSize: 17,
        color: 'var(--fg-2)',
        ...show(k(2)),
      }}
    >
      It takes a minute.
    </span>
    <Field y={200} label="Email" k={k(3)} />
    <Field y={280} label="Password" k={k(4)} />
    <div
      style={{
        position: 'absolute',
        left: BTN.x,
        top: BTN.y,
        width: BTN.w,
        height: BTN.h,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        background: press > 0.5 ? 'var(--accent-active)' : 'var(--accent)',
        color: 'var(--accent-fg)',
        fontWeight: 700,
        fontSize: 20,
        ...show(k(5)),
        transform: `scale(${(0.9 + 0.1 * k(5)) * (1 - 0.05 * Math.sin(Math.PI * press))})`,
      }}
    >
      Sign up
    </div>
    <span
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 466,
        textAlign: 'center',
        fontSize: 16,
        color: 'var(--fg-2)',
        ...show(k(6)),
      }}
    >
      Already have an account? <b style={{ color: 'var(--accent-text)' }}>Log in</b>
    </span>
    {/* the bottom of the card: a divider and the two social sign-ins, so the card is full */}
    <div
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 512,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
        color: 'var(--fg-3, var(--fg-2))',
        ...show(k(6)),
      }}
    >
      <i style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      or
      <i style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
    </div>
    <div
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 540,
        display: 'flex',
        gap: 12,
        ...show(k(6)),
      }}
    >
      {['Passkey', 'Email link'].map((n) => (
        <span
          key={n}
          style={{
            flex: 1,
            height: 46,
            borderRadius: 14,
            border: '1.5px solid var(--border-subtle)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--fg-1)',
          }}
        >
          {n}
        </span>
      ))}
    </div>
  </Frame>
);

export const WelcomeScreen = ({ press = 0 }: { press?: number }) => (
  <Frame style={{ boxShadow: 'var(--shadow-lg)' }}>
    <div
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 60,
        height: 220,
        borderRadius: 26,
        background: 'var(--object-sky)',
        overflow: 'hidden',
      }}
    >
      <i
        style={{
          position: 'absolute',
          right: 30,
          top: 34,
          width: 74,
          height: 74,
          borderRadius: 999,
          background: 'var(--object-yellow)',
        }}
      />
      <i
        style={{
          position: 'absolute',
          left: -30,
          bottom: -60,
          width: 300,
          height: 140,
          borderRadius: 999,
          background: 'var(--object-green)',
        }}
      />
    </div>
    <b
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 310,
        fontFamily: 'var(--font-display)',
        fontSize: 30,
        color: 'var(--fg-0)',
      }}
    >
      Welcome, Tereza!
    </b>
    <span
      style={{
        position: 'absolute',
        left: 30,
        right: 30,
        top: 356,
        fontSize: 17,
        color: 'var(--fg-2)',
      }}
    >
      Let's set up your first project.
    </span>
    <div
      style={{
        position: 'absolute',
        left: BTN.x,
        top: 460,
        width: BTN.w,
        height: BTN.h,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        background: press > 0.5 ? 'var(--accent-active)' : 'var(--accent)',
        color: 'var(--accent-fg)',
        fontWeight: 700,
        fontSize: 20,
        transform: `scale(${1 - 0.05 * Math.sin(Math.PI * press)})`,
      }}
    >
      Continue
    </div>
  </Frame>
);

export const HomeScreen = () => (
  <Frame style={{ boxShadow: 'var(--shadow-lg)' }}>
    <b
      style={{
        position: 'absolute',
        left: 30,
        top: 56,
        fontFamily: 'var(--font-display)',
        fontSize: 30,
        color: 'var(--fg-0)',
      }}
    >
      Projects
    </b>
    {['var(--object-lilac)', 'var(--object-coral)', 'var(--object-green)'].map((c, i) => (
      <div
        key={c}
        style={{
          position: 'absolute',
          left: 30,
          top: 120 + i * 150,
          width: 270,
          height: 130,
          borderRadius: 20,
          background: 'var(--bg-1)',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}
      >
        <i
          style={{
            position: 'absolute',
            left: 16,
            top: 16,
            width: 98,
            height: 98,
            borderRadius: 14,
            background: c,
          }}
        />
        <i
          style={{
            position: 'absolute',
            left: 130,
            top: 30,
            width: 110,
            height: 14,
            borderRadius: 7,
            background: 'var(--fg-1)',
          }}
        />
        <i
          style={{
            position: 'absolute',
            left: 130,
            top: 58,
            width: 80,
            height: 10,
            borderRadius: 5,
            background: 'var(--bg-3)',
          }}
        />
      </div>
    ))}
  </Frame>
);
