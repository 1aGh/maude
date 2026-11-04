import { Fragment } from 'react';
import { at, SiteStage, useMs } from './stage';

/**
 * Beat 1 (0–5 s). "You like Figma. You like Claude. Meet Maude."
 *
 * The site's hero headline as a selected text layer on the canvas (Public Site v2 · HeroHeadline):
 * the lines land on the VO, the layer tag pops, then the weight bubble (semibold → heavy) runs
 * through "Meet Maude." the way it follows the pointer on the site.
 */
const LINES = [
  { t: 'You like Figma.', quiet: true, d: 300 },
  { t: 'You like Claude.', quiet: true, d: 1750 },
  { t: 'Meet Maude.', quiet: false, d: 3050 },
];

/** Weight of letter i while the bubble's centre sits at letter p (both in letter units). */
const bubble = (i: number, p: number) => {
  const k = Math.max(0, 1 - Math.abs(i - p) / 2.2);
  return Math.round(600 + 300 * k * k * (3 - 2 * k));
};

export const I2Headline = () => {
  const ms = useMs();
  // The bubble sweeps through "Meet Maude." from 3.55 s to 4.75 s and leaves it semibold again.
  const p = ms < 3550 ? -10 : -2.5 + ((ms - 3550) / 1200) * 15;
  return (
    <SiteStage t0={ms}>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div className="ps-play" style={{ marginTop: 0 }}>
          <div className="ps-layer ps-bubble">
            <i />
            <i />
            <i />
            <i />
            <span className="ps-layer-tag ps-a ps-a--pop" style={at(3450)} aria-hidden="true">
              Text · Display
            </span>
            <h1 className="ps-h1">
              {LINES.map((l, j) => (
                <Fragment key={j}>
                  <span
                    className={`${l.quiet ? 'ps-quiet ' : ''}ps-a`}
                    style={{ display: 'inline-block', ...at(l.d) }}
                  >
                    {Array.from(l.t).map((c, i) => (
                      <span key={i} style={j === 2 ? { fontWeight: bubble(i, p) } : undefined}>
                        {c}
                      </span>
                    ))}
                  </span>
                  {j < LINES.length - 1 ? <br /> : null}
                </Fragment>
              ))}
            </h1>
          </div>
        </div>
      </div>
    </SiteStage>
  );
};
