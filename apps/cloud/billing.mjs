// Billing, answered on the billing page — Cloud Phase 24 A10 + A11 + D2.
//
// WHAT CHANGED AND WHY. The billing page used to be one state card and a door
// into Stripe's portal. That is defensible for anything that *changes* money —
// it is the customer's billing relationship and they should hold it directly —
// but it made three ordinary questions into a two-hop journey through somebody
// else's product:
//
//   "where is my receipt for the accountant"   → the invoice list, here
//   "put the club's VAT id on the invoice"     → billing details, here
//   "what happens to my designs if I stop"     → the cancel ladder, here
//
// The third is the one that cannot live at Stripe at all: Stripe's cancel
// button knows nothing about the project, so it leaves through a door that
// cannot answer the only question that matters.
//
// PURE, AND SEPARATE FROM THE EFFECTS (DDR-196 §1). Everything here takes what
// Stripe said and returns what to show or what to send. The route module does
// the fetching. That is what makes the date arithmetic behind a deletion
// countdown a unit test rather than a thing we find out about from a customer.

import { SUSPEND_RETENTION_DAYS } from './reconcile.mjs';

const DAY_MS = 24 * 3600_000;

/**
 * THE RETENTION NUMBER, IN ONE PLACE.
 *
 * Cloud Phase 24 A11 proposed seven days. It is deliberately NOT seven: the
 * Trust page already publishes "data is retained 30 days" and the reconciler
 * already enforces `SUSPEND_RETENTION_DAYS = 30`. Shortening a published
 * retention promise is the exact breach A11 warns about, so the ladder adopts
 * the number that is already promised rather than inventing a shorter one, and
 * imports it rather than restating it — two places that both "know" this
 * number is how the screen and the reconciler come to disagree.
 *
 * Changing it is a DDR, not an edit.
 */
export const RETENTION_DAYS = SUSPEND_RETENTION_DAYS;

/**
 * THE A3 TRIAL (Maude v2 S9.15): 14 days, no card, from the account's first
 * sign-in. The number pricing.json advertises (`trialDays`); a test holds the
 * two equal.
 */
export const TRIAL_DAYS = 14;

/**
 * How many trial WORKSPACES one verified e-mail address may start.
 *
 * The run's recorded default (`.ai/state/v2-waiting-for-michal.md`). The abuse
 * policy is Michal's decision before any live rollout — change it HERE, the
 * one place every check reads it from.
 */
export const TRIALS_PER_VERIFIED_EMAIL = 1;

/**
 * Where an account's trial stands. Pure.
 *
 * @param {{ trial_started_at?: number | null } | null} account
 * @returns {{ state: 'none'|'trialing'|'ended', startedAt: number|null, endsAt: number|null, daysLeft: number }}
 */
export function trialView(account, { now = Date.now() } = {}) {
  const startedAt = account?.trial_started_at ?? null;
  if (startedAt === null) {
    return { state: 'none', startedAt: null, endsAt: null, daysLeft: TRIAL_DAYS };
  }
  const endsAt = startedAt + TRIAL_DAYS * DAY_MS;
  if (now >= endsAt) return { state: 'ended', startedAt, endsAt, daysLeft: 0 };
  return { state: 'trialing', startedAt, endsAt, daysLeft: Math.ceil((endsAt - now) / DAY_MS) };
}

/** `1753...` ms → `28 August 2026`. The one date format a customer sees. */
export function formatDay(ms) {
  return new Date(Number(ms)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Minor units + ISO currency → what a person reads on an invoice. */
export function money(minor, currency = 'eur') {
  const symbol = { eur: '€', usd: '$', gbp: '£', czk: 'Kč ' }[String(currency).toLowerCase()];
  const amount = (Number(minor ?? 0) / 100).toFixed(2);
  return symbol ? `${symbol}${amount}` : `${amount} ${String(currency).toUpperCase()}`;
}

/**
 * Stripe's invoice list → the rows this page renders.
 *
 * Drafts are dropped: an invoice that has not been issued is not a receipt,
 * and showing one invites somebody to hand their accountant a number that has
 * not happened yet. Anything with no PDF is dropped for the same reason.
 */
export function invoiceRows(invoices = []) {
  return invoices
    .filter((i) => i && i.status !== 'draft' && i.invoice_pdf)
    .map((i) => ({
      id: String(i.id),
      at: Number(i.created ?? 0) * 1000,
      description: i.lines?.data?.[0]?.description ?? 'Subscription',
      amount: money(i.total, i.currency),
      pdf: String(i.invoice_pdf),
      // `open` means issued and unpaid — worth saying, because an unpaid
      // invoice is the reason a project is about to pause.
      unpaid: i.status === 'open',
    }))
    .sort((a, b) => b.at - a.at);
}

// ------------------------------------------------------------ billing details

/** Two letters, then 2–13 more characters — the loose shape of every EU VAT id. */
const VAT_SHAPE = /^[A-Z]{2}[A-Z0-9]{2,13}$/;
const COUNTRY_SHAPE = /^[A-Z]{2}$/;

/**
 * What goes on the invoice, checked before it is sent anywhere.
 *
 * Structured rather than one free-text address line, because this is also what
 * Stripe Tax reads to decide the VAT rate (D2) — and a tax engine cannot parse
 * "Sportovní 12, 602 00 Brno" into a country.
 *
 * Everything is optional EXCEPT the country when anything else is given: a
 * partial address that Stripe Tax cannot place is worse than none, because it
 * looks answered.
 */
export function validateBillingDetails(input = {}) {
  const clean = (v, max = 120) =>
    String(v ?? '')
      .trim()
      .slice(0, max);
  const details = {
    company: clean(input.company),
    line1: clean(input.line1),
    city: clean(input.city, 80),
    postalCode: clean(input.postalCode, 20),
    country: clean(input.country, 2).toUpperCase(),
    vatId: clean(input.vatId, 20)
      .toUpperCase()
      .replace(/[\s.-]/g, ''),
  };
  const anything = Object.values(details).some(Boolean);
  const errors = [];

  if (anything && !details.country) {
    errors.push('Country is needed — it decides which VAT applies.');
  }
  if (details.country && !COUNTRY_SHAPE.test(details.country)) {
    errors.push('Country must be a two-letter code, like CZ or DE.');
  }
  if (details.vatId && !VAT_SHAPE.test(details.vatId)) {
    errors.push('That does not look like a VAT id — they start with two letters, like CZ26547891.');
  }
  if (details.vatId && details.country && !details.vatId.startsWith(details.country)) {
    errors.push('The VAT id and the country do not match.');
  }
  return { ok: errors.length === 0, errors, details };
}

/**
 * Billing details → the form fields Stripe's customer update wants.
 *
 * An emptied field is sent as an empty string rather than omitted: omitting it
 * leaves the old value in place, which means a customer who clears their
 * company name watches it come straight back.
 */
export function customerParams(details) {
  return {
    name: details.company,
    'address[line1]': details.line1,
    'address[city]': details.city,
    'address[postal_code]': details.postalCode,
    'address[country]': details.country,
  };
}

/** The VAT id Stripe currently holds for this customer, or null. */
export function currentVatId(taxIds = []) {
  const found = taxIds.find((t) => t?.value);
  return found ? { id: String(found.id), value: String(found.value) } : null;
}

// ------------------------------------------------------------- the cancel ladder

/**
 * Every date the cancel screen must show BEFORE the click (canvas board E0).
 *
 * Two dates and one number answer the whole question: it works until X, it
 * pauses then, and the data goes X + retention. A countdown to a deletion is
 * only honest if the deletion actually happens — which is why B4 (purge the
 * bytes) is this item's hard dependency and not a nicety.
 *
 * @param {number|null} periodEndMs  when the paid period ends (Stripe)
 * @returns {{worksUntil: number, pausesOn: number, deletedOn: number,
 *            retentionDays: number, daysLeft: number}}
 */
export function cancelSchedule({
  periodEndMs,
  now = Date.now(),
  retentionDays = RETENTION_DAYS,
} = {}) {
  // No period end (a project that never billed) means the pause is immediate.
  // Saying "it keeps working until —" would be worse than saying "now".
  const worksUntil = Number(periodEndMs) > now ? Number(periodEndMs) : now;
  const deletedOn = worksUntil + retentionDays * DAY_MS;
  return {
    worksUntil,
    pausesOn: worksUntil,
    deletedOn,
    retentionDays,
    daysLeft: Math.max(0, Math.ceil((deletedOn - now) / DAY_MS)),
  };
}

/**
 * The clock a PAUSED project is running against (canvas E0, screen 3).
 *
 * Derived from `state_since` — the same instant the reconciler measures its
 * retention window from — so the countdown on screen and the deletion the
 * platform will actually perform cannot disagree.
 *
 * Returns null for any state that is not paused, because a countdown shown to
 * somebody whose project is fine is a countdown that costs us a customer.
 */
export function pauseClock({
  state,
  stateSince,
  now = Date.now(),
  retentionDays = RETENTION_DAYS,
}) {
  if (state !== 'suspended' || !stateSince) return null;
  const pausedOn = Number(stateSince);
  const deletedOn = pausedOn + retentionDays * DAY_MS;
  return {
    pausedOn,
    deletedOn,
    retentionDays,
    daysLeft: Math.max(0, Math.ceil((deletedOn - now) / DAY_MS)),
  };
}

/**
 * What the billing page is looking at, derived from one subscription.
 *
 * `cancel_at_period_end` is the state the old page could not show at all: the
 * customer had cancelled, everything still worked, and nothing on any Maude
 * screen said so — they had to go back into Stripe to check.
 */
export function subscriptionView(subscription) {
  if (!subscription) return { exists: false, cancelling: false, periodEndMs: null };
  const periodEndMs = subscription.current_period_end
    ? Number(subscription.current_period_end) * 1000
    : null;
  return {
    exists: true,
    status: String(subscription.status ?? ''),
    cancelling: subscription.cancel_at_period_end === true,
    periodEndMs,
  };
}
