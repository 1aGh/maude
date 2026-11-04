import { Avatar, Icon, Mark } from '../../../vendor/maude-v2/_kit';
import { at, SiteStage, useMs } from './stage';

/**
 * Beat 6 (43.5–50.5 s). "Maude Cloud puts your project online for everyone. You pay for the
 * project, never per seat."
 *
 * A recreation in the site's own pieces (the Cloud band's words): the project gets its link,
 * people join one after another, and "per project, never per seat" lands on the second line.
 * No price (plan Decision 8). Everyone shown is a made-up demo person.
 */
const PEOPLE = [
  { who: 'tereza' },
  { who: 'jonas' },
  { ini: 'A', tone: 'lilac' as const },
  { ini: 'K', tone: 'coral' as const },
  { ini: 'P', tone: 'green' as const },
  { ini: 'E', tone: 'sky' as const },
];

export const I2Cloud = () => {
  const ms = useMs();
  return (
    <SiteStage t0={ms}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 36,
        }}
      >
        <span
          className="ps-eyebrow ps-a"
          style={{
            fontSize: 'var(--type-lg)',
            gap: 'var(--space-3)',
            color: 'var(--fg-0)',
            fontWeight: 600,
            ...at(150),
          }}
        >
          <Mark size={44} /> Maude Cloud
        </span>
        <h2
          className="ps-h2"
          style={{ textAlign: 'center', fontSize: 'calc(var(--type-3xl) * 1.6)' }}
        >
          <span className="ps-a" style={{ display: 'inline-block', ...at(300) }}>
            Invite everyone.
          </span>
          <br />
          <span className="ps-quiet ps-a" style={{ display: 'inline-block', ...at(3500) }}>
            Pay for the project.
          </span>
        </h2>
        <div
          className="island ps-a"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 14px 12px 20px',
            borderRadius: 999,
            zoom: 1.5,
            ...at(900),
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <Icon name="link" size={16} /> Studio site
          </span>
          <span style={{ display: 'flex' }}>
            {PEOPLE.map((p, i) => {
              const d = 1300 + i * 260;
              return (
                <span
                  key={i}
                  className="ps-a ps-a--pop"
                  style={{
                    marginLeft: i ? -8 : 0,
                    borderRadius: 999,
                    boxShadow: '0 0 0 2px var(--bg-1)',
                    display: 'inline-flex',
                    ...at(d),
                  }}
                >
                  {'who' in p ? (
                    <Avatar who={p.who} size="lg" />
                  ) : (
                    <Avatar ini={p.ini} tone={p.tone} size="lg" />
                  )}
                </span>
              );
            })}
          </span>
          <span className="btn btn--primary">Share</span>
        </div>
        <span
          className="chip ps-a ps-a--pop"
          style={{ fontSize: 'var(--type-lg)', padding: '8px 18px', ...at(4300) }}
        >
          Per project, never per seat
        </span>
      </div>
    </SiteStage>
  );
};
