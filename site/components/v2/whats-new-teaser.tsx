// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// What's new: the changelog's home on Home, not a nav link. The three newest entries of the feed.
import Link from 'next/link';
import whatsNew from '@/lib/whats-new.json';
import { Icon } from './kit/glyphs';

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The first sentence of an entry's summary: the card is a teaser, the page has the rest. */
const lead = (summary: string) => {
  const m = summary.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : summary;
};

export function WhatsNewTeaser() {
  const items = whatsNew.entries.slice(0, 3);
  return (
    <section className="ps-wrap ps-section--tight" aria-labelledby="h-rel">
      <div
        className="ps-row"
        style={{ justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}
      >
        <h2 id="h-rel" className="ps-h3">
          What's new
        </h2>
        <Link className="btn btn--ghost btn--sm" href="/changelog">
          All releases <Icon name="submenu" size={12} />
        </Link>
      </div>
      <div className="ps-grid-3">
        {items.map((e) => (
          <Link key={e.id} className="ps-card ps-rel" href="/whats-new">
            <span className="ps-rel-v">
              <span className="chip chip--accent">{e.version}</span> {day(e.date)}
            </span>
            <b>{e.title}</b>
            <span className="ps-small">{lead(e.summary)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
