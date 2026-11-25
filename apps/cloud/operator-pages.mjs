// The operator surface's pages — Cloud Phase 26 Stage 1.
//
// Server-rendered, no script, same as every other signed-in surface. The rule
// is load-bearing here in a way it is not on the dashboard: this is the board
// somebody opens DURING an outage, and a fleet health page that needs
// JavaScript to tell you the fleet is unhealthy cannot tell you anything at
// the one moment it matters.
//
// Read-mostly by design, and every write is a form with a required reason.
// MONEY stays in Stripe, which schema.sql designates the subscription
// authority: nothing here creates, changes, refunds or cancels a subscription,
// and the sweep picks those up within the hour. What an operator CAN do
// (canvas 16; operator-actions.mjs) is everything that is not money at Stripe:
// free time, Promo, a pause by hand, a project made for somebody, a move to
// another owner, signing an account out — plus the original reconcile nudge.
//
// THE PHRASE "operator console" MUST NOT APPEAR ON A CUSTOMER SURFACE.
// `project-admin.test.mjs:498` asserts it, because a tenant hostname once
// greeted a customer with one. These pages live under the apex `/operator/*`
// only and wear the same `appShell`; the trap test stays green because the
// shell's fleet section renders only for an allowlisted operator.

import { FREE_TIME_DAYS } from './billing.mjs';
import { appShell } from './brand.mjs';
import { changesView } from './changes.mjs';
import { operatorPlan } from './plan-copy.mjs';
import { PROMO_TIERS, promoTierLabel } from './promo.mjs';

// The table + card vocabulary the admin surfaces already use (project-admin,
// people-page), plus the one new block: a row of KPI tiles. No new design
// vocabulary — an internal board is the last place to invent any.
const CSS = `
  .main-inner { max-width: 78rem; }
  table { width: 100%; border-collapse: collapse; border-spacing: 0; margin: var(--space-4) 0 var(--space-6); background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; }
  th { text-align: left; font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
  td { padding: var(--space-3) var(--space-5); border-top: 1px solid var(--border-subtle); vertical-align: baseline; font-size: var(--type-base); }
  tr:first-child td { border-top: 0; }
  td.right, th.right { text-align: right; white-space: nowrap; }
  .mono { font-family: var(--font-mono); font-size: var(--type-sm); }
  .quiet { color: var(--fg-2); }
  .card { margin-bottom: var(--space-5); }
  .card h2 { margin: 0 0 var(--space-3); font-size: var(--type-md); }
  time { color: var(--fg-2); font-size: var(--type-sm); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-6); }
  .tile { background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-4) var(--space-5); margin: 0; }
  .tile dt { font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); margin: 0 0 var(--space-2); }
  .tile dd { margin: 0; font-family: var(--font-mono); font-size: var(--type-lg); line-height: var(--lh-md); color: var(--fg-0); }
  .tile .sub { display: block; margin-top: var(--space-2); font-family: var(--font-sans); font-size: var(--type-sm); line-height: var(--lh-sm); color: var(--fg-2); }
  .tile.alarm { border-color: color-mix(in oklab, var(--status-error) 40%, transparent); }

  .problems { list-style: none; margin: 0; padding: 0; }
  .problems li { display: flex; gap: var(--space-4); align-items: baseline; padding: var(--space-3) 0; border-top: 1px solid var(--border-subtle); }
  .problems li:first-child { border-top: 0; }
  .problems .n { font-family: var(--font-mono); font-size: var(--type-md); color: var(--fg-0); min-width: 2.5rem; }
  .problems .k { font-family: var(--font-mono); font-size: var(--type-sm); color: var(--fg-1); min-width: 11rem; }

  .nudge textarea { width: 100%; min-height: 5rem; font: inherit; }
  .nudge label { display: block; margin-bottom: var(--space-2); font-size: var(--type-sm); color: var(--fg-1); }
  .err { color: var(--status-error); font-size: var(--type-sm); }
  .ok { color: var(--status-success); font-size: var(--type-sm); }

  .op-band { margin: 0 0 var(--space-5); padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); background: var(--fg-0); color: var(--bg-0); font-size: var(--type-sm); }
  .head-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-5); }
  .search { display: flex; gap: var(--space-2); margin: 0 0 var(--space-4); }
  .search input { max-width: 26rem; }
  .plan-ok { color: var(--fg-0); }
  .plan-warn { color: var(--status-warn); }
  .plan-stop { color: var(--status-error); }
  .plan-off { color: var(--fg-2); }
  details.sheet { margin: var(--space-3) 0; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--bg-1); }
  details.sheet > summary { cursor: pointer; padding: var(--space-3) var(--space-5); font-weight: 600; }
  details.sheet > form { padding: 0 var(--space-5) var(--space-5); }
  details.sheet label { display: block; margin: var(--space-3) 0 var(--space-1); font-size: var(--type-sm); color: var(--fg-1); }
  details.sheet .pick label { display: flex; gap: var(--space-2); align-items: baseline; margin: var(--space-1) 0; color: var(--fg-0); font-size: var(--type-base); }
  details.sheet textarea { width: 100%; min-height: 4rem; font: inherit; }
  details.sheet .hint { margin: var(--space-1) 0 0; font-size: var(--type-sm); color: var(--fg-2); }
  details.sheet .foot { display: flex; gap: var(--space-4); align-items: center; margin-top: var(--space-4); }
  td form.inline { display: inline; }
  .otabs { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0 0 var(--space-3); padding: 0; list-style: none; }
  .otabs a { display: inline-block; padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill); border: 1px solid var(--border-subtle); color: var(--fg-1); font-size: var(--type-sm); text-decoration: none; }
  .otabs a[aria-current="page"] { background: var(--bg-4); color: var(--fg-0); font-weight: 600; }
  .btn.ghost { background: var(--bg-2); color: var(--fg-1); border-color: var(--border-default); }
  .card h3 { margin: var(--space-3) 0 var(--space-1); font-size: var(--type-sm); color: var(--fg-2); }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * Unknown renders as an em-dash, and only unknown does.
 *
 * The whole point of the three-valued rule: a `0` that means "no cell has ever
 * reported this" is indistinguishable on screen from a `0` that means "it
 * reported, and the answer was none". One of those is a metric; the other is a
 * missing pipe.
 */
export function num(v) {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : String(v);
}

export function money(minor, currency = 'eur') {
  if (minor === null || minor === undefined) return '—';
  const symbol = currency === 'eur' ? '€' : `${String(currency).toUpperCase()} `;
  return `${symbol}${(minor / 100).toFixed(2)}`;
}

/**
 * A timestamp, or an em-dash — and never a thrown RangeError.
 *
 * `new Date(x).toISOString()` throws on an out-of-range epoch, and some of the
 * values reaching here originate in a CELL-REPORTED `/health` body
 * (`windowStartedAt`). A number the board cannot render is still "no answer";
 * it is not a reason for the page an operator opens during an outage to 500.
 */
function when(ms) {
  if (ms === null || ms === undefined) return '—';
  try {
    const iso = new Date(Number(ms)).toISOString();
    return `${iso.replace('T', ' ').slice(0, 16)} UTC`;
  } catch {
    return '—';
  }
}

function bytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function ms(v) {
  return v === null || v === undefined ? '—' : `${Math.round(Number(v))} ms`;
}

/**
 * The cache hit rate, divided HERE — at read time, from the two counts.
 *
 * Never in the cell and never in the sweep. A ratio computed over a window
 * that reset is a confident lie; two counts and a window start can be judged
 * (the render-telemetry contract). `—` when nothing was ever looked up: a 0%
 * cache is a catastrophe and "no builds yet" is a Tuesday.
 */
function cachePct(r, suffix = '') {
  if (!r) return '—';
  const looked = r.cacheHits + r.cacheMisses;
  return looked === 0 ? '—' : `${Math.round((r.cacheHits / looked) * 100)}%${suffix}`;
}

/** Timeouts and memory kills are one operator-facing fact: it hit the wall. */
function ceilingHits(r) {
  return r === null || r === undefined ? null : r.timeouts + r.memoryKills;
}

function tile(label, value, sub = null, { alarm = false } = {}) {
  return `<dl class="tile${alarm ? ' alarm' : ''}">
    <dt>${esc(label)}</dt>
    <dd>${value}${sub ? `<span class="sub">${sub}</span>` : ''}</dd>
  </dl>`;
}

/** The band every operator page wears (canvas 16): whose changes these are. */
const OP_BAND =
  '<p class="op-band">Operator — every account on Maude Cloud is visible here. Changes are logged as yours, with the reason you give.</p>';

function shell({ account, title, body: inner, active, lede = null }) {
  const body = `${OP_BAND}${inner}`;
  return appShell({
    account,
    title,
    body,
    isOperator: true,
    active,
    lede,
    extraCss: CSS,
  });
}

// ---------------------------------------------------------------- overview

/**
 * The board.
 *
 * Four things an operator cannot get anywhere else without a terminal: how
 * many projects exist and in what state, what the plane believes it earns,
 * what the model says it costs, and what is wrong right now.
 *
 * @param {object} args
 * @param {object} args.board     assembleBoard() output
 * @param {object} args.mrr       deriveMrr() output
 * @param {number|null} args.accounts
 * @param {object|null} [args.metrics]  analytics tiles, null when not connected
 * @param {object|null} [args.totals]   summed tenant content stats, null when unknown
 */
export function operatorOverviewPage({
  account,
  board,
  mrr,
  accounts = null,
  metrics = null,
  totals = null,
  stripeUrl = 'https://dashboard.stripe.com/subscriptions',
  lists = null,
  tab = 'newest',
}) {
  const states = Object.entries(board.byState ?? {}).sort((a, b) => b[1] - a[1]);
  const totalProjects = states.reduce((sum, [, n]) => sum + n, 0);

  // The cost tile is a RATIO against a model, never an invoice. `costAlarms`
  // divides observed spend by cell count; `modelPerCellEur: 3` is a Phase-0
  // estimate that has never been given real figures, and presenting an
  // estimate as an invoice is how an estimate stops being questioned.
  const perCell = board.observedSpend === null ? null : board.alarms.perCell;
  const ratio = perCell === null ? null : perCell / board.modelPerCellEur;

  const tiles = [
    tile('Accounts', `<span>${num(accounts)}</span>`),
    tile(
      'Projects',
      `<span>${totalProjects}</span>`,
      states.map(([s, n]) => `${esc(s)} ${n}`).join(' · ') || 'none yet'
    ),
    tile(
      'MRR (believed)',
      `<span>${money(mrr.believedMonthlyMinor, mrr.currency)}</span>`,
      // The label is the honesty. schema.sql: this table is the memory between
      // runs, not the authority — so the number drifts on a missed webhook and
      // the real one is one click away.
      `derived from plan × state · <a href="${esc(stripeUrl)}">Stripe is the authority</a>`
    ),
    tile(
      'Cost vs model',
      `<span>${ratio === null ? '—' : `${ratio.toFixed(1)}×`}</span>`,
      board.observedSpend === null
        ? `no spend figure has ever been collected · model €${board.modelPerCellEur}/cell covers sync AND builds`
        : `€${perCell.toFixed(2)}/cell against a €${board.modelPerCellEur} model` +
            (board.build
              ? ` · build side: ${num(board.build.builds)} builds, ${num(board.build.ceilingHits)} ceiling hits`
              : ' · build side: no cell has reported'),
      { alarm: !board.alarms.ok }
    ),
  ];

  // Stage 4 — WHICH HALF. The €3 model covers a cell's sync lane and its canvas
  // builds together, and until the build sandbox shipped there was no way to
  // say which one moved. This tile is the build half's own figures; whatever
  // the model spends that they do not explain is the sync half.
  if (board.build) {
    const b = board.build;
    tiles.push(
      tile(
        'Canvas builds',
        `<span>${num(b.builds)}</span>`,
        // The ratio is divided HERE, from the two counts, never stored as one:
        // a ratio computed over a window that reset is a confident lie.
        `${b.cacheHitRatio === null ? '—' : `${Math.round(b.cacheHitRatio * 100)}% cached`} · ${num(b.ceilingHits)} ceiling hits · ${b.projects} cells reporting`,
        { alarm: b.ceilingHits > 0 }
      )
    );
  }

  if (metrics) {
    tiles.push(
      tile(
        'Active accounts',
        `<span>${num(metrics.dau)}</span>`,
        `${num(metrics.wau)} this week · ${num(metrics.mau)} this month`
      )
    );
  }
  if (totals) {
    tiles.push(
      tile(
        'Tenant content',
        `<span>${num(totals.canvases)}</span>`,
        `canvases · ${num(totals.designSystems)} design systems · ${bytes(totals.assetsBytes)}`
      )
    );
  }
  if (metrics?.coldStartP95Ms !== undefined) {
    tiles.push(
      tile(
        'Cold start p95',
        `<span>${ms(metrics.coldStartP95Ms)}</span>`,
        'time from waking a sleeping cell to a healthy answer'
      )
    );
  }

  const problems = board.problems.length
    ? `<ul class="problems">${board.problems
        .map(
          (p) => `<li>
            <span class="n">${p.count}</span>
            <span class="k">${esc(p.kind)}</span>
            <span class="quiet">${esc(p.detail ?? '')}${
              p.ids.length
                ? ` — ${esc(p.ids.join(', '))}${p.count > p.ids.length ? ', …' : ''}`
                : ''
            }</span>
          </li>`
        )
        .join('\n')}</ul>`
    : '<p class="quiet">Nothing to interpret. Every serving cell is drilled, checkpointed and on one version.</p>';

  const alarms = board.alarms.alarms.length
    ? `<ul class="problems">${board.alarms.alarms
        .map(
          (a) =>
            `<li><span class="k">${esc(a.kind)}</span><span class="quiet">${esc(a.detail)}</span></li>`
        )
        .join('\n')}</ul>`
    : '';

  const unpriced = mrr.unpriced.length
    ? `<div class="card"><h2>Projects on a plan with no price</h2>
         <p class="quiet">Counted as nothing, which is why they are listed rather than summed.</p>
         <p class="mono">${mrr.unpriced.map((u) => esc(`${u.id} (${u.plan})`)).join(', ')}</p>
       </div>`
    : '';

  return shell({
    account,
    title: 'Fleet overview',
    active: 'operator',
    lede: 'Every project and account on the platform, what the plane believes it earns, and what is wrong right now. Actions live on an account’s page and a project’s page; each needs a reason and is logged.',
    body: `<p class="head-actions"><a class="btn" href="/operator/new-project">New project for an account</a></p>
      <div class="tiles">${tiles.join('\n')}</div>
      ${accountLists(lists, tab)}
      <div class="card"><h2>Needs a look</h2>
        ${alarms ? `<h3>Cost alarms</h3>${alarms}` : ''}
        <h3>Fleet problems</h3>${problems}
      </div>
      ${unpriced}`,
  });
}

/** The four account lists of the overview (canvas 16, cl-operator), with counts. */
const LIST_WORD = {
  newest: 'Newest accounts',
  active: 'Most active',
  trial: 'Trial ends soon',
  promo: 'Promo',
};

/**
 * @param {{counts: object, rows: object[]|null, note?: string}|null} lists
 *   `rows: null` means the list could not be read (Most active without
 *   analytics) — said in words, never drawn as an empty table.
 */
function accountLists(lists, tab) {
  if (!lists) return '';
  const active = Object.hasOwn(LIST_WORD, tab) ? tab : 'newest';
  const tabs = Object.keys(LIST_WORD)
    .map((key) => {
      const n = lists.counts?.[key];
      return `<li><a href="/operator${key === 'newest' ? '' : `?tab=${key}`}"${key === active ? ' aria-current="page"' : ''}>${esc(LIST_WORD[key])}${n === null || n === undefined ? '' : ` <span class="mono">${n}</span>`}</a></li>`;
    })
    .join('');
  const rows = (lists.rows ?? [])
    .map(
      (a) => `<tr>
        <td><a href="/operator/accounts/${esc(a.id)}">${esc(a.email)}</a></td>
        <td class="right mono">${num(a.projects ?? null)}</td>
        <td class="quiet">${esc(a.note ?? '')}</td>
        <td class="right"><time>${when(a.created_at)}</time></td>
      </tr>`
    )
    .join('\n');
  return `<div class="card">
    <ul class="otabs">${tabs}</ul>
    ${
      lists.rows === null
        ? `<p class="quiet">${esc(lists.note ?? 'This list could not be read.')}</p>`
        : rows
          ? `<table><thead><tr><th>Account</th><th class="right">Projects</th><th></th><th class="right">Created</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="quiet">Nobody on this list.</p>'
    }
  </div>`;
}

// ---------------------------------------------------------------- projects

/**
 * Every project, one row each.
 *
 * @param {Map<string, object>|null} [args.stats]  latest reported content stats
 *   per project id. A project absent from the map has never reported, which is
 *   a different fact from reporting zero — hence `—`.
 */
export function operatorProjectsPage({ account, projects = [], stats = null, render = null }) {
  const withStats = stats !== null;
  const withRender = render !== null;
  const rows = projects
    .map((p) => {
      const s = stats?.get(p.id) ?? null;
      const r = render?.get(p.id) ?? null;
      return `<tr>
        <td class="mono"><a href="/operator/projects/${esc(p.id)}">${esc(p.id)}</a></td>
        <td>${esc(p.name ?? '')}</td>
        <td>${esc(p.state)}</td>
        <td>${planCell(p)}</td>
        <td class="quiet">${ownerLink(p)}</td>
        <td class="mono">${esc(p.version ?? '—')}</td>
        <td class="right"><time>${when(p.last_checkpoint)}</time></td>
        <td class="right">${p.cell_running ? 'yes' : 'no'}</td>
        ${
          withStats
            ? `<td class="right mono">${num(s?.canvases ?? null)}</td>
               <td class="right mono">${num(s?.artboards ?? null)}</td>
               <td class="right mono">${bytes(s?.assetsBytes ?? null)}</td>`
            : ''
        }
        ${
          withRender
            ? `<td class="right mono">${num(r?.builds ?? null)}</td>
               <td class="right mono">${cachePct(r)}</td>
               <td class="right mono">${ms(r?.durationMsP95)}</td>
               <td class="right mono">${num(ceilingHits(r))}</td>`
            : ''
        }
      </tr>`;
    })
    .join('\n');

  return shell({
    account,
    title: 'All projects',
    active: 'operator-projects',
    lede: 'Every project on the platform, whatever state it is in. An em-dash means the plane has no answer — never that the answer is zero.',
    body: projects.length
      ? `<table>
          <thead><tr>
            <th>Project</th><th>Name</th><th>State</th><th>Plan</th><th>Owner</th><th>Version</th>
            <th class="right">Last checkpoint</th><th class="right">Cell up</th>
            ${withStats ? '<th class="right">Canvases</th><th class="right">Artboards</th><th class="right">Assets</th>' : ''}
            ${withRender ? '<th class="right">Builds</th><th class="right">Cache hit</th><th class="right">Build p95</th><th class="right">Ceiling hits</th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : '<p class="quiet">No projects yet.</p>',
  });
}

/** A project's plan as support reads it (plan-copy.mjs `operatorPlan`). */
function planCell(project, { now = Date.now() } = {}) {
  const plan = operatorPlan(project, { now });
  return `<span class="plan-${esc(plan.tone)}">${esc(plan.line)}</span>`;
}

/** The owner's address, linking to their account page when the id is known. */
function ownerLink(project) {
  const email = esc(project.owner_email ?? '—');
  return project.account_id
    ? `<a href="/operator/accounts/${esc(project.account_id)}">${email}</a>`
    : email;
}

// ---------------------------------------------------------------- accounts

export function operatorAccountsPage({ account, accounts = [], q = '' }) {
  const rows = accounts
    .map(
      (a) => `<tr>
        <td class="mono"><a href="/operator/accounts/${esc(a.id)}">${esc(a.id)}</a></td>
        <td>${esc(a.email)}</td>
        <td class="right mono">${num(a.projects ?? null)}</td>
        <td class="right">${a.stripe_customer_id ? 'yes' : 'no'}</td>
        <td class="right"><time>${when(a.created_at)}</time></td>
      </tr>`
    )
    .join('\n');

  return shell({
    account,
    title: 'All accounts',
    active: 'operator-accounts',
    lede: 'Who exists on the platform. Reading this list is itself recorded — a fleet-wide view of who our customers are is the break-glass, whatever it is called.',
    body: `<form class="search" method="get" action="/operator/accounts">
        <input type="search" name="q" value="${esc(q)}" maxlength="120"
               placeholder="Email, project name or id" aria-label="Email, project name or id">
        <button type="submit">Find</button>
        ${q ? '<a class="btn ghost" href="/operator/accounts">All accounts</a>' : ''}
      </form>
      ${
        accounts.length
          ? `<table>
          <thead><tr><th>Account</th><th>Email</th><th class="right">Projects</th><th class="right">Stripe</th><th class="right">Created</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
          : `<p class="quiet">${q ? `No account matches “${esc(q)}”.` : 'No accounts yet.'}</p>`
      }`,
  });
}

// ------------------------------------------------------------ the action sheets
//
// No script: a sheet is a <details> holding one form. Every form carries the
// session-derived token and a REQUIRED reason, and says where the reason goes —
// the customer's own Activity page shows it (DDR-193 §4), so it is written for
// them to read.

const REASON_HINT =
  'Recorded permanently with your name. The project’s owner can read it on the Activity page.';

function sheet({ title, action, csrf, fields = '', submit, hidden = {}, note = null, id }) {
  const extra = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<details class="sheet">
    <summary>${esc(title)}</summary>
    <form method="post" action="${esc(action)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">${extra}
      ${note ? `<p class="hint">${note}</p>` : ''}
      ${fields}
      <label for="${esc(id)}-reason">Why</label>
      <textarea id="${esc(id)}-reason" name="reason" required maxlength="500"></textarea>
      <p class="hint">${esc(REASON_HINT)}</p>
      <div class="foot"><button type="submit">${esc(submit)}</button></div>
    </form>
  </details>`;
}

const dateInput = (name, label, id) =>
  `<label for="${esc(id)}">${esc(label)}</label><input type="date" id="${esc(id)}" name="${esc(name)}">`;

/** How long: 14 days · 30 days · 3 months · until a date. */
function freeTimeFields(id) {
  const words = { 14: '14 days', 30: '30 days', 90: '3 months' };
  return `<div class="pick" role="radiogroup" aria-label="How long">
      ${FREE_TIME_DAYS.map(
        (d) =>
          `<label><input type="radio" name="days" value="${d}"${d === 30 ? ' checked' : ''}> ${esc(words[d] ?? `${d} days`)}</label>`
      ).join('')}
      <label><input type="radio" name="days" value="until"> Until a date</label>
    </div>
    ${dateInput('until', 'Until (only with “Until a date”)', `${id}-until`)}`;
}

function freeTimeSheet({ action, csrf, rid, id, title, note, hidden = {} }) {
  return sheet({
    title,
    action,
    csrf,
    id,
    hidden: { rid, ...hidden },
    note,
    fields: freeTimeFields(id),
    submit: 'Give free time',
  });
}

function promoFields(id, { current = 'dedicated' } = {}) {
  return `<div class="pick" role="radiogroup" aria-label="Storage">
      ${PROMO_TIERS.map(
        (t) =>
          `<label><input type="radio" name="tier" value="${esc(t.id)}"${t.id === current ? ' checked' : ''}> ${esc(promoTierLabel(t.id))}</label>`
      ).join('')}
    </div>
    ${dateInput('ends', 'Ends (empty = never)', `${id}-ends`)}
    <p class="hint">With a date, the owner is told 30 days before, and nothing is paused until the date.</p>`;
}

// ------------------------------------------------------------- one account

/**
 * One account: who it is, every project it owns, and its log — with the
 * actions support needs on the same page (canvas 16, cl-op-account).
 *
 * @param {object} args
 * @param {object} args.target     the account being looked at
 * @param {object[]} args.projects every project it owns, each with `people`,
 *   `invitesOpen` and (when a cell reported) `stats`
 * @param {object[]} args.entries  its audit log, newest first
 * @param {() => string} [args.newRid]  one request id per free-time form
 */
export function operatorAccountPage({
  account,
  target,
  projects = [],
  entries = [],
  csrf,
  believedMonthlyMinor = null,
  currency = 'eur',
  notice = null,
  error = null,
  now = Date.now(),
  newRid = () => crypto.randomUUID(),
}) {
  const live = projects.filter((p) => p.state !== 'purged');
  const method = target.google_sub
    ? 'with Google'
    : target.password_hash
      ? 'with a password'
      : 'by an operator, and has not signed in yet';
  const macs = Number(target.macs ?? 0);
  const header = [
    esc(target.email),
    `${target.google_sub || target.password_hash ? 'signed up' : 'made'} ${when(target.created_at)} ${method}`,
    `last here ${target.last_seen ? when(target.last_seen) : 'never'}`,
    macs === 0 ? 'no Mac signed in' : `${macs} ${macs === 1 ? 'Mac' : 'Macs'}`,
  ].join(' · ');

  const plans = live.map((p) => operatorPlan(p, { now }));
  const count = (state) => plans.filter((p) => p.state === state).length;
  const breakdown = [
    ['trial', 'trial'],
    ['paid', 'paid'],
    ['promo', 'Promo'],
    ['paused', 'paused'],
    ['held', 'paused by hand'],
    ['none', 'no plan'],
  ]
    .map(([state, word]) => [count(state), word])
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(' · ');
  const people = live.reduce((n, p) => n + Number(p.people ?? 0), 0);
  const waiting = live.reduce((n, p) => n + Number(p.invitesOpen ?? 0), 0);
  const withStorage = live.filter((p) => p.stats?.assetsBytes != null);
  const tiles = [
    tile('Projects', `<span>${live.length}</span>`, esc(breakdown) || 'none'),
    tile(
      'People',
      `<span>${people}</span>`,
      `across its projects, the owner counted in each · ${waiting} invited, not opened`
    ),
    tile(
      'Pays (believed)',
      `<span>${money(believedMonthlyMinor, currency)}</span>`,
      'a month, from plan × state · Stripe is the authority'
    ),
    // Only when a cell reported: a storage figure summed from nothing would be
    // a zero that means "unknown".
    ...(withStorage.length
      ? [
          tile(
            'Storage',
            `<span>${bytes(withStorage.reduce((n, p) => n + p.stats.assetsBytes, 0))}</span>`,
            `${withStorage.length} of ${live.length} projects reported`
          ),
        ]
      : []),
  ];

  const rows = projects
    .map((p) => {
      const plan = operatorPlan(p, { now });
      // Only where a trial clock exists: a row with no plan never expires, and
      // free time would put an end date on it (operator-actions.mjs `decideFreeTime`).
      const canFree = plan.state === 'trial' || plan.state === 'paused';
      return `<tr>
        <td><a href="/operator/projects/${esc(p.id)}">${esc(p.name || p.id)}</a>
          <span class="quiet mono">${esc(p.id)}</span>${
            p.stats?.canvases != null
              ? ` <span class="quiet">· ${num(p.stats.canvases)} canvases</span>`
              : ''
          }</td>
        <td><span class="plan-${esc(plan.tone)}">${esc(plan.line)}</span></td>
        <td class="right mono">${num(p.people ?? null)}</td>
        <td class="right mono">${bytes(p.stats?.assetsBytes ?? null)}</td>
        <td class="right mono">${num(changesView([p], { now })?.week ?? null)}</td>
        <td class="right"><time>${when(p.last_checkpoint)}</time></td>
        <td>${
          canFree
            ? freeTimeSheet({
                title: plan.state === 'paused' ? 'Wake with free time' : 'Give free time',
                action: `/operator/projects/${p.id}/free-time`,
                csrf,
                rid: newRid(),
                id: `free-${p.id}`,
                hidden: { back: 'account' },
                note:
                  plan.state === 'paused'
                    ? 'Counted from today. The project is editable again as soon as its workspace restarts.'
                    : 'Added on top of the time it already has. No card.',
              })
            : ''
        }</td>
      </tr>`;
    })
    .join('\n');

  const auditRows = entries
    .map(
      (e) => `<tr>
        <td>${esc(e.action)}</td>
        <td class="quiet">${esc(e.actor)}</td>
        <td class="mono quiet">${esc(e.project_id ?? '')}</td>
        <td>${esc(e.reason ?? '—')}</td>
        <td class="right"><time>${when(e.at)}</time></td>
      </tr>`
    )
    .join('\n');

  return shell({
    account,
    title: target.name || target.email,
    active: 'operator-accounts',
    lede: 'One account: every project it owns, the people on them, and what happened. The designs themselves are in each project’s workspace and are not reachable from here.',
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <p class="quiet">${header}</p>
      <p class="head-actions">
        <a class="btn" href="/operator/new-project?owner=${encodeURIComponent(target.email)}">New project for this account</a>
        <a class="btn ghost" href="/operator/accounts/${esc(target.id)}/view">See it as ${esc(target.email)} does</a>
      </p>
      <div class="tiles">${tiles.join('\n')}</div>

      <div class="card"><h2>Projects</h2>
        ${
          projects.length
            ? `<table><thead><tr><th>Project</th><th>Plan</th><th class="right">People</th><th class="right">Storage</th><th class="right">Changes (week)</th><th class="right">Last change</th><th></th></tr></thead><tbody>${rows}</tbody></table>
               <p class="quiet">Last change is the last checkpoint the platform recorded. People in this project, Mark as Promo, Pause, Wake, Move to another owner and Delete are on each project’s own page.</p>`
            : '<p class="quiet">This account owns no project.</p>'
        }
      </div>

      <div class="card"><h2>For the whole account</h2>
        ${freeTimeSheet({
          title: 'Give free time to every project of this account',
          action: `/operator/accounts/${target.id}/free-time`,
          csrf,
          rid: newRid(),
          id: 'free-all',
          note: 'Added to every project that has no paid plan and is not Promo; also wakes the ones paused because their trial ended. A paid project is left alone, and the log says so. The owner gets one e-mail.',
        })}
        ${sheet({
          title: 'Sign out everywhere',
          action: `/operator/accounts/${target.id}/sign-out`,
          csrf,
          id: 'sign-out',
          note: 'Ends every browser sign-in and every Mac of this account. Nothing else changes: the person signs in again and carries on.',
          submit: 'Sign out everywhere',
        })}
      </div>

      <div class="card"><h2>Log</h2>
        ${
          entries.length
            ? `<table><thead><tr><th>Action</th><th>Actor</th><th>Project</th><th>Reason</th><th class="right">When</th></tr></thead><tbody>${auditRows}</tbody></table>`
            : '<p class="quiet">Nothing recorded.</p>'
        }
      </div>`,
  });
}

// ------------------------------------------------- people in one project

/**
 * People in this project (canvas 16, cl-op-account row menu) — the owner's
 * People page, for support: the same list and the same actions, each needing
 * a reason and each recorded as the operator's.
 */
export function operatorProjectPeoplePage({
  account,
  project,
  people = [],
  grants = [],
  invites = [],
  requests = [],
  csrf,
  canView = false,
  notice = null,
  error = null,
}) {
  const action = `/operator/projects/${project.id}/people`;
  const word = (role) => PEOPLE_ROLE_WORD[role] ?? 'Can view';
  const roles = ['member', 'viewer', ...(canView ? ['observer'] : [])];
  const roleOptions = (current) =>
    roles
      .concat(current && !roles.includes(current) && current !== 'owner' ? [current] : [])
      .map(
        (r) =>
          `<option value="${esc(r)}"${r === current ? ' selected' : ''}>${esc(word(r))}</option>`
      )
      .join('');
  const act = (title, hidden, { fields = '', submit, id }) =>
    sheet({ title, action, csrf, id, hidden, fields, submit });

  const personRows = people
    .map((p) => {
      const who = `${esc(String(p.name ?? '').trim() || p.email)} <span class="quiet">${esc(p.email)}</span>`;
      if (p.role === 'owner')
        return `<tr><td>${who}</td><td><strong>Owner</strong></td><td></td></tr>`;
      return `<tr><td>${who}</td><td><strong>${esc(word(p.role))}</strong></td><td>
        ${act(
          'Change role',
          { do: 'role', account: p.account_id },
          {
            id: `role-${p.account_id}`,
            fields: `<label for="role-${esc(p.account_id)}-r">What they can do</label><select id="role-${esc(p.account_id)}-r" name="role">${roleOptions(p.role)}</select>`,
            submit: 'Save',
          }
        )}
        ${act('Remove', { do: 'remove', account: p.account_id }, { id: `rm-${p.account_id}`, submit: 'Remove from this project' })}
      </td></tr>`;
    })
    .join('\n');
  const grantRows = grants
    .map(
      (g) =>
        `<tr><td>${esc(String(g.name ?? '').trim() || g.email)} <span class="quiet">${esc(g.email)}</span></td><td><strong>${esc(word(g.role))}</strong> <span class="quiet">on one canvas only</span></td><td></td></tr>`
    )
    .join('\n');
  const inviteRows = invites
    .map(
      (
        i
      ) => `<tr><td>${esc(i.email)}</td><td><strong>${esc(word(i.role))}</strong> <span class="quiet">not joined yet · until ${when(i.expires_at)}</span></td><td>
        ${act('Send again', { do: 'invite-resend', invite: i.id }, { id: `rs-${i.id}`, submit: 'Send again' })}
        ${act('Cancel invite', { do: 'invite-cancel', invite: i.id }, { id: `cx-${i.id}`, submit: 'Cancel invite' })}
      </td></tr>`
    )
    .join('\n');
  const requestRows = requests
    .map(
      (
        r
      ) => `<tr><td>${esc(String(r.name ?? '').trim() || r.email)} <span class="quiet">${esc(r.email)}</span></td><td class="quiet">asked ${when(r.created_at)}</td><td>
        ${act('Allow editing', { do: 'request-allow', request: r.id }, { id: `ok-${r.id}`, submit: 'Allow editing' })}
        ${act('Not now', { do: 'request-decline', request: r.id }, { id: `no-${r.id}`, submit: 'Not now' })}
      </td></tr>`
    )
    .join('\n');

  return shell({
    account,
    title: `People in ${project.name || project.id}`,
    active: 'operator-projects',
    lede: 'Who is on this project and what each can do. Every change here is recorded as Maude support’s, with your reason, on the project’s own Activity page.',
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <p class="head-actions"><a class="btn ghost" href="/operator/projects/${esc(project.id)}">Back to the project</a></p>
      <div class="card"><h2>People</h2>
        <table><thead><tr><th>Person</th><th>What they can do</th><th></th></tr></thead><tbody>${personRows}${grantRows}</tbody></table>
      </div>
      ${requests.length ? `<div class="card"><h2>Asks to edit</h2><table><tbody>${requestRows}</tbody></table></div>` : ''}
      ${invites.length ? `<div class="card"><h2>Invited</h2><table><tbody>${inviteRows}</tbody></table></div>` : ''}
      <div class="card"><h2>Invite someone</h2>
        ${act(
          'Invite by e-mail',
          { do: 'invite' },
          {
            id: 'invite',
            fields: `<label for="invite-email">Their email</label><input type="email" id="invite-email" name="email" required maxlength="254">
            <label for="invite-role">What they can do</label><select id="invite-role" name="role">${roleOptions('member')}</select>
            ${canView ? '' : '<p class="hint">Can view is not available for this project yet.</p>'}`,
            submit: 'Send invitation',
          }
        )}
      </div>`,
  });
}

const PEOPLE_ROLE_WORD = {
  owner: 'Owner',
  member: 'Can edit',
  viewer: 'Can comment',
  observer: 'Can view',
};

// --------------------------------------------------------- new project sheet

/** New project for an account, no checkout (canvas 16, cl-operator). */
export function operatorNewProjectPage({ account, csrf, values = {}, error = null }) {
  const v = (k) => esc(values[k] ?? '');
  const plan = values.plan === 'trial' ? 'trial' : 'promo';
  return shell({
    account,
    title: 'New project for an account',
    active: 'operator-accounts',
    lede: 'For a customer, a friend or a demo — no checkout. If the address has no account, one is made with no password, and its owner gets one e-mail.',
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <form class="card" method="post" action="/operator/new-project">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label for="owner">Owner’s email</label>
        <input type="email" id="owner" name="owner" value="${v('owner')}" required maxlength="254">
        <label for="name">Project name</label>
        <input type="text" id="name" name="name" value="${v('name')}" required maxlength="120">
        <fieldset>
          <legend>Plan</legend>
          <label><input type="radio" name="plan" value="promo"${plan === 'promo' ? ' checked' : ''}> Promo — never a trial, never paused; you pick the storage</label>
          <label><input type="radio" name="plan" value="trial"${plan === 'trial' ? ' checked' : ''}> Trial — then the owner picks a plan</label>
        </fieldset>
        <fieldset>
          <legend>Promo storage</legend>
          ${PROMO_TIERS.map(
            (t) =>
              `<label><input type="radio" name="tier" value="${esc(t.id)}"${(values.tier ?? 'dedicated') === t.id ? ' checked' : ''}> ${esc(promoTierLabel(t.id))}</label>`
          ).join('')}
          <label for="ends">Promo ends (empty = never)</label>
          <input type="date" id="ends" name="ends" value="${v('ends')}">
        </fieldset>
        <label for="invites">Also invite, as Can edit</label>
        <input type="text" id="invites" name="invites" value="${v('invites')}" placeholder="Emails, separated by commas">
        <label for="reason">Why</label>
        <textarea id="reason" name="reason" required maxlength="500">${v('reason')}</textarea>
        <p class="quiet">${esc(REASON_HINT)}</p>
        <p><button type="submit">Make project</button> <a href="/operator/accounts">Cancel</a></p>
      </form>`,
  });
}

// ------------------------------------------------------------ project detail

/**
 * One project, everything the plane knows plus the one action.
 *
 * The audit tail renders the REASON column, which the customer-facing page did
 * not until this phase. An operator access with no stated reason is the one
 * worth noticing (schema.sql), and a column that is never displayed is a
 * column nobody fills in honestly.
 */
export function operatorProjectPage({
  account,
  project,
  jobs = [],
  entries = [],
  csrf,
  stats = null,
  render = null,
  error = null,
  notice = null,
  now = Date.now(),
  newRid = () => crypto.randomUUID(),
}) {
  const plan = operatorPlan(project, { now });
  const base = `/operator/projects/${project.id}`;
  const facts = [
    ['id', `<span class="mono">${esc(project.id)}</span>`],
    ['name', esc(project.name ?? '')],
    ['owner', ownerLink(project)],
    ['plan state', `<span class="plan-${esc(plan.tone)}">${esc(plan.line)}</span>`],
    [
      'state',
      `${esc(project.state)} <span class="quiet">since ${when(project.state_since)}</span>`,
    ],
    ['plan', esc(project.plan ?? '')],
    [
      'subscription',
      project.subscription_id
        ? `<a class="mono" href="https://dashboard.stripe.com/subscriptions/${esc(project.subscription_id)}">${esc(project.subscription_id)}</a>`
        : '—',
    ],
    ['version', `<span class="mono">${esc(project.version ?? '—')}</span>`],
    ['previous version', `<span class="mono">${esc(project.previous_version ?? '—')}</span>`],
    ['canary', project.canary ? 'yes' : 'no'],
    ['cell running', project.cell_running ? 'yes' : 'no'],
    ['last checkpoint', when(project.last_checkpoint)],
    ['last restore drill', when(project.last_restore_drill)],
    ['export sent', when(project.export_sent_at)],
    ['created', when(project.created_at)],
  ];

  if (stats) {
    facts.push([
      'content',
      `${num(stats.canvases)} canvases · ${num(stats.artboards)} artboards · ${num(stats.designSystems)} design systems · ${bytes(stats.assetsBytes)}`,
    ]);
  }
  if (render) {
    facts.push([
      'canvas builds',
      `${num(render.builds)} builds · ${cachePct(render, ' cached')} · p95 ${ms(render.durationMsP95)} · ${num(ceilingHits(render))} ceiling hits` +
        // Without the window start, a row of zeroes is ambiguous between "a
        // quiet hour" and "this cell rebooted a minute ago".
        ` <span class="quiet">(window from ${when(render.windowStartedAt ?? null)})</span>`,
    ]);
  }

  const jobRows = jobs
    .map(
      (j) => `<tr>
        <td class="mono">${esc(j.reason)}</td>
        <td>${esc(j.outcome ?? 'pending')}</td>
        <td class="quiet">${esc(String(j.detail ?? '').slice(0, 160))}</td>
        <td class="right"><time>${when(j.created_at)}</time></td>
      </tr>`
    )
    .join('\n');

  const auditRows = entries
    .map(
      (e) => `<tr>
        <td>${esc(e.action)}</td>
        <td class="quiet">${esc(e.actor)}</td>
        <td>${esc(e.reason ?? '—')}</td>
        <td class="right"><time>${when(e.at)}</time></td>
      </tr>`
    )
    .join('\n');

  return shell({
    account,
    title: project.name || project.id,
    active: 'operator-projects',
    lede: 'Everything the control plane knows about this project. What it holds, what it earns and what state it is in — the designs themselves are in the cell and are not reachable from here.',
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <div class="card"><h2>Row</h2>
        <table><tbody>${facts
          .map(([k, v]) => `<tr><td class="quiet">${esc(k)}</td><td>${v}</td></tr>`)
          .join('\n')}</tbody></table>
      </div>

      <div class="card"><h2>Recent jobs</h2>
        ${
          jobs.length
            ? `<table><thead><tr><th>Reason</th><th>Outcome</th><th>Detail</th><th class="right">Created</th></tr></thead><tbody>${jobRows}</tbody></table>`
            : '<p class="quiet">No jobs recorded.</p>'
        }
      </div>

      <div class="card"><h2>Activity</h2>
        ${
          entries.length
            ? `<table><thead><tr><th>Action</th><th>Actor</th><th>Reason</th><th class="right">When</th></tr></thead><tbody>${auditRows}</tbody></table>`
            : '<p class="quiet">Nothing recorded.</p>'
        }
      </div>

      <p class="head-actions">
        <a class="btn" href="/operator/projects/${esc(project.id)}/people">People in this project</a>
        ${project.account_id ? `<a class="btn ghost" href="/operator/accounts/${esc(project.account_id)}/view/projects/${esc(project.id)}/people">See it as the owner does</a>` : ''}
      </p>
      <div class="card"><h2>Actions</h2>
        <p class="quiet">None of these touches a subscription at Stripe. A project with a paid plan
          is refused by the ones that would disagree with it, and the refusal is logged.</p>
        ${
          plan.state === 'trial' || plan.state === 'paused'
            ? freeTimeSheet({
                title: plan.state === 'paused' ? 'Wake with free time' : 'Give free time',
                action: `${base}/free-time`,
                csrf,
                rid: newRid(),
                id: 'free',
                note: 'Days added to the time the project is free for — counted from today when that time has run out. No card, and the owner gets one e-mail.',
              })
            : ''
        }
        ${
          plan.state === 'paid' || plan.state === 'lapsed' || plan.state === 'gone'
            ? ''
            : sheet({
                title: project.promo_since != null ? 'Change Promo' : 'Mark as Promo',
                action: `${base}/promo`,
                csrf,
                id: 'promo',
                note: 'It stays free, never becomes a trial and is never paused while Promo runs.',
                fields: promoFields('promo', { current: project.promo_tier ?? 'dedicated' }),
                submit: project.promo_since != null ? 'Save Promo' : 'Mark as Promo',
              })
        }
        ${
          project.promo_since != null && plan.state !== 'paid'
            ? sheet({
                title: 'End Promo',
                action: `${base}/promo/end`,
                csrf,
                id: 'promo-end',
                note: 'After the date the owner picks a plan to keep editing. Nothing is deleted.',
                fields: dateInput('ends', 'Ends on (empty = today)', 'promo-end-ends'),
                submit: 'End Promo',
              })
            : ''
        }
        ${
          project.hold_since != null
            ? sheet({
                title: 'Wake',
                action: `${base}/wake`,
                csrf,
                id: 'wake',
                note: 'Lifts the pause. The platform check then brings the project back as its plan says.',
                submit: 'Wake',
              })
            : project.state === 'active' || project.state === 'past_due'
              ? sheet({
                  title: 'Pause',
                  action: `${base}/pause`,
                  csrf,
                  id: 'pause',
                  note: 'Stops the workspace and takes its address down. Nothing is deleted, no deletion is scheduled, and the owner can still download everything. A paid subscription keeps charging — pausing does not stop it.',
                  submit: 'Pause',
                })
              : ''
        }
        ${
          project.state === 'purged' || project.subscription_id
            ? ''
            : sheet({
                title: 'Move to another owner',
                action: `${base}/move`,
                csrf,
                id: 'move',
                note: 'The new owner must already have an account. The current owner stays on the project as Can edit.',
                fields:
                  '<label for="move-to">New owner’s email</label><input type="email" id="move-to" name="to" required maxlength="254">',
                submit: 'Move',
              })
        }
        ${
          project.delete_since != null
            ? plan.state === 'deleting' && project.state === 'suspended'
              ? sheet({
                  title: 'Undo the scheduled deletion',
                  action: `${base}/delete/undo`,
                  csrf,
                  id: 'undelete',
                  note: 'Nothing has been deleted yet. The project comes back as its plan says, and the owner reads this on Activity.',
                  submit: 'Undo',
                })
              : ''
            : project.state === 'purged' || project.state === 'exported' || project.subscription_id
              ? ''
              : sheet({
                  title: 'Delete…',
                  action: `${base}/delete`,
                  csrf,
                  id: 'delete',
                  note: 'Never at once. The project is paused, a complete copy is prepared and mailed to its owner, they are warned two days before, and it is deleted after 30 days. Until then this can be undone here.',
                  fields: `<label for="delete-confirm">Type the project’s name or id to confirm</label><input type="text" id="delete-confirm" name="confirm" required autocomplete="off">`,
                  submit: 'Schedule the deletion',
                })
        }
      </div>

      <div class="card nudge"><h2>Ask the reconciler to run</h2>
        <p class="quiet">It enqueues a job; the reconciler
          re-derives everything from Stripe and the cell, exactly as the hourly sweep does.
          Comping and refunding stay in Stripe — the sweep picks those up on its own.</p>
        <form method="post" action="/operator/projects/${esc(project.id)}/reconcile">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <label for="reason">Why, in your own words. Recorded permanently, and the customer can read it.</label>
          <textarea id="reason" name="reason" required maxlength="500"
            placeholder="e.g. customer reported the project stuck in setup"></textarea>
          <button type="submit">Enqueue a reconcile</button>
        </form>
      </div>`,
  });
}

// ------------------------------------------------------------------- events

/**
 * Product analytics, read back out of Workers Analytics Engine.
 *
 * `metrics === null` means the read token is not configured. That renders as a
 * quiet "not connected" panel rather than an error page: an unset optional
 * secret is a deployment state, not a fault, and a board that 500s because one
 * tile has no data is a board that cannot report the outage it exists for.
 */
export function operatorEventsPage({ account, metrics = null, sampled = false }) {
  if (!metrics) {
    return shell({
      account,
      title: 'Usage',
      active: 'operator-events',
      lede: 'Server-side product analytics, emitted by the edge and read back over the Analytics Engine SQL API.',
      body: `<div class="card"><h2>Analytics is not connected</h2>
        <p class="quiet">Events are being written — the binding is part of the Worker. Reading them
          back needs a separate token with <span class="mono">Account Analytics Read</span> and
          nothing else:</p>
        <p class="mono">wrangler secret put CF_ANALYTICS_TOKEN</p>
      </div>`,
    });
  }

  const approx = (n) => (n === null || n === undefined ? '—' : `${sampled ? '~' : ''}${n}`);

  const byName = (metrics.byName ?? [])
    .map(
      (r) =>
        `<tr><td class="mono">${esc(r.name)}</td><td class="right mono">${approx(r.count)}</td></tr>`
    )
    .join('\n');

  return shell({
    account,
    title: 'Usage',
    active: 'operator-events',
    lede: sampled
      ? 'Analytics Engine sampled this window, so the counts are approximations — shown with a leading ~.'
      : 'Server-side product analytics. Account ids and action names only: no email, no content, no third party.',
    body: `<div class="tiles">
        ${tile('Active today', `<span>${approx(metrics.dau)}</span>`, 'distinct accounts, last 24 h')}
        ${tile('Active this week', `<span>${approx(metrics.wau)}</span>`, 'distinct accounts, last 7 d')}
        ${tile('Active this month', `<span>${approx(metrics.mau)}</span>`, 'distinct accounts, last 30 d')}
        ${tile('Signups', `<span>${approx(metrics.signups)}</span>`, 'last 30 d')}
        ${tile('Checkouts completed', `<span>${approx(metrics.checkouts)}</span>`, 'last 30 d')}
      </div>
      <div class="card"><h2>Events, last 7 days</h2>
        ${
          byName
            ? `<table><thead><tr><th>Event</th><th class="right">Count</th></tr></thead><tbody>${byName}</tbody></table>`
            : '<p class="quiet">No events in the window.</p>'
        }
      </div>`,
  });
}

/** Every operator-surface string, for the vocabulary lint + the leak trap. */
export function allOperatorHtml() {
  const account = { email: 'op@example.com', id: 'acct_op' };
  const project = {
    id: 'alligators',
    name: 'Brno Alligators',
    state: 'active',
    state_since: 0,
    plan: 'project',
    owner_email: 'a@example.com',
    subscription_id: 'sub_1',
    version: 'v1',
    previous_version: null,
    canary: 0,
    cell_running: 1,
    last_checkpoint: null,
    last_restore_drill: null,
    export_sent_at: null,
    created_at: 0,
  };
  return [
    operatorOverviewPage({
      account,
      board: {
        byState: { active: 1 },
        problems: [{ kind: 'never-drilled', count: 1, ids: ['alligators'], detail: 'x' }],
        alarms: { alarms: [], ok: true, perCell: 0, total: 0 },
        observedSpend: null,
        modelPerCellEur: 3,
      },
      mrr: { believedMonthlyMinor: 1900, currency: 'eur', byPlan: [], unpriced: [] },
      accounts: 1,
    }),
    operatorProjectsPage({ account, projects: [project] }),
    operatorAccountsPage({ account, accounts: [{ ...project, id: 'acct_1', email: 'a@e.com' }] }),
    operatorProjectPage({ account, project, csrf: 'x'.repeat(32) }),
    operatorProjectPage({
      account,
      project: { ...project, subscription_id: null, promo_since: 1, promo_tier: 'dedicated' },
      csrf: 'x'.repeat(32),
    }),
    operatorProjectPage({
      account,
      project: { ...project, subscription_id: null, state: 'suspended', hold_since: 1 },
      csrf: 'x'.repeat(32),
    }),
    operatorAccountPage({
      account,
      target: { id: 'acct_1', email: 'a@example.com', created_at: 0 },
      projects: [{ ...project, subscription_id: null, trial_ends_at: 1, people: 2 }],
      csrf: 'x'.repeat(32),
    }),
    operatorNewProjectPage({ account, csrf: 'x'.repeat(32) }),
    operatorEventsPage({ account, metrics: null }),
  ].join('\n');
}
