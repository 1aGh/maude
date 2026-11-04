'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Tick } from './tick';

type Props = {
  monthly: string;
  yearly: string;
  /** "two months free" */
  yearFree: string;
  savePct: number;
  gb: number;
  href: string;
};

/** The Cloud Project card: the Monthly/Yearly switch changes the price, its unit and the line under the button. */
export function ProjectPlan({ monthly, yearly, yearFree, savePct, gb, href }: Props) {
  const [yearlyOn, setYearlyOn] = useState(false);
  return (
    <article className="ps-card ps-plan" data-pick="true" aria-labelledby="plan-project">
      <span className="ps-row" style={{ justifyContent: 'space-between' }}>
        <span id="plan-project" className="ps-who" style={{ color: 'var(--accent-text)' }}>
          Cloud Project
        </span>
        <span className="chip chip--accent">Most teams</span>
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: the canvas's segmented control is a button group */}
      <span className="seg" role="group" aria-label="Billing for Cloud Project">
        <button type="button" aria-pressed={!yearlyOn} onClick={() => setYearlyOn(false)}>
          Monthly
        </button>
        <button type="button" aria-pressed={yearlyOn} onClick={() => setYearlyOn(true)}>
          Yearly <span className="ps-save">−{savePct}%</span>
        </button>
      </span>
      <div className="ps-price" aria-live="polite">
        <b>{yearlyOn ? yearly : monthly}</b>
        <span>{yearlyOn ? 'a year per project' : 'a month per project'}</span>
      </div>
      <p className="ps-body">One project online, with everyone you invite included.</p>
      <ul className="ps-ticks">
        <Tick>People, roles and invitations</Tick>
        <Tick>{gb} GB of media included</Tick>
        <Tick>Full history and one-click export</Tick>
        <Tick>An automatic copy in your own GitHub</Tick>
      </ul>
      <Link className="btn btn--primary btn--lg" href={href}>
        Get Maude Cloud
      </Link>
      <span className="ps-small" style={{ textAlign: 'center' }}>
        {yearlyOn ? `Monthly: ${monthly} a month` : `Yearly: ${yearly}, ${yearFree}`}
      </span>
    </article>
  );
}
