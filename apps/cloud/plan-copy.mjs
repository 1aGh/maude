// What a project's plan reads as — one place, two audiences. Pure.
//
// The OWNER's line appears on the account's Billing page, the project's
// Billing page and the dashboard card; members are never shown any of it (a
// plan is the owner's business). The OPERATOR's line is the same fact with the
// detail support needs. Both are derived from `planState`, so the page and the
// cell can never disagree about whether a project is paused.

import { formatDay } from './billing.mjs';
import pricingCatalog from './pricing.json' with { type: 'json' };
import { planState } from './project-access.mjs';
import { promoStorageLabel, promoTierLabel, promoView } from './promo.mjs';

const DAY_MS = 86_400_000;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const daysLeft = (endsAt, now) => Math.max(1, Math.ceil((Number(endsAt) - now) / DAY_MS));

const planName = (id) => pricingCatalog.plans.find((p) => p.id === id)?.name ?? null;

/** Is this project paused by an operator right now (D1 v21 `hold_since`)? */
export const isHeld = (project) => project?.hold_since != null && project?.state === 'suspended';

/**
 * The owner's view of one project's plan.
 *
 * @returns {{ state: string, line: string, tone: 'ok'|'warn'|'stop', canChoose: boolean,
 *            promo: object|null, freeUntil: number|null }}
 *   `canChoose` — offer Choose a plan: a trial, a paused project, or a Promo
 *   whose end date is near. `null` line when there is nothing to say beyond
 *   the project's state (a row with no plan at all).
 */
export function ownerPlan(project, { now = Date.now() } = {}) {
  const state = planState(project, { now });
  const promo = promoView(project, { now });
  if (isHeld(project)) {
    return {
      state: 'held',
      line: 'Paused by Maude · nothing is deleted',
      tone: 'stop',
      canChoose: false,
      promo: null,
      freeUntil: null,
    };
  }
  if (state === 'paid') {
    return {
      state,
      line: `${planName(project.plan) ?? 'A plan'} · plan chosen`,
      tone: 'ok',
      canChoose: false,
      promo: null,
      freeUntil: null,
    };
  }
  if (state === 'promo') {
    return {
      state,
      line:
        promo.endsAt === null
          ? 'Promo from Maude · free'
          : `Promo from Maude · free until ${formatDay(promo.endsAt)}`,
      tone: 'ok',
      canChoose: promo.endingSoon,
      promo,
      freeUntil: promo.endsAt,
    };
  }
  if (state === 'trial') {
    const days = daysLeft(project.trial_ends_at, now);
    return {
      state,
      line: `Free trial · ${plural(days, 'day left', 'days left')} · free until ${formatDay(project.trial_ends_at)}`,
      tone: 'ok',
      canChoose: true,
      promo: null,
      freeUntil: Number(project.trial_ends_at),
    };
  }
  if (state === 'paused') {
    return {
      state,
      line: 'Paused · Choose a plan to keep editing.',
      tone: 'warn',
      canChoose: true,
      promo: null,
      freeUntil: null,
    };
  }
  return { state, line: null, tone: 'ok', canChoose: false, promo: null, freeUntil: null };
}

/** The three facts the owner's Promo card shows (canvas 16, cl-promo-owner). */
export function promoFacts(project, { now = Date.now(), usedBytes = null } = {}) {
  const promo = promoView(project, { now });
  if (!promo || promo.ended) return null;
  const storage = promoStorageLabel(promo.tier);
  return {
    plan: 'Promo from Maude · free',
    storage: storage ?? null,
    usedBytes,
    ends: promo.endsAt === null ? 'Never' : formatDay(promo.endsAt),
    endingSoon: promo.endingSoon,
    endsAt: promo.endsAt,
  };
}

/**
 * The operator's line: the same state, with what support needs to see.
 *
 * @returns {{ state: string, line: string, tone: 'ok'|'warn'|'stop'|'off' }}
 */
export function operatorPlan(project, { now = Date.now() } = {}) {
  const state = planState(project, { now });
  if (project.state === 'purged') return { state: 'gone', line: 'Deleted', tone: 'off' };
  if (isHeld(project)) {
    return {
      state: 'held',
      line: `Paused by an operator · since ${formatDay(project.hold_since)}`,
      tone: 'stop',
    };
  }
  if (state === 'paid') {
    const name = planName(project.plan) ?? project.plan ?? 'plan';
    if (project.state === 'suspended' || project.state === 'exported') {
      return { state: 'lapsed', line: `${name} · paused, subscription ended`, tone: 'off' };
    }
    if (project.state === 'past_due')
      return { state, line: `${name} · payment failing`, tone: 'warn' };
    return { state, line: `${name} · paid`, tone: 'ok' };
  }
  if (state === 'promo') {
    const promo = promoView(project, { now });
    const ends = promo.endsAt === null ? '' : ` · until ${formatDay(promo.endsAt)}`;
    return { state, line: `Promo · ${promoTierLabel(promo.tier)}${ends}`, tone: 'ok' };
  }
  if (state === 'trial') {
    const days = daysLeft(project.trial_ends_at, now);
    return {
      state,
      line: `Trial · ${plural(days, 'day left', 'days left')}`,
      tone: days <= 3 ? 'warn' : 'ok',
    };
  }
  if (state === 'paused') {
    const promoEnded = project.promo_since != null;
    const at = promoEnded ? project.promo_ends_at : project.trial_ends_at;
    return {
      state,
      line: `Paused · ${promoEnded ? 'Promo' : 'trial'} ended ${formatDay(at)}`,
      tone: 'off',
    };
  }
  if (project.state === 'pending') return { state, line: 'Setting up', tone: 'warn' };
  return { state, line: 'No plan — never paused, and nothing says why', tone: 'warn' };
}
