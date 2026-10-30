// The account pages — Maude v2 S9.16 (canvas 02 ob-settings: "Manage on
// cloud.maude.sh" opens these, signed in).
//
//   /account                     the overview: plan line + the five doors
//   /account/people              People and invites — every project you own
//                                (people, canvas grants, pending invites) and
//                                every project shared with you (your access
//                                only; nobody else's address)
//   /account/billing             Billing and plan — the trial's days left, each
//                                owned project's plan, and the S9.15 plan
//                                picker (it POSTs to /projects/<id>/billing/plan)
//   /account/macs                Your Macs — the apps signed in to the account,
//                                with Sign out. The stored credential never
//                                reaches the page, not even its hash: a row is
//                                named by a handle derived from it.
//   /account/download            Download everything — the owner-only .zip per
//                                project (each project's own download page) and
//   /account/download/account.json  the account's own details, streamed
//   /account/delete              Delete the account — typed confirmation, then
//                                sign-in, Macs and memberships end and the name
//                                and address are removed. Refused while the
//                                account still owns a project that is not
//                                deleted (each goes through its own
//                                export-gated delete, DDR-193 §3).
//
// Every page: session required, `Cache-Control: no-store`, no script. Every
// POST: same-origin (Origin, when sent, must be this origin; the edge's
// Fetch-Metadata gate runs first) AND a CSRF field derived from the session
// with a server-side key — the operator surface's shape (operator.mjs
// `deriveCsrf`), domain-separated so the two tokens never coincide. Fails
// closed when no key is configured.
//
// The trial claim (`trial_claims`, S9.15) is deliberately NOT touched by a
// deletion: it is keyed by the address's hash so a re-signup on the same
// address gets no second trial.

import { SESSION_COOKIE } from './auth-routes.mjs';
import { formatDay, TRIAL_DAYS, trialView } from './billing.mjs';
import { appShell } from './brand.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { audit } from './db.mjs';
import { spend } from './edge.mjs';
import { verifyCsrf } from './operator.mjs';
import {
  canvasName,
  peopleRowsTable,
  ROLE_MEANING,
  roleWord as roleWordFor,
} from './people-page.mjs';
import pricingCatalog from './pricing.json' with { type: 'json' };
import { planState } from './project-access.mjs';
import { listExports as exportGenerationsFor } from './project-admin.mjs';
import { nudgeCellRevocations } from './provision.mjs';

const DAY_MS = 86_400_000;

/** Must match the cell's ACCESS_TOKEN_TTL_MS (project-routes.mjs quotes the same). */
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/** How many account files one account may take in ten minutes. */
export const ACCOUNT_EXPORT_LIMIT = 6;
const ACCOUNT_EXPORT_WINDOW_MS = 10 * 60_000;

/** Where a deleted account's address goes: unique, unroutable, not an address anyone holds. */
export const DELETED_EMAIL_DOMAIN = 'deleted.invalid';

/** The doors, in the canvas's order (ob-settings); E-mails is S9.18's (the mention e-mail switch). */
export const ACCOUNT_SECTIONS = Object.freeze([
  { key: 'people', href: '/account/people', label: 'People and invites' },
  { key: 'billing', href: '/account/billing', label: 'Billing and plan' },
  { key: 'macs', href: '/account/macs', label: 'Your Macs' },
  { key: 'emails', href: '/account/emails', label: 'E-mails' },
  { key: 'download', href: '/account/download', label: 'Download everything' },
  { key: 'delete', href: '/account/delete', label: 'Delete the account' },
]);

const CSS = `
  .tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-6); padding: 0; list-style: none; }
  .tabs a { display: inline-block; padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill); border: 1px solid var(--border-subtle); background: var(--bg-1); color: var(--fg-1); font-size: var(--type-sm); text-decoration: none; }
  .tabs a[aria-current="page"] { background: var(--bg-4); color: var(--fg-0); font-weight: 600; }
  .tabs a.danger { color: var(--status-error); }
  table { width: 100%; border-collapse: collapse; margin: var(--space-3) 0 var(--space-6); background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
  td { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-subtle); vertical-align: baseline; font-size: var(--type-base); }
  tr:first-child td { border-top: 0; }
  td.right { text-align: right; white-space: nowrap; }
  td .num, .num { font-variant-numeric: tabular-nums; }
  form.inline { display: inline; }
  .card { margin-bottom: var(--space-6); }
  .card h2 { margin: 0 0 var(--space-3); }
  .danger-card { border-color: color-mix(in oklab, var(--status-error) 40%, transparent); }
  .doors { display: grid; gap: var(--space-2); padding: 0; margin: 0; list-style: none; }
  .doors a { display: block; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--bg-1); border: 1px solid var(--border-subtle); color: var(--fg-0); text-decoration: none; }
  .doors a.danger { color: var(--status-error); }
  .plan-line { font-size: var(--type-md); margin: 0 0 var(--space-2); }
  .picker { display: grid; gap: var(--space-2); margin: var(--space-3) 0 0; }
  .picker label { display: flex; gap: var(--space-2); align-items: baseline; font-size: var(--type-base); }
  ul.what { margin: var(--space-2) 0 0; padding-left: var(--space-6); line-height: var(--lh-base); }
  input[name=confirm] { max-width: 26rem; }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The plan line of canvas ob-settings: "Free trial · 12 days left". */
export function trialLine(trial) {
  if (trial?.state === 'trialing') {
    return `Free trial · ${plural(trial.daysLeft, 'day left', 'days left')}`;
  }
  if (trial?.state === 'ended') return `Free trial · ended on ${formatDay(trial.endsAt)}`;
  return `Free trial · ${TRIAL_DAYS} days, from your next sign-in`;
}

/** CONTRACT §4 times: relative first, then "6 Oct, 14:05" (24-hour, UTC). */
export function when(ms, { now = Date.now() } = {}) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return 'never';
  const ago = now - t;
  if (ago >= 0 && ago < 60_000) return 'just now';
  if (ago >= 0 && ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`;
  if (ago >= 0 && ago < 86_400_000)
    return plural(Math.floor(ago / 3_600_000), 'hour ago', 'hours ago');
  if (ago >= 0 && ago < 2 * 86_400_000) return 'yesterday';
  const d = new Date(t);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${date}, ${time}`;
}

// ------------------------------------------------------------------ the shell

function tabs(active) {
  return `<ul class="tabs">${ACCOUNT_SECTIONS.map(
    (s) =>
      `<li><a href="${s.href}"${s.key === 'delete' ? ' class="danger"' : ''}${s.key === active ? ' aria-current="page"' : ''}>${esc(s.label)}</a></li>`
  ).join('')}</ul>`;
}

function page(title, body, { account, active, lede = null }) {
  return appShell({
    account,
    title,
    active: 'account',
    lede,
    extraCss: CSS,
    body: `${active ? tabs(active) : ''}${body}`,
  });
}

const notices = ({ error, notice }) =>
  `${error ? `<p class="error">${esc(error)}</p>` : ''}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}`;

const csrfField = (csrf) => `<input type="hidden" name="csrf" value="${esc(csrf ?? '')}">`;

// ------------------------------------------------------------------ overview

export function overviewPage({ account, trial }) {
  return page(
    'Account',
    `<p class="plan-line">${esc(trialLine(trial))}</p>
     <ul class="doors">${ACCOUNT_SECTIONS.map(
       (s) =>
         `<li><a href="${s.href}"${s.key === 'delete' ? ' class="danger"' : ''}>${esc(s.label)}</a></li>`
     ).join('')}</ul>`,
    {
      account,
      active: null,
      lede: `Signed in as ${account.email}.`,
    }
  );
}

// -------------------------------------------------------------------- people

/**
 * People and invites.
 *
 * @param {object} args
 * @param {{project: object, people: object[], grants: object[], invites: object[]}[]} args.owned
 * @param {{project: object, ownerName: string|null, role: string|null, grants: object[]}[]} args.shared
 */
export function accountPeoplePage({ account, owned = [], shared = [] }) {
  const ownedHtml = owned.length
    ? owned
        .map(
          ({ project, people, grants, invites }) => `<div class="card">
          <h2>${esc(project.name || project.id)}</h2>
          ${peopleRowsTable({ people, grants, invites, isOwner: true, selfId: account.id })}
          <p><a href="/projects/${esc(project.id)}/people">Add or remove people on ${esc(project.name || project.id)}</a></p>
        </div>`
        )
        .join('\n')
    : '<p class="quiet">You own no projects yet.</p>';

  const sharedRows = shared
    .map(({ project, ownerName, role, grants }) => {
      const access = [
        ...(role ? [`<strong>${esc(roleWordFor(role))}</strong>`] : []),
        ...grants.map(
          (g) =>
            `<strong>${esc(roleWordFor(g.role))}</strong> on ${esc(canvasName(g.canvas_path))} only`
        ),
      ].join(' · ');
      const owner = String(ownerName ?? '').trim();
      return `<tr><td>${esc(project.name || project.id)}${owner ? ` <span class="quiet">· ${esc(owner)}’s project</span>` : ''}</td><td>${access}</td></tr>`;
    })
    .join('\n');
  const sharedHtml = shared.length
    ? `<table><thead><tr><th>Project</th><th>What you can do</th></tr></thead><tbody>${sharedRows}</tbody></table>`
    : '<p class="quiet">Nothing is shared with you yet.</p>';

  return page(
    'People and invites',
    `<h2>Projects you own</h2>${ownedHtml}
     <h2>Shared with you</h2>${sharedHtml}`,
    {
      account,
      active: 'people',
      lede: 'Who can open what. Only a project’s owner sees addresses and invitations.',
    }
  );
}

// ------------------------------------------------------------------- billing

function projectPlanLine(project, { now }) {
  const state = planState(project, { now });
  if (state === 'paid') {
    const plan = pricingCatalog.plans.find((p) => p.id === project.plan);
    return { state, line: `${plan?.name ?? 'A plan'} · plan chosen` };
  }
  if (state === 'trial') {
    const days = Math.max(1, Math.ceil((Number(project.trial_ends_at) - now) / DAY_MS));
    return { state, line: `Free trial · ${plural(days, 'day left', 'days left')}` };
  }
  if (state === 'paused') return { state, line: 'Paused · Choose a plan to keep editing.' };
  return { state, line: (STATE_COPY[project.state] ?? { label: project.state }).label };
}

/** The S9.15 plan picker: today's Checkout, converting THIS trial project. */
function planPicker(project, csrf) {
  const plans = pricingCatalog.plans
    .map(
      (p, i) =>
        `<label><input type="radio" name="plan" value="${esc(p.id)}"${i === 0 ? ' checked' : ''} required> ${esc(p.name)} <span class="quiet">${esc(p.summary ?? '')}</span></label>`
    )
    .join('');
  return `<form class="picker" method="post" action="/projects/${esc(project.id)}/billing/plan">
      ${csrfField(csrf)}
      ${plans}
      <label><input type="radio" name="interval" value="monthly" checked> Monthly</label>
      <label><input type="radio" name="interval" value="annual"> Annual — two months free</label>
      <div><button type="submit">Choose a plan</button></div>
    </form>`;
}

export function accountBillingPage({ account, trial, projects = [], csrf, now = Date.now() }) {
  const rows = projects
    .map((project) => {
      const { state, line } = projectPlanLine(project, { now });
      const picker = state === 'trial' || state === 'paused' ? planPicker(project, csrf) : '';
      return `<div class="card">
        <h2>${esc(project.name || project.id)}</h2>
        <p class="plan-line">${esc(line)}</p>
        ${picker}
        <p><a href="/projects/${esc(project.id)}/billing">Billing details and invoices for ${esc(project.name || project.id)}</a></p>
      </div>`;
    })
    .join('\n');
  return page(
    'Billing and plan',
    `<p class="plan-line">${esc(trialLine(trial))}</p>
     ${projects.length ? rows : '<p class="quiet">You own no projects, so nothing is billed.</p>'}
     <p class="quiet">Payment details are handled by Stripe. Each project has its own plan.</p>`,
    { account, active: 'billing', lede: 'Your free trial, and the plan of each project you own.' }
  );
}

// ---------------------------------------------------------------------- macs

/**
 * A row's handle: derived from the stored id, never the id. The stored id is
 * the credential's hash and the lookup key; the page needs neither.
 */
export async function macHandle(storedId) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`maude-mac-handle:${storedId}`)
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

export function macsPage({
  account,
  macs = [],
  csrf,
  notice = null,
  error = null,
  now = Date.now(),
}) {
  const rows = macs
    .map(
      (m) => `<tr>
        <td>${esc(m.label || 'A Maude app')}</td>
        <td class="quiet">Signed in ${esc(when(m.created_at, { now }))} · ${m.last_used_at ? `last used ${esc(when(m.last_used_at, { now }))}` : 'not used yet'}</td>
        <td class="right"><form class="inline" method="post" action="/account/macs">
          ${csrfField(csrf)}
          <input type="hidden" name="mac" value="${esc(m.handle)}">
          <button type="submit" class="ghost">Sign out this Mac</button>
        </form></td>
      </tr>`
    )
    .join('\n');
  return page(
    'Your Macs',
    `${notices({ error, notice })}
     ${macs.length ? `<table><tbody>${rows}</tbody></table>` : '<p class="quiet">No Mac is signed in to this account. The Maude app signs itself in when you sign in there.</p>'}`,
    {
      account,
      active: 'macs',
      lede: 'Every Maude app signed in to this account. Sign one out and it stops opening your projects the next time it checks in.',
    }
  );
}

// ------------------------------------------------------------------ download

/** What the account file holds — the page says it in these words. */
export const ACCOUNT_FILE_CONTENTS = Object.freeze([
  'your name and address, and when the account was made',
  'your free trial',
  'the projects you own, with their plan',
  'the projects shared with you, with what you can do in each',
  'the Macs signed in to the account',
]);

export function downloadEverythingPage({
  account,
  owned = [],
  sharedCount = 0,
  notice = null,
  error = null,
  now = Date.now(),
}) {
  const rows = owned
    .map(
      (p) => `<tr>
        <td>${esc(p.name || p.id)}</td>
        <td class="quiet">${p.latest ? `Latest copy ${esc(when(p.latest, { now }))}` : 'No copy yet'}</td>
        <td class="right"><a href="/projects/${esc(p.id)}/download">Download ${esc(p.name || p.id)}</a></td>
      </tr>`
    )
    .join('\n');
  return page(
    'Download everything',
    `${notices({ error, notice })}
     <h2>Projects you own</h2>
     ${owned.length ? `<p class="quiet">Each project downloads as one .zip of its whole history, from its own page.</p><table><tbody>${rows}</tbody></table>` : '<p class="quiet">You own no projects.</p>'}
     ${sharedCount ? `<p class="quiet">${esc(plural(sharedCount, 'project is', 'projects are'))} shared with you. Their owners download them.</p>` : ''}
     <h2>Your account</h2>
     <p>One file with ${esc(ACCOUNT_FILE_CONTENTS.join(', '))}.</p>
     <p class="quiet">It holds nothing about other people — no one else’s name or address.</p>
     <p><a class="btn" href="/account/download/account.json">Download your account file</a></p>`,
    {
      account,
      active: 'download',
      lede: 'Everything that is yours, to keep. Downloads work in every state, including after a plan ends.',
    }
  );
}

// -------------------------------------------------------------------- delete

export function deleteAccountPage({ account, blocking = [], csrf, error = null }) {
  if (blocking.length) {
    return page(
      'Delete the account',
      `${notices({ error })}
       <div class="card danger-card">
         <p>You still own ${esc(plural(blocking.length, 'project', 'projects'))}. Delete ${blocking.length === 1 ? 'it' : 'each one'} first — every project offers its download before it goes.</p>
         <ul class="what">${blocking
           .map(
             (p) =>
               `<li>${esc(p.name || p.id)} — <a href="/projects/${esc(p.id)}/delete">Delete ${esc(p.name || p.id)}…</a></li>`
           )
           .join('')}</ul>
       </div>`,
      { account, active: 'delete', lede: 'An account that owns projects cannot be deleted.' }
    );
  }
  const hours = Math.round(ACCESS_TOKEN_TTL_MS / 3_600_000);
  return page(
    'Delete the account?',
    `${notices({ error })}
     <div class="card danger-card">
       <h2>What happens</h2>
       <ul class="what">
         <li>You are signed out here, and every Mac signed in to this account is signed out.</li>
         <li>You leave every project shared with you. A project already open in the app keeps working for up to ${esc(plural(hours, 'hour', 'hours'))}.</li>
         <li>Your name and address are removed now. Invitations sent to the address stop working.</li>
         <li>The address can make a new account later. It gets no second free trial.</li>
         <li>This cannot be undone.</li>
       </ul>
     </div>
     <form method="post" action="/account/delete">
       ${csrfField(csrf)}
       <label for="confirm">Type ${esc(account.email)} to confirm</label>
       <input type="text" id="confirm" name="confirm" required autocomplete="off" spellcheck="false">
       <p><button type="submit" class="danger">Delete the account</button>
          <a href="/account" style="margin-left:1rem">Cancel</a></p>
     </form>`,
    { account, active: 'delete', lede: ACCOUNT_DELETE_LEDE }
  );
}

const ACCOUNT_DELETE_LEDE = 'Your projects are already deleted. This removes the account itself.';

// ---------------------------------------------------------------- reading D1

async function all(db, sql, ...args) {
  const rows = await db
    .prepare(sql)
    .bind(...args)
    .all();
  return rows?.results ?? [];
}

async function accountRow(env, accountId) {
  return env.DB.prepare(
    'SELECT id, email, name, created_at, email_verified_at, trial_started_at FROM accounts WHERE id = ?'
  )
    .bind(accountId)
    .first();
}

/** Projects this account owns and has not deleted. */
async function ownedProjects(env, accountId) {
  return all(
    env.DB,
    `SELECT * FROM projects WHERE account_id = ? AND state != 'purged' ORDER BY name`,
    accountId
  );
}

/**
 * Projects shared with this account: a membership or a canvas grant, never one
 * it owns. Only the owner's NAME rides along — never the address.
 */
async function sharedProjects(env, accountId) {
  const members = await all(
    env.DB,
    `SELECT p.id, p.name, p.state, m.role, o.name AS owner_name
       FROM project_members m
       JOIN projects p ON p.id = m.project_id
       JOIN accounts o ON o.id = p.account_id
      WHERE m.account_id = ?1 AND p.account_id != ?1 AND p.state != 'purged'`,
    accountId
  );
  const grants = await all(
    env.DB,
    `SELECT g.project_id, g.canvas_path, g.role, p.name, p.state, o.name AS owner_name
       FROM canvas_grants g
       JOIN projects p ON p.id = g.project_id
       JOIN accounts o ON o.id = p.account_id
      WHERE g.account_id = ?1 AND p.account_id != ?1 AND p.state != 'purged'`,
    accountId
  ).catch(() => []);
  const byId = new Map();
  for (const m of members) {
    byId.set(m.id, {
      project: { id: m.id, name: m.name, state: m.state },
      ownerName: m.owner_name,
      role: m.role,
      grants: [],
    });
  }
  for (const g of grants) {
    const entry = byId.get(g.project_id) ?? {
      project: { id: g.project_id, name: g.name, state: g.state },
      ownerName: g.owner_name,
      role: null,
      grants: [],
    };
    entry.grants.push({ canvas_path: g.canvas_path, role: g.role });
    byId.set(g.project_id, entry);
  }
  return [...byId.values()].sort((a, b) =>
    String(a.project.name).localeCompare(String(b.project.name))
  );
}

/** Everyone on a project this account owns — the owner's view (addresses included). */
async function ownerView(env, project, { now }) {
  const owner = await env.DB.prepare('SELECT id, email, name FROM accounts WHERE id = ?')
    .bind(project.account_id)
    .first();
  const members = await all(
    env.DB,
    `SELECT m.account_id, m.role, a.email, a.name
       FROM project_members m JOIN accounts a ON a.id = m.account_id
      WHERE m.project_id = ? AND m.account_id != ? ORDER BY a.email`,
    project.id,
    project.account_id
  );
  const grants = await all(
    env.DB,
    `SELECT g.account_id, g.role, g.canvas_path, a.email, a.name
       FROM canvas_grants g JOIN accounts a ON a.id = g.account_id
      WHERE g.project_id = ? ORDER BY a.email, g.canvas_path`,
    project.id
  ).catch(() => []);
  const invites = await all(
    env.DB,
    `SELECT email, role, canvas_path, expires_at FROM project_invites
      WHERE project_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    project.id,
    now
  ).catch(() => []);
  return {
    project,
    people: [
      ...(owner
        ? [{ account_id: owner.id, email: owner.email, name: owner.name, role: 'owner' }]
        : []),
      ...members,
    ],
    grants,
    invites,
  };
}

async function liveMacs(env, accountId) {
  const rows = await all(
    env.DB,
    'SELECT id, label, created_at, last_used_at FROM personal_tokens WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
    accountId
  );
  return Promise.all(
    rows.map(async (r) => ({
      handle: await macHandle(r.id),
      label: r.label,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      _id: r.id,
    }))
  );
}

// -------------------------------------------------------------- the account file

/**
 * The account file, as JSON pieces — streamed so a large account never sits
 * in memory whole. Holds only facts about THIS account: no other person's
 * name or address, no credential, no stored hash.
 */
export async function accountFileParts(env, accountId, { now = Date.now() } = {}) {
  const me = await accountRow(env, accountId);
  const owned = await ownedProjects(env, accountId);
  const shared = await sharedProjects(env, accountId);
  const macs = await all(
    env.DB,
    'SELECT label, created_at, last_used_at FROM personal_tokens WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at',
    accountId
  );
  const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
  const head = {
    format: 'maude-account/1',
    downloadedAt: iso(now),
    account: {
      email: me?.email ?? null,
      name: me?.name ?? null,
      createdAt: iso(me?.created_at),
      emailVerifiedAt: iso(me?.email_verified_at),
    },
    trial: (() => {
      const t = trialView(me, { now });
      return { state: t.state, startedAt: iso(t.startedAt), endsAt: iso(t.endsAt) };
    })(),
  };
  const ownedOut = owned.map((p) => ({
    id: p.id,
    name: p.name,
    state: (STATE_COPY[p.state] ?? { label: p.state }).label,
    plan: planState(p, { now }),
    trialEndsAt: iso(p.trial_ends_at),
    createdAt: iso(p.created_at),
    download: `/projects/${p.id}/download`,
  }));
  const sharedOut = shared.map((s) => ({
    id: s.project.id,
    name: s.project.name,
    access: s.role ? roleWordFor(s.role) : null,
    canvases: s.grants.map((g) => ({
      canvas: canvasName(g.canvas_path),
      access: roleWordFor(g.role),
    })),
  }));
  const macsOut = macs.map((m) => ({
    name: m.label ?? null,
    signedInAt: iso(m.created_at),
    lastUsedAt: iso(m.last_used_at),
  }));
  const body = JSON.stringify(head, null, 2);
  return [
    `${body.slice(0, -2)},\n  "projectsYouOwn": ${JSON.stringify(ownedOut, null, 2).replace(/\n/g, '\n  ')}`,
    `,\n  "sharedWithYou": ${JSON.stringify(sharedOut, null, 2).replace(/\n/g, '\n  ')}`,
    `,\n  "macs": ${JSON.stringify(macsOut, null, 2).replace(/\n/g, '\n  ')}\n}\n`,
  ];
}

function streamParts(parts) {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < parts.length) controller.enqueue(enc.encode(parts[i++]));
      else controller.close();
    },
  });
}

// --------------------------------------------------------------------- CSRF

function cookieValue(request, name) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * This session's account-page CSRF token: HMAC(key, "account-csrf:" + session).
 * Derived, not stored — see operator.mjs `deriveCsrf` for why a double-submit
 * cookie is the wrong shape on a domain whose siblings render untrusted
 * content. `null` without a key, which every POST reads as a refusal.
 */
export async function accountCsrf(sessionToken, secret) {
  if (!sessionToken || !secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`account-csrf:${sessionToken}`));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function csrfFor(request, env) {
  return accountCsrf(cookieValue(request, SESSION_COOKIE), env.CELL_SECRET_MASTER ?? '');
}

/** Same-origin, and the CSRF field matches. Fails closed. */
export async function postAllowed(request, env, url, form) {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return false;
  const expected = await csrfFor(request, env);
  return Boolean(expected) && verifyCsrf(expected, String(form.get('csrf') ?? ''));
}

// ------------------------------------------------------------------ responses

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
};

function html(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...PAGE_HEADERS, ...extra } });
}

function redirect(to, extra = {}) {
  return new Response(null, {
    status: 303,
    headers: { location: to, 'cache-control': 'no-store', ...extra },
  });
}

const REFUSED = '<p>That request could not be verified. Reload the page and try again.</p>';

// -------------------------------------------------------------------- routes

/**
 * Route the account pages. Returns a Response, or null when the path is not
 * ours. `account` is the COOKIE session's — a device token never opens these.
 */
export async function handleAccountPages(request, env, { account, ctx = null } = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(
    /^\/account(?:\/(people|billing|macs|download|delete))?(\/account\.json)?\/?$/
  );
  if (!m) return null;
  const [, section = null, file = null] = m;
  if (file && section !== 'download') return null;
  if (!account) return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  const now = Date.now();
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    return html('<p>Not allowed.</p>', 405);
  }
  const me = (await accountRow(env, account.id)) ?? account;

  // ---- overview (GET only; the pre-v2 revoke form posted here)
  if (section === null) {
    if (method === 'POST') return html(REFUSED, 403);
    return html(overviewPage({ account: me, trial: trialView(me, { now }), now }));
  }

  // ---- people
  if (section === 'people') {
    if (method === 'POST') return html('<p>Not allowed.</p>', 405);
    const owned = await Promise.all(
      (await ownedProjects(env, account.id)).map((p) => ownerView(env, p, { now }))
    );
    const shared = await sharedProjects(env, account.id);
    return html(accountPeoplePage({ account: me, owned, shared }));
  }

  // ---- billing
  if (section === 'billing') {
    if (method === 'POST') return html('<p>Not allowed.</p>', 405);
    return html(
      accountBillingPage({
        account: me,
        trial: trialView(me, { now }),
        projects: await ownedProjects(env, account.id),
        csrf: await csrfFor(request, env),
        now,
      })
    );
  }

  // ---- macs
  if (section === 'macs') {
    const csrf = await csrfFor(request, env);
    if (method !== 'POST') {
      return html(macsPage({ account: me, macs: await liveMacs(env, account.id), csrf, now }));
    }
    const form = await request.formData();
    if (!(await postAllowed(request, env, url, form))) return html(REFUSED, 403);
    const handle = String(form.get('mac') ?? '');
    const target = (await liveMacs(env, account.id)).find((x) => x.handle === handle);
    let notice = null;
    let error = null;
    if (target) {
      // `account_id = ?` again in the write: a handle is only ever matched
      // against THIS account's rows, and the write says so too.
      await env.DB.prepare(
        'UPDATE personal_tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL'
      )
        .bind(now, target._id, account.id)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        actor: `customer:${me.email}`,
        action: 'device.disconnected',
      });
      notice = 'Signed out. That Mac stops opening your projects the next time it checks in.';
    } else {
      error = 'That Mac is already signed out.';
    }
    return html(
      macsPage({ account: me, macs: await liveMacs(env, account.id), csrf, notice, error, now }),
      target ? 200 : 404
    );
  }

  // ---- download
  if (section === 'download') {
    if (method === 'POST') return html('<p>Not allowed.</p>', 405);
    if (file) {
      const budget = await spend(env, request, {
        cost: `account-file:${account.id}`,
        limit: ACCOUNT_EXPORT_LIMIT,
        windowMs: ACCOUNT_EXPORT_WINDOW_MS,
      });
      if (!budget.ok) {
        return html(
          downloadEverythingPage({
            account: me,
            owned: [],
            error:
              'That file was downloaded several times just now. Wait ten minutes and try again.',
          }),
          429
        );
      }
      const parts = await accountFileParts(env, account.id, { now });
      await audit(env.DB, {
        accountId: account.id,
        actor: `customer:${me.email}`,
        action: 'account.file-downloaded',
      }).catch(() => {});
      return new Response(method === 'HEAD' ? null : streamParts(parts), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="maude-account.json"',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        },
      });
    }
    const owned = await Promise.all(
      (await ownedProjects(env, account.id)).map(async (p) => {
        const generations = await exportGenerationsFor(env, p.id).catch(() => []);
        return { id: p.id, name: p.name, latest: stampMs(generations[0]?.stamp) };
      })
    );
    const shared = await sharedProjects(env, account.id);
    return html(downloadEverythingPage({ account: me, owned, sharedCount: shared.length, now }));
  }

  // ---- delete
  const blocking = await ownedProjects(env, account.id);
  const csrf = await csrfFor(request, env);
  if (method !== 'POST') return html(deleteAccountPage({ account: me, blocking, csrf }));
  const form = await request.formData();
  if (!(await postAllowed(request, env, url, form))) return html(REFUSED, 403);
  // Server-side, at the moment of the write — never from what the page showed.
  if (blocking.length) return html(deleteAccountPage({ account: me, blocking, csrf }), 409);
  const typed = String(form.get('confirm') ?? '')
    .trim()
    .toLowerCase();
  if (!typed || typed !== String(me.email).toLowerCase()) {
    return html(
      deleteAccountPage({
        account: me,
        blocking,
        csrf,
        error: 'That is not the address of this account. Nothing was deleted.',
      }),
      400
    );
  }
  await deleteAccount(env, { account: me, now, ctx });
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account deleted — Maude</title></head><body><main><h1>The account is deleted.</h1><p>You are signed out. <a href="/">Back to cloud.maude.sh</a></p></main></body></html>`,
    {
      status: 200,
      headers: {
        ...PAGE_HEADERS,
        'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`,
      },
    }
  );
}

/** `20261006T140500Z` → ms, or null. */
function stampMs(stamp) {
  const m = String(stamp ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/**
 * Delete the account. Precondition (checked by the caller, at the write): it
 * owns no project that is not deleted.
 *
 * One batch where the database offers one, so a failure part-way leaves the
 * account as it was. The row itself stays — deleted projects still name it as
 * their owner (projects.account_id is ON DELETE RESTRICT) — but everything
 * that identifies the person or signs them in is gone: the address becomes
 * `deleted+<id>@deleted.invalid`, the name, password, Google link and payment
 * customer are cleared. `trial_claims` is untouched on purpose.
 */
export async function deleteAccount(env, { account, now = Date.now(), ctx = null }) {
  const db = env.DB;
  const memberships = await all(
    db,
    'SELECT DISTINCT project_id FROM project_members WHERE account_id = ?',
    account.id
  );
  const grantProjects = await all(
    db,
    'SELECT DISTINCT project_id FROM canvas_grants WHERE account_id = ?',
    account.id
  ).catch(() => []);
  const projects = [...new Set([...memberships, ...grantProjects].map((r) => r.project_id))];

  const statements = [
    [
      'UPDATE personal_tokens SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL',
      now,
      account.id,
    ],
    [
      'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL',
      now,
      account.id,
    ],
    // A code approved and not yet collected would mint a Mac sign-in later.
    ['DELETE FROM device_codes WHERE approved_account = ?', account.id],
    [
      'UPDATE handoff_codes SET used_at = ? WHERE account_id = ? AND used_at IS NULL',
      now,
      account.id,
    ],
    // A password-reset link would hand the account back.
    [
      'UPDATE email_tokens SET used_at = ? WHERE account_id = ? AND used_at IS NULL',
      now,
      account.id,
    ],
    // Live connections end through the cells' revocation lists (by address,
    // as every removal does), the rows go now.
    ...projects.map((p) => [
      'INSERT INTO member_revocations (project_id, email, revoked_at) VALUES (?, ?, ?)',
      p,
      account.email,
      now,
    ]),
    ['DELETE FROM project_members WHERE account_id = ?', account.id],
    ['DELETE FROM canvas_grants WHERE account_id = ?', account.id],
    ['DELETE FROM access_requests WHERE account_id = ?', account.id],
    [
      'UPDATE project_invites SET revoked_at = ? WHERE email = ? AND redeemed_at IS NULL AND revoked_at IS NULL',
      now,
      account.email,
    ],
    [
      'UPDATE account_invites SET revoked_at = ? WHERE account_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL',
      now,
      account.id,
    ],
    [
      `UPDATE accounts SET email = ?, name = NULL, password_hash = NULL, google_sub = NULL,
              stripe_customer_id = NULL, email_verified_at = NULL WHERE id = ?`,
      `deleted+${account.id}@${DELETED_EMAIL_DOMAIN}`,
      account.id,
    ],
    [
      'INSERT INTO audit_log (id, account_id, project_id, at, actor, action, reason, detail) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?)',
      `aud_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      account.id,
      now,
      `customer:${account.id}`,
      'account.deleted',
      plural(projects.length, 'membership ended', 'memberships ended'),
    ],
  ];
  const prepared = statements.map(([sql, ...args]) => db.prepare(sql).bind(...args));
  if (typeof db.batch === 'function') await db.batch(prepared);
  else for (const s of prepared) await s.run();

  // The cells hear about it now, not at their next sweep. Best-effort: the
  // rows above already decide; the token lifetime bounds the rest.
  for (const p of projects) {
    const nudge = nudgeCellRevocations(env, p).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(nudge);
  }
  return { memberships: projects.length };
}

// ------------------------------------------------------------------ the lint

/** Every customer-facing string here, for the vocabulary lint. */
export function allAccountHtml() {
  const now = Date.UTC(2026, 9, 6, 14, 5);
  const account = { id: 'a1', email: 'you@example.com', name: 'You' };
  const trial = {
    state: 'trialing',
    startedAt: now - 2 * DAY_MS,
    endsAt: now + 12 * DAY_MS,
    daysLeft: 12,
  };
  const project = { id: 'studio-site', name: 'Studio site', account_id: 'a1', state: 'active' };
  return [
    overviewPage({ account, trial, now }),
    overviewPage({
      account,
      trial: { state: 'ended', startedAt: 1, endsAt: now - DAY_MS, daysLeft: 0 },
      now,
    }),
    accountPeoplePage({
      account,
      owned: [
        {
          project,
          people: [
            { account_id: 'a1', email: 'you@example.com', name: 'You', role: 'owner' },
            { account_id: 'a2', email: 'tereza@example.com', name: 'Tereza', role: 'member' },
          ],
          grants: [
            {
              account_id: 'a3',
              email: 'jonas@example.com',
              name: 'Jonas',
              role: 'viewer',
              canvas_path: 'ui/Pricing.tsx',
            },
          ],
          invites: [
            {
              email: 'new@example.com',
              role: 'observer',
              canvas_path: null,
              expires_at: now + 7 * DAY_MS,
            },
          ],
        },
      ],
      shared: [
        {
          project: { id: 'alligators', name: 'Alligators brand' },
          ownerName: 'Tereza',
          role: 'viewer',
          grants: [],
        },
      ],
    }),
    accountPeoplePage({ account, owned: [], shared: [] }),
    accountBillingPage({
      account,
      trial,
      projects: [
        { ...project, trial_ends_at: now + 12 * DAY_MS, subscription_id: null },
        {
          ...project,
          id: 'b',
          name: 'Alligators brand',
          trial_ends_at: now - DAY_MS,
          subscription_id: null,
        },
        { ...project, id: 'c', name: 'Paid', subscription_id: 'sub_x', plan: 'project' },
      ],
      csrf: 'x'.repeat(32),
      now,
    }),
    macsPage({
      account,
      macs: [
        {
          handle: 'h',
          label: 'Maude on MacBook',
          created_at: now - 3 * DAY_MS,
          last_used_at: now - 120_000,
        },
      ],
      csrf: 'x'.repeat(32),
      notice: 'Signed out. That Mac stops opening your projects the next time it checks in.',
      now,
    }),
    macsPage({ account, macs: [], csrf: 'x', error: 'That Mac is already signed out.' }),
    downloadEverythingPage({
      account,
      owned: [{ id: 'studio-site', name: 'Studio site', latest: now - 3_600_000 }],
      sharedCount: 2,
      now,
    }),
    deleteAccountPage({ account, blocking: [project], csrf: 'x' }),
    deleteAccountPage({
      account,
      blocking: [],
      csrf: 'x',
      error: 'That is not the address of this account. Nothing was deleted.',
    }),
    ROLE_MEANING.viewer,
  ].join('\n');
}
