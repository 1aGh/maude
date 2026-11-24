// The operator surface's routes — Cloud Phase 26 Stage 1, the effects layer.
//
// A module of its own rather than another branch in worker.mjs, for the reason
// worker.mjs's own header gives: it is thin on purpose (DDR-196 §1), and this
// is six routes with their own D1 reads. Every DECISION here is imported from
// operator.mjs, which is pure and exhaustively tested; what is left is
// fetching, rendering and one insert.
//
// FIVE SECURITY INVARIANTS, each of which is a test rather than a comment:
//
//   1. COOKIE SESSION ONLY. `account` arrives from worker.mjs's single
//      `currentAccount()` read. This module deliberately does NOT import
//      device-auth.mjs — the `personalTokenAccount(...) ?? currentAccount(...)`
//      two-door pattern at worker.mjs:82 is correct for opening a project and
//      would be catastrophic here, because it would make a leaked device token
//      a key to the whole fleet. `operator-routes.test.mjs` asserts the import
//      is absent, so the door cannot be added back by accident.
//   2. 404, NEVER 403. A signed-in non-operator gets the same body a wrong URL
//      gets. The precedent is openProject: "404 for everything that is not
//      sign in", so the response never confirms the surface exists.
//   3. ITS OWN CSRF TOKEN ON THE ONE WRITE, DERIVED FROM THE SESSION.
//      `edge.mjs sameSiteGate` carries most of the load — it refuses
//      `same-site` as well as cross-site, which IS the tenant-canvas-on-a-
//      sibling-subdomain case — but it fails OPEN when `Sec-Fetch-Site` is
//      absent, so it decides nothing about a non-browser client holding a
//      stolen cookie. The token closes that, and it is DERIVED rather than a
//      double-submit cookie because a sibling subdomain can SET a cookie for
//      the parent domain even though it cannot read one (see `deriveCsrf`).
//   4. READS ARE AUDITED. A fleet-wide list of who our customers are IS the
//      break-glass, whatever the URL says. DDR-193 §4's promise is "you can
//      see that we looked", and it is worth nothing if the looking that
//      spans every tenant is the looking that goes unrecorded.
//   5. NO WRITE TOUCHES A SUBSCRIPTION. Comp and refund stay in Stripe —
//      schema.sql designates it the subscription authority, and a second place
//      that can change a subscription is a second place that can disagree with
//      it. The writes that exist (operator-actions.mjs: free time, Promo, a
//      pause by hand, a project made for somebody, a move, a sign-out, and the
//      original reconcile nudge) each pass ONE gate — `gate()` below: the
//      session-derived token, then a required reason — before anything is
//      read or written, and each lands in the audit log with that reason.

import { boardMetrics, tenantMetrics, totalContent } from './analytics.mjs';
import { SESSION_COOKIE } from './auth-routes.mjs';
import { audit, enqueueReconcile } from './db.mjs';
import { pageCsp } from './edge.mjs';
import {
  assembleBoard,
  CSRF_FIELD,
  checkNudge,
  deriveCsrf,
  deriveMrr,
  isOperator,
  operatorIds,
} from './operator.mjs';
import {
  createProjectFor,
  endOfDay,
  endPromo,
  giveFreeTime,
  markPromo,
  moveProject,
  parseFreeTime,
  parseInviteList,
  setHold,
  signOutEverywhere,
} from './operator-actions.mjs';
import {
  operatorAccountPage,
  operatorAccountsPage,
  operatorEventsPage,
  operatorNewProjectPage,
  operatorOverviewPage,
  operatorProjectPage,
  operatorProjectsPage,
} from './operator-pages.mjs';
import pricingCatalog from './pricing.json' with { type: 'json' };

/** Same id shape the rest of the plane validates before it reaches D1. */
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** An account id, as accounts.mjs mints them. */
const ACCOUNT_ID = /^acct_[A-Za-z0-9_-]{1,64}$/;
/** A free-time form's request id (the page mints a UUID per form). */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // An operator board is exactly the page a shared cache must never hold.
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // TIGHTER than the edge floor, never narrower. `harden()` fills a header
      // only when it is absent, so a route that sets its own CSP inherits
      // nothing — and the first cut silently dropped `frame-ancestors 'none'`
      // and `base-uri 'none'` from the one page carrying a privileged form.
      // edge.mjs's contract is that a route may tighten what it stamps and can
      // no longer forget it; this is that contract, honoured by hand.
      'content-security-policy': pageCsp(),
      'referrer-policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

/**
 * The one answer a non-operator ever gets here.
 *
 * BYTE-IDENTICAL to what a wrong URL gets from worker.mjs — same status, same
 * content-type, same body. The first cut answered `text/html` while the
 * generic 404 answers JSON, which meant a signed-in non-operator could confirm
 * the surface exists from the content-type alone. A 404 that is distinguishable
 * from the real 404 is a 403 wearing a different number.
 */
function notFound() {
  return new Response(JSON.stringify({ ok: false, error: 'not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  });
}

function redirect(to, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { location: to, ...extraHeaders } });
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * This session's CSRF token.
 *
 * A pure function of (session, key), so every tab of the same session gets the
 * same value and nothing has to be stored or re-minted. `null` when no signing
 * key is configured, which `checkNudge` treats as a refusal — fail closed.
 */
function csrfFor(request, env) {
  return deriveCsrf(cookieValue(request, SESSION_COOKIE), env.CELL_SECRET_MASTER ?? '');
}

/** Best-effort audit — a recording failure must not deny the operator the page. */
function record(env, ctx, entry) {
  const write = audit(env.DB, entry).catch((err) => {
    console.error(`[operator] audit failed: ${err.message}`);
  });
  if (ctx?.waitUntil) ctx.waitUntil(write);
  return write;
}

// --------------------------------------------------------------------- reads

async function listProjectsWithOwners(db) {
  try {
    const { results } = await db
      .prepare(
        `SELECT p.*, a.email AS owner_email
           FROM projects p LEFT JOIN accounts a ON a.id = p.account_id
          ORDER BY p.created_at DESC`
      )
      .all();
    return results ?? [];
  } catch (err) {
    console.error(`[operator] project listing failed: ${err.message}`);
    return [];
  }
}

async function countAccounts(db) {
  try {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM accounts').first();
    // `null` rather than 0 when the count could not be read — the whole
    // surface's rule is that unknown never renders as a number.
    return row?.n ?? null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- router

/**
 * @param {object} deps
 * @param {{id: string, email: string}|null} deps.account  from the COOKIE session
 * @param {{waitUntil?: Function}} [deps.ctx]
 */
export async function handleOperatorRoutes(
  request,
  env,
  { account, ctx, reconcileNow = null } = {}
) {
  const url = new URL(request.url);
  if (url.pathname !== '/operator' && !url.pathname.startsWith('/operator/')) return null;

  // A surface that is switched OFF does not exist for anybody, signed in or
  // not. Checked FIRST: the first cut redirected an anonymous caller to
  // /login even with an empty allowlist, which made "every /operator hit 404s"
  // false and told a stranger the path was real.
  if (operatorIds(env).length === 0) return notFound();

  if (!account) {
    // A caller presenting a token is a non-browser client, and this surface
    // has exactly one door. Answering it with "sign in over there" implies a
    // second one; 404 says the surface is not theirs to reach.
    if (request.headers.get('authorization')) return notFound();
    // …and so does everybody else who is not signed in. A redirect to /login
    // told a stranger that `/operator/accounts/<id>` is a real route worth
    // signing in for; an unknown URL says nothing. An operator signs in at
    // /login like anyone, and the dashboard carries the way in.
    return notFound();
  }
  if (!isOperator(env, account)) return notFound();

  const actor = `operator:${account.email}`;

  // ------------------------------------------------------------- overview
  if (url.pathname === '/operator' && request.method === 'GET') {
    // CONCURRENT — nothing here depends on anything before it, and the two
    // analytics reads each carry an 8 s timeout. In series, the page whose
    // whole justification is "opens during an outage" is the page that makes
    // you wait through every one of them.
    const [projects, metrics, tenant, accounts] = await Promise.all([
      listProjectsWithOwners(env.DB),
      boardMetrics(env),
      tenantMetrics(env),
      countAccounts(env.DB),
    ]);
    // Analytics is OPTIONAL everywhere it appears. `boardMetrics` reports
    // `ok: false` when the read token is unset, and the page simply renders
    // fewer tiles — a board that cannot come up because one tile has no data
    // is a board that cannot report the outage it exists for.
    record(env, ctx, { accountId: account.id, actor, action: 'operator.board.viewed' });
    return html(
      operatorOverviewPage({
        account,
        board: assembleBoard({ projects, render: tenant.render }),
        mrr: deriveMrr(projects, pricingCatalog),
        accounts,
        metrics: metrics.ok ? { ...metrics, coldStartP95Ms: tenant.coldStartP95Ms } : null,
        totals: totalContent(tenant.stats),
      })
    );
  }

  // ------------------------------------------------------------- projects
  if (url.pathname === '/operator/projects' && request.method === 'GET') {
    const tenant = await tenantMetrics(env);
    record(env, ctx, { accountId: account.id, actor, action: 'operator.projects.viewed' });
    return html(
      operatorProjectsPage({
        account,
        projects: await listProjectsWithOwners(env.DB),
        // `null` (not an empty Map) when analytics could not answer: the
        // columns disappear entirely rather than filling with em-dashes that
        // look like every cell failed to report.
        stats: tenant.stats,
        render: tenant.render,
      })
    );
  }

  // ------------------------------------------------------------- accounts
  if (url.pathname === '/operator/accounts' && request.method === 'GET') {
    // Search by e-mail, project name or project id. The term is a LITERAL:
    // `%` and `_` are escaped, so a wildcard typed here finds only itself.
    const q = String(url.searchParams.get('q') ?? '')
      .trim()
      .slice(0, 120);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    let accounts = [];
    try {
      const { results } = q
        ? await env.DB.prepare(
            `SELECT a.id, a.email, a.stripe_customer_id, a.created_at,
                    (SELECT COUNT(*) FROM projects p WHERE p.account_id = a.id) AS projects
               FROM accounts a
              WHERE a.email LIKE ?1 ESCAPE '\\' OR a.id = ?2
                 OR EXISTS (SELECT 1 FROM projects p WHERE p.account_id = a.id
                             AND (p.name LIKE ?1 ESCAPE '\\' OR p.id LIKE ?1 ESCAPE '\\'))
              ORDER BY a.created_at DESC LIMIT 200`
          )
            .bind(like, q)
            .all()
        : await env.DB.prepare(
            `SELECT a.id, a.email, a.stripe_customer_id, a.created_at,
                    (SELECT COUNT(*) FROM projects p WHERE p.account_id = a.id) AS projects
               FROM accounts a ORDER BY a.created_at DESC`
          ).all();
      accounts = results ?? [];
    } catch (err) {
      console.error(`[operator] account listing failed: ${err.message}`);
    }
    // The most break-glass read on the surface: every customer's address, in
    // one place. Recorded first-class rather than folded into a page view.
    record(env, ctx, { accountId: account.id, actor, action: 'operator.accounts.viewed' });
    return html(operatorAccountsPage({ account, accounts, q }));
  }

  // ---------------------------------------------------------- one account
  const accountPage = url.pathname.match(/^\/operator\/accounts\/([A-Za-z0-9_-]+)$/);
  if (accountPage && request.method === 'GET') {
    const [, accountId] = accountPage;
    if (!ACCOUNT_ID.test(accountId)) return notFound();
    const target = await loadAccount(env.DB, accountId);
    if (!target) return notFound();
    const projects = await accountProjects(env, accountId);
    // The page is the looking, recorded against the account looked at — and
    // written BEFORE the log is read, so the row is on the page it describes.
    await record(env, null, {
      accountId,
      actor,
      action: 'operator.account.viewed',
      detail: JSON.stringify({ operator: account.id }),
    });
    const entries = await env.DB.prepare(
      `SELECT at, actor, action, reason, project_id FROM audit_log
        WHERE account_id = ?1 OR project_id IN (SELECT id FROM projects WHERE account_id = ?1)
        ORDER BY at DESC LIMIT 60`
    )
      .bind(accountId)
      .all()
      .then((r) => r?.results ?? [])
      .catch(() => []);
    const paying = projects.filter((p) => p.subscription_id);
    return html(
      operatorAccountPage({
        account,
        target,
        projects,
        entries,
        csrf: (await csrfFor(request, env)) ?? '',
        believedMonthlyMinor: deriveMrr(paying, pricingCatalog).believedMonthlyMinor,
        currency: pricingCatalog.currency,
        notice: noticeFor(url),
        error: ERRORS[url.searchParams.get('error')] ?? null,
      })
    );
  }

  // ------------------------------------------------- new project (the form)
  if (url.pathname === '/operator/new-project' && request.method === 'GET') {
    return html(
      operatorNewProjectPage({
        account,
        csrf: (await csrfFor(request, env)) ?? '',
        values: { owner: String(url.searchParams.get('owner') ?? '').slice(0, 254) },
      })
    );
  }

  // --------------------------------------------------------------- events
  if (url.pathname === '/operator/events' && request.method === 'GET') {
    const metrics = await boardMetrics(env);
    record(env, ctx, { accountId: account.id, actor, action: 'operator.events.viewed' });
    return html(
      operatorEventsPage({
        account,
        metrics: metrics.ok ? metrics : null,
        sampled: metrics.ok ? metrics.sampled : false,
      })
    );
  }

  // ------------------------------------------------------- project detail
  const detail = url.pathname.match(/^\/operator\/projects\/([a-z0-9-]+)$/);
  if (detail && request.method === 'GET') {
    const [, projectId] = detail;
    if (!PROJECT_ID.test(projectId)) return notFound();
    const project = await env.DB.prepare(
      `SELECT p.*, a.email AS owner_email
         FROM projects p LEFT JOIN accounts a ON a.id = p.account_id
        WHERE p.id = ?`
    )
      .bind(projectId)
      .first()
      .catch(() => null);
    if (!project) return notFound();

    const jobs = await env.DB.prepare(
      'SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20'
    )
      .bind(projectId)
      .all()
      .then((r) => r?.results ?? [])
      .catch(() => []);
    const entries = await env.DB.prepare(
      'SELECT at, actor, action, reason FROM audit_log WHERE project_id = ? ORDER BY at DESC LIMIT 50'
    )
      .bind(projectId)
      .all()
      .then((r) => r?.results ?? [])
      .catch(() => []);

    record(env, ctx, {
      accountId: account.id,
      projectId,
      actor,
      action: 'operator.project.viewed',
    });

    const tenant = await tenantMetrics(env);
    return html(
      operatorProjectPage({
        account,
        project,
        jobs,
        entries,
        stats: tenant.stats?.get(projectId) ?? null,
        render: tenant.render?.get(projectId) ?? null,
        csrf: (await csrfFor(request, env)) ?? '',
        notice: url.searchParams.get('nudged') ? 'Reconcile enqueued.' : noticeFor(url),
        error: ERRORS[url.searchParams.get('error')] ?? null,
      })
    );
  }

  // ----------------------------------------------------------- the actions
  //
  // ONE GATE for every write below, in one order: the form is read, the token
  // is checked, the reason is checked — and only then is anything looked up.
  // A caller without the token learns nothing, including whether the target
  // exists.
  const gate = async () => {
    let form;
    try {
      form = await request.formData();
    } catch {
      return { refusal: html('<p>That form could not be read.</p>', 400) };
    }
    const verdict = checkNudge({
      expected: await csrfFor(request, env),
      fieldValue: String(form.get(CSRF_FIELD) ?? ''),
      reason: form.get('reason'),
    });
    if (!verdict.ok && verdict.reason === 'csrf') {
      return { refusal: html('<p>That request could not be verified.</p>', 403) };
    }
    return { form, reason: verdict.ok ? verdict.cleaned : null, problem: verdict.reason ?? null };
  };
  const origin = url.origin;

  // ---- new project for an account (POST)
  if (url.pathname === '/operator/new-project' && request.method === 'POST') {
    const g = await gate();
    if (g.refusal) return g.refusal;
    const values = Object.fromEntries(
      ['owner', 'name', 'plan', 'tier', 'ends', 'invites', 'reason'].map((k) => [
        k,
        String(g.form.get(k) ?? ''),
      ])
    );
    const again = async (error, status) =>
      html(
        operatorNewProjectPage({
          account,
          csrf: (await csrfFor(request, env)) ?? '',
          values,
          error,
        }),
        status
      );
    if (!g.reason) return again(ERRORS[g.problem] ?? ERRORS['no-reason'], 400);
    const list = parseInviteList(values.invites);
    if (list.bad.length || list.tooMany) {
      return again(
        list.tooMany
          ? 'That is more than 20 people to invite at once.'
          : `These do not look like email addresses: ${list.bad.join(', ').slice(0, 200)}`,
        400
      );
    }
    let endsAt = null;
    if (values.plan === 'promo' && values.ends.trim()) {
      endsAt = endOfDay(values.ends);
      if (endsAt === null) return again('The end date is not a date.', 400);
    }
    const made = await createProjectFor(env, {
      operator: account,
      ownerEmail: values.owner,
      name: values.name,
      plan: values.plan,
      tier: values.plan === 'promo' ? values.tier : null,
      endsAt,
      invites: list.emails,
      reason: g.reason,
      origin,
      ctx,
    });
    if (!made.ok) return again(made.error, made.status);
    return redirect(`/operator/accounts/${made.owner.id}?done=project-made`);
  }

  // ---- account-wide actions
  const accountAction = url.pathname.match(
    /^\/operator\/accounts\/([A-Za-z0-9_-]+)\/(free-time|sign-out)$/
  );
  if (accountAction && request.method === 'POST') {
    const [, accountId, verb] = accountAction;
    if (!ACCOUNT_ID.test(accountId)) return notFound();
    const g = await gate();
    if (g.refusal) return g.refusal;
    const back = (query) => redirect(`/operator/accounts/${accountId}?${query}`);
    if (!g.reason) return back(`error=${g.problem}`);
    const target = await loadAccount(env.DB, accountId);
    if (!target) return notFound();

    if (verb === 'sign-out') {
      await signOutEverywhere(env, {
        operator: account,
        account: target,
        reason: g.reason,
        ctx,
      });
      return back('done=signed-out');
    }
    const parsed = parseFreeTime({ days: g.form.get('days'), until: g.form.get('until') });
    if (!parsed.ok) return back(`error=${parsed.reason}`);
    const rid = String(g.form.get('rid') ?? '');
    if (!REQUEST_ID.test(rid)) return back('error=free-bad-request');
    const { results } = await env.DB.prepare(
      `SELECT * FROM projects WHERE account_id = ? AND state != 'purged' ORDER BY name`
    )
      .bind(accountId)
      .all();
    const out = await giveFreeTime(env, {
      operator: account,
      projects: results ?? [],
      days: parsed.days,
      until: parsed.until,
      reason: g.reason,
      requestId: rid,
      scope: `account:${accountId}`,
      origin,
      ctx,
    });
    if (!out.ok) return back(`error=${out.reason}`);
    if (!out.given.length) return back('error=free-none');
    return back(`done=free-time&given=${out.given.length}&skipped=${out.refused.length}`);
  }

  // ---- project actions
  const action = url.pathname.match(
    /^\/operator\/projects\/([a-z0-9-]+)\/(free-time|promo|promo\/end|pause|wake|move)$/
  );
  if (action && request.method === 'POST') {
    const [, projectId, verb] = action;
    if (!PROJECT_ID.test(projectId)) return notFound();
    const g = await gate();
    if (g.refusal) return g.refusal;
    // Existence is checked AFTER the token, as the nudge does.
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?')
      .bind(projectId)
      .first()
      .catch(() => null);
    if (!project) return notFound();
    const base =
      g.form.get('back') === 'account'
        ? `/operator/accounts/${project.account_id}`
        : `/operator/projects/${projectId}`;
    const back = (query) => redirect(`${base}?${query}`);
    if (!g.reason) return back(`error=${g.problem}`);
    const common = { operator: account, project, reason: g.reason, ctx };

    if (verb === 'free-time') {
      const parsed = parseFreeTime({ days: g.form.get('days'), until: g.form.get('until') });
      if (!parsed.ok) return back(`error=${parsed.reason}`);
      const rid = String(g.form.get('rid') ?? '');
      if (!REQUEST_ID.test(rid)) return back('error=free-bad-request');
      const out = await giveFreeTime(env, {
        operator: account,
        projects: [project],
        days: parsed.days,
        until: parsed.until,
        reason: g.reason,
        requestId: rid,
        scope: `project:${projectId}`,
        origin,
        ctx,
      });
      if (!out.ok) return back(`error=${out.reason}`);
      if (out.refused.length) return back(`error=free-${out.refused[0].why}`);
      return back('done=free-time');
    }

    if (verb === 'promo') {
      const raw = String(g.form.get('ends') ?? '').trim();
      const endsAt = raw ? endOfDay(raw) : null;
      if (raw && endsAt === null) return back('error=promo-bad-date');
      const out = await markPromo(env, {
        ...common,
        tier: String(g.form.get('tier') ?? ''),
        endsAt,
      });
      if (!out.ok) return back(`error=${out.reason}`);
      return back(`done=${out.changed ? 'promo' : 'promo-same'}`);
    }

    if (verb === 'promo/end') {
      const raw = String(g.form.get('ends') ?? '').trim();
      const endsAt = raw ? endOfDay(raw) : Date.now();
      if (endsAt === null) return back('error=promo-bad-date');
      const out = await endPromo(env, { ...common, endsAt, reconcileNow });
      if (!out.ok) return back(`error=${out.reason}`);
      return back('done=promo-end');
    }

    if (verb === 'pause' || verb === 'wake') {
      const out = await setHold(env, { ...common, hold: verb === 'pause', reconcileNow });
      if (!out.ok) return back(`error=${out.reason}`);
      const word = verb === 'pause' ? 'paused' : 'woken';
      return back(`done=${!out.changed || out.settled ? word : `${word}-queued`}`);
    }

    // move
    const out = await moveProject(env, { ...common, toEmail: String(g.form.get('to') ?? '') });
    if (!out.ok) return back(`error=${out.reason}`);
    return back(`done=${out.changed ? 'moved' : 'moved-same'}`);
  }

  // ------------------------------------------------------ the one write
  const nudge = url.pathname.match(/^\/operator\/projects\/([a-z0-9-]+)\/reconcile$/);
  if (nudge && request.method === 'POST') {
    const [, projectId] = nudge;
    if (!PROJECT_ID.test(projectId)) return notFound();

    let form;
    try {
      form = await request.formData();
    } catch {
      return html('<p>That form could not be read.</p>', 400);
    }

    const verdict = checkNudge({
      expected: await csrfFor(request, env),
      fieldValue: String(form.get(CSRF_FIELD) ?? ''),
      reason: form.get('reason'),
    });
    if (!verdict.ok) {
      // A forged request gets a bare refusal and learns nothing about the
      // project — including whether it exists.
      if (verdict.reason === 'csrf') return html('<p>That request could not be verified.</p>', 403);
      return redirect(`/operator/projects/${projectId}?error=${verdict.reason}`);
    }

    // Existence is checked AFTER the token, so a caller without one cannot use
    // this route to probe which project ids are real.
    const exists = await env.DB.prepare('SELECT id FROM projects WHERE id = ?')
      .bind(projectId)
      .first()
      .catch(() => null);
    if (!exists) return notFound();

    await enqueueReconcile(env.DB, { projectId, reason: 'manual' });
    // The reason is REQUIRED by the application, not by the schema — and this
    // entry is customer-visible on their own activity page. An operator's
    // words about why they touched somebody's project are the point.
    await audit(env.DB, {
      projectId,
      actor,
      action: 'operator.reconcile.nudged',
      reason: verdict.cleaned,
    });
    return redirect(`/operator/projects/${projectId}?nudged=1`);
  }

  return notFound();
}

/** One account, with what the header shows: how it signs in, when it was last here, its Macs. */
async function loadAccount(db, accountId) {
  try {
    const row = await db
      .prepare(
        `SELECT a.id, a.email, a.name, a.created_at, a.stripe_customer_id, a.google_sub,
                a.password_hash IS NOT NULL AS password_hash,
                (SELECT COUNT(*) FROM personal_tokens t
                  WHERE t.account_id = a.id AND t.revoked_at IS NULL) AS macs,
                (SELECT MAX(s.created_at) FROM sessions s WHERE s.account_id = a.id) AS last_session,
                (SELECT MAX(t.last_used_at) FROM personal_tokens t WHERE t.account_id = a.id) AS last_mac
           FROM accounts a WHERE a.id = ?`
      )
      .bind(accountId)
      .first();
    if (!row) return null;
    const lastSeen = Math.max(Number(row.last_session ?? 0), Number(row.last_mac ?? 0));
    // The password HASH never leaves the query: the page needs only "has one".
    return { ...row, password_hash: Boolean(row.password_hash), last_seen: lastSeen || null };
  } catch (err) {
    console.error(`[operator] account read failed: ${err.message}`);
    return null;
  }
}

/** Every project an account owns, with its people, open invitations and reported stats. */
async function accountProjects(env, accountId) {
  let rows = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.*, a.email AS owner_email,
              1 + (SELECT COUNT(*) FROM project_members m
                    WHERE m.project_id = p.id AND m.account_id != p.account_id) AS people,
              (SELECT COUNT(*) FROM project_invites i
                WHERE i.project_id = p.id AND i.redeemed_at IS NULL AND i.revoked_at IS NULL
                  AND i.expires_at > ?2) AS invitesOpen
         FROM projects p LEFT JOIN accounts a ON a.id = p.account_id
        WHERE p.account_id = ?1 ORDER BY p.created_at DESC`
    )
      .bind(accountId, Date.now())
      .all();
    rows = results ?? [];
  } catch (err) {
    console.error(`[operator] account projects failed: ${err.message}`);
  }
  // Analytics is optional here as everywhere: no token, no stats, no error.
  const tenant = rows.length ? await tenantMetrics(env) : { stats: null };
  return rows.map((p) => ({ ...p, stats: tenant.stats?.get(p.id) ?? null }));
}

/** What a finished action says, by code — never a string from the URL. */
const DONE = {
  'free-time': 'Free time given. The owner was sent one e-mail.',
  promo: 'Marked as Promo.',
  'promo-same': 'Already Promo with those settings. Nothing changed.',
  'promo-end': 'The Promo end date is set.',
  paused: 'Paused.',
  'paused-queued':
    'Paused. The platform check could not run just now, so it is queued for the next hourly pass.',
  woken: 'Woken.',
  'woken-queued':
    'The pause is lifted. The platform check could not run just now, so it is queued for the next hourly pass.',
  moved: 'Moved. The previous owner stays on the project as Can edit.',
  'moved-same': 'That account already owns this project. Nothing changed.',
  'signed-out': 'Signed out everywhere.',
  'project-made': 'Project made.',
};

function noticeFor(url) {
  const code = url.searchParams.get('done');
  const base = DONE[code] ?? null;
  if (!base) return null;
  const skipped = Number(url.searchParams.get('skipped') ?? 0);
  if (code === 'free-time' && Number.isInteger(skipped) && skipped > 0) {
    return `${base} ${skipped} ${skipped === 1 ? 'project was' : 'projects were'} left alone — the log says why.`;
  }
  return base;
}

/** What a refused action tells the operator, in their own page. */
const ERRORS = {
  'no-reason': 'A reason is required — it is recorded, and the customer can read it.',
  'reason-too-long': 'That reason is longer than 500 characters.',
  'free-paid':
    'This project has a paid plan at Stripe, so free time would not change what is charged. Nothing was changed — a credit or a coupon is made in Stripe.',
  'free-promo': 'This project is on Promo. Change the Promo end date instead. Nothing was changed.',
  'free-gone': 'This project is deleted or queued for deletion. Nothing was changed.',
  'free-no-plan':
    'This project has no trial clock, so it never expires — free time would put an end date on it. Nothing was changed. Mark it as Promo to record why it is free.',
  'free-not-later': 'The project is already free past that date. Nothing was changed.',
  'free-none':
    'No project of this account could be given free time — each has a paid plan, is on Promo or is deleted. Nothing was changed.',
  'free-bad-days': 'Pick 14 days, 30 days, 3 months or a date.',
  'free-bad-date': 'Pick a date in the future, at most three years away.',
  'free-bad-request': 'That form was already used. Reload the page and try again.',
  'promo-paid':
    'This project has a paid plan, and a project is never both paid and Promo. Nothing was changed.',
  'promo-gone': 'This project is deleted or queued for deletion. Nothing was changed.',
  'promo-tier': 'Pick the storage for this Promo.',
  'promo-bad-date': 'Pick a date in the future, at most three years away — or leave it empty.',
  'promo-none': 'This project is not on Promo. Nothing was changed.',
  'pause-checkout-open':
    'A checkout is open for this project — its owner is paying right now. Nothing was changed; try again once the payment has landed or a day has passed.',
  'pause-not-running': 'Only a running project can be paused. Nothing was changed.',
  'wake-not-held': 'This project is not paused by an operator. Nothing was changed.',
  'move-no-account':
    'No account has that address. The new owner signs up first — nothing was moved.',
  'move-unverified':
    'That account has not confirmed its e-mail, so the project was not moved to it. Nothing was changed.',
  'move-checkout-open':
    'A checkout is open for this project — its owner is paying right now. Nothing was moved; try again once the payment has landed or a day has passed.',
  'move-paid':
    'This project has a subscription that belongs to its current owner. Move the subscription in Stripe first — nothing was moved.',
  'move-gone': 'This project is deleted. Nothing was moved.',
};
