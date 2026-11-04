// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The Buy CTA: one dark band, the price in the open, two actions.
import Link from 'next/link';
import { Icon, Mark } from './kit/glyphs';
import { CLOUD_CTA_ON, PILOT_FINE } from './pilot';
import { PRICE } from './price';

export function CloudBand() {
  return (
    <section className="ps-wrap ps-section--tight" aria-labelledby="h-cloud">
      <div className="ps-band">
        <div className="ps-head" style={{ marginBottom: 0 }}>
          <span
            className="ps-eyebrow"
            style={{ color: 'var(--bg-3)', fontSize: 'var(--type-md)', gap: 'var(--space-3)' }}
          >
            <Mark size={44} /> Maude Cloud
          </span>
          <h2 id="h-cloud" className="ps-h2">
            Invite everyone. Pay for the project.
          </h2>
          <p className="ps-body">
            Your project online with its own address. Invite everyone who needs it, never pay per
            seat, and they open it in the app or the browser.
          </p>
          <div className="ps-row" style={{ marginTop: 'var(--space-3)' }}>
            {CLOUD_CTA_ON ? (
              <Link className="btn btn--primary btn--lg" href="/cloud">
                Get Maude Cloud
              </Link>
            ) : null}
            <Link
              className={`btn btn--lg ${CLOUD_CTA_ON ? 'btn--ghost' : 'btn--primary'}`}
              href="/cloud#pricing"
            >
              See pricing
            </Link>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="ps-band-price">
            <b>{PRICE.project}</b>
            <span>a month per project</span>
          </div>
          <ul className="ps-band-list">
            <li>
              <Icon name="people" size={14} /> Everyone you invite is included
            </li>
            <li>
              <Icon name="history" size={14} /> Full history and one-click export
            </li>
            <li>
              <Icon name="sync" size={14} /> An automatic copy in your own GitHub
            </li>
          </ul>
          <span className="ps-fine">
            {PILOT_FINE}Prices without VAT. {PRICE.projectYear} a year, {PRICE.yearFree}. The first{' '}
            {PRICE.trialDays} days are free, then it renews until you cancel. AI runs on your own
            Claude account.
          </span>
        </div>
      </div>
    </section>
  );
}
