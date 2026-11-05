import { Mark, Spark } from '../../../vendor/maude-v2/_kit';
import { CUE, EASE, sp, tw, useT } from './motion';

/**
 * Beat 8 · End card (63.2–70.5 s). "Maude. Built around AI, not bent to fit one. Free to download
 * at maude.sh."
 *
 * The Mark and "maude" land on "Maude."; the line rises in; on "one." the spark flies in on an
 * arc and lands as the line's full stop (the AI's signature, one last time); then Download free
 * and maude.sh. It settles by ~68 s and holds (the poster is its last frame).
 */
export const EndCard = () => {
  const t = useT();
  if (t < 62.0) return null;
  const { mark, line, stop, cta } = CUE.end;
  const m = sp(t, mark, 'bouncy');
  const word = sp(t, mark + 0.12, 'snappy');
  const l = sp(t, line, 'snappy');
  const fly = tw(t, stop - 0.75, stop, 0, 1, EASE.move);
  const land = sp(t, stop, 'pop'); // the full stop: one of the film's two big overshoots
  // after the CTA, the full stop breathes (1 Hz) so the held poster frame is never dead
  const glow = tw(t, cta + 1.2, cta + 1.8) * (0.5 - 0.5 * Math.cos((t - cta - 1.2) * Math.PI * 2));
  const c = sp(t, cta, 'snappy');
  return (
    <div
      style={{
        position: 'absolute',
        left: 5200,
        top: 1500,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 34,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 26 }}>
        <span
          style={{
            display: 'inline-flex',
            transform: `scale(${m}) rotate(${(1 - Math.min(1, m)) * -20}deg)`,
          }}
        >
          <Mark size={132} />
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 132,
            letterSpacing: '-0.04em',
            color: 'var(--fg-0)',
            opacity: word,
            transform: `translateX(${(1 - word) * -30}px)`,
          }}
        >
          maude
        </span>
      </span>
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 60,
          letterSpacing: '-0.02em',
          color: 'var(--fg-0)',
          opacity: l,
          transform: `translateY(${(1 - l) * 30}px)`,
          whiteSpace: 'nowrap',
        }}
      >
        Built around AI, <span style={{ color: 'var(--fg-2)' }}>not bent to fit one</span>
        {/* the spark lands as the full stop: it flies in on an arc from the upper left */}
        <span style={{ display: 'inline-block', width: 50, position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 6,
              bottom: 4,
              display: 'inline-flex',
              opacity: fly > 0 ? 1 : 0,
              transform: `translate(${(1 - fly) * -720}px, ${(1 - fly) * -260 - Math.sin(Math.PI * fly) * 160}px) rotate(${(1 - fly) * -150}deg) scale(${fly < 1 ? 1.35 : 1 + 0.35 * (1 - land)})`,
              filter:
                glow > 0.01 ? `drop-shadow(0 0 ${4 + 10 * glow}px var(--spark-muted))` : undefined,
            }}
          >
            <Spark size={40} />
          </span>
        </span>
      </p>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 24,
          opacity: c,
          transform: `translateY(${(1 - c) * 24}px)`,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 76,
            padding: '0 34px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            fontWeight: 700,
            fontSize: 30,
          }}
        >
          Download free
        </span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 40,
            color: 'var(--fg-0)',
          }}
        >
          maude.sh
        </span>
      </span>
    </div>
  );
};
