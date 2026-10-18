// Provision first, charge after — Cloud Phase 14 Task 3. Pure decision module.
//
// THE FIVE MINUTES THIS EXISTS FOR. Somebody pays, waits, and lands in an
// empty project — or worse, pays for a workspace that never boots at all.
// That is the worst possible first impression, and it is the one a naive
// "checkout succeeded ⇒ charge ⇒ provision" ordering produces by default,
// because charging is the easy part and booting is the part that can fail.
//
// So the order is inverted: **a card is authorized, the workspace is built,
// and only a workspace that answers turns the authorization into a charge.**
// If it does not come up inside the window, the authorization is voided and
// the person is told in plain language. They are never charged for something
// that did not work.
//
// WHY THIS IS A DECISION MODULE AND NOT AN `if` IN THE WEBHOOK. The ordering
// is the product promise. It has to be reviewable in one place, provable
// without Stripe, and impossible to reorder by accident while adding a
// feature — which is exactly what happens to an ordering that lives inside an
// effects handler (DDR-196 §1).

import { TRIAL_DAYS, TRIALS_PER_VERIFIED_EMAIL, trialView } from './billing.mjs';
import { ACCESS_MESSAGES } from './project-access.mjs';

const DAY_MS = 24 * 3600_000;

/**
 * How long a person waits before we give up and void.
 *
 * Long enough for a cold start that clones a real project (Phase 15 measured
 * minutes for ~280 MB on a small instance); short enough that nobody is left
 * staring at a spinner wondering whether they have been charged.
 */
export const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

/** Terminal outcomes of a checkout attempt. */
export const OUTCOMES = ['waiting', 'charge', 'void', 'already-settled'];

/**
 * What to do about one checkout attempt, given what is actually true.
 *
 * @param {object} attempt
 * @param {'authorized'|'charged'|'voided'} attempt.payment  what Stripe holds now
 * @param {number} attempt.authorizedAt                      ms epoch
 * @param {'pending'|'healthy'|'failed'} attempt.provision   what the workspace is doing
 * @param {object} [opts]
 * @returns {{outcome: string, reason: string, tellCustomer: string|null}}
 */
export function decideCheckout(
  attempt,
  { now = Date.now(), timeoutMs = PROVISION_TIMEOUT_MS } = {}
) {
  const { payment, provision, authorizedAt } = attempt;

  // Idempotence first. A webhook is delivered more than once as a matter of
  // course, and the second delivery must not charge a second time.
  if (payment === 'charged' || payment === 'voided') {
    return {
      outcome: 'already-settled',
      reason: `payment is already ${payment}`,
      tellCustomer: null,
    };
  }

  if (provision === 'healthy') {
    return {
      outcome: 'charge',
      reason: 'the workspace is up, so the authorization becomes a charge',
      tellCustomer: 'Your project is ready.',
    };
  }

  if (provision === 'failed') {
    return {
      outcome: 'void',
      reason: 'provisioning failed',
      // Says what happened, what it cost them (nothing), and what to do —
      // in that order, because the second is the one they are worried about.
      tellCustomer:
        'We could not set up your project, so you have not been charged. ' +
        'Nothing was taken from your card. Try again, or reply to this email and we will look.',
    };
  }

  const waited = now - authorizedAt;
  if (waited >= timeoutMs) {
    return {
      outcome: 'void',
      reason: `provisioning did not finish within ${Math.round(timeoutMs / 60000)} minutes`,
      tellCustomer:
        'Setting up your project is taking longer than it should, so we have released ' +
        'the hold on your card — you have not been charged. We are looking into it and ' +
        'will email you when it is ready.',
    };
  }

  return {
    outcome: 'waiting',
    reason: 'the workspace is still coming up',
    tellCustomer: null,
  };
}

/**
 * The invariant, stated as a function so it can be asserted rather than
 * believed: a charge REQUIRES a healthy workspace.
 *
 * Exists separately from `decideCheckout` on purpose. A test that only drives
 * the decision function proves the decision function; this proves the RULE,
 * over every input shape, including ones a future branch might add.
 */
export function chargeIsPermitted(attempt) {
  return attempt?.provision === 'healthy' && attempt?.payment === 'authorized';
}

/**
 * Progress a person can read while they wait.
 *
 * Named steps, not a percentage. A percentage invented from nothing is a lie
 * that gets found out at 90%, and the honest thing — "this can take a few
 * minutes" — is also the thing that stops people refreshing.
 */
export const PROVISION_STEPS = [
  { key: 'account', label: 'Setting up your account' },
  { key: 'workspace', label: 'Building your workspace' },
  { key: 'project', label: 'Adding your project' },
  { key: 'ready', label: 'Ready' },
];

export function waitingRoom(attempt, { now = Date.now(), timeoutMs = PROVISION_TIMEOUT_MS } = {}) {
  const decision = decideCheckout(attempt, { now, timeoutMs });
  const step =
    decision.outcome === 'charge'
      ? 'ready'
      : decision.outcome === 'void'
        ? null
        : (attempt.step ?? 'workspace');
  return {
    step,
    steps: PROVISION_STEPS,
    done: decision.outcome !== 'waiting',
    // The reassurance belongs on the WAITING screen, not only in the failure
    // email — the question "have I been charged?" arrives long before any
    // email does.
    note:
      decision.outcome === 'waiting'
        ? 'This usually takes a minute or two. Your card has not been charged yet — ' +
          'that happens once your project is up.'
        : decision.tellCustomer,
  };
}

// ----------------------------------------------------------- the A3 trial
//
// Maude v2 S9.15. The first cloud project provisions under the ACCOUNT's
// trial, with no checkout and no Stripe object — so there is no charge to
// order against a boot, and none of the above applies. What does need one
// reviewable place is who gets a free workspace, because free cells for any
// sign-up is the cost and abuse risk the run flagged.

/** The refusal a trial that cannot start gives — the contract's 402 `plan`. */
const NEEDS_PLAN = Object.freeze({
  outcome: 'refuse',
  status: 402,
  reason: 'plan',
  error: ACCESS_MESSAGES.plan,
});

/**
 * May this account provision a trial project now? Pure.
 *
 * Order matters and each step is a test:
 *   1. a REPLAY (same request id, or the same name without one) answers the
 *      project it already made — whatever else became true since. Provisioning
 *      is idempotent; a retry never makes a second project nor spends a claim;
 *   2. an ended trial needs a plan;
 *   3. the address must be verified — the trial is per verified e-mail;
 *   4. `TRIALS_PER_VERIFIED_EMAIL` claims already spent need a plan;
 *   5. a taken name is the caller's to change (409), and spends nothing.
 *
 * @param {{ account: object, now?: number, replay?: object|null, claimsUsed?: number, nameTaken?: boolean }} args
 */
export function decideTrialProvision({
  account,
  now = Date.now(),
  replay = null,
  claimsUsed = 0,
  nameTaken = false,
}) {
  if (replay) return { outcome: 'replay', project: replay };
  const trial = trialView(account, { now });
  if (trial.state === 'ended') return { ...NEEDS_PLAN };
  if (!account?.email_verified_at) {
    return {
      outcome: 'refuse',
      status: 403,
      reason: 'email-unverified',
      error: 'Confirm your e-mail address first — the link is in your inbox.',
    };
  }
  if (claimsUsed >= TRIALS_PER_VERIFIED_EMAIL) return { ...NEEDS_PLAN };
  if (nameTaken) {
    return {
      outcome: 'refuse',
      status: 409,
      reason: 'name-taken',
      error: 'That name is already a web address here. Pick another name.',
    };
  }
  // A trial that has not started (no sign-in since v19) starts now.
  return { outcome: 'provision', trialEndsAt: trial.endsAt ?? now + TRIAL_DAYS * DAY_MS };
}
