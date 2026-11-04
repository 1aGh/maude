import { CUE, EASE, sp, tw, useT } from './motion';

/**
 * Beat 5 · No handoff (38.5–46.6 s). "No handoff. No final_v7_really_final. Just pure creativity."
 *
 * A dark artboard on the same canvas (the camera dives into it). The handoff file names stack
 * up; each is struck on a hard stop (a strike line snaps across, the name jolts and dims); then
 * "Just pure creativity." lands. Kinetic type only: no AI here, so no spark.
 */
export const NH = { x: 6750, y: 910, w: 2100, h: 1180 };
const FILES = [
  { name: 'handoff_notes.pdf', in: 38.9, strike: CUE.nh.s1 },
  { name: 'specs_v3.fig', in: 39.25, strike: CUE.nh.s2 },
  { name: 'final_v7_really_final.fig', in: 40.75, strike: CUE.nh.s3 },
];

export const NoHandoff = () => {
  const t = useT();
  if (t < 37.5) return null;
  const line = sp(t, CUE.nh.line, 'snappy');
  const filesOut = tw(t, CUE.nh.line - 0.1, CUE.nh.line + 0.35, 0, 1, EASE.exit);
  return (
    <div className="maude-v2" data-theme="dark" style={{ position: 'absolute', left: NH.x, top: NH.y, width: NH.w, height: NH.h, borderRadius: 28, background: 'var(--bg-0)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
      <div style={{ position: 'absolute', left: 260, top: 300, display: 'flex', flexDirection: 'column', gap: 34, opacity: 1 - filesOut, transform: `translateY(${-filesOut * 60}px)` }}>
        {FILES.map((f) => {
          const k = sp(t, f.in, 'snappy');
          const s = tw(t, f.strike, f.strike + 0.12, 0, 1, (n) => n);
          const jolt = Math.sin(Math.PI * tw(t, f.strike, f.strike + 0.16, 0, 1, (n) => n)) * 10;
          return (
            <div key={f.name} style={{ position: 'relative', alignSelf: 'flex-start', opacity: k, transform: `translate(${jolt}px, ${(1 - k) * 40}px)` }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 64, color: s > 0 ? 'var(--fg-3)' : 'var(--fg-0)', whiteSpace: 'nowrap' }}>{f.name}</span>
              <i style={{ position: 'absolute', left: -10, top: '52%', height: 7, width: `calc(${s * 100}% + ${20 * s}px)`, borderRadius: 4, background: 'var(--fg-0)' }} />
            </div>
          );
        })}
      </div>
      <h2
        style={{
          position: 'absolute', left: 250, top: 420, margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 150, letterSpacing: '-0.04em', lineHeight: 1,
          color: 'var(--fg-0)', opacity: line, transform: `translateY(${(1 - line) * 70}px) scale(${0.96 + 0.04 * line})`, transformOrigin: '0 100%',
        }}
      >
        Just pure creativity.
      </h2>
    </div>
  );
};
