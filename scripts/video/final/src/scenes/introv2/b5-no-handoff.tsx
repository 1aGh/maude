import { CUE, EASE, sp, tw, useT } from './motion';

/**
 * Beat 5 · No handoff (38.5–46.6 s). "No handoff. No final_v7_really_final. Just pure creativity."
 *
 * A dark artboard on the same canvas (the camera dives into it; it sits below the wows, out of
 * the team shot). The handoff file names stack up, centred; the last one types itself out with a
 * caret while the VO says it; each is struck on its word (the line draws across in 8 frames, the
 * name jolts and dims); then "Just pure creativity." lands, centred. Kinetic type only: no AI
 * here, so no spark. Its dark ground (dark --bg-0) is the same dark the Flip dims the world to.
 */
export const NH = { x: 6750, y: 1710, w: 2100, h: 1180 };
const FILES = [
  { name: 'handoff_notes.pdf', in: 38.9, strike: CUE.nh.s1, type: 0 },
  { name: 'specs_v3.fig', in: 39.25, strike: CUE.nh.s2, type: 0 },
  { name: 'final_v7_really_final.fig', in: 40.6, strike: CUE.nh.s3, type: 0.9 },
];
const CHAR = 38.4; // mono advance at 64 px

export const NoHandoff = () => {
  const t = useT();
  if (t < 37.5 || t > 48) return null;
  const line = sp(t, CUE.nh.line, 'snappy');
  return (
    <div className="maude-v2" data-theme="dark" style={{ position: 'absolute', left: NH.x, top: NH.y, width: NH.w, height: NH.h, borderRadius: 28, background: 'var(--bg-0)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
      <div style={{ position: 'absolute', left: (NH.w - 25 * CHAR) / 2, top: 400, display: 'flex', flexDirection: 'column', gap: 34 }}>
        {FILES.map((f, i) => {
          const k = sp(t, f.in, 'snappy');
          const out = tw(t, CUE.nh.line - 0.15 + i * 0.06, CUE.nh.line + 0.3 + i * 0.06, 0, 1, EASE.exit);
          const s = tw(t, f.strike, f.strike + 0.27, 0, 1, EASE.enter);
          const jolt = Math.sin(Math.PI * tw(t, f.strike, f.strike + 0.2, 0, 1, EASE.move)) * 10;
          const typed = f.type ? Math.round(tw(t, f.in, f.in + f.type, 0, f.name.length, (n) => n)) : f.name.length;
          const caret = f.type && t >= f.in && t < f.strike && (t < f.in + f.type || Math.floor((t - f.in - f.type) * 2) % 2 === 0);
          return (
            <div key={f.name} style={{ position: 'relative', alignSelf: 'flex-start', opacity: k * (1 - out), transform: `translate(${jolt}px, ${(1 - k) * 40 - out * 60}px)` }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 64, color: s > 0.5 ? 'var(--fg-2)' : 'var(--fg-0)', whiteSpace: 'nowrap' }}>{f.name.slice(0, typed)}</span>
              {caret ? <i style={{ position: 'absolute', left: typed * CHAR + 4, top: 8, width: 5, height: 72, borderRadius: 2, background: 'var(--accent)' }} /> : null}
              {s > 0 ? <i style={{ position: 'absolute', left: -10, top: '52%', height: 7, width: `calc(${s * 100}% + ${20 * s}px)`, borderRadius: 4, background: 'var(--fg-0)' }} /> : null}
            </div>
          );
        })}
      </div>
      <h2
        style={{
          position: 'absolute', left: 0, right: 0, top: 515, margin: 0, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 150, letterSpacing: '-0.04em', lineHeight: 1,
          color: 'var(--fg-0)', opacity: line, transform: `translateY(${(1 - line) * 70}px) scale(${0.96 + 0.04 * line})`, transformOrigin: '50% 100%',
        }}
      >
        Just pure creativity.
      </h2>
    </div>
  );
};
