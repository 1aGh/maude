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
import {
  appShell,
  avatar,
  icon,
  logLine,
  sheetActions,
  stat,
  statusWord,
  thumb,
  who,
} from './brand.mjs';
import { changesView } from './changes.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { operatorPlan } from './plan-copy.mjs';
import { AUDIT_COPY, foldActivity } from './project-admin.mjs';
import { PROMO_TIERS, promoTierLabel } from './promo.mjs';
import { routineCount } from './routine-log.mjs';

/** An audit action in words — the customer's own wording where there is one, never a dotted key. */
export function actionWord(action) {
  const a = String(action ?? '');
  return (
    AUDIT_COPY[a] ??
    a
      .replace(/^operator\./, '')
      .replace(/[.-]+/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
const timesMark = (e) =>
  e.times > 1 ? ` <span class="ma-count ma-count--quiet">${e.times}×</span>` : '';

// The page pieces are the shared ones (brand-css.mjs, canvas 16): stat tiles,
// cards, tables, the log feed. Only what an operator page adds lives here.
const CSS = `
  .op-kv { display: grid; grid-template-columns: 150px 1fr; gap: var(--space-1) var(--space-3); margin: 0; padding: 0 var(--space-5) var(--space-4); font-size: var(--type-sm); }
  .op-kv dt { color: var(--fg-2); }
  .op-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .op-acts { display: flex; flex-direction: column; }
  .op-acts details.sheet { box-shadow: inset 0 0.5px 0 var(--border-subtle); }
  /* In a table row the doors sit side by side as small buttons on the right; one that is opened takes the row's width under them. */
  .op-acts-cell { text-align: right; vertical-align: middle; width: 240px; }
  .op-acts--row { flex-direction: row; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
  .op-acts--row details.sheet { box-shadow: none; text-align: left; white-space: normal; }
  .op-acts--row details.sheet > summary { padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px var(--border-default); font-weight: var(--weight-medium); white-space: nowrap; }
  .op-acts--row details.sheet > summary::after { content: none; }
  .op-acts--row details.sheet[open] { flex-basis: 100%; min-width: 260px; }
  .op-acts--row details.sheet > form { padding: var(--space-3) 0 0; }
  details.sheet > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-3) var(--space-5); font-size: var(--type-sm); font-weight: var(--weight-semibold); }
  details.sheet > summary::-webkit-details-marker { display: none; }
  details.sheet > summary::after { content: "›"; color: var(--fg-3); font-size: var(--type-md); line-height: 1; }
  details.sheet[open] > summary::after { transform: rotate(90deg); }
  details.sheet > summary:hover { background: var(--bg-3); }
  details.sheet > form { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0 var(--space-5) var(--space-4); }
  details.sheet label, .op-form label { margin: 0; }
  textarea[name=reason] { min-height: 52px; height: 52px; }
  .ma-sheet .field-hint, details.sheet .field-hint { font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); }
  .ma-seg-b { white-space: nowrap; padding: 0 var(--space-2); }
  form:not(:has(input[name=days][value=until]:checked)) .field:has(input[name=until]) { display: none; }
  .hint { margin: 0; font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); }
  .err { margin: 0 0 var(--space-4); color: var(--status-error-text); font-size: var(--type-sm); font-weight: var(--weight-semibold); }
  .ok { margin: 0 0 var(--space-4); }
  .op-nudge { padding: 0 var(--space-5) var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
  .op-nudge form { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; }
  .op-nudge button { align-self: flex-start; }
  .op-ev-r { color: var(--fg-2); }
  .ma-table td.mono, .mono { font-family: var(--font-mono); font-size: var(--type-xs); color: var(--fg-1); }
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

/** `€8 460` — a tile's money: whole units, grouped by a thin space. */
function wholeMoney(minor, currency = 'eur') {
  if (minor === null || minor === undefined) return '—';
  const symbol = currency === 'eur' ? '€' : `${String(currency).toUpperCase()} `;
  return `${symbol}${Math.round(minor / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')}`;
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

/**
 * One stat tile (canvas 16): label with its glyph, the figure, one quiet line.
 * `value` and `sub` are plain text — every figure here is a number this module
 * formatted, and anything a cell reported is escaped by `stat`.
 */
function tile(label, glyph, value, { unit = null, sub = null, alarm = false, href = null } = {}) {
  return stat({
    label,
    glyph,
    value: String(value),
    unit,
    foot: sub
      ? `<span${alarm ? ' class="op-alarm"' : ''}>${alarm ? statusWord('error', sub) : esc(sub)}</span>`
      : null,
    href,
  });
}

/** The row of tiles, re-dividing itself over the tiles that are there. */
const tiles = (list) =>
  list.length ? `<div class="ma-stats" style="--n:${list.length}">${list.join('\n')}</div>` : '';

/** A card with a heading. `title` is plain text; `inner` and `aside` are trusted markup. */
const card = (title, inner, { aside = '', cls = '' } = {}) =>
  `<div class="ma-card ma-card--clip${cls ? ` ${cls}` : ''}"><h2 class="ma-card-h">${esc(title)}${aside ? ` ${aside}` : ''}</h2>${inner}</div>`;

/** A quiet paragraph inside a card. `text` is trusted markup. */
const note = (text) => `<p class="ma-card-p">${text}</p>`;

/** A plan said with its tone, as a word with a dot. */
const PLAN_SW = { ok: 'ok', warn: 'warn', stop: 'error', off: 'off' };
function planWord(plan) {
  if (plan.state === 'promo') return `<span class="ma-promo">${esc(plan.line)}</span>`;
  return statusWord(PLAN_SW[plan.tone] ?? 'ok', plan.line);
}

function shell({
  account,
  title,
  body,
  active,
  lede = null,
  heading = null,
  actions = '',
  sheet = null,
  counts = {},
  q = '',
}) {
  return appShell({
    account,
    title,
    heading,
    body,
    q,
    isOperator: true,
    counts,
    active,
    lede,
    actions,
    sheet,
    wide: true,
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
  sheet = null,
  now = Date.now(),
}) {
  const states = Object.entries(board.byState ?? {}).sort((a, b) => b[1] - a[1]);
  const totalProjects = states.reduce((sum, [, n]) => sum + n, 0);
  const running = board.byState?.active ?? 0;

  // The cost line is a RATIO against a model, never an invoice. `costAlarms`
  // divides observed spend by cell count; `modelPerCellEur: 3` is a Phase-0
  // estimate that has never been given real figures, and presenting an
  // estimate as an invoice is how an estimate stops being questioned.
  const perCell = board.observedSpend === null ? null : board.alarms.perCell;
  const ratio = perCell === null ? null : perCell / board.modelPerCellEur;

  const list = [
    tile('Accounts', 'people', num(accounts), { href: '/operator/accounts' }),
    tile('Projects running', 'folder', running, {
      unit: `of ${totalProjects}`,
      sub: states.map(([st, n]) => `${st} ${n}`).join(' · ') || 'none yet',
      href: '/operator/projects',
    }),
  ];
  if (metrics) {
    list.push(
      tile('People active', 'pulse', num(metrics.wau), {
        unit: 'week',
        sub: `${num(metrics.dau)} today · ${num(metrics.mau)} this month`,
      })
    );
  }
  list.push(
    stat({
      label: 'Monthly revenue',
      glyph: 'export',
      value: wholeMoney(mrr.believedMonthlyMinor, mrr.currency),
      // The label is the honesty. schema.sql: this table is the memory between
      // runs, not the authority — so the number drifts on a missed webhook and
      // the real one is one click away.
      foot: `<span>${
        board.observedSpend === null
          ? 'no spend figure has ever been collected'
          : board.alarms.ok
            ? `cost ${ratio.toFixed(1)}× the €${board.modelPerCellEur}/cell model · ok`
            : statusWord(
                'error',
                `cost ${ratio.toFixed(1)}× the €${board.modelPerCellEur}/cell model`
              )
      } · derived from plans · <a href="${esc(stripeUrl)}">Stripe is the authority</a></span>`,
    })
  );
  if (metrics?.coldStartP95Ms !== undefined && metrics?.coldStartP95Ms !== null) {
    list.push(
      tile('Cold start', 'clock', (Number(metrics.coldStartP95Ms) / 1000).toFixed(1), {
        unit: 's p95',
        sub:
          board.build?.cacheHitRatio != null
            ? `canvas builds ${Math.round(board.build.cacheHitRatio * 100)} % cached`
            : 'waking a sleeping cell to a healthy answer',
      })
    );
  }
  // Stage 4 — WHICH HALF. The €3 model covers a cell's sync lane and its canvas
  // builds together; this tile is the build half's own figures.
  if (board.build) {
    const b = board.build;
    list.push(
      tile('Canvas builds', 'file', num(b.builds), {
        sub: `${b.cacheHitRatio === null ? '—' : `${Math.round(b.cacheHitRatio * 100)}% cached`} · ${num(b.ceilingHits)} ceiling hits · ${b.projects} cells reporting`,
        alarm: b.ceilingHits > 0,
      })
    );
  }
  if (totals) {
    list.push(
      tile('Tenant content', 'file', num(totals.canvases), {
        unit: 'canvases',
        sub: `${num(totals.designSystems)} design systems · ${bytes(totals.assetsBytes)}`,
      })
    );
  }

  // Needs a look: what is wrong right now, each a word with a dot.
  const alarmRows = [
    ...board.alarms.alarms.map(
      (a) =>
        `<div class="ma-alarm">${statusWord('error', 'Cost alarm')}<span>${esc(a.kind)} — ${esc(a.detail)}</span><span></span></div>`
    ),
    // Every row opens Fleet with just those cells — a list you cannot click
    // into is a list you have to read twice (owner, 2026-11-27).
    ...board.problems.map(
      (p) =>
        `<a class="ma-alarm ma-alarm--go" href="/operator/fleet?need=${encodeURIComponent(p.kind)}">${statusWord('warn', `${p.count} · ${KIND_WORD[p.kind] ?? p.kind}`)}<span>${esc(p.ids.slice(0, 4).join(', '))}${p.count > Math.min(4, p.ids.length) ? ` and ${p.count - Math.min(4, p.ids.length)} more` : ''}</span><span>${icon('chevron-r', 12)}</span></a>`
    ),
  ];
  const needs = card(
    'Needs a look',
    alarmRows.length
      ? `<div class="ma-feed">${alarmRows.join('\n')}</div>`
      : note(
          'Nothing to interpret. Every serving cell is drilled, checkpointed and on one version.'
        ),
    { aside: alarmRows.length ? `<small>${alarmRows.length}</small>` : '' }
  );

  const unpriced = mrr.unpriced.length
    ? card(
        'Projects on a plan with no price',
        `${note('Counted as nothing, which is why they are listed rather than summed.')}${note(`<span class="mono">${mrr.unpriced.map((u) => esc(`${u.id} (${u.plan})`)).join(', ')}</span>`)}`,
        { cls: 'ma-gap' }
      )
    : '';

  const day = new Date(now).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return shell({
    account,
    title: 'Fleet overview',
    heading: 'The service today',
    active: 'operator',
    lede: `${day} · every project and account on the platform, and what is wrong right now`,
    actions: `<a class="btn btn--primary" href="/operator/new-project">${icon('plus', 14)}New project for an account</a>`,
    sheet,
    counts: { fleet: fleetCount(board) },
    body: `${tiles(list)}
      <div class="ma-cols ma-cols--2-1">
        ${accountLists(lists, tab)}
        ${needs}
      </div>
      ${unpriced}`,
  });
}

/** How many cells need a look — the small count on the Fleet tab. */
export function fleetCount(board) {
  return new Set((board?.board?.problems ?? []).map((p) => p.id).filter((id) => id !== '(fleet)'))
    .size;
}

// ------------------------------------------------------------------- fleet

const KIND_WORD = {
  unhealthy: 'Unhealthy',
  'never-drilled': 'Never drilled',
  'stale-drill': 'Drill is old',
  'no-checkpoint': 'Never replicated',
  'stale-checkpoint': 'Replication is old',
  'version-spread': 'Versions differ',
  'config-drift': 'Config drift',
};

/**
 * Fleet: every serving cell, one row each — health, version, when it last
 * replicated and when a restore was last proven — with what is wrong on top.
 * The overview says how many; this page says which and why. No script: it is
 * the page somebody opens during an outage.
 *
 * @param {object} args.board  assembleBoard() output
 * @param {Array}  args.projects  listProjectsWithOwners() rows, for names and owners
 */
export function operatorFleetPage({
  account,
  board,
  projects = [],
  need = null,
  now = Date.now(),
}) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const filter = need && Object.hasOwn(KIND_WORD, need) ? need : null;
  const problemsOf = new Map();
  for (const p of board.board.problems) {
    const list = problemsOf.get(p.id) ?? [];
    list.push(p);
    problemsOf.set(p.id, list);
  }
  const age = (v, unit) => (v === null || v === undefined ? 'never' : `${v} ${unit} ago`);
  const rows = board.board.rows
    .filter((r) => !filter || (problemsOf.get(r.id) ?? []).some((w) => w.kind === filter))
    .map((r) => {
      const p = byId.get(r.id) ?? {};
      const wrong = problemsOf.get(r.id) ?? [];
      return `<tr>
        <td><a class="ma-who" href="/operator/projects/${esc(r.id)}">${thumb('ma-thumb--row')}<span class="ma-who-t"><strong>${esc(p.name || r.id)}</strong><span class="mono">${esc(r.id)}</span></span></a></td>
        <td class="ma-quiet">${ownerLink(p)}</td>
        <td>${
          r.health === 'healthy'
            ? statusWord('ok', 'Healthy')
            : r.health === 'unknown' || !r.health
              ? statusWord('off', 'No report yet')
              : statusWord(
                  'error',
                  String(r.health).replace(/^./, (c) => c.toUpperCase())
                )
        }</td>
        <td class="mono">${esc(r.version ?? '—')}${r.canary ? ' <small>canary</small>' : ''}</td>
        <td class="ma-quiet">${esc(age(r.checkpointAgeMinutes, 'min'))}</td>
        <td class="ma-quiet">${esc(age(r.drillAgeDays, 'days'))}</td>
        <td>${
          wrong.length
            ? wrong.map((w) => statusWord('warn', KIND_WORD[w.kind] ?? w.kind)).join(' ')
            : statusWord('ok', 'Nothing')
        }</td>
      </tr>`;
    })
    .join('\n');

  const fleetWide = [
    ...board.alarms.alarms.map(
      (a) =>
        `<div class="ma-alarm">${statusWord('error', 'Cost alarm')}<span>${esc(a.kind)} — ${esc(a.detail)}</span><span></span></div>`
    ),
    ...board.board.problems
      .filter((p) => p.id === '(fleet)')
      .map(
        (p) =>
          `<div class="ma-alarm">${statusWord('warn', KIND_WORD[p.kind] ?? p.kind)}<span>${esc(p.detail ?? '')}</span><span></span></div>`
      ),
  ];

  const count = fleetCount(board);
  const day = new Date(now).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return shell({
    account,
    title: 'Fleet',
    active: 'operator-fleet',
    lede: `${day} · ${board.serving} serving ${board.serving === 1 ? 'cell' : 'cells'} · ${
      count ? `${count} ${count === 1 ? 'needs' : 'need'} a look` : 'nothing needs a look'
    }`,
    counts: { fleet: count },
    body: `${
      problemsOf.size
        ? `<nav class="ma-chips" aria-label="Show"><a class="ma-chip" href="/operator/fleet"${filter ? '' : ' aria-current="page"'}>Every cell</a>${Object.keys(
            KIND_WORD
          )
            .map((k) => [
              k,
              [...problemsOf.values()].filter((l) => l.some((w) => w.kind === k)).length,
            ])
            .filter(([, n]) => n)
            .map(
              ([k, n]) =>
                `<a class="ma-chip" href="/operator/fleet?need=${encodeURIComponent(k)}"${filter === k ? ' aria-current="page"' : ''}>${esc(KIND_WORD[k])} <span class="ma-count">${n}</span></a>`
            )
            .join('')}</nav>`
        : ''
    }${
      fleetWide.length
        ? card('The whole fleet', `<div class="ma-feed">${fleetWide.join('\n')}</div>`)
        : ''
    }${
      board.board.rows.length
        ? `<div class="ma-card ma-card--clip"><div class="ma-scroll"><table class="ma-table">
          <thead><tr>
            <th scope="col">Project</th><th scope="col">Owner</th><th scope="col">Health</th><th scope="col">Version</th>
            <th scope="col">Replicated</th><th scope="col">Restore drill</th><th scope="col">Needs a look</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>`
        : `<div class="ma-card">${note('No cell is serving right now.')}</div>`
    }`,
  });
}

/** The four account lists of the overview (canvas 16, cl-operator), with counts. */
const LIST_WORD = {
  newest: 'Newest accounts',
  active: 'Most active',
  trial: 'Trial ends soon',
  promo: 'Promo',
};

/** One account row: who, their plan, their counts, when last here. */
function accountRow(a, { now = Date.now() } = {}) {
  const plan = a.plan ? planWord(a.plan) : '<span class="ma-quiet">No project</span>';
  return `<tr${a.plan?.tone === 'warn' ? ' class="is-hl"' : ''}>
    <td>${who({ name: String(a.name ?? '').trim() || a.email, sub: a.email, seed: a.email, href: `/operator/accounts/${a.id}` })}</td>
    <td>${plan}${a.note ? ` <span class="ma-quiet">· ${esc(a.note)}</span>` : ''}</td>
    <td class="ma-num">${num(a.projects ?? null)}</td>
    <td class="ma-num">${num(a.people ?? null)}</td>
    <td class="ma-quiet">${a.last_seen ? esc(ago(a.last_seen, now)) : 'never'}</td>
    <td><a class="btn btn--ghost btn--sm" href="/operator/accounts/${esc(a.id)}">Open</a></td>
  </tr>`;
}

/**
 * @param {{counts: object, rows: object[]|null, note?: string}|null} lists
 *   `rows: null` means the list could not be read (Most active without
 *   analytics) — said in words, never drawn as an empty table.
 */
function accountLists(lists, tab) {
  if (!lists) return '<div></div>';
  const active = Object.hasOwn(LIST_WORD, tab) ? tab : 'newest';
  const tabsHtml = Object.keys(LIST_WORD)
    .map((key) => {
      const n = lists.counts?.[key];
      return `<a class="ma-tab" href="/operator${key === 'newest' ? '' : `?tab=${key}`}"${key === active ? ' aria-current="page"' : ''}>${esc(LIST_WORD[key])}${n === null || n === undefined ? '' : ` <span class="ma-count${key === 'trial' && n > 0 ? ' ma-count--hot' : ''}">${n}</span>`}</a>`;
    })
    .join('');
  const rows = (lists.rows ?? []).map((a) => accountRow(a)).join('\n');
  return `<div class="ma-card ma-card--clip">
    <nav class="ma-tabs" aria-label="Lists of accounts">${tabsHtml}<span class="ma-tabs-sp"></span>
      <form class="ma-filter" role="search" method="get" action="/operator/accounts">${icon('search', 13)}<input type="search" name="q" maxlength="120" placeholder="Email, project or id" aria-label="Email, project name or id"></form>
    </nav>
    ${
      lists.rows === null
        ? note(esc(lists.note ?? 'This list could not be read.'))
        : rows
          ? `<div class="ma-scroll"><table class="ma-table"><thead><tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col" class="ma-num">Projects</th><th scope="col" class="ma-num">People</th><th scope="col">Last here</th><th scope="col"><span class="ma-sr">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
          : note('Nobody on this list.')
    }
  </div>`;
}

/** "28 Oct" — a day as a person reads it (UTC). */
function shortDay(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '—';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "12 min ago", "Yesterday", "3 Nov" — how long since, the way a person says it. */
function ago(ms, now = Date.now()) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return 'never';
  const d = now - t;
  if (d < 5 * 60_000) return 'Now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  if (d < 2 * 86_400_000) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
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
      return `<tr${p.state === 'purged' ? ' class="is-dim"' : ''}>
        <td><a class="ma-who" href="/operator/projects/${esc(p.id)}">${thumb('ma-thumb--row')}<span class="ma-who-t"><strong>${esc(p.name || p.id)}</strong><span class="mono">${esc(p.id)}</span></span></a></td>
        <td>${esc(p.state)}</td>
        <td>${planCell(p)}</td>
        <td class="ma-quiet">${ownerLink(p)}</td>
        <td class="mono">${esc(p.version ?? '—')}</td>
        <td class="ma-quiet"><time>${when(p.last_checkpoint)}</time></td>
        <td>${p.cell_running ? statusWord('ok', 'up') : statusWord('off', 'asleep')}</td>
        ${
          withStats
            ? `<td class="ma-num">${num(s?.canvases ?? null)}</td>
               <td class="ma-num">${num(s?.artboards ?? null)}</td>
               <td class="ma-num">${bytes(s?.assetsBytes ?? null)}</td>`
            : ''
        }
        ${
          withRender
            ? `<td class="ma-num">${num(r?.builds ?? null)}</td>
               <td class="ma-num">${cachePct(r)}</td>
               <td class="ma-num">${ms(r?.durationMsP95)}</td>
               <td class="ma-num">${num(ceilingHits(r))}</td>`
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
      ? `<div class="ma-card ma-card--clip"><div class="ma-scroll"><table class="ma-table">
          <thead><tr>
            <th scope="col">Project</th><th scope="col">State</th><th scope="col">Plan</th><th scope="col">Owner</th><th scope="col">Version</th>
            <th scope="col">Last checkpoint</th><th scope="col">Cell</th>
            ${withStats ? '<th scope="col" class="ma-num">Canvases</th><th scope="col" class="ma-num">Artboards</th><th scope="col" class="ma-num">Assets</th>' : ''}
            ${withRender ? '<th scope="col" class="ma-num">Builds</th><th scope="col" class="ma-num">Cache hit</th><th scope="col" class="ma-num">Build p95</th><th scope="col" class="ma-num">Ceiling hits</th>' : ''}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div></div>`
      : `<div class="ma-card">${note('No projects yet.')}</div>`,
  });
}

/** A project's plan as support reads it (plan-copy.mjs `operatorPlan`). */
function planCell(project, { now = Date.now() } = {}) {
  return planWord(operatorPlan(project, { now }));
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
        <td>${who({ name: String(a.name ?? '').trim() || a.email, sub: a.id, seed: a.email, href: `/operator/accounts/${a.id}` })}</td>
        <td>${esc(a.email)}</td>
        <td class="ma-num">${num(a.projects ?? null)}</td>
        <td>${a.stripe_customer_id ? 'yes' : 'no'}</td>
        <td class="ma-quiet"><time>${when(a.created_at)}</time></td>
        <td><a class="btn btn--ghost btn--sm" href="/operator/accounts/${esc(a.id)}">Open</a></td>
      </tr>`
    )
    .join('\n');

  return shell({
    account,
    title: 'All accounts',
    active: 'operator-accounts',
    lede: 'Every account on the platform. Opening this list is recorded.',
    actions: `<a class="btn btn--primary" href="/operator/new-project">${icon('plus', 14)}New project for an account</a>`,
    body: `<div class="ma-card ma-card--clip">
      <nav class="ma-tabs" aria-label="Accounts">
        <a class="ma-tab" href="/operator/accounts"${q ? '' : ' aria-current="page"'}>All accounts</a>
        ${q ? `<span class="ma-tab" aria-current="page">Matching “${esc(q)}” <span class="ma-count">${accounts.length}</span></span>` : ''}
        <span class="ma-tabs-sp"></span>
        <form class="ma-filter" role="search" method="get" action="/operator/accounts">${icon('search', 13)}<input type="search" name="q" value="${esc(q)}" maxlength="120"
               placeholder="Email, project name or id" aria-label="Email, project name or id"></form>
      </nav>
      ${
        accounts.length
          ? `<div class="ma-scroll"><table class="ma-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Email</th><th scope="col" class="ma-num">Projects</th><th scope="col">Stripe</th><th scope="col">Created</th><th scope="col"><span class="ma-sr">Action</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
          : note(q ? `No account matches “${esc(q)}”.` : 'No accounts yet.')
      }</div>`,
  });
}

/**
 * The operator's search (the nav's field): accounts by e-mail, name or id, and
 * projects by name or id with their owner — one page, two groups, each row
 * opening the operator page for it.
 */
export function operatorSearchPage({ account, q = '', accounts = [], projects = [] }) {
  const needle = String(q).trim().toLowerCase();
  const mark = (t) => {
    const text = String(t ?? '');
    const i = needle ? text.toLowerCase().indexOf(needle) : -1;
    return i < 0
      ? esc(text)
      : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + needle.length))}</mark>${esc(text.slice(i + needle.length))}`;
  };
  const group = (title, rows) =>
    rows.length
      ? `<section class="ma-card ma-card--clip"><h2 class="ma-card-h">${esc(title)} <small>${rows.length}</small></h2>${rows.join('')}</section>`
      : '';
  const body = !needle
    ? `<div class="ma-card">${note('Type an e-mail, a name, a project or an id.')}</div>`
    : accounts.length + projects.length === 0
      ? `<div class="ma-card ma-empty"><p><strong>Nothing matches “${esc(q)}”.</strong></p></div>`
      : `<div class="ma-results">${group(
          'Accounts',
          accounts.map(
            (a) =>
              `<a class="ma-hit" href="/operator/accounts/${esc(a.id)}">${avatar(String(a.name ?? '').trim() || a.email, { seed: a.email })}<span class="ma-who-t"><strong>${mark(String(a.name ?? '').trim() || a.email)}</strong><span>${mark(a.email)} · ${num(a.projects ?? 0)} ${Number(a.projects) === 1 ? 'project' : 'projects'}</span></span><span class="ma-hit-k">Open</span></a>`
          )
        )}${group(
          'Projects',
          projects.map(
            (p) =>
              `<a class="ma-hit" href="/operator/projects/${esc(p.id)}">${thumb('ma-thumb--row')}<span class="ma-who-t"><strong>${mark(p.name || p.id)}</strong><span>${mark(p.id)} · ${esc(p.owner_email ?? '')}</span></span><span class="ma-hit-k">${esc(STATE_COPY[p.state]?.label ?? String(p.state ?? ''))}</span></a>`
          )
        )}</div>`;
  return shell({
    account,
    title: needle ? `Results for “${q}”` : 'Search',
    active: 'operator-search',
    q,
    body,
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

/** The reason field every operator form carries. */
function reasonField(id, { label = 'Why', placeholder = '' } = {}) {
  return `<span class="field"><label for="${esc(id)}-reason">${esc(label)}</label>
      <textarea id="${esc(id)}-reason" name="reason" required maxlength="500"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}></textarea>
      <span class="field-hint">${esc(REASON_HINT)}</span></span>`;
}

/**
 * An inline action: a <details> holding one form, for the actions that are
 * rare enough to sit in a list (pause, move, delete…). The big three — free
 * time, Promo, a new project — are sheets over the page (see `freeTimeSheet`).
 */
function sheet({
  title,
  action,
  csrf,
  fields = '',
  submit,
  hidden = {},
  note: hint = null,
  id,
  danger = false,
}) {
  const extra = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<details class="sheet">
    <summary>${esc(title)}</summary>
    <form method="post" action="${esc(action)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">${extra}
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      ${fields}
      ${reasonField(id)}
      <div class="ma-sheet-a"><span class="ma-quiet">Logged as yours</span><span class="ma-sp"></span><button type="submit" class="btn btn--sm${danger ? ' k-btn-danger' : ' btn--primary'}">${esc(submit)}</button></div>
    </form>
  </details>`;
}

const dateInput = (name, label, id, value = '') =>
  `<span class="field"><label for="${esc(id)}">${esc(label)}</label><input type="date" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"></span>`;

/** A segmented control of radios: `options` is [[value, word]]. */
function segmented(name, label, options, current) {
  return `<span class="field"><span class="field-label" id="seg-${esc(name)}">${esc(label)}</span>
    <span class="seg ma-seg" role="radiogroup" aria-labelledby="seg-${esc(name)}">${options
      .map(
        ([value, word]) =>
          `<label class="ma-seg-b"><input type="radio" name="${esc(name)}" value="${esc(value)}"${String(value) === String(current) ? ' checked' : ''}>${esc(word)}</label>`
      )
      .join('')}</span></span>`;
}

/** A pick list of radios: `options` is [[value, title, sub]]. */
function pickList(name, label, options, current) {
  return `<span class="field"><span class="field-label" id="pick-${esc(name)}">${esc(label)}</span>
    <span class="ma-pick" role="radiogroup" aria-labelledby="pick-${esc(name)}">${options
      .map(
        ([value, title, sub]) =>
          `<label class="ma-pick-o"><input type="radio" name="${esc(name)}" value="${esc(value)}"${value === current ? ' checked' : ''}><span><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</span></label>`
      )
      .join('')}</span></span>`;
}

/** How long: 14 days · 30 days · 3 months · until a date. */
function freeTimeFields(id) {
  const words = { 14: '14 days', 30: '30 days', 90: '3 months' };
  return `${segmented(
    'days',
    'How long',
    [...FREE_TIME_DAYS.map((d) => [d, words[d] ?? `${d} days`]), ['until', 'Until…']],
    30
  )}
    ${dateInput('until', 'Until (only with “Until…”)', `${id}-until`)}`;
}

const PROMO_SUB = {
  project: 'Like the Project plan',
  dedicated: 'Like the Dedicated plan',
  unlimited: 'No storage limit at all',
};

function promoFields(id, { current = 'dedicated' } = {}) {
  return `${pickList(
    'tier',
    'Storage',
    PROMO_TIERS.map((t) => [t.id, promoTierLabel(t.id), PROMO_SUB[t.id] ?? '']),
    current
  )}
    ${dateInput('ends', 'Ends (empty = never)', `${id}-ends`)}
    <span class="field-hint">With a date, the owner hears 30 days before, and nothing is paused until the date.</span>`;
}

/**
 * The right-hand sheet for one operator action (canvas 16: Give free time,
 * Mark as Promo, New project for an account). No script on these pages, so a
 * sheet is its own address — `?sheet=…` on the page it sits over — and Cancel
 * is a link back to that page.
 *
 * @returns {{title: string, sub: string|null, back: string, body: string}}
 */
function actionSheet({
  title,
  sub = null,
  back,
  action,
  csrf,
  hidden = {},
  fields,
  submit,
  id,
  promise = null,
  reasonFirst = false,
}) {
  const extra = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  const reason = reasonField(id, { label: reasonFirst ? 'Why' : 'Why · needed' });
  return {
    title,
    sub,
    back,
    body: `<form method="post" action="${esc(action)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">${extra}
      ${reasonFirst ? reason : fields}
      ${reasonFirst ? fields : reason}
      ${promise ? `<div class="ma-promise">${icon('check', 14)}<span>${esc(promise)}</span></div>` : ''}
      ${sheetActions({ back, submit, note: 'Logged as yours' })}
    </form>`,
  };
}

/** Give free time — to one project, or (no `project`) to every project of an account. */
export function freeTimeSheet({ project = null, target = null, csrf, rid, back, backKey = null }) {
  const paused = project ? operatorPlan(project).state === 'paused' : false;
  const ends = project?.trial_ends_at ? shortDay(project.trial_ends_at) : null;
  return actionSheet({
    title: project
      ? `${paused ? 'Wake' : 'Give'} ${project.name || project.id}${paused ? ' with' : ''} free time`
      : 'Give every project of this account free time',
    sub: project
      ? paused
        ? 'Counted from today. The project is editable again as soon as its workspace restarts.'
        : `${ends ? `Free until ${ends} now. ` : ''}Free time is added on top, with no card.`
      : 'Added to every project that has no paid plan and is not Promo; also wakes the ones paused because their trial ended. A paid project is left alone, and the log says so.',
    back,
    action: project
      ? `/operator/projects/${project.id}/free-time`
      : `/operator/accounts/${target.id}/free-time`,
    csrf,
    hidden: { rid, ...(backKey ? { back: backKey } : {}) },
    fields: freeTimeFields(project ? `free-${project.id}` : 'free-all'),
    submit: 'Give free time',
    id: project ? `free-${project.id}` : 'free-all',
    promise: `${target?.email ?? project?.owner_email ?? 'The owner'} gets one email saying until when it is free.`,
  });
}

/** Mark as Promo, or change it. */
function promoSheet({ project, csrf, back }) {
  const on = project.promo_since != null;
  return actionSheet({
    title: on
      ? `Change Promo on ${project.name || project.id}`
      : `Mark ${project.name || project.id} as Promo`,
    sub: 'It stays free, never becomes a trial and is never paused while Promo runs.',
    back,
    action: `/operator/projects/${project.id}/promo`,
    csrf,
    fields: promoFields('promo', { current: project.promo_tier ?? 'dedicated' }),
    submit: on ? 'Save Promo' : 'Mark as Promo',
    id: 'promo',
    reasonFirst: true,
  });
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
  sheet = null,
  sheetProject = null,
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
    target.email,
    `${target.google_sub || target.password_hash ? 'signed up' : 'made'} ${shortDay(target.created_at)} ${method}`,
    `last here ${target.last_seen ? ago(target.last_seen, now).toLowerCase() : 'never'}`,
    macs === 0 ? 'no Mac signed in' : `${macs} ${macs === 1 ? 'Mac' : 'Macs'}`,
  ].join(' · ');
  const first = (String(target.name ?? '').trim() || target.email).split(/[\s@]/)[0];
  const base = `/operator/accounts/${target.id}`;

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
  const list = [
    tile('Projects', 'folder', live.length, { sub: breakdown || 'none' }),
    tile('People', 'people', people, {
      sub: `across its projects, the owner counted in each · ${waiting} invited, not opened`,
    }),
    stat({
      label: 'Pays (believed)',
      glyph: 'export',
      value: money(believedMonthlyMinor, currency),
      unit: believedMonthlyMinor ? 'a month' : null,
      foot: '<span>from plan × state · Stripe is the authority</span>',
    }),
    // Only when a cell reported: a storage figure summed from nothing would be
    // a zero that means "unknown".
    ...(withStorage.length
      ? (() => {
          const [amount, unit] = bytes(
            withStorage.reduce((n, p) => n + p.stats.assetsBytes, 0)
          ).split(' ');
          return [
            tile('Storage', 'server', amount, {
              unit,
              sub: `${withStorage.length} of ${live.length} projects reported`,
            }),
          ];
        })()
      : []),
  ];

  const rows = projects
    .map((p) => {
      const plan = operatorPlan(p, { now });
      // Only where a trial clock exists: a row with no plan never expires, and
      // free time would put an end date on it (operator-actions.mjs `decideFreeTime`).
      const canFree = plan.state === 'trial' || plan.state === 'paused';
      const week = changesView([p], { now })?.week ?? null;
      const sub = [
        ...(p.stats?.canvases != null ? [`${num(p.stats.canvases)} canvases`] : []),
        week !== null ? `${week} changes this week` : 'changes not reported',
      ].join(' · ');
      const menu = `<details class="menu"><summary aria-label="More for ${esc(p.name || p.id)}">${icon('more', 14)}</summary><div class="menu-list">
          <a href="/operator/projects/${esc(p.id)}/people">People in this project</a>
          <a href="/operator/projects/${esc(p.id)}">Mark as Promo, pause, move, delete…</a>
          <a href="${esc(base)}/view/projects/${esc(p.id)}/people">See it as ${esc(first)} does</a>
        </div></details>`;
      return `<tr class="${plan.tone === 'warn' ? 'is-hl' : plan.tone === 'off' || p.state === 'purged' ? 'is-dim' : ''}">
        <td><a class="ma-who" href="/operator/projects/${esc(p.id)}">${thumb('ma-thumb--row')}<span class="ma-who-t"><strong>${esc(p.name || p.id)}</strong><span>${esc(sub)}</span></span></a></td>
        <td>${planWord(plan)}</td>
        <td class="ma-num">${num(p.people ?? null)}</td>
        <td class="ma-num">${bytes(p.stats?.assetsBytes ?? null)}</td>
        <td class="ma-quiet"><time>${p.last_checkpoint ? esc(ago(p.last_checkpoint, now)) : '—'}</time></td>
        <td><span class="ma-row-a">${
          canFree
            ? `<a class="btn btn--sm" href="${esc(base)}?sheet=free&amp;project=${encodeURIComponent(p.id)}">${plan.state === 'paused' ? 'Wake with free time' : 'Give free time'}</a>`
            : `<a class="btn btn--ghost btn--sm" href="/operator/projects/${esc(p.id)}">Open</a>`
        }${menu}</span></td>
      </tr>`;
    })
    .join('\n');

  const GLYPH = (action) =>
    /free|trial|promo/.test(action)
      ? 'clock'
      : /invite|people|role|member/.test(action)
        ? 'people'
        : /sign|session/.test(action)
          ? 'lock'
          : /project|create|move/.test(action)
            ? 'folder'
            : 'pulse';
  const feed = foldActivity(entries)
    .map((e) =>
      logLine({
        glyph: GLYPH(String(e.action)),
        body: `<strong>${esc(
          String(e.actor)
            .replace(/^operator:/, '')
            .replace(/^customer:/, '')
        )}</strong> <span>${esc(actionWord(e.action))}${e.project_id ? ` · ${esc(e.project_id)}` : ''}</span>${timesMark(e)}${e.reason ? `<br><span class="op-ev-r">${esc(e.reason)}</span>` : ''}`,
        when: ago(e.at, now),
      })
    )
    .join('\n');

  let sheetHtml = null;
  if (sheet === 'free') {
    const one = sheetProject ? live.find((p) => p.id === sheetProject) : null;
    const plan = one ? operatorPlan(one, { now }) : null;
    if (!sheetProject || (one && (plan.state === 'trial' || plan.state === 'paused'))) {
      sheetHtml = freeTimeSheet({
        project: one ?? null,
        target,
        csrf,
        rid: newRid(),
        back: base,
        backKey: one ? 'account' : null,
      });
    }
  } else if (sheet === 'sign-out') {
    sheetHtml = actionSheet({
      title: `Sign ${first} out everywhere`,
      sub: 'Ends every browser sign-in and every Mac of this account. Nothing else changes: the person signs in again and carries on.',
      back: base,
      action: `${base}/sign-out`,
      csrf,
      fields: '',
      submit: 'Sign out everywhere',
      id: 'sign-out',
    });
  }

  return shell({
    account,
    title: target.name || target.email,
    active: 'operator-accounts',
    lede: header,
    actions: `<a class="btn" href="${esc(base)}?sheet=sign-out">Sign out everywhere</a>
      <a class="btn" href="/operator/new-project?owner=${encodeURIComponent(target.email)}">${icon('plus', 14)}New project for ${esc(first)}</a>
      ${live.length ? `<a class="btn btn--primary" href="${esc(base)}?sheet=free">${icon('clock', 14)}Give free time</a>` : ''}`,
    sheet: sheetHtml,
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      ${tiles(list)}
      <div class="ma-cols ma-cols--2-1">
        ${card(
          'Projects',
          projects.length
            ? `<div class="ma-scroll"><table class="ma-table"><thead><tr><th scope="col">Project</th><th scope="col">Plan</th><th scope="col" class="ma-num">People</th><th scope="col" class="ma-num">Storage</th><th scope="col">Last change</th><th scope="col"><span class="ma-sr">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>
               <div class="ma-menu-key"><span>In each row’s menu:</span><span class="chip">People in this project</span><span class="chip">Mark as Promo</span><span class="chip">Pause</span><span class="chip">Move to another owner</span><span class="chip">See it as ${esc(first)} does</span><span class="chip">Delete</span></div>`
            : note('This account owns no project.'),
          { aside: `<small>${projects.length}</small>` }
        )}
        ${card(
          'Log',
          entries.length ? `<div class="ma-feed">${feed}</div>` : note('Nothing recorded.'),
          { aside: `<a class="ma-link" href="${esc(base)}/view">See it as ${esc(first)} does</a>` }
        )}
      </div>
      <p class="ma-foot" style="margin-top:var(--space-4)">The designs themselves are in each project’s workspace and are not reachable from here. Last change is the last checkpoint the platform recorded.</p>`,
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
      const who = personCell(p);
      if (p.role === 'owner')
        return `<tr><td>${who}</td><td><span class="ma-mrole ma-mrole--own">Owner</span></td><td></td></tr>`;
      return `<tr><td>${who}</td><td><span class="ma-mrole">${esc(word(p.role))}</span></td><td class="op-acts-cell"><div class="op-acts op-acts--row">
        ${act(
          'Change role',
          { do: 'role', account: p.account_id },
          {
            id: `role-${p.account_id}`,
            fields: `<span class="field"><label for="role-${esc(p.account_id)}-r">What they can do</label><select id="role-${esc(p.account_id)}-r" name="role">${roleOptions(p.role)}</select></span>`,
            submit: 'Save',
          }
        )}
        ${act('Remove', { do: 'remove', account: p.account_id }, { id: `rm-${p.account_id}`, submit: 'Remove from this project' })}
      </div></td></tr>`;
    })
    .join('\n');
  const grantRows = grants
    .map(
      (g) =>
        `<tr><td>${personCell(g)}</td><td><span class="ma-mrole">${esc(word(g.role))}</span> <span class="ma-quiet">on one canvas only</span></td><td></td></tr>`
    )
    .join('\n');
  const inviteRows = invites
    .map(
      (
        i
      ) => `<tr><td>${personCell({ email: i.email })}</td><td><span class="ma-mrole">${esc(word(i.role))}</span> <span class="ma-quiet">not joined yet · until ${when(i.expires_at)}</span></td><td class="op-acts-cell"><div class="op-acts op-acts--row">
        ${act('Send again', { do: 'invite-resend', invite: i.id }, { id: `rs-${i.id}`, submit: 'Send again' })}
        ${act('Cancel invite', { do: 'invite-cancel', invite: i.id }, { id: `cx-${i.id}`, submit: 'Cancel invite' })}
      </div></td></tr>`
    )
    .join('\n');
  const requestRows = requests
    .map(
      (
        r
      ) => `<tr><td>${personCell(r)}</td><td class="ma-quiet">asked ${when(r.created_at)}</td><td class="op-acts-cell"><div class="op-acts op-acts--row">
        ${act('Allow editing', { do: 'request-allow', request: r.id }, { id: `ok-${r.id}`, submit: 'Allow editing' })}
        ${act('Not now', { do: 'request-decline', request: r.id }, { id: `no-${r.id}`, submit: 'Not now' })}
      </div></td></tr>`
    )
    .join('\n');

  return shell({
    account,
    title: `People in ${project.name || project.id}`,
    active: 'operator-projects',
    lede: 'Who is on this project and what each can do. Every change here is recorded as Maude support’s, with your reason, on the project’s own Activity page.',
    actions: `<a class="btn" href="/operator/projects/${esc(project.id)}">Back to the project</a>`,
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <div class="ma-cols ma-cols--2-1"><div class="ma-stack">
      ${card('People', `<div class="ma-scroll"><table class="ma-table"><thead><tr><th scope="col">Person</th><th scope="col">What they can do</th><th scope="col"><span class="ma-sr">Action</span></th></tr></thead><tbody>${personRows}${grantRows}</tbody></table></div>`)}
      ${requests.length ? card('Asks to edit', `<table class="ma-table"><tbody>${requestRows}</tbody></table>`) : ''}
      ${invites.length ? card('Invited', `<table class="ma-table"><tbody>${inviteRows}</tbody></table>`) : ''}
      </div>
      <div class="ma-card ma-card--clip"><h2 class="ma-card-h">Invite someone</h2><div class="op-acts">
        ${act(
          'Invite by e-mail',
          { do: 'invite' },
          {
            id: 'invite',
            fields: `<span class="field"><label for="invite-email">Their email</label><input type="email" id="invite-email" name="email" required maxlength="254"></span>
            <span class="field"><label for="invite-role">What they can do</label><select id="invite-role" name="role">${roleOptions('member')}</select></span>
            ${canView ? '' : '<p class="hint">Can view is not available for this project yet.</p>'}`,
            submit: 'Send invitation',
          }
        )}
      </div></div></div>`,
  });
}

/** A person in an operator table: their face, their name, their address. */
function personCell(p) {
  const name = String(p.name ?? '').trim();
  return who({ name: name || p.email, sub: name ? p.email : null, seed: p.email });
}

const PEOPLE_ROLE_WORD = {
  owner: 'Owner',
  member: 'Can edit',
  viewer: 'Can comment',
  observer: 'Can view',
};

// --------------------------------------------------------- new project sheet

/**
 * New project for an account, no checkout (canvas 16, cl-operator) — the sheet.
 * `values` refills it after a refusal; every value is escaped.
 */
export function newProjectSheet({ csrf, values = {}, error = null, back = '/operator' }) {
  const v = (k) => esc(values[k] ?? '');
  const plan = values.plan === 'trial' ? 'trial' : 'promo';
  return {
    title: 'New project for an account',
    sub: 'For a customer, a friend or a demo — no checkout.',
    back,
    body: `<form method="post" action="/operator/new-project">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        ${error ? `<p class="err">${esc(error)}</p>` : ''}
        <span class="field"><label for="owner">Owner’s email</label>
          <input type="email" id="owner" name="owner" value="${v('owner')}" required maxlength="254" autofocus>
          <span class="field-hint">No account yet — one is made with no password, and its owner gets one invite email.</span></span>
        <span class="field"><label for="name">Project name</label>
          <input type="text" id="name" name="name" value="${v('name')}" required maxlength="120"></span>
        ${pickList(
          'plan',
          'Plan',
          [
            ['promo', 'Promo', 'Never a trial, never paused · you pick the storage'],
            ['trial', 'Trial', 'Then the owner picks a plan'],
          ],
          plan
        )}
        ${segmented(
          'tier',
          'Promo storage',
          PROMO_TIERS.map((t) => [t.id, promoTierLabel(t.id)]),
          values.tier ?? 'dedicated'
        )}
        ${dateInput('ends', 'Promo ends (empty = never)', 'ends', values.ends ?? '')}
        <span class="field"><label for="invites">Also invite, as Can edit</label>
          <input type="text" id="invites" name="invites" value="${v('invites')}" placeholder="Emails, separated by commas"></span>
        <span class="field"><label for="reason">Why</label>
          <textarea id="reason" name="reason" required maxlength="500">${v('reason')}</textarea>
          <span class="field-hint">${esc(REASON_HINT)}</span></span>
        ${sheetActions({ back, submit: 'Make project', note: 'Logged as yours in the audit' })}
      </form>`,
  };
}

/**
 * The sheet on its own address. The route renders it over the overview; this
 * form (after a refusal, or with nothing behind it) sits over a bare page.
 */
export function operatorNewProjectPage({ account, csrf, values = {}, error = null }) {
  return shell({
    account,
    title: 'New project for an account',
    heading: 'The service today',
    active: 'operator',
    lede: 'If the address has no account, one is made with no password, and its owner gets one e-mail.',
    sheet: newProjectSheet({ csrf, values, error }),
    body: '',
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
  sheet: sheetKey = null,
  newRid = () => crypto.randomUUID(),
}) {
  const plan = operatorPlan(project, { now });
  const base = `/operator/projects/${project.id}`;
  const facts = [
    ['id', `<span class="mono">${esc(project.id)}</span>`],
    ['name', esc(project.name ?? '')],
    ['owner', ownerLink(project)],
    ['plan state', planWord(plan)],
    [
      'state',
      `${esc(project.state)} <span class="ma-quiet">since ${when(project.state_since)}</span>`,
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
        ` <span class="ma-quiet">(window from ${when(render.windowStartedAt ?? null)})</span>`,
    ]);
  }

  const jobFeed = jobs
    .map((j) =>
      logLine({
        glyph: /export/.test(j.reason)
          ? 'export'
          : /backup|checkpoint/.test(j.reason)
            ? 'server'
            : 'sync',
        body: `<span class="mono">${esc(j.reason)}</span> · ${esc(j.outcome ?? 'pending')}${j.detail ? `<br><span class="op-ev-r">${esc(String(j.detail).slice(0, 160))}</span>` : ''}`,
        when: ago(j.created_at, now),
      })
    )
    .join('\n');

  // The log renders the REASON of every entry, which the customer-facing page
  // did not until this phase — and an em-dash where there is none.
  const logFeed = foldActivity(entries)
    .map((e) =>
      logLine({
        glyph: /free|promo|trial/.test(String(e.action))
          ? 'clock'
          : /people|invite|access/.test(String(e.action))
            ? 'people'
            : 'pulse',
        body: `<strong>${esc(
          String(e.actor)
            .replace(/^operator:/, '')
            .replace(/^customer:/, '')
        )}</strong> <span>${esc(actionWord(e.action))}${esc(routineCount(e))}</span>${timesMark(e)}${e.reason ? `<br><span class="op-ev-r">Reason: ${esc(e.reason)}</span>` : ''}`,
        when: ago(e.at, now),
      })
    )
    .join('\n');

  const canFree = plan.state === 'trial' || plan.state === 'paused';
  const canPromo = !(plan.state === 'paid' || plan.state === 'lapsed' || plan.state === 'gone');
  let sheetHtml = null;
  if (sheetKey === 'free' && canFree) {
    sheetHtml = freeTimeSheet({ project, csrf, rid: newRid(), back: base });
  } else if (sheetKey === 'promo' && canPromo) {
    sheetHtml = promoSheet({ project, csrf, back: base });
  }

  const owner = project.owner_email ? `Owner ${project.owner_email}` : null;
  const sub = [
    owner,
    ...(stats ? [`${num(stats.canvases)} canvases`] : []),
    `cell ${project.cell_running ? 'up' : 'asleep'}`,
    `version ${project.version ?? '—'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const actions = [
    `<a class="btn" href="#reconcile">Reconcile</a>`,
    `<a class="btn" href="/operator/projects/${esc(project.id)}/people">${icon('people', 14)}People in this project</a>`,
    ...(canFree
      ? [
          `<a class="btn${canPromo ? '' : ' btn--primary'}" href="${esc(base)}?sheet=free">${icon('clock', 14)}${plan.state === 'paused' ? 'Wake with free time' : 'Give free time'}</a>`,
        ]
      : []),
    ...(canPromo
      ? [
          `<a class="btn btn--primary" href="${esc(base)}?sheet=promo">${project.promo_since != null ? 'Change Promo' : 'Mark as Promo'}</a>`,
        ]
      : []),
  ].join('');

  return shell({
    account,
    title: project.name || project.id,
    active: 'operator-projects',
    lede: sub,
    actions,
    sheet: sheetHtml,
    body: `
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <div class="ma-cols ma-cols--2-1">
        <div class="ma-stack">
          ${card(
            'Plan',
            `<dl class="op-kv">
              <dt>Plan</dt><dd>${esc(plan.line)}</dd>
              <dt>Subscription</dt><dd>${project.subscription_id ? `<a class="mono" href="https://dashboard.stripe.com/subscriptions/${esc(project.subscription_id)}">${esc(project.subscription_id)}</a>` : 'none'}</dd>
              <dt>Made</dt><dd>${shortDay(project.created_at)}</dd>
              ${stats ? `<dt>Storage</dt><dd>${bytes(stats.assetsBytes)} used</dd>` : ''}
            </dl>`,
            { aside: planWord(plan) }
          )}
          ${card('Log', entries.length ? `<div class="ma-feed">${logFeed}</div>` : note('Nothing recorded.'))}
          ${card(
            'Everything the control plane knows',
            `<dl class="op-kv">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
             ${note('What it holds, what it earns and what state it is in — the designs themselves are in the cell and are not reachable from here.')}`
          )}
        </div>
        <div class="ma-stack">
          ${card('Recent jobs', jobs.length ? `<div class="ma-feed">${jobFeed}</div>` : note('No jobs recorded.'))}
          <div class="ma-card ma-card--clip">
            <h2 class="ma-card-h">More actions</h2>
            ${note('None of these touches a subscription at Stripe. A project with a paid plan is refused by the ones that would disagree with it, and the refusal is logged.')}
            <div class="op-acts">
            ${
              project.account_id
                ? `<a class="ma-need" href="/operator/accounts/${esc(project.account_id)}/view/projects/${esc(project.id)}/people"><span class="ma-need-t"><strong>See it as the owner does</strong><span>Read only, and recorded</span></span>${icon('chevron-r', 14)}</a>`
                : ''
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
                      '<span class="field"><label for="move-to">New owner’s email</label><input type="email" id="move-to" name="to" required maxlength="254"></span>',
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
                : project.state === 'purged' ||
                    project.state === 'exported' ||
                    project.subscription_id
                  ? ''
                  : sheet({
                      title: 'Delete…',
                      action: `${base}/delete`,
                      csrf,
                      id: 'delete',
                      danger: true,
                      note: 'Never at once. The project is paused, a complete copy is prepared and mailed to its owner, they are warned two days before, and it is deleted after 30 days. Until then this can be undone here.',
                      fields: `<span class="field"><label for="delete-confirm">Type the project’s name or id to confirm</label><input type="text" id="delete-confirm" name="confirm" required autocomplete="off"></span>`,
                      submit: 'Schedule the deletion',
                    })
            }
            </div>
          </div>
          <div class="ma-card" id="reconcile">
            <h2 class="ma-card-h">Ask the reconciler to run</h2>
            <div class="op-nudge">
              <p class="hint">It enqueues a job; the reconciler re-derives everything from Stripe and the cell,
                exactly as the hourly sweep does. Comping and refunding stay in Stripe — the sweep picks those up on its own.</p>
              <form method="post" action="/operator/projects/${esc(project.id)}/reconcile">
                <input type="hidden" name="csrf" value="${esc(csrf)}">
                <label for="reason">Why, in your own words. Recorded permanently, and the customer can read it.</label>
                <textarea id="reason" name="reason" required maxlength="500"
                  placeholder="e.g. customer reported the project stuck in setup"></textarea>
                <button type="submit" class="btn btn--sm">Enqueue a reconcile</button>
              </form>
            </div>
          </div>
        </div>
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
      body: card(
        'Analytics is not connected',
        `${note('Events are being written — the binding is part of the Worker. Reading them back needs a separate token with <span class="mono">Account Analytics Read</span> and nothing else:')}
        ${note('<span class="mono">wrangler secret put CF_ANALYTICS_TOKEN</span>')}`
      ),
    });
  }

  const approx = (n) => (n === null || n === undefined ? '—' : `${sampled ? '~' : ''}${n}`);

  const byName = (metrics.byName ?? [])
    .map(
      (r) =>
        `<tr><td class="mono">${esc(r.name)}</td><td class="ma-num">${approx(r.count)}</td></tr>`
    )
    .join('\n');

  return shell({
    account,
    title: 'Usage',
    active: 'operator-events',
    lede: sampled
      ? 'Analytics Engine sampled this window, so the counts are approximations — shown with a leading ~.'
      : 'Server-side product analytics. Account ids and action names only: no email, no content, no third party.',
    body: `${tiles([
      tile('Active today', 'pulse', approx(metrics.dau), { sub: 'distinct accounts, last 24 h' }),
      tile('Active this week', 'people', approx(metrics.wau), {
        sub: 'distinct accounts, last 7 d',
      }),
      tile('Active this month', 'people', approx(metrics.mau), {
        sub: 'distinct accounts, last 30 d',
      }),
      tile('Signups', 'plus', approx(metrics.signups), { sub: 'last 30 d' }),
      tile('Checkouts completed', 'check', approx(metrics.checkouts), { sub: 'last 30 d' }),
    ])}
      ${card(
        'Events, last 7 days',
        byName
          ? `<table class="ma-table"><thead><tr><th scope="col">Event</th><th scope="col" class="ma-num">Count</th></tr></thead><tbody>${byName}</tbody></table>`
          : note('No events in the window.')
      )}`,
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
