// Starting a project — Cloud Phase 14, the decisions.
//
// Pure module, same posture as provisioning.mjs: everything here is provable
// without Stripe, and the routes (checkout-routes.mjs) only carry verdicts
// out. What is decided here:
//
//   - what may be a project id (it becomes a HOSTNAME, so the rules are DNS
//     rules plus our own reserved names — `view-<id>` is the share view's
//     namespace, so `view-*` can never be a project);
//   - what a valid "start a project" request is;
//   - the exact Checkout Session the control plane asks Stripe for.
//
// HOW THE PROVISION-FIRST PROMISE MEETS STRIPE (DDR-203). The subscription is
// created by Checkout with the advertised free trial, so nothing is charged at
// checkout — the card is collected and validated, which is the "authorization".
// The workspace is then built INSIDE the trial. Only a workspace that answers
// lets the subscription live on to convert ("charge"); a failure or a timeout
// CANCELS it while it has cost nothing ("void"), which is the one ordering a
// subscription-mode integration cannot get wrong by accident once it is
// decided here.

/**
 * Names that can never be a project, because the hostname (or the namespace)
 * is already spoken for. `view-` as a PREFIX is reserved wholesale — that is
 * the share view's namespace (Phase 18).
 */
export const RESERVED_IDS = new Set([
  'cloud',
  'www',
  'api',
  'app',
  'admin',
  'mail',
  'view',
  'share',
  'status',
  'docs',
  'help',
  'billing',
  'account',
  'accounts',
  'login',
  'signup',
  'maude',
  // Cloud Phase 25 A4 — the segregated canvas origin lives at
  // `canvas.cloud.maude.sh`. A project allocated this name would take over the
  // hostname every project's canvases are served from, which is the largest
  // possible version of this class of bug.
  'canvas',
]);

/**
 * Turn what a human calls their project into the id that becomes its address.
 * Diacritics fold rather than drop: "Zkušební tým" → "zkusebni-tym".
 */
export function deriveProjectId(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Is this a project id we can build an address on?
 * Same grammar the rest of the platform enforces, plus the reservations.
 */
export function validProjectId(id) {
  if (typeof id !== 'string') return false;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return false;
  if (id.length < 3 || id.length > 40) return false;
  if (RESERVED_IDS.has(id)) return false;
  if (id.startsWith('view-')) return false;
  return true;
}

/**
 * Validate a "start a project" submission against the price catalog.
 *
 * Returns `{ ok: true, id, plan, interval }` or `{ ok: false, error }` with a
 * sentence fit for the form, never for a log.
 */
export function validateNewProject({ name, plan, interval, pricing }) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 3) {
    return { ok: false, error: 'Give the project a name — at least 3 characters.' };
  }
  const id = deriveProjectId(trimmed);
  if (!validProjectId(id)) {
    return {
      ok: false,
      error: 'That name cannot become a web address here. Try one with a few more letters.',
    };
  }
  const known = pricing.plans.find((p) => p.id === plan);
  if (!known) return { ok: false, error: 'Pick one of the plans.' };
  if (interval !== 'monthly' && interval !== 'annual') {
    return { ok: false, error: 'Pick monthly or annual billing.' };
  }
  if (interval === 'annual' && !known.amounts.annualMinor) {
    return { ok: false, error: 'That plan is billed monthly only.' };
  }
  return { ok: true, id, name: trimmed, plan, interval };
}

/**
 * Validate the name a trial project is created with (A3, `POST /api/projects`).
 * The same address rules as the wizard; no plan, because there is none yet.
 */
export function validateTrialProject({ name }) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < 3 || trimmed.length > 120) {
    return { ok: false, error: 'Give the project a name — at least 3 characters.' };
  }
  const id = deriveProjectId(trimmed);
  if (!validProjectId(id)) {
    return {
      ok: false,
      error: 'That name cannot become a web address here. Try one with a few more letters.',
    };
  }
  return { ok: true, id, name: trimmed };
}

/**
 * Choose a plan (A3): the plan picked for an EXISTING trial project. The
 * wizard's validation without the name — the project already has one.
 */
export function validatePlanChoice({ plan, interval, pricing }) {
  const verdict = validateNewProject({ name: 'placeholder', plan, interval, pricing });
  return verdict.ok ? { ok: true, plan, interval } : verdict;
}

/**
 * The Checkout Session, as the flat form params Stripe's API takes.
 *
 * `subscription_data[trial_period_days]` is the advertised trial from
 * pricing.json — nothing is charged at checkout, which is what makes the
 * provision-first ordering possible in subscription mode at all.
 *
 * `convert` (A3, Maude v2 S9.15) is Choose a plan: the SAME Checkout for a
 * trial project that already exists. It carries no second trial
 * (`trialDays: null` omits the key — the account's trial was the trial),
 * `metadata[convert]` tells the return to attach the subscription to that row
 * instead of writing a new one, and cancelling goes back to its billing page.
 */
export function checkoutSessionParams({
  projectId,
  projectName,
  plan,
  priceId,
  trialDays,
  customerId,
  origin,
  convert = false,
}) {
  return {
    mode: 'subscription',
    customer: customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    ...(trialDays === null || trialDays === undefined
      ? {}
      : { 'subscription_data[trial_period_days]': String(trialDays) }),
    'subscription_data[metadata][project_id]': projectId,
    'metadata[project_id]': projectId,
    // The project row is written on RETURN, not before checkout — an
    // abandoned checkout must not squat the address. The session therefore
    // carries everything the return needs to write it.
    'metadata[project_name]': projectName,
    'metadata[plan]': plan,
    ...(convert ? { 'metadata[convert]': '1' } : {}),
    // The card is collected and validated even though the trial is free —
    // that validation IS the authorization the ordering relies on.
    payment_method_collection: 'always',
    // VAT — ON, AND NOT OURS TO SWITCH OFF (measured 2026-08-01, during C1).
    //
    // The account runs Stripe **Managed Payments**, which makes STRIPE the
    // merchant of record: it calculates the customer's local VAT, collects it,
    // and remits it. The session says whose liability it is —
    // `automatic_tax.liability: {type: "stripe"}` — and Stripe refuses
    // `automatic_tax[enabled]=false` outright ("Managed Payments handles taxes
    // for you"). Omitting the flag inherits ON from the account, so there is
    // no arrangement in which this integration does not charge tax.
    //
    // WHY THAT IS THE POINT RATHER THAN A NUISANCE. The provider is not
    // registered for VAT in the Czech Republic (ARES: `stavZdrojeDph:
    // NEEXISTUJICI`) and, under merchant-of-record, does not need to be for
    // these sales — the same arrangement Paddle and Lemon Squeezy sell.
    //
    // What it DOES mean is that the customer pays the listed price PLUS their
    // own local VAT, so every page quoting a price has to say so. C1 caught
    // the funnel showing "Total after trial €22.99" one click after a page
    // promising €19.
    'automatic_tax[enabled]': 'true',
    // Stripe REFUSES automatic tax on a session naming an existing `customer`
    // unless it may write the collected address back — without this pair the
    // session create fails outright.
    'customer_update[address]': 'auto',
    'customer_update[name]': 'auto',
    billing_address_collection: 'required',
    // A business customer's reverse-charge VAT id, offered at the moment they
    // are already entering an address. Asking later means asking after an
    // invoice has been issued with the wrong tax on it.
    'tax_id_collection[enabled]': 'true',
    success_url: `${origin}/checkout/return?project=${projectId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: convert ? `${origin}/projects/${projectId}/billing` : `${origin}/projects/new`,
  };
}

/**
 * Map a stored attempt row onto the shape `decideCheckout` reasons about.
 */
export function attemptFromRow(row) {
  return {
    payment: row.payment,
    authorizedAt: row.authorized_at ?? 0,
    provision: row.provision ?? 'pending',
  };
}
