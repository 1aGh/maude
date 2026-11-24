// Promo — a plan state an operator sets. Pure.
//
// A Promo project is free because Maude said so: never a trial, never paused
// by the trial or billing sweeps while it runs, and replaced the moment a paid
// plan starts (project-access.mjs `planState` — `paid` is read first). The
// storage tiers are the two plans in pricing.json plus one with no limit; the
// tier NAMES come from pricing.json so this file never carries a plan word of
// its own.

import pricingCatalog from './pricing.json' with { type: 'json' };

const DAY_MS = 86_400_000;

/** How long before a Promo end date the owner is told. */
export const PROMO_NOTICE_DAYS = 30;

/**
 * The tiers, smallest first. `id` matches a pricing.json plan id where there is
 * one; `storageGb: null` is no limit.
 */
export const PROMO_TIERS = Object.freeze([
  Object.freeze({ id: 'project', storageGb: 25 }),
  Object.freeze({ id: 'dedicated', storageGb: 250 }),
  Object.freeze({ id: 'unlimited', storageGb: null }),
]);

export const promoTier = (id) => PROMO_TIERS.find((t) => t.id === id) ?? null;

export const validPromoTier = (id) => promoTier(id) !== null;

/** `Cloud Project · 25 GB` / `Unlimited` — the plan's own name, then the storage. */
export function promoTierLabel(id) {
  const tier = promoTier(id);
  if (!tier) return 'Promo';
  if (tier.storageGb === null) return 'Unlimited';
  const plan = pricingCatalog.plans.find((p) => p.id === tier.id);
  return `${plan?.name ?? tier.id} · ${tier.storageGb} GB`;
}

/** The storage a tier includes, as a person reads it. */
export function promoStorageLabel(id) {
  const tier = promoTier(id);
  if (!tier) return null;
  return tier.storageGb === null ? 'No storage limit' : `${tier.storageGb} GB`;
}

/**
 * What a project's Promo looks like right now, or null when it has none.
 *
 * `endingSoon` is the window in which the owner is offered Choose a plan: an
 * end date at most PROMO_NOTICE_DAYS away. `ended` rows read `paused` in
 * `planState` and are not Promo any more for the owner — a choice is due.
 */
export function promoView(project, { now = Date.now() } = {}) {
  if (!project || project.promo_since == null || project.subscription_id) return null;
  const endsAt = project.promo_ends_at ?? null;
  const ended = endsAt !== null && now >= endsAt;
  return {
    since: Number(project.promo_since),
    tier: promoTier(project.promo_tier)?.id ?? null,
    endsAt,
    ended,
    endingSoon: endsAt !== null && !ended && endsAt - now <= PROMO_NOTICE_DAYS * DAY_MS,
    daysLeft: endsAt === null || ended ? null : Math.max(1, Math.ceil((endsAt - now) / DAY_MS)),
  };
}
