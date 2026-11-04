import { Fragment } from 'react';
import { Spark } from '../../../vendor/maude-v2/_kit';
import { CUE, EASE, sp, tw, useT } from './motion';

/**
 * Beat 1 · Hook (0–6.4 s). "You like Figma. You like Claude. Meet Maude. A canvas with an AI
 * that actually does stuff."
 *
 * The headline is a selected text layer on the canvas (the site's hero). The lines land one by
 * one on the VO; on "actually does stuff" the AI takes the layer: the frame turns spark and a
 * weight wave runs through "Meet Maude." (the AI cursor that does it is the travelling spark).
 */
const LINES = [
  { t: 'You like Figma.', quiet: true, at: CUE.hook.l1 },
  { t: 'You like Claude.', quiet: true, at: CUE.hook.l2 },
  { t: 'Meet Maude.', quiet: false, at: CUE.hook.l3 },
];

/** Weight of letter i while the AI's wave sits at letter p. */
const weight = (i: number, p: number) => {
  const k = Math.max(0, 1 - Math.abs(i - p) / 2.4);
  return Math.round(700 + 200 * k * k * (3 - 2 * k));
};

export const HOOK_BOX = { x: -520, y: -205, w: 1040, h: 410 };

export const Hook = () => {
  const t = useT();
  if (t > 7.5) return null; // off camera from the first whip on
  const box = sp(t, 0.05, 'calm');
  const ai = tw(t, CUE.hook.edit, CUE.hook.edit + 0.25);
  const p = -3 + tw(t, CUE.hook.edit + 0.1, CUE.hook.edit + 1.2, 0, 1, EASE.move) * 16;
  const B = HOOK_BOX;
  const handle = (l: number, tp: number) => (
    <i style={{ position: 'absolute', left: l - 7, top: tp - 7, width: 14, height: 14, borderRadius: 3, background: 'var(--bg-1)', border: `2px solid ${ai ? 'var(--spark)' : 'var(--accent)'}` }} />
  );
  return (
    <div style={{ position: 'absolute', left: B.x, top: B.y, width: B.w, height: B.h }}>
      {/* the selection frame draws in from its centre */}
      <div style={{ position: 'absolute', inset: 0, opacity: box, transform: `scale(${0.96 + 0.04 * box})` }}>
        <div style={{ position: 'absolute', inset: 0, border: `2px solid ${ai ? 'var(--spark)' : 'var(--accent)'}`, borderRadius: 6, boxShadow: ai ? '0 0 0 8px var(--spark-muted)' : undefined }} />
        {handle(0, 0)}
        {handle(B.w, 0)}
        {handle(0, B.h)}
        {handle(B.w, B.h)}
        <span
          style={{
            position: 'absolute', right: -14, top: -56, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6,
            fontWeight: 600, fontSize: 20, color: ai ? 'var(--spark-fg)' : 'var(--accent-fg)', background: ai ? 'var(--spark)' : 'var(--accent)',
            transform: `scale(${sp(t, 0.4, 'snappy')})`, transformOrigin: '100% 100%',
          }}
        >
          {ai ? <><Spark size={14} color="currentColor" /> AI is editing</> : 'Text · Display'}
        </span>
      </div>
      <h1
        style={{
          position: 'absolute', inset: 0, margin: 0, padding: '0 46px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 112, lineHeight: 1.04, letterSpacing: '-0.035em', color: 'var(--fg-0)',
        }}
      >
        {LINES.map((l, j) => {
          const k = sp(t, l.at, 'snappy');
          return (
            <span key={j} style={{ display: 'block', whiteSpace: 'nowrap', color: l.quiet ? 'var(--fg-1)' : undefined, opacity: k, transform: `translateY(${(1 - k) * 34}px)` }}>
              {Array.from(l.t).map((c, i) => (
                <Fragment key={i}>
                  <span style={j === 2 ? { fontWeight: weight(i, p) } : undefined}>{c}</span>
                </Fragment>
              ))}
            </span>
          );
        })}
      </h1>
    </div>
  );
};
