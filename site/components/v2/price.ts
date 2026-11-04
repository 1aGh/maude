// Prices are never typed on a page: they come from site/lib/pricing.json, which
// site/scripts/build-pricing.mjs generates from apps/cloud/pricing.json.
import pricing from '@/lib/pricing.json';

const SYMBOL: Record<string, string> = { eur: '€' };

export const money = (minor: number): string => {
  const v = minor / 100;
  return `${SYMBOL[pricing.currency] ?? ''}${Number.isInteger(v) ? v : v.toFixed(2)}`;
};

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const annual = pricing.plans.project.annualMinor ?? 0;
const freeMonths = annual ? 12 - Math.round(annual / pricing.plans.project.monthlyMinor) : 0;

const monthly = pricing.plans.project.monthlyMinor;

export const PRICE = {
  project: money(pricing.plans.project.monthlyMinor),
  projectYear: annual ? money(annual) : '',
  /** "two months free", as many months as the yearly price saves. */
  yearFree: freeMonths > 0 ? `${WORDS[freeMonths] ?? freeMonths} months free` : '',
  /** What the yearly price saves against twelve monthly ones, in whole percent. */
  yearSavePct: annual ? Math.round((1 - annual / (monthly * 12)) * 100) : 0,
  projectGb: pricing.plans.project.includedStorageGb,
  dedicated: money(pricing.plans.dedicated.monthlyMinor),
  dedicatedGb: pricing.plans.dedicated.includedStorageGb,
  /** The Cloud Project's monthly price with Czech VAT (21 %), the worked example on the pricing page. */
  projectCz: money(Math.round(monthly * 1.21)),
  trialDays: pricing.trialDays,
};
