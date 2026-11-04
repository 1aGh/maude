// Ported once from .design/ui/Public Site v2.tsx (CloudPage) on 2026-11-04; site/ is the source now.
// Numbers come from apps/cloud/pricing.json through lib/pricing.json: nothing here types a price.
import type { Metadata } from 'next';
import Link from 'next/link';
import { DownloadLabel } from '@/components/v2/download-label.client';
import { Icon } from '@/components/v2/kit/glyphs';
import { CLOUD_START, PilotBadge } from '@/components/v2/pilot';
import { PRICE } from '@/components/v2/price';
import { PricingPlans } from '@/components/v2/pricing-plans';

export const metadata: Metadata = {
  title: 'Maude Cloud and pricing',
  description: `Your project online for the whole team. ${PRICE.project} a month per project, never per seat; self-host it for free.`,
  alternates: { canonical: '/cloud' },
};

const FAQ: [string, string][] = [
  [
    'What counts as a project?',
    'One shared Maude project: all its canvases, its design system, its people and its history. Make as many canvases inside it as you like.',
  ],
  [
    'Do I pay for each person I invite?',
    'No. Everyone you invite is included, whatever their role.',
  ],
  [
    'Do I need a Claude subscription?',
    "For AI, yes. You connect your own Claude account. We don't resell it and get no part of it.",
  ],
  [
    'Is self-hosting a smaller version?',
    "No. It's the same software, and the hosting costs are published in the docs.",
  ],
  [
    'Who can open a Cloud project?',
    'Anyone you invite, in the Mac app or in the browser. You choose who can edit, comment or view.',
  ],
  [
    'Can I leave?',
    'Yes. Export the whole project in one click, and your GitHub copy is always there.',
  ],
];

const COMPARE: [string, string, string][] = [
  ['Who runs the server', 'You, with one command', 'We do'],
  ['Updates', 'When you pull a new release', 'Automatic'],
  ['Backups', 'Your own backup target', 'Included, with full history'],
  ['Your address', 'Your own domain', 'Its own address on Maude Cloud'],
  ['Leaving', "It's already yours", 'One-click export, plus your GitHub copy'],
];

export default function CloudPage() {
  return (
    <main id="main-content">
      <section className="ps-wrap ps-hero" aria-labelledby="h-cloudp">
        <PilotBadge />
        <h1 id="h-cloudp" className="ps-h1 ps-h1--xl">
          Your project online.
          <br />
          <span className="ps-quiet">For the whole team.</span>
        </h1>
        <p className="ps-lede">
          Maude Cloud keeps your project on its own address, with people, roles and full history.
          Pay per project, never per seat, and invite everyone who needs it.
        </p>
      </section>

      <PricingPlans />

      <section className="ps-wrap ps-section" aria-labelledby="h-seat">
        <div className="ps-card ps-vs" style={{ padding: 'var(--space-6)' }}>
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-eyebrow">Per project, never per seat</span>
            <h2 id="h-seat" className="ps-h2 ps-h2--lg">
              Inviting people is the point. So it's free.
            </h2>
            <p className="ps-body">A team of five on one project pays the same as a team of one.</p>
          </div>
          <div
            className="ps-bars"
            role="img"
            aria-label={`Monthly cost for five people on one project: Maude Cloud ${PRICE.project}, a per-seat tool five times its seat price`}
          >
            <div className="ps-bar" data-you="true">
              <span>Maude Cloud</span>
              <span>
                <i className="ps-r ps-r--grow" style={{ width: '24%' }} />
              </span>
              <b>{PRICE.project}</b>
            </div>
            <div className="ps-bar">
              <span>Per-seat tool</span>
              <span>
                <i className="ps-r ps-r--grow" style={{ width: '100%' }} />
              </span>
              <b>5 × a seat</b>
            </div>
            <span className="ps-small">
              Five people, one project, one month. Add a sixth person: Maude Cloud stays{' '}
              {PRICE.project}.
            </span>
          </div>
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-host">
        <div className="ps-head ps-center">
          <span className="ps-eyebrow">Same software, two ways to run it</span>
          <h2 id="h-host" className="ps-h2 ps-h2--lg">
            Self-host it, or let us run it.
          </h2>
        </div>
        <table className="ps-compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="ps-sr">Question</span>
              </th>
              <th scope="col">Self-host · free</th>
              <th scope="col">Maude Cloud · {PRICE.project}</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map(([q, a, b]) => (
              <tr key={q}>
                <td>{q}</td>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ps-trust" style={{ marginTop: 'var(--space-6)' }}>
          <span>
            <Icon name="export" size={16} /> Leave any time, with everything
          </span>
          <span>
            <Icon name="sync" size={16} /> A copy in your own GitHub
          </span>
          <span>
            <Icon name="lock" size={16} /> An isolated workspace per project
          </span>
          <span>
            <Icon name="server" size={16} /> Or self-host it, for free
          </span>
        </div>
      </section>

      <section className="ps-wrap ps-section" aria-labelledby="h-faq">
        <h2 id="h-faq" className="ps-h2 ps-h2--lg" style={{ marginBottom: 'var(--space-6)' }}>
          Questions
        </h2>
        <div className="ps-faq">
          {FAQ.map(([q, a]) => (
            <details key={q} className="ps-q">
              <summary>{q}</summary>
              <p className="ps-body">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-cloud-cta">
        <div className="ps-band ps-band--cta">
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <h2 id="h-cloud-cta" className="ps-h2 ps-h2--lg">
              Start a Cloud project.
            </h2>
            <p className="ps-body">
              Move a project from your Mac in the Share sheet, or start a new one here.
            </p>
          </div>
          <div className="ps-row">
            <Link className="btn btn--primary btn--lg" href={CLOUD_START}>
              Get Maude Cloud
            </Link>
            <Link className="btn btn--ghost btn--lg" href="/desktop">
              <DownloadLabel />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
