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

export const PRICE = {
  project: money(pricing.plans.project.monthlyMinor),
  projectYear: annual ? money(annual) : '',
  /** "two months free", as many months as the yearly price saves. */
  yearFree: freeMonths > 0 ? `${WORDS[freeMonths] ?? freeMonths} months free` : '',
  dedicated: money(pricing.plans.dedicated.monthlyMinor),
  storage: money(pricing.storage.monthlyMinor),
  storageBlockGb: pricing.storage.blockGb,
  trialDays: pricing.trialDays,
};
