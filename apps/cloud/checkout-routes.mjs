// Starting a project, the effects — Cloud Phase 14 (DDR-203).
//
// Every decision is imported: what may be a project (checkout.mjs), whether a
// charge is permitted (provisioning.mjs), what the person sees
// (checkout-pages.mjs), what things cost (pricing-core.mjs + the bundled
// catalog). What is left here is Stripe calls, D1 rows, and redirects.
//
// THE ORDERING, END TO END:
//   wizard → Checkout (card collected, trial started, NOTHING charged)
//   → return (subscription recorded, address routed)
//   → waiting room (each visit asks the workspace itself, then lets
//     `decideCheckout` say charge / void / keep waiting).
//
// The waiting room drives settlement rather than a background job, and that
// is deliberate: the person watching IS the poller, the hourly sweep is the
// backstop for the person who closed the tab, and there is no third machine
// to go wrong.

import { startTrial, trialEmailKey } from './accounts.mjs';
import { track } from './analytics.mjs';
import {
  cancelSchedule,
  currentVatId,
  customerParams,
  invoiceRows,
  pauseClock,
  subscriptionView,
  TRIALS_PER_VERIFIED_EMAIL,
  validateBillingDetails,
} from './billing.mjs';
import {
  attemptFromRow,
  checkoutSessionParams,
  validateNewProject,
  validatePlanChoice,
  validateTrialProject,
} from './checkout.mjs';
import {
  allCheckoutHtml,
  billingPage,
  cancelPage,
  newProjectPage,
  waitingRoomPage,
} from './checkout-pages.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { audit } from './db.mjs';
import { personalTokenAccount } from './device-auth.mjs';
import pricingCatalog from './pricing.json' with { type: 'json' };
import { priceIdFor, publicPricing, stripeMode } from './pricing-core.mjs';
import { ACCESS_MESSAGES, can, decideAccess, planState } from './project-access.mjs';
import { ensureCellDomain, ensureProjectCanvasDomain, probeCell } from './provision.mjs';
import { decideCheckout, decideTrialProvision, waitingRoom } from './provisioning.mjs';

export { allCheckoutHtml, pricingCatalog };

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      'referrer-policy': 'no-referrer',
    },
  });
}

function redirect(to) {
  return new Response(null, { status: 303, headers: { location: to } });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** One form-encoded call to Stripe. Returns { ok, status, body }. */
async function stripe(env, method, path, params = null) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/** The customer object this account bills through, created on first need. */
async function ensureCustomer(env, account) {
  if (account.stripe_customer_id) return account.stripe_customer_id;
  const created = await stripe(env, 'POST', '/v1/customers', {
    email: account.email,
    'metadata[account_id]': account.id,
  });
  if (!created.ok) throw new Error(`customer create failed (${created.status})`);
  await env.DB.prepare('UPDATE accounts SET stripe_customer_id = ? WHERE id = ?')
    .bind(created.body.id, account.id)
    .run();
  return created.body.id;
}

async function latestAttempt(env, projectId) {
  return env.DB.prepare(
    'SELECT * FROM checkout_attempts WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
  )
    .bind(projectId)
    .first();
}

/**
 * Route the checkout + billing surfaces. Returns a Response or null.
 */
export async function handleCheckoutRoutes(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const { pathname } = url;
  const pricing = pricingCatalog;

  // ------------------------------------- the A3 trial project (Bearer client)
  // `GET /api/projects` (the list) is device-auth.mjs's and answers first;
  // the create is here, beside the wizard it is the no-checkout twin of.
  if (pathname === '/api/projects' && request.method === 'POST') {
    return createTrialProject(request, env, { ctx });
  }

  // -------------------------------------------------------------- the wizard
  if (pathname === '/projects/new') {
    if (!account) return redirect('/login');
    if (request.method === 'GET') return html(newProjectPage({ account, pricing }));
    if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);

    const form = await request.formData();
    const values = {
      name: String(form.get('name') ?? ''),
      plan: String(form.get('plan') ?? ''),
      interval: String(form.get('interval') ?? ''),
    };
    const verdict = validateNewProject({ ...values, pricing });
    if (!verdict.ok)
      return html(newProjectPage({ account, pricing, error: verdict.error, values }), 400);

    const taken = await env.DB.prepare('SELECT id FROM projects WHERE id = ?')
      .bind(verdict.id)
      .first();
    if (taken) {
      return html(
        newProjectPage({
          account,
          pricing,
          error: `“${verdict.id}” is already someone's address here. Pick another name.`,
          values,
        }),
        409
      );
    }

    let priceId;
    try {
      priceId = priceIdFor(verdict.plan, verdict.interval, {
        pricing,
        mode: stripeMode(env),
      });
    } catch (err) {
      console.error(`[checkout] price resolution: ${err.message}`);
      return html(
        newProjectPage({
          account,
          pricing,
          error: 'That plan cannot be started right now.',
          values,
        }),
        503
      );
    }

    try {
      const customerId = await ensureCustomer(env, account);
      const session = await stripe(
        env,
        'POST',
        '/v1/checkout/sessions',
        checkoutSessionParams({
          projectId: verdict.id,
          projectName: verdict.name,
          plan: verdict.plan,
          priceId,
          trialDays: pricing.trialDays,
          customerId,
          origin: url.origin,
        })
      );
      if (!session.ok || !session.body?.url) {
        console.error(
          `[checkout] session create: ${session.status} ${JSON.stringify(session.body?.error ?? {}).slice(0, 300)}`
        );
        return html(
          newProjectPage({
            account,
            pricing,
            error: 'Payment could not be started. Nothing was created — try again.',
            values,
          }),
          502
        );
      }
      // The top of the funnel: somebody chose a plan and left for Stripe. The
      // matching `checkout_completed` fires only when the workspace actually
      // came up, so the gap between the two IS the abandonment rate.
      track(env, ctx, {
        name: 'checkout_started',
        accountId: account.id,
        projectId: verdict.id,
        props: { plan: verdict.plan, interval: verdict.interval },
      });
      return redirect(session.body.url);
    } catch (err) {
      console.error(`[checkout] ${err.message}`);
      return html(
        newProjectPage({
          account,
          pricing,
          error: 'Payment could not be started. Nothing was created — try again.',
          values,
        }),
        502
      );
    }
  }

  // ------------------------------------------------- returning from Stripe
  if (request.method === 'GET' && pathname === '/checkout/return') {
    if (!account) return redirect('/login');
    const sessionId = String(url.searchParams.get('session_id') ?? '');
    const projectId = String(url.searchParams.get('project') ?? '');
    if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return redirect('/');

    const session = await stripe(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
    const s = session.body;
    // Everything about this request is attacker-suppliable except what Stripe
    // says about the session — so what Stripe says is the only thing believed:
    // the session must be complete, must belong to THIS account's customer,
    // and must name the same project the query does.
    if (
      !session.ok ||
      s.status !== 'complete' ||
      !s.subscription ||
      s.metadata?.project_id !== projectId ||
      s.customer !== account.stripe_customer_id
    ) {
      return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    }

    const now = Date.now();

    // Choose a plan (A3): the subscription joins the trial project that
    // already exists and already runs. No new row, and no provision-first
    // settlement — the workspace is up, so there is nothing to void, and a
    // slow probe must never cancel a plan somebody just paid for.
    if (s.metadata?.convert === '1') {
      return convertTrialProject(env, { account, projectId, session: s, sessionId, now, ctx });
    }

    // The project row is born here — an abandoned checkout never squats the
    // address. INSERT OR IGNORE makes a refreshed return page harmless.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO projects (id, account_id, name, state, state_since, subscription_id, plan, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
      .bind(
        projectId,
        account.id,
        s.metadata.project_name || projectId,
        now,
        String(s.subscription),
        s.metadata.plan || 'project',
        now
      )
      .run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO checkout_attempts (session_id, project_id, payment, subscription_id, authorized_at, created_at)
       VALUES (?, ?, 'authorized', ?, ?, ?)`
    )
      .bind(sessionId, projectId, String(s.subscription), now, now)
      .run();
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'checkout.authorized',
      detail: JSON.stringify({ session: sessionId }),
    });

    // Route the address now, so the workspace can start answering while the
    // person watches the waiting room. Failure is not fatal here — the waiting
    // room retries it, and the timeout tells the truth if it never lands.
    await ensureCellDomain(env, projectId);
    // The canvases need their own origin (Cloud Phase 27) — provisioned with
    // the project, not discovered missing when somebody opens a design.
    await ensureProjectCanvasDomain(env, projectId);

    return redirect(`/projects/${projectId}/setup`);
  }

  // -------------------------------------------------------- the waiting room
  let m = pathname.match(/^\/projects\/([a-z0-9-]+)\/setup$/);
  if (request.method === 'GET' && m) {
    if (!account) return redirect('/login');
    const projectId = m[1];
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first();
    if (!project || project.account_id !== account.id) {
      return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    }

    const attempt = await latestAttempt(env, projectId);
    if (!attempt) {
      // No attempt on record (hand-provisioned projects, e.g. the pilot).
      const room = { step: 'ready', steps: [], done: true, note: 'Your project is ready.' };
      return html(waitingRoomPage({ project, room }));
    }

    // Ask the workspace itself, then let the decision module rule.
    const provision =
      attempt.payment === 'authorized'
        ? await probeCell(env, projectId, { timeoutMs: 4000 })
        : 'pending';
    const row = { ...attempt, provision };
    const decision = decideCheckout(attemptFromRow(row));

    if (decision.outcome === 'charge') {
      // "Charge" here means: the trial is allowed to convert. The subscription
      // already exists and Stripe will invoice at trial end; what settles NOW
      // is our promise — the workspace answered, so the money may follow.
      await env.DB.prepare(
        `UPDATE checkout_attempts SET payment = 'charged', settled_at = ? WHERE session_id = ?`
      )
        .bind(Date.now(), attempt.session_id)
        .run();
      await env.DB.prepare(
        `UPDATE projects SET state = 'active', state_since = ?, cell_running = 1 WHERE id = ?`
      )
        .bind(Date.now(), projectId)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: 'system',
        action: 'checkout.settled',
        detail: 'workspace healthy — subscription kept',
      });
      // Settlement is provision-FIRST, so these two are the same moment: the
      // subscription is kept precisely because the workspace answered.
      // No `interval` here, deliberately: `projects` records a plan and not a
      // billing interval, so naming one would be inventing it. The interval is
      // on `checkout_started`, where the form actually said which it was.
      track(env, ctx, {
        name: 'checkout_completed',
        accountId: account.id,
        projectId,
        props: { plan: project.plan === 'dedicated' ? 'dedicated' : 'project' },
      });
      track(env, ctx, { name: 'project_provisioned', accountId: account.id, projectId });
    } else if (decision.outcome === 'void') {
      // The workspace did not come up in time: the subscription is cancelled
      // while it has cost nothing. That IS the void.
      const cancelled = await stripe(env, 'DELETE', `/v1/subscriptions/${attempt.subscription_id}`);
      if (!cancelled.ok && cancelled.status !== 404) {
        console.error(`[checkout] void of ${attempt.subscription_id} failed (${cancelled.status})`);
      }
      await env.DB.prepare(
        `UPDATE checkout_attempts SET payment = 'voided', settled_at = ? WHERE session_id = ?`
      )
        .bind(Date.now(), attempt.session_id)
        .run();
      await env.DB.prepare(`UPDATE projects SET state = 'suspended', state_since = ? WHERE id = ?`)
        .bind(Date.now(), projectId)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: 'system',
        action: 'checkout.voided',
        detail: decision.reason,
      });
      // But keep retrying the route itself — a missing domain is our fault,
      // not theirs, and a later visit may find the infrastructure repaired.
      await ensureCellDomain(env, projectId);
      // The canvases need their own origin (Cloud Phase 27) — provisioned with
      // the project, not discovered missing when somebody opens a design.
      await ensureProjectCanvasDomain(env, projectId);
    }

    // Render from THIS visit's decision. Re-deciding after the settlement
    // writes would land in `already-settled`, which deliberately carries no
    // customer sentence — it is the idempotence branch, not a page.
    if (decision.outcome === 'charge') {
      return html(
        waitingRoomPage({
          project,
          room: { step: 'ready', done: true, note: decision.tellCustomer },
        })
      );
    }
    if (decision.outcome === 'void') {
      return html(
        waitingRoomPage({ project, room: { step: null, done: true, note: decision.tellCustomer } })
      );
    }
    if (decision.outcome === 'already-settled') {
      const room =
        attempt.payment === 'charged'
          ? { step: 'ready', done: true, note: 'Your project is ready.' }
          : {
              step: null,
              done: true,
              note:
                'This project could not be set up, and nothing was charged. ' +
                'Start again whenever you like.',
            };
      return html(waitingRoomPage({ project, room }));
    }
    return html(waitingRoomPage({ project, room: waitingRoom(attemptFromRow(row)) }));
  }

  // ---------------------------------------------------------------- billing
  m = pathname.match(
    /^\/projects\/([a-z0-9-]+)\/billing(?:\/(portal|cancel|details|resume|plan))?$/
  );
  if (m) {
    if (!account) return redirect('/login');
    const projectId = m[1];
    const surface = m[2] ?? null;
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first();
    const rows = await env.DB.prepare(
      'SELECT account_id, role FROM project_members WHERE project_id = ?'
    )
      .bind(projectId)
      .all();
    const verdict = decideAccess({
      accountId: account.id,
      project,
      members: rows?.results ?? [],
    });
    if (!verdict.ok || !can(verdict.role, 'billing')) {
      return html(`<p>${ACCESS_MESSAGES['no-access']}</p>`, 404);
    }

    if (surface === 'portal') {
      if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
      const portal = await stripe(env, 'POST', '/v1/billing_portal/sessions', {
        customer: account.stripe_customer_id,
        return_url: `${url.origin}/projects/${projectId}/billing`,
      });
      if (!portal.ok || !portal.body?.url) {
        console.error(`[billing] portal create failed (${portal.status})`);
        return html('<p>Billing could not be opened right now. Try again in a minute.</p>', 502);
      }
      track(env, ctx, { name: 'billing_portal_opened', accountId: account.id, projectId });
      return redirect(portal.body.url);
    }

    // ---- Choose a plan (A3, Maude v2 S9.15) ---------------------------------
    // Today's Checkout, converting THIS trial project. The picker itself is
    // the billing page's (S9.16); GET lands there.
    if (surface === 'plan') {
      if (request.method === 'GET') return redirect(`/projects/${projectId}/billing`);
      if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
      return choosePlan(env, { request, url, account, project, pricing, ctx });
    }

    // ---- the cancel ladder (Cloud Phase 24 A11, canvas board E0) ------------
    if (surface === 'cancel') {
      if (!project.subscription_id) return html('<p>Not allowed.</p>', 405);
      const subscription = subscriptionView(await readSubscription(env, project.subscription_id));
      const schedule = cancelSchedule({ periodEndMs: subscription.periodEndMs });

      if (request.method === 'GET') {
        return html(
          cancelPage({
            account,
            project,
            schedule,
            hasExport: Boolean(project.export_sent_at),
          })
        );
      }
      if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);

      const form = await request.formData();
      if (form.get('sure') !== 'yes') {
        return html(
          cancelPage({
            account,
            project,
            schedule,
            hasExport: Boolean(project.export_sent_at),
            error: 'Tick the box to confirm.',
          }),
          400
        );
      }
      // At period end, NOT now: they paid for the rest of the period and
      // taking it away at the moment of cancelling is the cheapest possible
      // way to turn a churn into a complaint.
      const cancelled = await stripe(env, 'POST', `/v1/subscriptions/${project.subscription_id}`, {
        cancel_at_period_end: 'true',
      });
      if (!cancelled.ok) {
        console.error(`[billing] cancel failed (${cancelled.status})`);
        return html(
          cancelPage({
            account,
            project,
            schedule,
            hasExport: Boolean(project.export_sent_at),
            error: 'That could not be cancelled right now, so nothing changed. Try again shortly.',
          }),
          502
        );
      }
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: `customer:${account.email}`,
        action: 'billing.cancelled',
        detail: `ends ${new Date(schedule.pausesOn).toISOString()}`,
      });
      // Worth measuring precisely because it is the uncomfortable number.
      track(env, ctx, { name: 'cancel_requested', accountId: account.id, projectId });
      return redirect(`/projects/${projectId}/billing`);
    }

    if (surface === 'resume') {
      if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
      if (!project.subscription_id) return html('<p>Not allowed.</p>', 405);
      const resumed = await stripe(env, 'POST', `/v1/subscriptions/${project.subscription_id}`, {
        cancel_at_period_end: 'false',
      });
      if (!resumed.ok) {
        console.error(`[billing] resume failed (${resumed.status})`);
        return html('<p>That could not be undone right now. Try again in a minute.</p>', 502);
      }
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: `customer:${account.email}`,
        action: 'billing.resumed',
      });
      return redirect(`/projects/${projectId}/billing`);
    }

    // ---- what goes on the invoice (A10 + D2) --------------------------------
    if (surface === 'details') {
      if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
      if (!account.stripe_customer_id) return html('<p>Not allowed.</p>', 405);
      const form = await request.formData();
      const checked = validateBillingDetails({
        company: form.get('company'),
        line1: form.get('line1'),
        city: form.get('city'),
        postalCode: form.get('postalCode'),
        country: form.get('country'),
        vatId: form.get('vatId'),
      });
      if (!checked.ok) {
        return html(
          await renderBilling(env, {
            account,
            project,
            details: checked.details,
            error: checked.errors.join(' '),
          }),
          400
        );
      }
      const saved = await saveBillingDetails(env, account.stripe_customer_id, checked.details);
      if (!saved.ok) {
        return html(
          await renderBilling(env, {
            account,
            project,
            details: checked.details,
            error: 'Those could not be saved right now, so nothing changed. Try again shortly.',
          }),
          502
        );
      }
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: `customer:${account.email}`,
        action: 'billing.details',
      });
      return html(
        await renderBilling(env, { account, project, notice: 'Saved. Future invoices use these.' })
      );
    }

    if (request.method !== 'GET') return html('<p>Not allowed.</p>', 405);
    return html(await renderBilling(env, { account, project }));
  }

  return null;
}

// ------------------------------------------------------------- the A3 trial
//
// Maude v2 S9.15. Who may get a free workspace is `decideTrialProvision`'s
// (pure); what is left here is reading the facts and writing two rows.

/** The `{project}` a trial create answers — the S6↔S9 cloud-move reads `project.id`. */
function trialProjectBody(env, project) {
  return {
    project: {
      id: project.id,
      name: project.name,
      state: project.state,
      stateLabel: (STATE_COPY[project.state] ?? { label: project.state }).label,
      role: 'owner',
      plan: planState(project),
      trialEndsAt: project.trial_ends_at ?? null,
      url: `https://${project.id}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`,
    },
  };
}

/**
 * Route the address and mark the project live. Idempotent: a `pending` row is
 * retried (the replay of a create heals a failed route), anything else is left
 * alone. There is no charge to void, so a route that fails stays `pending` and
 * says so; the client polls.
 */
async function settleTrialProject(env, project) {
  if (project.state !== 'pending') return project;
  const routed = await ensureCellDomain(env, project.id);
  if (!routed.ok) {
    console.error(`[trial] route ${project.id}: ${routed.error}`);
    return project;
  }
  await ensureProjectCanvasDomain(env, project.id);
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE projects SET state = 'active', state_since = ?, cell_running = 1
      WHERE id = ? AND state = 'pending'`
  )
    .bind(now, project.id)
    .run();
  return { ...project, state: 'active', state_since: now, cell_running: 1 };
}

/** `POST /api/projects {name}` with the device token — the trial-provisioned project. */
async function createTrialProject(request, env, { ctx }) {
  const now = Date.now();
  const bearer = await personalTokenAccount(env, request, { now });
  if (!bearer) {
    return json({ ok: false, reason: 'not-signed-in', error: 'Sign in from the app first.' }, 401);
  }
  let body = null;
  try {
    body = await request.json();
  } catch {
    /* not JSON — validated as a missing name below */
  }
  const named = validateTrialProject({ name: body?.name });
  if (!named.ok) return json({ ok: false, reason: 'bad-name', error: named.error }, 400);
  const key = (request.headers.get('idempotency-key') ?? '').trim();
  if (key && !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) {
    return json({ ok: false, reason: 'bad-request', error: 'That request id is not usable.' }, 400);
  }
  const requestId = key || `name:${named.id}`;

  // The first sign-in started the trial; an account signed in before v19
  // starts it here, at its first use.
  await startTrial(env.DB, bearer.id, { now });
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?')
    .bind(bearer.id)
    .first();
  const emailHash = await trialEmailKey(account.email);

  // A replay is this account's own claim for this request — or for this
  // name, so a retry that lost its id still finds the project it made.
  const prior = await env.DB.prepare(
    `SELECT project_id FROM trial_claims
      WHERE account_id = ? AND (request_id = ? OR project_id = ?) LIMIT 1`
  )
    .bind(account.id, requestId, named.id)
    .first();
  const replay = prior
    ? await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND account_id = ?')
        .bind(prior.project_id, account.id)
        .first()
    : null;
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM trial_claims WHERE email_hash = ?')
    .bind(emailHash)
    .first();
  const taken = await env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(named.id).first();

  const decision = decideTrialProvision({
    account,
    now,
    replay,
    claimsUsed: Number(used?.n ?? 0),
    nameTaken: Boolean(taken),
  });
  if (decision.outcome === 'refuse') {
    return json({ ok: false, reason: decision.reason, error: decision.error }, decision.status);
  }
  if (decision.outcome === 'replay') {
    return json(trialProjectBody(env, await settleTrialProject(env, decision.project)), 200);
  }

  // The claim first, conditionally in ONE statement, so two racing creates
  // cannot both pass the count; then the row. A name lost to a race gives
  // the claim back — a refusal spends nothing.
  const claimed = await env.DB.prepare(
    `INSERT OR IGNORE INTO trial_claims (email_hash, request_id, account_id, project_id, claimed_at)
     SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM trial_claims WHERE email_hash = ?) < ?`
  )
    .bind(emailHash, requestId, account.id, named.id, now, emailHash, TRIALS_PER_VERIFIED_EMAIL)
    .run();
  if (!claimed?.meta?.changes) {
    return json({ ok: false, reason: 'plan', error: ACCESS_MESSAGES.plan }, 402);
  }
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO projects (id, account_id, name, state, state_since, plan, trial_ends_at, created_at)
     VALUES (?, ?, ?, 'pending', ?, 'project', ?, ?)`
  )
    .bind(named.id, account.id, named.name, now, decision.trialEndsAt, now)
    .run();
  if (!inserted?.meta?.changes) {
    await env.DB.prepare('DELETE FROM trial_claims WHERE email_hash = ? AND request_id = ?')
      .bind(emailHash, requestId)
      .run();
    return json(
      {
        ok: false,
        reason: 'name-taken',
        error: 'That name is already a web address here. Pick another name.',
      },
      409
    );
  }
  await audit(env.DB, {
    accountId: account.id,
    projectId: named.id,
    actor: `customer:${account.email}`,
    action: 'trial.provisioned',
    detail: JSON.stringify({ endsAt: decision.trialEndsAt }),
  });
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(named.id).first();
  const project = await settleTrialProject(env, row);
  if (project.state === 'active') {
    track(env, ctx, { name: 'project_provisioned', accountId: account.id, projectId: named.id });
  }
  return json(trialProjectBody(env, project), 201);
}

/** Choose a plan: open Checkout for a trial project, with no second trial. */
async function choosePlan(env, { request, url, account, project, pricing, ctx }) {
  // Only a trial project converts; one with a plan already has one.
  if (project.subscription_id || project.trial_ends_at === null) {
    return html('<p>This project already has a plan.</p>', 409);
  }
  const form = await request.formData();
  const choice = validatePlanChoice({
    plan: String(form.get('plan') ?? ''),
    interval: String(form.get('interval') ?? ''),
    pricing,
  });
  if (!choice.ok) return html(`<p>${choice.error}</p>`, 400);
  let priceId;
  try {
    priceId = priceIdFor(choice.plan, choice.interval, { pricing, mode: stripeMode(env) });
  } catch (err) {
    console.error(`[plan] price resolution: ${err.message}`);
    return html('<p>That plan cannot be started right now.</p>', 503);
  }
  try {
    const customerId = await ensureCustomer(env, account);
    const session = await stripe(
      env,
      'POST',
      '/v1/checkout/sessions',
      checkoutSessionParams({
        projectId: project.id,
        projectName: project.name,
        plan: choice.plan,
        priceId,
        trialDays: null,
        customerId,
        origin: url.origin,
        convert: true,
      })
    );
    if (!session.ok || !session.body?.url) {
      console.error(`[plan] session create: ${session.status}`);
      return html('<p>Payment could not be started. Nothing changed — try again.</p>', 502);
    }
    track(env, ctx, {
      name: 'checkout_started',
      accountId: account.id,
      projectId: project.id,
      props: { plan: choice.plan, interval: choice.interval },
    });
    return redirect(session.body.url);
  } catch (err) {
    console.error(`[plan] ${err.message}`);
    return html('<p>Payment could not be started. Nothing changed — try again.</p>', 502);
  }
}

/** The Checkout return for Choose a plan: attach the subscription to the row. */
async function convertTrialProject(env, { account, projectId, session, sessionId, now, ctx }) {
  const subscriptionId = String(session.subscription);
  const updated = await env.DB.prepare(
    `UPDATE projects SET subscription_id = ?, plan = ?
      WHERE id = ? AND account_id = ? AND subscription_id IS NULL AND trial_ends_at IS NOT NULL`
  )
    .bind(subscriptionId, session.metadata.plan || 'project', projectId, account.id)
    .run();
  if (!updated?.meta?.changes) {
    const row = await env.DB.prepare('SELECT subscription_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first();
    if (row?.subscription_id !== subscriptionId) {
      // Two completed Checkouts for one project: the second subscription is
      // not attached anywhere. Loud, audited, and left for a human — an
      // automatic cancel of a paid subscription is not this page's to make.
      console.error(`[plan] ${projectId}: second subscription ${subscriptionId} not attached`);
      await audit(env.DB, {
        accountId: account.id,
        projectId,
        actor: 'system',
        action: 'checkout.convert-duplicate',
        detail: JSON.stringify({ session: sessionId, subscription: subscriptionId }),
      });
    }
    return redirect(`/projects/${projectId}/billing`);
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO checkout_attempts (session_id, project_id, payment, subscription_id, authorized_at, settled_at, created_at)
     VALUES (?, ?, 'charged', ?, ?, ?, ?)`
  )
    .bind(sessionId, projectId, subscriptionId, now, now, now)
    .run();
  await audit(env.DB, {
    accountId: account.id,
    projectId,
    actor: `customer:${account.email}`,
    action: 'checkout.converted',
    detail: JSON.stringify({ session: sessionId }),
  });
  track(env, ctx, {
    name: 'checkout_completed',
    accountId: account.id,
    projectId,
    props: { plan: session.metadata.plan === 'dedicated' ? 'dedicated' : 'project' },
  });
  return redirect(`/projects/${projectId}/billing`);
}

// -------------------------------------------------------------- billing reads
//
// EVERY Stripe read on the billing page is best-effort and non-fatal. This is
// the page somebody opens when their card failed; a Stripe outage that blanks
// it turns one problem into two, and the state card — the part that answers
// "is my work safe" — comes from our own database and always renders.

/** One subscription, or null when Stripe cannot say. */
async function readSubscription(env, subscriptionId) {
  if (!subscriptionId || !env.STRIPE_SECRET_KEY) return null;
  try {
    const res = await stripe(env, 'GET', `/v1/subscriptions/${subscriptionId}`);
    return res.ok ? res.body : null;
  } catch (err) {
    console.error(`[billing] subscription read: ${err.message}`);
    return null;
  }
}

/** Assemble the billing page from our row plus whatever Stripe answers. */
async function renderBilling(
  env,
  { account, project, details = null, error = null, notice = null }
) {
  const stateCopy = STATE_COPY[project.state] ?? { label: project.state, note: null };
  const canPortal = Boolean(account.stripe_customer_id && project.subscription_id);
  const pausedUntil = pauseClock({ state: project.state, stateSince: project.state_since });
  if (!canPortal) {
    return billingPage({ account, project, stateCopy, canPortal, pausedUntil, error, notice });
  }

  const subscription = subscriptionView(await readSubscription(env, project.subscription_id));

  let invoices = [];
  let invoicesUnavailable = false;
  try {
    const res = await stripe(
      env,
      'GET',
      `/v1/invoices?customer=${encodeURIComponent(account.stripe_customer_id)}&limit=12`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    invoices = invoiceRows(res.body?.data ?? []);
  } catch (err) {
    console.error(`[billing] invoice list: ${err.message}`);
    invoicesUnavailable = true;
  }

  // A just-submitted form wins over what Stripe holds: re-rendering somebody's
  // rejected input as the old saved values loses what they typed.
  let onFile = details;
  let detailsUnavailable = false;
  if (!onFile) {
    try {
      onFile = await readBillingDetails(env, account.stripe_customer_id);
    } catch (err) {
      console.error(`[billing] details read: ${err.message}`);
      detailsUnavailable = true;
    }
  }

  return billingPage({
    account,
    project,
    stateCopy,
    canPortal,
    subscription,
    invoices,
    invoicesUnavailable,
    details: onFile,
    detailsUnavailable,
    pausedUntil,
    error,
    notice,
  });
}

/** What Stripe currently holds for this customer, in our own shape. */
async function readBillingDetails(env, customerId) {
  const customer = await stripe(env, 'GET', `/v1/customers/${customerId}`);
  if (!customer.ok) throw new Error(`customer HTTP ${customer.status}`);
  const taxIds = await stripe(env, 'GET', `/v1/customers/${customerId}/tax_ids?limit=1`);
  const vat = taxIds.ok ? currentVatId(taxIds.body?.data ?? []) : null;
  const address = customer.body?.address ?? {};
  return {
    company: customer.body?.name ?? '',
    line1: address.line1 ?? '',
    city: address.city ?? '',
    postalCode: address.postal_code ?? '',
    country: address.country ?? '',
    vatId: vat?.value ?? '',
  };
}

/**
 * Write them back.
 *
 * A tax id cannot be edited at Stripe, only replaced — so the old one is
 * removed and the new one created. Order matters: remove first, because a
 * customer briefly holding two VAT ids is a customer whose next invoice may
 * carry the wrong one.
 */
async function saveBillingDetails(env, customerId, details) {
  const updated = await stripe(env, 'POST', `/v1/customers/${customerId}`, {
    ...customerParams(details),
    'tax[validate_location]': 'deferred',
  });
  if (!updated.ok) return { ok: false };

  const existing = await stripe(env, 'GET', `/v1/customers/${customerId}/tax_ids?limit=1`);
  const held = existing.ok ? currentVatId(existing.body?.data ?? []) : null;
  if (held && held.value !== details.vatId) {
    await stripe(env, 'DELETE', `/v1/customers/${customerId}/tax_ids/${held.id}`);
  }
  if (details.vatId && held?.value !== details.vatId) {
    const created = await stripe(env, 'POST', `/v1/customers/${customerId}/tax_ids`, {
      type: 'eu_vat',
      value: details.vatId,
    });
    // A rejected VAT id is a validation failure the customer must see, not a
    // silent no-op that leaves them believing it was saved.
    if (!created.ok) return { ok: false };
  }
  return { ok: true };
}

/** For tests: the public pricing shape the wizard renders from. */
export function wizardPricing() {
  return publicPricing({ pricing: pricingCatalog });
}
