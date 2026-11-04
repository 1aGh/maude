import { AbsoluteFill } from 'remotion';
import { Avatar, Cursor, Icon, Sticky } from '../../../vendor/maude-v2/_kit';
import { cameraAt, toScreen } from './camera';
import { Chip } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 6 · The whole team (46.6–53.5 s). "Bring the whole team. Everyone on one canvas, live. You
 * pay for the project, never per seat."
 *
 * The camera pulls back over all three wows on the one canvas. People arrive in screen space but
 * pinned to the world (they ride the camera's drift): cursors fly in from the edges, stickies
 * land, the project link ripples out and the faces join it. Everyone is a made-up demo person.
 */
const PEOPLE = [
  { name: 'tereza', from: [-120, 760], world: [3150, 180], at: CUE.team.people },
  { name: 'jonas', from: [2040, 120], world: [5300, -330], at: CUE.team.people + 0.35 },
  { name: 'Ada', tone: 'lilac' as const, from: [2040, 900], world: [7650, 360], at: CUE.team.people + 0.7 },
  { name: 'Kai', tone: 'coral' as const, from: [900, -120], world: [4500, -380], at: CUE.team.people + 1.0 },
];
const STICKIES = [
  { text: 'Love this cut', color: 'yellow' as const, world: [2200, -560], rot: -4, at: CUE.team.stick },
  { text: 'Ship it ✓', color: 'green' as const, world: [8250, -520], rot: 3, at: CUE.team.stick + 0.55 },
];

export const Team = () => {
  const t = useT();
  if (t < 46.8 || t > 53.8) return null;
  const cam = cameraAt(t);
  const leave = tw(t, 53.15, 53.5, 0, 1, EASE.exit);
  const link = sp(t, CUE.team.link - 0.6, 'snappy');
  return (
    <AbsoluteFill className="iv2" style={{ opacity: 1 - leave, pointerEvents: 'none' }}>
      {STICKIES.map((s) => {
        const p = toScreen(cam, s.world[0], s.world[1]);
        const k = sp(t, s.at, 'bouncy');
        return (
          <div key={s.text} style={{ position: 'absolute', left: p.x, top: p.y - (1 - Math.min(1, k)) * 80, opacity: Math.min(1, k * 2), transform: `scale(${1.25 * (1.15 - 0.15 * k)})`, transformOrigin: '50% 50%' }}>
            <Sticky color={s.color} x={0} y={0} rotate={s.rot} w={170}>{s.text}</Sticky>
          </div>
        );
      })}
      {PEOPLE.map((m) => {
        const p = toScreen(cam, m.world[0], m.world[1]);
        const k = tw(t, m.at, m.at + 0.85, 0, 1, EASE.move);
        const x = lerp(m.from[0], p.x, k);
        const y = lerp(m.from[1], p.y, k) - Math.sin(Math.PI * k) * 60;
        return (
          <div key={m.name} style={{ position: 'absolute', left: x, top: y, opacity: k > 0 ? 1 : 0, transform: 'scale(1.6)', transformOrigin: '0 0' }}>
            <Cursor name={m.name} color={m.tone} x={0} y={0} />
          </div>
        );
      })}
      {/* the project link: ripples out, the people join it */}
      <div style={{ position: 'absolute', left: 960, top: 905, transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * link})`, opacity: link }}>
        {[0, 1, 2].map((i) => {
          const r = tw(t, CUE.team.link + i * 0.22, CUE.team.link + 1.3 + i * 0.22, 0, 1, EASE.enter);
          return <i key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 420, height: 92, marginLeft: -210, marginTop: -46, borderRadius: 999, border: '3px solid var(--accent)', opacity: r > 0 ? 0.6 * (1 - r) : 0, transform: `scale(${1 + 0.9 * r}, ${1 + 1.8 * r})` }} />;
        })}
        <div className="island" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px 14px 24px', borderRadius: 999, fontSize: 24, fontWeight: 600, color: 'var(--fg-0)', background: 'var(--bg-1)', boxShadow: 'var(--shadow-lg)' }}>
          <Icon name="link" size={22} /> Studio site
          <span style={{ display: 'flex' }}>
            {[{ who: 'tereza' }, { who: 'jonas' }, { ini: 'A', tone: 'lilac' as const }, { ini: 'K', tone: 'coral' as const }, { ini: 'E', tone: 'green' as const }].map((a, i) => {
              const j = sp(t, CUE.team.people + 0.6 + i * 0.3, 'bouncy');
              return (
                <span key={i} style={{ marginLeft: i ? -8 : 0, display: 'inline-flex', borderRadius: 999, boxShadow: '0 0 0 3px var(--bg-1)', transform: `scale(${j})` }}>
                  {'who' in a ? <Avatar who={a.who} size="lg" /> : <Avatar ini={a.ini} tone={a.tone} size="lg" />}
                </span>
              );
            })}
          </span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 960, top: 1000, transform: `translate(-50%, -50%) scale(${sp(t, CUE.team.link + 0.5, 'bouncy')})` }}>
        <Chip>Per project, never per seat</Chip>
      </div>
    </AbsoluteFill>
  );
};
