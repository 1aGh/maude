// The reconciler — Cloud Phase 7.
//
// THE LOAD-BEARING RULE OF THE WHOLE CONTROL PLANE:
//
//   Webhooks and API calls only ever enqueue "reconcile this project".
//   Nothing is event-side-effect load-bearing.
//
// Why that rule and not the obvious alternative (act on the webhook): Stripe
// webhooks arrive out of order, arrive twice, and sometimes do not arrive at
// all. A control plane that provisions on `checkout.session.completed` and
// suspends on `invoice.payment_failed` is a state machine driven by an
// unordered, at-least-once, occasionally-lossy transport — and its failure mode
// is a customer who paid and has no project, or a customer who cancelled and
// still has one.
//
// So: subscription state in Stripe plus tenant state in D1 are the INPUTS, and
// this function derives what should be true. An hourly cron re-derives it for
// everybody whether or not any event arrived, which means a missed webhook
// costs at most one hour rather than a support ticket, and a duplicated one
// costs nothing at all.
//
// Everything here is pure: `reconcile()` takes observed state and returns
// ACTIONS. The worker executes them. That split is what makes 20 chaos
// lifecycle cycles a unit test rather than an integration environment.

import { assertTransition, canTransition, stepToward } from '../../cli/lib/cell-plan.mjs';

/** How long a suspended tenant's data is retained before it may be purged. */
export const SUSPEND_RETENTION_DAYS = 30;

/** Grace between a failed payment and suspension — dunning happens in here. */
export const PAST_DUE_GRACE_DAYS = 14;

/** How long before the deletion the last-chance email goes out (A11, canvas E0). */
export const DELETION_WARNING_DAYS = 2;

/**
 * How long a non-active subscription must PERSIST before it tears anything down.
 *
 * The reconciler stopped being record-only in Phase 24 B3: `suspend-cell` now
 * stops the container and detaches the customer's address, unattended, on an
 * hourly cron. Before this, ONE `fetchSubscription` returning `canceled` — an
 * eventual-consistency blip, a partial Stripe outage, a replicated read behind
 * a write — was enough to do that to a paying customer, with the 30-day
 * retention as the only thing between a bad read and destroyed data.
 *
 * Six hours is six consecutive adverse readings at the current cadence: long
 * enough to ride out an API wobble, far too short to be free service. It
 * delays only the FIRST teardown; nothing else in the ladder moves.
 */
export const SUSPEND_DEBOUNCE_MS = 6 * 3600_000;

const DAY_MS = 24 * 3600_000;

/**
 * @typedef {object} TenantRow            what D1 believes
 * @property {string} id
 * @property {'pending'|'active'|'past_due'|'suspended'|'exported'|'purged'} state
 * @property {string|null} subscriptionId
 * @property {number|null} stateSince      ms epoch
 * @property {boolean} cellRunning
 * @property {boolean} exportSent
 *
 * @typedef {object} Subscription         what Stripe says (null = none)
 * @property {'trialing'|'active'|'past_due'|'unpaid'|'canceled'|'incomplete'|'incomplete_expired'|'paused'} status
 * @property {number|null} currentPeriodEnd
 */

/**
 * Map a Stripe subscription status to the tenant state it implies.
 *
 * `trialing` is deliberately `active`: a trial that does not actually work is
 * not a trial. `incomplete` stays pending — the customer started checkout and
 * never finished, and provisioning for them would be provisioning for anyone
 * who opened a payment form.
 */
export function stateForSubscription(sub) {
  if (!sub) return 'pending';
  switch (sub.status) {
    case 'trialing':
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'paused':
    case 'canceled':
      return 'suspended';
    case 'incomplete':
      return 'pending';
    case 'incomplete_expired':
      return 'suspended';
    default:
      // An unrecognized status must never be read as "active". A new Stripe
      // status appearing should cost a tenant a pause, not free service, and
      // should be visible rather than silently mapped.
      return 'unknown';
  }
}

/**
 * Derive the actions that make reality match intent.
 *
 * Returns `{ desiredState, actions, notes }`. Actions are DATA — the executor
 * decides how to perform them, and a dry run can print them.
 */
export function reconcile(tenant, subscription, { now = Date.now() } = {}) {
  const actions = [];
  const notes = [];
  const since = tenant.stateSince ?? now;

  if (tenant.state === 'purged') {
    // Terminal. Nothing is ever provisioned for a purged tenant again, whatever
    // Stripe says — a resubscribe is a new project, not a resurrection of data
    // we already destroyed.
    return { desiredState: 'purged', actions: [], notes: ['purged is terminal'] };
  }

  // A trial project (A3, Maude v2 S9.15) runs with NO subscription by design —
  // it was provisioned under the account's trial, not by a Checkout. Read
  // through the machine below, "no subscription" means `pending`, and
  // `active → pending` is unreachable, so every active trial raised an
  // `illegal-transition` alert into the customer-visible audit log on every
  // hourly sweep. Its plan lives on the row (`planState`, project-access.mjs):
  // the cell pauses on expiry, nothing here tears it down. Once Choose a plan
  // attaches a subscription, the ordinary machine owns it again — including a
  // converted project whose subscription then VANISHED at Stripe (null with a
  // subscription id on the row), which must still alert and hold.
  if (!subscription && tenant.trialEndsAt != null && !tenant.subscriptionId) {
    return { desiredState: tenant.state, actions: [], notes: ['trial project (A3)'] };
  }

  const implied = stateForSubscription(subscription);

  if (implied === 'unknown') {
    // Fail visible, not open. A status we do not understand must not decide
    // anything, and it must not be quiet.
    notes.push(`unrecognized Stripe status "${subscription?.status}" — leaving state untouched`);
    return {
      desiredState: tenant.state,
      actions: [
        { kind: 'alert', reason: 'unknown-subscription-status', status: subscription?.status },
      ],
      notes,
    };
  }

  // `exported` is PAST the point where a subscription status decides anything,
  // and it needs its own branch (Cloud Phase 24 B3).
  //
  // Without one, the generic walk below asked for `suspended`, found no legal
  // one-hop route from `exported`, and took the shortest path — which is
  // `exported → active → suspended`. That resurrected a project queued for
  // deletion, reset its retention clock, and did it again every time the
  // window elapsed: the deletion the trust page and the cancellation screen
  // both promise could never actually happen. A countdown nothing performs is
  // a lie with a timestamp on it.
  if (tenant.state === 'exported') {
    if (implied === 'active' || implied === 'past_due') {
      // They resubscribed before we destroyed anything — a failing card counts,
      // because it means they came back. `active` is the only legal first hop
      // out of `exported`; a still-failing card walks on to `past_due` next
      // round, which is the machine doing its job rather than a special case.
      return {
        desiredState: 'active',
        actions: [
          { kind: 'set-state', from: 'exported', to: 'active' },
          ...(tenant.cellRunning ? [] : [{ kind: 'resume-cell' }]),
        ],
        notes: ['paid during the retention window — restored rather than purged'],
      };
    }
    return {
      desiredState: 'purged',
      actions: [
        { kind: 'purge-data', why: 'retention elapsed after an export was delivered' },
        { kind: 'set-state', from: 'exported', to: 'purged' },
      ],
      notes: ['retention is over and the copy went out — this is the promised deletion'],
    };
  }
  let desired = implied;

  // ---- the adverse-reading debounce -----------------------------------------
  //
  // Remember WHEN a non-active reading first appeared, and forget it the moment
  // a good one does. The teardown below consults it so a single blip cannot
  // detach a paying customer's address (security review, 2026-08-01).
  // NOT an action. The action list means "things the executor must DO", and it
  // is written verbatim into the customer-visible audit log; bookkeeping in
  // there is noise that makes the real entries harder to read. It rides on the
  // RESULT instead, and `applyActions` carries it onto the next row.
  const adverse = implied !== 'active';
  const adverseSince = adverse ? (tenant.adverseSince ?? now) : null;

  // past_due is a GRACE PERIOD, not an immediate stop. A card that expired on
  // holiday should not cost someone their working week.
  if (implied === 'past_due') {
    const elapsedDays = (now - since) / DAY_MS;
    if (tenant.state === 'past_due' && elapsedDays >= PAST_DUE_GRACE_DAYS) {
      desired = 'suspended';
      notes.push(`past_due for ${Math.floor(elapsedDays)}d — grace exhausted`);
    } else {
      desired = 'past_due';
    }
  }

  // A RUNNING tenant is never torn down on one reading. `past_due` already has
  // its own 14-day grace; this covers the abrupt route — `canceled`/`paused`
  // arriving while the tenant is `active` — which until now suspended the cell
  // and detached the address in the same sweep that first saw it.
  // ONLY from `active`. `past_due` already IS a persistence check — fourteen
  // days of the same reading — so debouncing it again would just delay a real
  // lapse for no extra safety.
  if (
    desired === 'suspended' &&
    tenant.state === 'active' &&
    now - adverseSince < SUSPEND_DEBOUNCE_MS
  ) {
    const mins = Math.round((now - adverseSince) / 60_000);
    notes.push(
      `subscription has read non-active for ${mins}m — holding until ` +
        `${Math.round(SUSPEND_DEBOUNCE_MS / 60_000)}m before any teardown`
    );
    desired = tenant.state;
  }

  // A tenant that never became active has no customer data, so it may be
  // cleaned up directly. One that DID become active never can be — see below.
  if (desired === 'suspended' && tenant.state === 'pending') desired = 'purged';

  // ---- the transition -----------------------------------------------------
  if (desired !== tenant.state) {
    if (canTransition(tenant.state, desired)) {
      actions.push({ kind: 'set-state', from: tenant.state, to: desired });
    } else {
      // Not reachable in one hop is usually ORDINARY, not an error: a pending
      // tenant whose card is already failing did subscribe, so the truthful
      // route is pending → active → past_due, and `settle` takes the second
      // hop on the next round. Walking the machine also means the one
      // transition it exists to forbid stays forbidden however we get there.
      const hop = stepToward(tenant.state, desired);
      if (hop) {
        notes.push(`${tenant.state} → ${desired} via ${hop}`);
        actions.push({ kind: 'set-state', from: tenant.state, to: hop });
        desired = hop;
      } else {
        // Genuinely unreachable — our model is wrong, and acting on a wrong
        // model is how data gets destroyed.
        notes.push(`refusing unreachable transition ${tenant.state} → ${desired}`);
        actions.push({
          kind: 'alert',
          reason: 'illegal-transition',
          from: tenant.state,
          to: desired,
        });
        desired = tenant.state;
      }
    }
  }

  // ---- compute ------------------------------------------------------------
  // Only `active` runs a cell. past_due keeps running deliberately: dunning is
  // a conversation, and taking someone's tools away mid-conversation is how a
  // recoverable billing problem becomes a churn event.
  const shouldRun = desired === 'active' || desired === 'past_due';
  if (shouldRun && !tenant.cellRunning) {
    actions.push({ kind: tenant.state === 'pending' ? 'provision-cell' : 'resume-cell' });
  }
  if (!shouldRun && tenant.cellRunning) {
    actions.push({ kind: 'suspend-cell' });
  }

  // ---- the export guarantee ----------------------------------------------
  // DDR-193 §3: an export email always fires BEFORE teardown. There is no path
  // from "stopped paying" to "your designs are gone" that skips "you were
  // handed your files".
  if (desired === 'suspended' && !tenant.exportSent) {
    actions.push({ kind: 'send-export', why: 'suspension — data is never hostage' });
  }

  // ---- retention ----------------------------------------------------------
  if (desired === 'suspended') {
    const heldDays = (now - since) / DAY_MS;
    // "Two days left" (Cloud Phase 24 A11, canvas E0). The 30 days are only a
    // promise if somebody is told the clock is running; the executor sends
    // this once, guarded by the audit log, because the cron runs hourly.
    if (
      tenant.state === 'suspended' &&
      heldDays >= SUSPEND_RETENTION_DAYS - DELETION_WARNING_DAYS &&
      heldDays < SUSPEND_RETENTION_DAYS
    ) {
      actions.push({
        kind: 'warn-deletion',
        deletesAt: since + SUSPEND_RETENTION_DAYS * DAY_MS,
      });
    }
    if (tenant.state === 'suspended' && heldDays >= SUSPEND_RETENTION_DAYS) {
      if (tenant.exportSent) {
        actions.push({ kind: 'set-state', from: 'suspended', to: 'exported' });
        notes.push(`retention window elapsed (${Math.floor(heldDays)}d) — ready to purge`);
      } else {
        // Retention elapsed but we never handed them their files. Wait, and say
        // so. The clock is not more important than the guarantee.
        notes.push('retention elapsed but no export was sent — holding, and re-sending');
        actions.push({ kind: 'send-export', why: 'retention elapsed without a prior export' });
      }
    }
  }

  return { desiredState: desired, actions, notes, adverseSince };
}

/**
 * Apply a reconcile result to a tenant row, returning the next row.
 *
 * Kept separate so a caller can dry-run: the actions are inspectable before
 * anything is written.
 */
export function applyActions(tenant, result, { now = Date.now() } = {}) {
  // The debounce clock is carried on the RESULT rather than as an action —
  // see reconcile(). `undefined` means a caller built a result by hand and did
  // not speak to it; leave the row's value alone rather than silently arming
  // or disarming the teardown delay.
  let next =
    result.adverseSince === undefined
      ? { ...tenant }
      : { ...tenant, adverseSince: result.adverseSince };
  for (const action of result.actions) {
    switch (action.kind) {
      case 'set-state':
        assertTransition(next.state, action.to);
        next = { ...next, state: action.to, stateSince: now };
        break;
      case 'provision-cell':
      case 'resume-cell':
        next = { ...next, cellRunning: true };
        break;
      case 'suspend-cell':
        next = { ...next, cellRunning: false };
        break;
      case 'send-export':
        // DELIBERATELY NOT `exportSent: true`.
        //
        // This flag is the sole precondition for destroying customer data, and
        // it must mean DELIVERED, not REQUESTED. Setting it on emission made a
        // failed export indistinguishable from a handed-over one: the
        // "retention elapsed but no export was sent — holding, and re-sending"
        // branch below became unreachable, and one failed attempt satisfied
        // DDR-193 §3 forever. The executor stamps it, and only on success
        // (worker.mjs performActions → prepareExportFor).
        //
        // Leaving it false here also stops `settle()` walking
        // suspended → exported → purged inside a single sweep on the
        // migration backlog — a tenant suspended before the effects existed
        // would otherwise have been exported and purged in the same tick,
        // with the email pointing at bytes that were already gone.
        break;
      default:
        break; // alerts change no state
    }
  }
  return next;
}

/**
 * Run reconcile→apply until it stops producing state changes.
 *
 * The reconciler must be a fixed point: running it twice in a row must not do
 * anything the second time. If it did, the hourly cron would flap a tenant's
 * cell forever, and nobody would notice until the bill.
 */
export function settle(tenant, subscription, { now = Date.now(), maxRounds = 5 } = {}) {
  let current = tenant;
  const all = [];
  for (let round = 0; round < maxRounds; round++) {
    const result = reconcile(current, subscription, { now });
    if (result.actions.length === 0) return { tenant: current, rounds: round, actions: all };
    all.push(...result.actions);
    const next = applyActions(current, result, { now });
    if (JSON.stringify(next) === JSON.stringify(current)) {
      return { tenant: current, rounds: round + 1, actions: all };
    }
    current = next;
  }
  throw new Error(
    `reconcile did not settle in ${maxRounds} rounds for tenant ${tenant.id} — ` +
      'this is a flapping loop, and the hourly cron would run it forever'
  );
}
