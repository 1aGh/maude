// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// Honest proof for a young indie tool: what can be checked, no borrowed logos.
import stats from '@/lib/stats.json';
import { Icon, Mark } from './kit/glyphs';

const since = new Date(`${stats.firstReleaseDate}T00:00:00Z`).toLocaleDateString('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function Proof() {
  return (
    <section className="ps-wrap ps-proof" aria-label="Facts about Maude">
      <span>
        <Icon name="history" size={16} /> <b>{stats.releases} releases</b> since {since}
      </span>
      <span>
        <Icon name="file" size={16} /> <b>MIT</b> license, source on GitHub
      </span>
      <span>
        <Icon name="eye-off" size={16} /> <b>No telemetry</b>, no signup to start
      </span>
      <span>
        <Mark size={16} /> Made in <b>Brno</b>
      </span>
    </section>
  );
}
