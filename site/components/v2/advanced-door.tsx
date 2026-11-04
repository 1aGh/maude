// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// Advanced keeps its own door: nothing from the old catalog is dropped.
import Link from 'next/link';
import { CATALOG } from '@/lib/catalog';
import { Icon } from './kit/glyphs';

export function AdvancedDoor() {
  return (
    <section id="advanced" className="ps-wrap ps-section--tight" aria-labelledby="h-adv">
      <div className="ps-adv">
        <div className="ps-head" style={{ marginBottom: 0 }}>
          <span className="ps-chip-adv">
            <Icon name="terminal" size={12} /> Advanced
          </span>
          <h3 id="h-adv" className="ps-h3">
            Live in a terminal? It's all still here.
          </h3>
          <p className="ps-body">
            The Mac app runs on two Claude Code plugins and a CLI. Use them on their own, with the
            same files and the same design system.
          </p>
          <Link className="btn btn--sm" href="/docs#advanced" style={{ alignSelf: 'flex-start' }}>
            Open the Advanced docs
          </Link>
        </div>
        <div className="ps-grid-2">
          {CATALOG.map((item) => (
            <div key={item.slug} className="ps-adv-item">
              <b>
                <Link href={item.docs}>{item.slug}</Link>
              </b>
              <span className="ps-small">{item.summary}</span>
              <span className="ps-mono">{item.install}</span>
              <span className="ps-small ps-adv-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
