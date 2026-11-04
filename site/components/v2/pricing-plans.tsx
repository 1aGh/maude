// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The three plans. Every amount comes from PRICE (generated from apps/cloud/pricing.json).
import Link from 'next/link';
import { ProjectPlan } from './billing-toggle.client';
import { Spark } from './kit/glyphs';
import { CLOUD_START } from './pilot';
import { PRICE } from './price';
import { Tick } from './tick';

export function PricingPlans() {
  return (
    <section id="pricing" className="ps-wrap" aria-labelledby="h-plans">
      <h2
        id="h-plans"
        className="ps-h3"
        style={{ textAlign: 'center', marginBottom: 'var(--space-5)' }}
      >
        Pricing
      </h2>
      <div className="ps-plans">
        <article className="ps-card ps-plan" aria-labelledby="plan-self">
          <span id="plan-self" className="ps-who">
            Self-host
          </span>
          <div className="ps-price">
            <b>Free</b>
            <span>forever</span>
          </div>
          <p className="ps-body">The same software on your own box. Nothing taken out.</p>
          <ul className="ps-ticks">
            <Tick>Everything in Maude Cloud</Tick>
            <Tick>Your server, your backups</Tick>
            <Tick>One command to stand it up</Tick>
          </ul>
          <Link className="btn btn--lg" href="/docs/hub">
            Read the setup guide
          </Link>
        </article>

        <ProjectPlan
          monthly={PRICE.project}
          yearly={PRICE.projectYear}
          yearFree={PRICE.yearFree}
          savePct={PRICE.yearSavePct}
          gb={PRICE.projectGb}
          href={CLOUD_START}
        />

        <article className="ps-card ps-plan" aria-labelledby="plan-dedicated">
          <span id="plan-dedicated" className="ps-who">
            Dedicated
          </span>
          <div className="ps-price">
            <b>{PRICE.dedicated}</b>
            <span>a month</span>
          </div>
          <p className="ps-body">A pinned instance for a team that needs its own.</p>
          <ul className="ps-ticks">
            <Tick>Everything in Cloud Project</Tick>
            <Tick>{PRICE.dedicatedGb} GB of media included</Tick>
            <Tick>Region pinning and a custom domain</Tick>
            <Tick>Priority support</Tick>
          </ul>
          <Link className="btn btn--lg" href={CLOUD_START}>
            Get Dedicated
          </Link>
          <span className="ps-small" style={{ textAlign: 'center' }}>
            monthly only
          </span>
        </article>
      </div>
      <p className="ps-small" style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
        Prices shown without VAT. For individuals: {PRICE.projectCz} a month including 21 % Czech
        VAT. Other EU countries pay their own rate, shown before you pay. Businesses with a VAT id
        pay {PRICE.project} (reverse charge). Payment is handled by our merchant of record, Lemon
        Squeezy (Sold through Link), who add the VAT and show the total before you enter a card.
      </p>
      <p className="ps-small" style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
        The first {PRICE.trialDays} days are free. If you start through checkout, your card is saved
        and checked but not charged. After the trial the plan renews automatically until you cancel,
        and you can stop any time before the trial ends. Starting from the desktop app needs no
        card.
      </p>
      <div className="ps-ai-note">
        <span className="ps-ico ps-ico--ai">
          <Spark size={16} />
        </span>
        <span>
          <b>AI runs on your own Claude account</b>, about €20 a month, paid to Anthropic on their
          terms. Maude never resells it and gets no part of it.
        </span>
      </div>
    </section>
  );
}
