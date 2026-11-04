import { Mark } from '../../../vendor/maude-v2/_kit';
import { SiteStage, at, useMs } from './stage';

/**
 * Beat 7 (50.5–60 s). "Maude. Built around AI, not bent to fit one. Free to download at maude.sh."
 *
 * The end card: the Mark, the positioning line, the address and the Download button. It settles
 * by ~5 s and holds; the poster JPG is taken from its last frame.
 */
export const I2EndCard = () => {
  const ms = useMs();
  return (
    <SiteStage t0={ms}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <span className="ps-brand ps-a ps-a--pop" style={{ fontSize: 76, gap: 22, ...at(200) }}>
          <Mark size={96} /> maude
        </span>
        <p className="ps-h2 ps-a" style={{ textAlign: 'center', fontSize: 'calc(var(--type-3xl) * 1.15)', ...at(1300) }}>
          Built around AI, <span className="ps-quiet">not bent to fit one.</span>
        </p>
        <div className="ps-a" style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, zoom: 1.35, ...at(4600) }}>
          <span className="btn btn--primary btn--lg">Download free</span>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--type-xl)' }}>maude.sh</span>
        </div>
      </div>
    </SiteStage>
  );
};
