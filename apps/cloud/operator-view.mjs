// "See it as the owner does" — canvas 16, cl-op-account. READ ONLY.
//
// Support needs to see what a customer sees. The dangerous way to give them
// that is to become the customer: mint a session, set a cookie, and trust
// every page to notice. This does none of it.
//
//   - NO SESSION, NO COOKIE, NO CREDENTIAL. The request is the operator's own,
//     under the operator's own session. Nothing is written to `sessions`,
//     `personal_tokens`, `handoff_codes` or `device_codes`, and no project
//     token is minted. The owner's pages are RENDERED from the same page
//     functions with the owner's rows, by code that has no write in it.
//   - A SHORT LIST OF PAGES. The dashboard, the account's overview / people /
//     billing, and a project's people / billing / activity. Everything that
//     opens the workspace, hands out a credential or shows something once
//     (connect, download, Macs, delete, mirror, saving) is simply not here.
//   - NOTHING ON THE PAGE CAN ACT. Every form is unwrapped, every control is
//     disabled, every hidden field (a CSRF token would be one) is dropped
//     before the page is even rendered with none, and every link is rewritten
//     to stay under the prefix. A POST under the prefix is 405 in the router,
//     before this module is reached.
//   - NO STRIPE, NO WORKSPACE. Billing is drawn from the row; invoices and
//     card details are the customer's and Stripe's, and are not fetched.
//   - THE OWNER CAN SEE THAT WE LOOKED (DDR-193 §4): one audit row per page,
//     against their account, at most one per page per ten minutes.

import {
  accountBillingPage,
  accountPeoplePage,
  overviewPage,
  peopleViewData,
  planLines,
} from './account-pages.mjs';
import { projectsFor } from './auth-routes.mjs';
import { trialView } from './billing.mjs';
import { appShell, icon } from './brand.mjs';
import { billingPage } from './checkout-pages.mjs';
import { dashboardPage, projectsPage, STATE_COPY } from './dashboard.mjs';
import { audit } from './db.mjs';
import { emailPrefsPage, mentionEmailsOn } from './mentions.mjs';
import { ownerOverview, ownerPlans } from './owner-overview.mjs';
import { peoplePage } from './people-page.mjs';
import { ownerPlan, promoFacts } from './plan-copy.mjs';
import { can, cellHolds } from './project-access.mjs';
import { activityEntries, auditPage, projectSettingsPage } from './project-admin.mjs';
import { projectPeopleData } from './project-routes.mjs';

const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One row per (operator, account, page) per this long. */
export const VIEW_AUDIT_WINDOW_MS = 10 * 60_000;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * Make a rendered page inert. Pure.
 *
 * Applied to pages that were ALREADY rendered with no token and no write
 * target that would accept one — this is the second lock, not the only one.
 */
export function readOnlyView(html, { email, base, exit = null }) {
  const banner = `<p class="ro-banner" role="status"><span>You are looking at this as ${esc(email)} sees it — read only</span>${
    exit ? `<a class="ro-exit" href="${esc(exit)}">Leave this view</a>` : ''
  }</p>`;
  return (
    String(html)
      .replace(/<input\b[^>]*\btype="hidden"[^>]*>/gi, '')
      // A form becomes a box that cannot submit — keeping its own class, so
      // the page still looks like the owner's (the nav's search field is one).
      .replace(/<form\b([^>]*)>/gi, (_m, attrs) => {
        const cls = /\bclass="([^"]*)"/.exec(attrs)?.[1];
        return cls ? `<div class="${esc(cls)}">` : '<div class="ro-form">';
      })
      .replace(/<\/form>/gi, '</div>')
      // `disabled` on EVERY control, unconditionally — never "unless the tag
      // already says disabled": that word in a title or a placeholder is not
      // the attribute. A second `disabled` on one tag is harmless.
      .replace(/<(button|input|select|textarea)\b/gi, '<$1 disabled')
      // Nothing may still name a target or run: `formaction` (a button's own
      // submit address), `form=` (a control adopted by a form elsewhere), and
      // every inline event handler — quoted either way, or bare.
      .replace(/\s(?:formaction|form|on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/href="\/(?!\/)([^"]*)"/g, (_m, rest) => `href="${base}${rest ? `/${rest}` : ''}"`)
      .replace(
        '</style>',
        '.ro-banner{position:sticky;top:calc(52px + var(--space-6));z-index:4;display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);max-width:none;margin:0 0 var(--space-5);padding:var(--space-2) var(--space-2) var(--space-2) var(--space-4);border-radius:var(--radius-md);background:var(--fg-0);color:var(--bg-1);font-size:var(--type-sm);font-weight:var(--weight-semibold);box-shadow:var(--shadow-md)}.ro-exit{display:inline-flex;align-items:center;height:28px;padding:0 var(--space-3);border-radius:var(--radius-sm);background:var(--bg-1);color:var(--fg-0);font-weight:var(--weight-semibold)}.ro-exit:hover{text-decoration:none;background:var(--bg-3)}.ro-form{display:contents}</style>'
      )
      .replace('<main class="ma-main">', `<main class="ma-main">${banner}`)
  );
}

/** The page key a path names, or null when the view does not include it. */
export function viewPage(rest) {
  if (rest === '' || rest === '/') return { page: 'dashboard' };
  if (rest === '/projects') return { page: 'projects' };
  if (rest === '/projects/new') return { page: 'closed', door: 'new' };
  if (rest === '/account') return { page: 'account' };
  if (rest === '/account/people') return { page: 'account-people' };
  if (rest === '/account/billing' || rest === '/account/plans') return { page: 'account-billing' };
  if (rest === '/account/notifications' || rest === '/account/emails')
    return { page: 'account-notifications' };
  // Pages that hand out something or act on the account: drawn as a closed
  // door in the view's own chrome, never as the page — and never a 404, so
  // the owner's whole navigation can be walked (owner, 2026-11-27).
  const closed = /^\/account\/(devices|macs|download|delete)$/.exec(rest);
  if (closed) return { page: 'closed', door: closed[1] === 'macs' ? 'devices' : closed[1] };
  const m = /^\/projects\/([a-z0-9-]+)\/(people|billing|audit|settings)$/.exec(rest);
  if (m && PROJECT_ID.test(m[1])) return { page: `project-${m[2]}`, projectId: m[1] };
  const shut = /^\/projects\/([a-z0-9-]+)\/(connect|download|delete|mirror|saving)$/.exec(rest);
  if (shut && PROJECT_ID.test(shut[1]))
    return { page: 'project-closed', projectId: shut[1], door: shut[2] };
  return null;
}

/** What each closed door would do — said on the page instead of doing it. */
const CLOSED_DOOR = {
  devices: ['Devices', 'the devices signed in to this account, with a way to sign each one out'],
  new: [
    'Start a project',
    'starting a project with this account’s card — for a project you make for them, use New project for an account',
  ],
  download: [
    'Download everything',
    'the downloads of this account’s projects and its account file',
  ],
  delete: ['Delete the account', 'deleting this account'],
  connect: ['Open', 'opening the project in the Maude app or the browser, signed in as the owner'],
  mirror: ['GitHub copy', 'the GitHub copy and its connection'],
  saving: ['Saving', 'how the workspace saves — reading it would wake the workspace'],
};

/**
 * Render one page of `target`'s account for the operator, or null when the
 * path is not part of the view (the router answers its ordinary 404).
 *
 * @param {object} args
 * @param {{id: string, email: string}} args.operator
 * @param {{id: string, email: string}} args.target  the account being looked at
 * @param {string} args.rest  what follows `/view`
 * @returns {Promise<string | null | {unavailable: true}>} the page; null when the
 *   path is not in the view; `unavailable` when the look could not be logged
 */
export async function renderViewAs(env, { operator, target, rest, now = Date.now() }) {
  const named = viewPage(rest);
  if (!named) return null;
  const base = `/operator/accounts/${target.id}/view`;
  const exit = `/operator/accounts/${target.id}`;
  const me = { id: target.id, email: target.email, name: target.name ?? null };

  // THE LOOKING IS RECORDED FIRST, OR NOTHING IS SHOWN. "You can see that we
  // looked" is the condition this view exists under; a page rendered while its
  // log row failed would be exactly the unrecorded look the promise forbids.
  // Once per page per window, so a refresh loop cannot bury the owner's log —
  // and when the row cannot be written, the caller answers 503.
  const detail = JSON.stringify({
    operator: operator.id,
    page: named.page,
    project: named.projectId ?? null,
  });
  const actor = `operator:${operator.email}`;
  // A closed door shows nothing of the owner's — it is not a look, and is not
  // logged as one; every real page is.
  const isClosed = named.page === 'closed' || named.page === 'project-closed';
  if (!isClosed) {
    try {
      const recent = await env.DB.prepare(
        `SELECT 1 AS x FROM audit_log
          WHERE action = 'operator.account.viewed-as' AND account_id = ? AND actor = ?
            AND detail = ? AND at > ? LIMIT 1`
      )
        .bind(target.id, actor, detail, now - VIEW_AUDIT_WINDOW_MS)
        .first();
      if (!recent) {
        await audit(
          env.DB,
          { accountId: target.id, actor, action: 'operator.account.viewed-as', detail },
          { now }
        );
      }
    } catch (err) {
      console.error(`[operator] view-as audit failed, page withheld: ${err.message}`);
      return { unavailable: true };
    }
  }

  let html = null;
  const closedDoor = (door, { project = null } = {}) => {
    const [title, what] = CLOSED_DOOR[door] ?? [door, 'this page'];
    return appShell({
      account: { ...me, owns: 1 },
      title,
      project,
      isOwner: true,
      active: door,
      body: `<div class="ma-card ma-empty">${icon('lock', 20)}<p><strong>Not part of the read-only view</strong></p><p class="ma-quiet">This page is ${esc(what)}. It is left closed here, so looking can never open, hand out or change anything.</p></div>`,
    });
  };
  if (named.page === 'closed') {
    html = closedDoor(named.door);
  } else if (named.page === 'projects') {
    const [projects, overview, plans] = await Promise.all([
      projectsFor(env, target.id),
      ownerOverview(env, target.id).catch(() => null),
      ownerPlans(env, target.id).catch(() => null),
    ]);
    html = projectsPage({ account: me, projects, can, overview, plans });
  } else if (named.page === 'account-notifications') {
    html = emailPrefsPage({
      account: me,
      mentions: await mentionEmailsOn(env.DB, target.id).catch(() => null),
      csrf: null,
    });
  } else if (named.page === 'dashboard') {
    const [projects, overview, plans] = await Promise.all([
      projectsFor(env, target.id),
      ownerOverview(env, target.id).catch(() => null),
      ownerPlans(env, target.id).catch(() => null),
    ]);
    html = dashboardPage({ account: me, projects, can, overview, plans });
  } else if (named.page === 'account') {
    const { results: owned } = await env.DB.prepare(
      `SELECT * FROM projects WHERE account_id = ? AND state != 'purged' ORDER BY name`
    )
      .bind(target.id)
      .all();
    html = overviewPage({
      account: me,
      trial: trialView(target, { now }),
      plans: planLines(owned ?? [], { now }),
      mentions: await mentionEmailsOn(env.DB, target.id).catch(() => null),
      now,
    });
  } else if (named.page === 'account-people') {
    const data = await peopleViewData(env, target.id, { now, analytics: false });
    html = accountPeoplePage({ account: me, ...data, csrf: null, now });
  } else if (named.page === 'account-billing') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM projects WHERE account_id = ? AND state != 'purged' ORDER BY name`
    )
      .bind(target.id)
      .all();
    html = accountBillingPage({
      account: me,
      trial: trialView(target, { now }),
      projects: results ?? [],
      csrf: null,
      now,
    });
  } else {
    // A project page: only a project THIS account owns.
    const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND account_id = ?')
      .bind(named.projectId, target.id)
      .first();
    if (!project || project.state === 'purged') return null;
    if (named.page === 'project-closed') {
      html = closedDoor(named.door, { project });
    } else if (named.page === 'project-settings') {
      html = projectSettingsPage({ account: me, project, now });
    } else if (named.page === 'project-people') {
      const data = await projectPeopleData(env, project);
      html = peoplePage({
        account: me,
        project,
        ...data,
        isOwner: true,
        csrf: null,
        canView: cellHolds(project, 'roles-v2'),
      });
    } else if (named.page === 'project-billing') {
      const plan = ownerPlan(project, { now });
      html = billingPage({
        account: me,
        project,
        stateCopy: STATE_COPY[project.state] ?? { label: project.state, note: null },
        // Never the portal, never Stripe: the row is what is shown.
        canPortal: false,
        plan,
        promo: plan.state === 'deleting' ? null : promoFacts(project, { now }),
      });
    } else {
      const entries = await activityEntries(env, { project, viewerId: target.id });
      html = auditPage({ account: me, project, isOwner: true, entries });
    }
  }

  return readOnlyView(html, { email: target.email, base, exit });
}
