// What an operator can DO — canvas 16 (cl-operator, cl-op-promo, cl-op-account).
//
// Until now the operator surface had one write, a reconcile nudge, and the
// rule beside it said suspend/comp stay in Stripe. That rule still holds for
// MONEY: nothing here creates, changes or cancels a subscription, and a
// project with one is refused by every action that would disagree with it.
// What is new is everything that is not money at Stripe — time a project is
// free for, a project that is free on purpose, a pause by hand, a project
// made for somebody, a project handed to another owner, an account signed out.
//
// THE SHAPE EVERY ACTION KEEPS:
//
//   - ONE DOOR. The route module checks the operator, the CSRF token and the
//     reason before any function here runs; nothing here authenticates.
//   - THE EXISTING MACHINERY DOES THE WORK. A pause is a column the reconciler
//     reads, then the reconciler's own `runOne` (handed in as `reconcileNow`);
//     waking a trial that ran out is the same cell restart Choose a plan does;
//     a new project is routed by the trial path's `settleTrialProject`;
//     invitations are `createProjectInvite`; sign-out is the rows the account's
//     own "delete" and "Your Macs" pages write.
//   - SAFE TO SEND TWICE. Each write is to an absolute value, guarded in its
//     WHERE; the one relative action (add N days) decides its dates once and
//     keeps them in `operator_actions`, so a retry re-applies the same dates.
//   - EVERY ACTION IS IN THE LOG, with the operator's reason, against the
//     project and the account it touched. That log is the customer's to read
//     (DDR-193 §4) — which is why the forms say the reason can be read.

import { createProjectInvite, transferOwnership } from './access-forward.mjs';
import {
  createAccount,
  getAccountByEmail,
  normalizeEmail,
  revokeAccountSessions,
  trialEmailKey,
} from './accounts.mjs';
import { FREE_TIME_DAYS, TRIAL_DAYS, TRIALS_PER_VERIFIED_EMAIL } from './billing.mjs';
import { validateTrialProject } from './checkout.mjs';
import { settleTrialProject } from './checkout-routes.mjs';
import {
  audit,
  CHECKOUT_OPEN_WINDOW_MS,
  checkoutOpen,
  enqueueReconcile,
  NO_OPEN_CHECKOUT_SQL,
} from './db.mjs';
import {
  deletionScheduledEmail,
  freeTimeEmail,
  passwordResetEmail,
  projectMadeEmail,
  sendEmail,
} from './email.mjs';
import { mintEmailToken } from './email-tokens.mjs';
import { planState } from './project-access.mjs';
import { validPromoTier } from './promo.mjs';
import { nudgeCellRevocations, restartCell } from './provision.mjs';
import { SUSPEND_RETENTION_DAYS } from './reconcile.mjs';

const DAY_MS = 86_400_000;

/** No date an operator types may be further away than this. */
const MAX_AHEAD_MS = 3 * 366 * DAY_MS;

const actorOf = (operator) => `operator:${operator.email}`;

/** `2026-12-26` → the END of that day, UTC (a project is free "until" a day inclusive). */
export function endOfDay(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString ?? '').trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
  // `Date.UTC` rolls 2026-02-31 over to March; a date that does not exist is not a date.
  return new Date(ms).toISOString().slice(0, 10) === m[0] ? ms : null;
}

/**
 * A best-effort step that must not delay the answer: handed to `waitUntil`
 * when the runtime offers one, awaited otherwise (tests, local tools) so it
 * is never silently dropped.
 */
async function background(ctx, promise) {
  const guarded = Promise.resolve(promise).catch((err) => {
    console.warn(`[operator] background step failed: ${err?.message ?? err}`);
  });
  if (ctx?.waitUntil) ctx.waitUntil(guarded);
  else await guarded;
}

async function ownerOf(db, project) {
  return db
    .prepare('SELECT id, email, name FROM accounts WHERE id = ?')
    .bind(project.account_id)
    .first();
}

/**
 * An account somebody typed a password for and never proved the address of.
 *
 * Anyone can sign up as `cto@victim.com`. Until a link mailed to that address
 * is followed, the row belongs to whoever chose its password — so nothing an
 * operator does may hand it a project (the same rule the trial holds:
 * provisioning.mjs `decideTrialProvision`, and Google linking in accounts.mjs).
 * An account with NO password is different: nobody can sign in to it except
 * through its mailbox, which is exactly the proof.
 */
const unproven = (account) =>
  Boolean(account && !account.email_verified_at && account.password_hash);

// ------------------------------------------------------------------ free time

/**
 * What free time does to ONE project. Pure.
 *
 * Free time extends `trial_ends_at` — from today when the trial has already
 * run out, on top of it otherwise — so it is the trial's clock, moved, and
 * everything that reads that clock (the cell's pause, Choose a plan, the
 * sweep) follows without knowing free time exists. It is never a trial CLAIM.
 *
 * Refused, with nothing changed:
 *   - `paid`  — a subscription is on the row. Free time would not change what
 *               Stripe charges, and a row that says "free" beside a live
 *               subscription is the disagreement schema.sql warns about;
 *   - `promo` — already free on purpose; its own end date is the thing to move;
 *   - `gone`  — deleted, or past the export and queued for deletion;
 *   - `no-plan` — no trial clock at all (a pilot, a legacy row, a checkout
 *               still pending). Such a row never expires; "free time" would
 *               stamp an end date on it and start a countdown nobody asked for;
 *   - `not-later` — "until" a day the project is already free past.
 */
export function decideFreeTime(project, { now = Date.now(), days = null, until = null } = {}) {
  if (!project || project.state === 'purged' || project.state === 'exported') {
    return { outcome: 'refuse', why: 'gone' };
  }
  if (project.subscription_id) return { outcome: 'refuse', why: 'paid' };
  if (project.promo_since != null) return { outcome: 'refuse', why: 'promo' };
  const from = project.trial_ends_at ?? null;
  if (from === null) return { outcome: 'refuse', why: 'no-plan' };
  const base = Math.max(now, from);
  const to = until ?? base + Number(days) * DAY_MS;
  if (!(to > base)) return { outcome: 'refuse', why: 'not-later' };
  return {
    outcome: 'extend',
    from,
    to,
    // Paused because the trial ended, and running: its cell was started paused.
    wake: project.state === 'active' && planState(project, { now }) === 'paused',
  };
}

/** Parse the form's `days` / `until` into one of the two inputs, or a refusal code. */
export function parseFreeTime({ days, until }, { now = Date.now() } = {}) {
  if (String(days) === 'until') {
    const at = endOfDay(until);
    if (at === null) return { ok: false, reason: 'free-bad-date' };
    if (at <= now || at - now > MAX_AHEAD_MS) return { ok: false, reason: 'free-bad-date' };
    return { ok: true, days: null, until: at };
  }
  const n = Number(days);
  if (!FREE_TIME_DAYS.includes(n)) return { ok: false, reason: 'free-bad-days' };
  return { ok: true, days: n, until: null };
}

/**
 * Give free time to a set of projects of ONE account.
 *
 * `requestId` makes it safe to retry: the first attempt's decisions (absolute
 * dates) are stored, a second attempt reads them back and re-applies the same
 * values, and the e-mail and the log rows go out once.
 *
 * @returns {{ ok: boolean, reason?: string, given: object[], refused: object[], replay: boolean }}
 */
export async function giveFreeTime(
  env,
  { operator, projects, days = null, until = null, reason, requestId, scope, origin, ctx = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const decided = projects.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    owner: p.account_id,
    ...decideFreeTime(p, { now, days, until }),
  }));
  await db
    .prepare(
      'INSERT OR IGNORE INTO operator_actions (request_id, kind, operator_id, plan, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(requestId, 'free-time', operator.id, JSON.stringify({ scope, items: decided }), now)
    .run();
  const ledger = await db
    .prepare('SELECT * FROM operator_actions WHERE request_id = ?')
    .bind(requestId)
    .first();
  // A request id that already means something else is not this request.
  if (ledger?.kind !== 'free-time' || ledger.operator_id !== operator.id) {
    return { ok: false, reason: 'free-bad-request', given: [], refused: [], replay: false };
  }
  let stored;
  try {
    stored = JSON.parse(ledger.plan);
  } catch {
    return { ok: false, reason: 'free-bad-request', given: [], refused: [], replay: false };
  }
  if (stored.scope !== scope) {
    return { ok: false, reason: 'free-bad-request', given: [], refused: [], replay: false };
  }
  const items = stored.items;
  const wanted = items.filter((i) => i.outcome === 'extend');

  // Absolute dates, and never backwards: `<` in the WHERE makes this the same
  // statement however often it runs. A subscription or a Promo that arrived
  // since the decision wins — the row is simply not matched, and that project
  // is then REFUSED, not given: what is reported, logged and mailed is what
  // the row says afterwards, never what was intended.
  const given = [];
  const refused = items.filter((i) => i.outcome === 'refuse');
  for (const item of wanted) {
    await db
      .prepare(
        `UPDATE projects SET trial_ends_at = ?
          WHERE id = ? AND subscription_id IS NULL AND promo_since IS NULL
            AND trial_ends_at IS NOT NULL AND trial_ends_at < ?`
      )
      .bind(item.to, item.id, item.to)
      .run();
    const after = await db
      .prepare('SELECT trial_ends_at, subscription_id, promo_since FROM projects WHERE id = ?')
      .bind(item.id)
      .first();
    if (
      after &&
      !after.subscription_id &&
      after.promo_since == null &&
      after.trial_ends_at === item.to
    ) {
      given.push(item);
    } else {
      refused.push({
        id: item.id,
        name: item.name,
        owner: item.owner,
        outcome: 'refuse',
        why: after?.subscription_id ? 'paid' : after?.promo_since != null ? 'promo' : 'gone',
      });
    }
  }

  // ONE caller finishes the request: the conditional update is the verdict,
  // taken BEFORE the log rows and the e-mail, so two identical posts arriving
  // together write one set of rows and send one mail.
  const won = await db
    .prepare('UPDATE operator_actions SET done_at = ? WHERE request_id = ? AND done_at IS NULL')
    .bind(now, requestId)
    .run();
  const replay = won?.meta?.changes !== 1;
  if (!replay) {
    for (const item of given) {
      await audit(
        db,
        {
          accountId: item.owner,
          projectId: item.id,
          actor: actorOf(operator),
          action: 'operator.free-time.given',
          reason,
          detail: JSON.stringify({
            operator: operator.id,
            from: item.from,
            to: item.to,
            ...(days ? { days } : {}),
            request: requestId,
          }),
        },
        { now }
      );
    }
    for (const item of refused) {
      await audit(
        db,
        {
          accountId: item.owner,
          projectId: item.id,
          actor: actorOf(operator),
          action: 'operator.free-time.refused',
          reason,
          detail: JSON.stringify({ operator: operator.id, why: item.why, request: requestId }),
        },
        { now }
      );
    }
    if (given.length) {
      // Wake what was paused by its trial ending — the restart Choose a plan
      // does (checkout-routes.mjs `convertTrialProject`): env applies at the
      // container's start, so a cell started paused keeps refusing edits until
      // it starts again. Best-effort; a sleeping cell reads the new date on its
      // next start anyway.
      for (const item of given.filter((i) => i.wake)) {
        await background(
          ctx,
          restartCell(env, item.id).then((r) => {
            if (!r.ok) console.warn(`[operator] ${item.id}: restart after free time did not land`);
          })
        );
      }
      const owner = await db
        .prepare('SELECT email FROM accounts WHERE id = ?')
        .bind(given[0].owner)
        .first();
      if (owner?.email) {
        await sendEmail(env, {
          to: owner.email,
          ...freeTimeEmail({
            projects: given.map((i) => ({ name: i.name, until: i.to })),
            billingUrl: `${origin}/account/billing`,
          }),
        });
      }
    }
  }
  return { ok: true, given, refused, replay };
}

// ---------------------------------------------------------------------- promo

/**
 * Mark a project as Promo, or change its tier / end date.
 *
 * `endsAt: null` is "never". Refused on a project with a subscription (a paid
 * plan and Promo are never both true — and when the owner later chooses a
 * plan, checkout-routes.mjs clears Promo in the statement that attaches it).
 */
export async function markPromo(
  env,
  { operator, project, tier, endsAt = null, reason, ctx = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const refuse = async (why) => {
    await audit(
      db,
      {
        accountId: project.account_id,
        projectId: project.id,
        actor: actorOf(operator),
        action: 'operator.promo.refused',
        reason,
        detail: JSON.stringify({ operator: operator.id, why }),
      },
      { now }
    );
    return { ok: false, reason: `promo-${why}` };
  };
  if (!validPromoTier(tier)) return { ok: false, reason: 'promo-tier' };
  if (endsAt !== null && !(endsAt > now && endsAt - now <= MAX_AHEAD_MS)) {
    return { ok: false, reason: 'promo-bad-date' };
  }
  if (project.state === 'purged' || project.state === 'exported') return refuse('gone');
  if (project.subscription_id) return refuse('paid');

  const same =
    project.promo_since != null &&
    project.promo_tier === tier &&
    (project.promo_ends_at ?? null) === endsAt;
  if (same) return { ok: true, changed: false };

  const wasPaused = project.state === 'active' && planState(project, { now }) === 'paused';
  // `COALESCE`: changing the tier or the date of a Promo keeps the day it began.
  const wrote = await db
    .prepare(
      `UPDATE projects SET promo_since = COALESCE(promo_since, ?), promo_tier = ?, promo_ends_at = ?
        WHERE id = ? AND subscription_id IS NULL`
    )
    .bind(now, tier, endsAt, project.id)
    .run();
  if (!wrote?.meta?.changes) return refuse('paid');
  await audit(
    db,
    {
      accountId: project.account_id,
      projectId: project.id,
      actor: actorOf(operator),
      action: 'operator.promo.set',
      reason,
      detail: JSON.stringify({
        operator: operator.id,
        tier,
        endsAt,
        was: planState(project, { now }),
      }),
    },
    { now }
  );
  if (wasPaused) {
    await background(
      ctx,
      restartCell(env, project.id).then((r) => {
        if (!r.ok) console.warn(`[operator] ${project.id}: restart after Promo did not land`);
      })
    );
  }
  return { ok: true, changed: true };
}

/**
 * End a Promo on a date (today is allowed). After that date the project needs
 * a plan — it reads `paused`, as a trial that ran out does; nothing is deleted.
 */
export async function endPromo(
  env,
  { operator, project, endsAt, reason, reconcileNow = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  if (project.promo_since == null || project.subscription_id) {
    return { ok: false, reason: 'promo-none' };
  }
  if (!(endsAt - now <= MAX_AHEAD_MS)) return { ok: false, reason: 'promo-bad-date' };
  if ((project.promo_ends_at ?? null) === endsAt) return { ok: true, changed: false };
  await db
    .prepare(
      'UPDATE projects SET promo_ends_at = ? WHERE id = ? AND promo_since IS NOT NULL AND subscription_id IS NULL'
    )
    .bind(endsAt, project.id)
    .run();
  await audit(
    db,
    {
      accountId: project.account_id,
      projectId: project.id,
      actor: actorOf(operator),
      action: 'operator.promo.ended',
      reason,
      detail: JSON.stringify({ operator: operator.id, endsAt, tier: project.promo_tier ?? null }),
    },
    { now }
  );
  // An end that is already here: let the sweep's own step tell the cell now
  // (worker.mjs `applyPlanPause`) rather than within the hour.
  if (endsAt <= now && reconcileNow) await reconcileNow(project.id).catch(() => {});
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------- pause / wake

/**
 * Pause or wake a project by hand.
 *
 * The write is one column, `hold_since`; the reconciler reads it as an input
 * and walks its ordinary transitions (reconcile.mjs), and the executor stops
 * or wakes the cell exactly as it does for a subscription. Nothing here writes
 * `state`; a wake does reset `state_since`, the retention clock (see below).
 * When the reconcile cannot run right now (Stripe unreachable for a
 * paid project halts it), a job is queued and the hourly sweep finishes it.
 */
export async function setHold(
  env,
  { operator, project, hold, reason, reconcileNow = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  if (hold) {
    if (project.hold_since != null) return { ok: true, changed: false };
    if (project.state !== 'active' && project.state !== 'past_due') {
      return { ok: false, reason: 'pause-not-running' };
    }
    // A payment on its way lands on this row; it is not stopped under it.
    if (await checkoutOpen(db, project.id, { now })) {
      return { ok: false, reason: 'pause-checkout-open' };
    }
  } else if (project.hold_since == null) {
    return { ok: false, reason: 'wake-not-held' };
  }
  const wrote = hold
    ? await db
        .prepare('UPDATE projects SET hold_since = ? WHERE id = ? AND hold_since IS NULL')
        .bind(now, project.id)
        .run()
    : // THE WAKE RESTARTS THE RETENTION CLOCK. A held row sits in `suspended`
      // with `state_since` at the moment of the hold, and the held branch of
      // the reconciler ignores that clock. Lifting the hold hands the row back
      // to the ordinary ladder — and if the subscription ended meanwhile, that
      // ladder measures its 30 days from `state_since`. Left at the hold's
      // date, a 40-day hold would wake straight into "retention elapsed": an
      // export and a deletion with no warning. So the days under a hold do not
      // count: the clock starts at the wake, in the statement that lifts it.
      await db
        .prepare(
          `UPDATE projects
              SET hold_since = NULL,
                  state_since = CASE WHEN state = 'suspended' THEN ? ELSE state_since END
            WHERE id = ? AND hold_since IS NOT NULL`
        )
        .bind(now, project.id)
        .run();
  if (!wrote?.meta?.changes) return { ok: true, changed: false };
  await audit(
    db,
    {
      accountId: project.account_id,
      projectId: project.id,
      actor: actorOf(operator),
      action: hold ? 'operator.project.paused' : 'operator.project.woken',
      reason,
      detail: JSON.stringify({ operator: operator.id }),
    },
    { now }
  );
  let settled = null;
  if (reconcileNow) {
    try {
      settled = await reconcileNow(project.id);
    } catch (err) {
      console.error(`[operator] ${project.id}: reconcile after a hold change: ${err.message}`);
    }
  }
  if (settled?.outcome !== 'ok') {
    await enqueueReconcile(db, { projectId: project.id, reason: 'manual' }, { now });
  }
  return { ok: true, changed: true, settled: settled?.outcome === 'ok' };
}

// ---------------------------------------------------------------- new project

/** `a@b.cz, c@d.cz e@f.cz` → unique normalized addresses, at most 20. */
export function parseInviteList(raw) {
  const out = [];
  const bad = [];
  for (const part of String(raw ?? '').split(/[\s,;]+/)) {
    if (!part) continue;
    const email = normalizeEmail(part);
    if (!email) bad.push(part);
    else if (!out.includes(email)) out.push(email);
  }
  return { emails: out.slice(0, 20), bad, tooMany: out.length > 20 };
}

/**
 * Make a project for an account, with no checkout (canvas 16, cl-operator).
 *
 * The account is made if the address has none — with NO password: nobody
 * chooses one for somebody else. Its owner gets one e-mail carrying the
 * ordinary single-use password link (and how to get another, or use Google).
 * The row is routed and marked live by the trial path's `settleTrialProject`,
 * so an operator-made project is provisioned by the same code a self-made
 * trial project is. Sent twice, it answers the project it already made —
 * recognised by its own log row, never by "the owner matches" — and mails and
 * invites nobody again.
 *
 * `plan: 'trial'` is that address's trial: the claim is written when one is
 * free (so the owner cannot also start a second trial project), and simply not
 * written when it is already spent — an operator may still make the project.
 */
export async function createProjectFor(
  env,
  { operator, ownerEmail, name, plan, tier = null, endsAt = null, invites = [], reason, origin },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const email = normalizeEmail(ownerEmail);
  if (!email) return { ok: false, status: 400, error: 'That does not look like an email address.' };
  const named = validateTrialProject({ name });
  if (!named.ok) return { ok: false, status: 400, error: named.error };
  if (plan !== 'promo' && plan !== 'trial') {
    return { ok: false, status: 400, error: 'Pick Promo or Trial.' };
  }
  if (plan === 'promo' && !validPromoTier(tier)) {
    return { ok: false, status: 400, error: 'Pick the storage for this Promo.' };
  }
  if (plan === 'promo' && endsAt !== null && !(endsAt > now && endsAt - now <= MAX_AHEAD_MS)) {
    return { ok: false, status: 400, error: 'The end date must be a day in the future.' };
  }

  const TAKEN = {
    ok: false,
    status: 409,
    error: 'That name is already a web address here. Pick another name.',
  };
  let owner = await getAccountByEmail(db, email);

  // AN ACCOUNT NOBODY PROVED IS NOT GIVEN A PROJECT. Somebody chose a password
  // for this address and never followed a link mailed to it — that somebody
  // may not be the address's owner. Nothing is made. Whoever is signed in to
  // the row is signed out, its unused links die, and the MAILBOX gets the
  // ordinary password link: following it replaces the password and proves the
  // address, after which this same form works.
  if (unproven(owner)) {
    await revokeAccountSessions(db, owner.id, { now });
    await db
      .prepare(
        'UPDATE personal_tokens SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL'
      )
      .bind(now, owner.id)
      .run();
    await db
      .prepare(
        `UPDATE email_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL AND purpose != 'unsub'`
      )
      .bind(now, owner.id)
      .run();
    const { token } = await mintEmailToken(db, { accountId: owner.id, purpose: 'reset' }, { now });
    await sendEmail(env, {
      to: owner.email,
      ...passwordResetEmail({ resetUrl: `${origin}/auth/reset?t=${token}` }),
    });
    await audit(
      db,
      {
        accountId: owner.id,
        actor: actorOf(operator),
        action: 'operator.project.refused',
        reason,
        detail: JSON.stringify({
          operator: operator.id,
          why: 'unverified-account',
          project: named.id,
        }),
      },
      { now }
    );
    return {
      ok: false,
      status: 409,
      error:
        'This address has an account that has not confirmed its e-mail, so nothing was made. It was signed out and sent a link to choose a password; make the project once that is done.',
    };
  }

  // A PROJECT THIS ACTION DID NOT MAKE IS NEVER TOUCHED. A row with this id is
  // a replay only when the log holds this action's own record of making it
  // for this owner; any other existing row — the owner's own, a checkout
  // still pending, anybody's — is simply a taken name. A replay finishes
  // routing a row still being set up and does NOTHING else: no e-mail, and no
  // invitation, however the form was filled in the second time.
  const existing = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(named.id).first();
  if (existing) {
    const mine =
      owner && existing.account_id === owner.id
        ? await db
            .prepare(
              `SELECT 1 AS x FROM audit_log
                WHERE project_id = ? AND account_id = ? AND action = 'operator.project.created' LIMIT 1`
            )
            .bind(named.id, owner.id)
            .first()
        : null;
    if (!mine || existing.subscription_id) return TAKEN;
    const settled = await settleTrialProject(env, existing);
    return { ok: true, project: settled, owner, fresh: false, accountCreated: false, invited: 0 };
  }

  let accountCreated = false;
  if (!owner) {
    try {
      const made = await createAccount(db, { email }, { now });
      accountCreated = true;
      owner = { id: made.id, email: made.email };
    } catch (err) {
      if (err.code !== 'account-exists') throw err;
      // Lost a race to the same address: whoever won it is judged as above.
      owner = await getAccountByEmail(db, email);
      if (unproven(owner)) return TAKEN;
    }
  }

  const trialEndsAt = plan === 'trial' ? now + TRIAL_DAYS * DAY_MS : null;
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO projects
         (id, account_id, name, state, state_since, plan, trial_ends_at,
          promo_since, promo_tier, promo_ends_at, created_at)
       VALUES (?, ?, ?, 'pending', ?, 'project', ?, ?, ?, ?, ?)`
    )
    .bind(
      named.id,
      owner.id,
      named.name,
      now,
      trialEndsAt,
      plan === 'promo' ? now : null,
      plan === 'promo' ? tier : null,
      plan === 'promo' ? endsAt : null,
      now
    )
    .run();
  // Lost the name to a concurrent insert: that row is not this action's.
  if (!inserted?.meta?.changes) return TAKEN;
  const fresh = true;
  let row = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(named.id).first();

  if (plan === 'trial') {
    // The address's one trial, if it is still free. Not a refusal when it is
    // not: the operator is making this project either way.
    await db
      .prepare(
        `INSERT OR IGNORE INTO trial_claims (email_hash, request_id, account_id, project_id, claimed_at)
         SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM trial_claims WHERE email_hash = ?) < ?`
      )
      .bind(
        await trialEmailKey(email),
        `operator:${named.id}`,
        owner.id,
        named.id,
        now,
        await trialEmailKey(email),
        TRIALS_PER_VERIFIED_EMAIL
      )
      .run();
  }

  if (fresh) {
    await audit(
      db,
      {
        accountId: owner.id,
        projectId: named.id,
        actor: actorOf(operator),
        action: 'operator.project.created',
        reason,
        detail: JSON.stringify({
          operator: operator.id,
          plan,
          ...(plan === 'promo' ? { tier, endsAt } : { trialEndsAt }),
          accountCreated,
          invites: invites.length,
        }),
      },
      { now }
    );
  }

  // Route the address and mark it live — the trial path's own step, and
  // idempotent: a row still `pending` from a failed route is retried here.
  row = await settleTrialProject(env, row);

  if (fresh) {
    let setPasswordUrl = null;
    if (accountCreated) {
      const { token } = await mintEmailToken(
        db,
        { accountId: owner.id, purpose: 'reset' },
        { now }
      );
      setPasswordUrl = `${origin}/auth/reset?t=${token}`;
    }
    await sendEmail(env, {
      to: owner.email,
      ...projectMadeEmail({
        projectName: named.name,
        dashboardUrl: `${origin}/login`,
        setPasswordUrl,
        forgotUrl: `${origin}/forgot`,
      }),
    });
  }

  // Extra people, as Can edit — the one way an invitation is made. An address
  // that already holds an open invitation to this project is not sent another.
  let invited = 0;
  for (const address of invites) {
    if (address === owner.email) continue;
    const sent = await createProjectInvite(env, {
      project: row,
      invitedBy: null,
      invitedByEmail: 'Maude',
      email: address,
      role: 'member',
      origin,
      now,
    });
    // Every invitation an operator action issues is on the record, against
    // the project, with the operator's reason.
    await audit(
      db,
      {
        accountId: owner.id,
        projectId: named.id,
        actor: actorOf(operator),
        action: 'operator.invite.sent',
        reason,
        detail: JSON.stringify({ operator: operator.id, invite: sent.id, role: 'member' }),
      },
      { now }
    );
    invited += 1;
  }
  return { ok: true, project: row, owner, fresh, accountCreated, invited };
}

// ------------------------------------------------------------------------ move

/**
 * Hand a project to another owner — an EXISTING account.
 *
 * Refused for a project with a subscription: the subscription belongs to the
 * old owner's Stripe customer, and a project whose owner cannot open its
 * billing is worse than one that has not moved. The old owner stays on the
 * project as Can edit (their work is in it); their live connection, which
 * carried the owner's rights, is ended so the next one is opened as Can edit.
 */
export async function moveProject(
  env,
  { operator, project, toEmail, reason, ctx = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const target = await getAccountByEmail(db, toEmail);
  if (!target) return { ok: false, reason: 'move-no-account' };
  if (project.state === 'purged') return { ok: false, reason: 'move-gone' };
  if (project.account_id === target.id) return { ok: true, changed: false };
  // Never to an account whose address nobody proved (see `unproven`), and
  // never to one with no way to have proved it yet.
  if (!target.email_verified_at) return { ok: false, reason: 'move-unverified' };
  // A scheduled deletion does not travel to a new owner who never heard of it.
  if (project.delete_since != null) return { ok: false, reason: 'move-deleting' };
  if (project.subscription_id) return { ok: false, reason: 'move-paid' };
  // A payment on its way attaches to this row FOR ITS CURRENT OWNER
  // (checkout-routes.mjs `convertTrialProject` matches on the account).
  if (await checkoutOpen(db, project.id, { now })) {
    return { ok: false, reason: 'move-checkout-open' };
  }
  const done = await transferOwnership(env, {
    project,
    target,
    actor: actorOf(operator),
    action: 'operator.project.moved',
    reason,
    detail: { operator: operator.id },
    ctx,
    now,
  });
  if (!done) return { ok: true, changed: false };
  return { ok: true, changed: true, to: target };
}

// -------------------------------------------------------------------- sign out

/**
 * Sign an account out everywhere: every browser session, every Mac, and any
 * code or link on its way to becoming a sign-in. Then its live connections to
 * projects, through the cells' own revocation lists — the same rows a removal
 * writes. Nothing about the account, its projects or its memberships changes;
 * the person signs in again and carries on.
 */
export async function signOutEverywhere(
  env,
  { operator, account, reason, ctx = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const run = (sql, ...args) =>
    db
      .prepare(sql)
      .bind(...args)
      .run()
      .then((r) => Number(r?.meta?.changes ?? 0))
      .catch(() => 0);
  const sessions = await run(
    'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL',
    now,
    account.id
  );
  const macs = await run(
    'UPDATE personal_tokens SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL',
    now,
    account.id
  );
  // A code approved and not yet collected would mint a Mac sign-in later; a
  // handoff code or a mailed link would hand the browser back.
  await run('DELETE FROM device_codes WHERE approved_account = ?', account.id);
  await run(
    'UPDATE handoff_codes SET used_at = ? WHERE account_id = ? AND used_at IS NULL',
    now,
    account.id
  );
  await run(
    `UPDATE email_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL AND purpose != 'unsub'`,
    now,
    account.id
  );
  // ALWAYS the rest, whatever the two counts say. A person with no browser
  // session and no Mac token can still be INSIDE a project: a project
  // connection outlives the sign-in that opened it (it is a token the cell
  // verifies offline). Those end through the cells' revocation lists below,
  // and the action is logged every time it is taken.

  const { results } = await db
    .prepare(
      `SELECT id FROM projects WHERE account_id = ?1 AND state != 'purged'
       UNION SELECT project_id FROM project_members WHERE account_id = ?1
       UNION SELECT project_id FROM canvas_grants WHERE account_id = ?1`
    )
    .bind(account.id)
    .all()
    .catch(() => ({ results: [] }));
  const projectIds = (results ?? []).map((r) => r.id);
  for (const projectId of projectIds) {
    await run(
      'INSERT INTO member_revocations (project_id, email, revoked_at) VALUES (?, ?, ?)',
      projectId,
      account.email,
      now
    );
    await background(ctx, nudgeCellRevocations(env, projectId));
  }
  await audit(
    db,
    {
      accountId: account.id,
      actor: actorOf(operator),
      action: 'operator.account.signed-out',
      reason,
      detail: JSON.stringify({
        operator: operator.id,
        sessions,
        macs,
        projects: projectIds.length,
      }),
    },
    { now }
  );
  return { ok: true, changed: true, sessions, macs };
}

// ---------------------------------------------------------------------- delete

/**
 * Schedule a project's deletion — never a purge.
 *
 * The write is one column, `delete_since`; the reconciler then walks the SAME
 * ladder a lapsed subscription walks (reconcile.mjs): the workspace is paused,
 * the complete copy is prepared and mailed, the owner is warned two days
 * before, and the bytes go at thirty days — and only with a copy in storage.
 * The customer's own "Delete project" is the stricter of the two paths in one
 * respect (it refuses until a copy exists) and the looser in another (it then
 * deletes at once); an operator gets neither shortcut.
 *
 * Refused: a project with a subscription (the plan is cancelled first, by its
 * owner or in Stripe — a deletion that keeps charging is the worst order), a
 * checkout under way, a project already gone, and a typed name that is not
 * this project's.
 */
export async function scheduleDelete(
  env,
  { operator, project, confirm, reason, origin, reconcileNow = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  const typed = String(confirm ?? '')
    .trim()
    .toLowerCase();
  if (
    !typed ||
    (typed !== project.id &&
      typed !==
        String(project.name ?? '')
          .trim()
          .toLowerCase())
  ) {
    return { ok: false, reason: 'delete-confirm' };
  }
  if (project.state === 'purged' || project.state === 'exported') {
    return { ok: false, reason: 'delete-gone' };
  }
  if (project.delete_since != null) return { ok: true, changed: false };
  if (project.subscription_id) return { ok: false, reason: 'delete-paid' };

  // ONE STATEMENT decides and writes: no subscription, no checkout under way,
  // not already gone. A page that read the row a moment ago proves nothing —
  // a checkout that started since then makes this match no row.
  //
  // The retention clock starts NOW, in the same statement: a project already
  // paused (an operator's hold, a trial long over) must still get its full
  // thirty days from the moment somebody decided to delete it.
  const wrote = await db
    .prepare(
      `UPDATE projects
          SET delete_since = ?1,
              state_since = CASE WHEN state = 'suspended' THEN ?1 ELSE state_since END
        WHERE id = ?2 AND delete_since IS NULL AND subscription_id IS NULL
          AND state NOT IN ('purged', 'exported')
          AND ${NO_OPEN_CHECKOUT_SQL('?2', '?3')}`
    )
    .bind(now, project.id, now - CHECKOUT_OPEN_WINDOW_MS)
    .run();
  if (!wrote?.meta?.changes) {
    // Say WHY nothing was written, from the row as it is now.
    const fresh = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(project.id).first();
    if (fresh?.delete_since != null) return { ok: true, changed: false };
    if (fresh?.subscription_id) return { ok: false, reason: 'delete-paid' };
    if (!fresh || fresh.state === 'purged' || fresh.state === 'exported') {
      return { ok: false, reason: 'delete-gone' };
    }
    return { ok: false, reason: 'delete-checkout-open' };
  }
  const deletesAt = now + SUSPEND_RETENTION_DAYS * DAY_MS;
  await audit(
    db,
    {
      accountId: project.account_id,
      projectId: project.id,
      actor: actorOf(operator),
      action: 'operator.project.delete-scheduled',
      reason,
      detail: JSON.stringify({ operator: operator.id, deletesAt }),
    },
    { now }
  );
  // The owner hears first, whatever the export does next.
  const owner = await ownerOf(db, project);
  if (owner?.email) {
    await sendEmail(env, {
      to: owner.email,
      ...deletionScheduledEmail({
        projectName: project.name || project.id,
        downloadUrl: `${origin}/projects/${project.id}/download`,
        deletesAt,
      }),
    });
  }
  let settled = null;
  if (reconcileNow) settled = await reconcileNow(project.id).catch(() => null);
  if (settled?.outcome !== 'ok') {
    await enqueueReconcile(db, { projectId: project.id, reason: 'manual' }, { now });
  }
  return { ok: true, changed: true, deletesAt };
}

/**
 * Undo a scheduled deletion — for exactly as long as nothing has been deleted
 * (the row is still `suspended`; once the ladder has moved it on, there is
 * nothing to bring back and this refuses). The project returns to what its
 * plan says: the reconciler wakes it.
 */
export async function undoDelete(
  env,
  { operator, project, reason, reconcileNow = null },
  { now = Date.now() } = {}
) {
  const db = env.DB;
  if (project.delete_since == null) return { ok: false, reason: 'delete-not-scheduled' };
  if (project.state !== 'suspended' && project.state !== 'active' && project.state !== 'past_due') {
    return { ok: false, reason: 'delete-too-late' };
  }
  const wrote = await db
    .prepare(
      `UPDATE projects SET delete_since = NULL, state_since = ?
        WHERE id = ? AND delete_since IS NOT NULL AND state IN ('suspended', 'active', 'past_due')`
    )
    .bind(now, project.id)
    .run();
  if (!wrote?.meta?.changes) return { ok: false, reason: 'delete-too-late' };
  await audit(
    db,
    {
      accountId: project.account_id,
      projectId: project.id,
      actor: actorOf(operator),
      action: 'operator.project.delete-undone',
      reason,
      detail: JSON.stringify({ operator: operator.id }),
    },
    { now }
  );
  let settled = null;
  if (reconcileNow) settled = await reconcileNow(project.id).catch(() => null);
  if (settled?.outcome !== 'ok') {
    await enqueueReconcile(db, { projectId: project.id, reason: 'manual' }, { now });
  }
  return { ok: true, changed: true };
}
