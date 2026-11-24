// The operator surface, the pure half — Cloud Phase 26 Stage 1.
//
// There has never been a cross-tenant view. The fleet was run from
// `wrangler d1 execute` and the Stripe dashboard, which works exactly until
// the moment you need to answer "is anything wrong" without already knowing
// what to look for.
//
// Almost none of the thinking here is new: `fleet.mjs` has had `fleetBoard()`
// and `costAlarms()` since Phase 9, fully tested and with ZERO callers. This
// module is mostly the translation layer between D1 rows and the shapes those
// two already speak, plus the two numbers that were only ever in somebody
// else's UI.
//
// Pure, like fleet.mjs and pricing-core.mjs (DDR-196 §1): it takes rows and
// returns view-models. worker.mjs does the fetching, operator-pages.mjs does
// the rendering. Nothing here touches D1, the network, or a Response.
//
// THE THREE HONESTY RULES this file exists to keep, because each one is a way
// an operator board becomes worse than no board at all:
//
//   1. THE PLANE'S BELIEF IS NOT AN OBSERVATION. `cell_running` is what the
//      reconciler INTENDED (reconcile.mjs:323 sets it from an action, not from
//      a probe), so it can prove a cell is down and never that it is up. A
//      board that renders intent as health is a board that stays green through
//      an outage.
//   2. MRR IS DERIVED, AND SAYS SO. schema.sql: "subscription status lives in
//      Stripe… this table is the memory between runs, not the authority." A
//      D1-derived number drifts on every missed webhook, so it is labelled and
//      linked rather than presented as revenue.
//   3. UNKNOWN IS NOT ZERO. Anywhere the plane has no answer, the answer is
//      `null` and the page renders an em-dash. A zero that means "nothing has
//      reported" reads identically to a zero that means "nothing happened".

import { EVENTS } from './events.mjs';
import { costAlarms, fleetBoard } from './fleet.mjs';

/**
 * States in which an address is SUPPOSED to answer.
 *
 * `suspended`, `exported` and `purged` are deliberate absences — a stopped
 * cell is the reconciler doing its job, and listing it as "down" would train
 * an operator to ignore the word. They still appear in the projects table;
 * they are just not fleet health.
 */
export const SERVING_STATES = new Set(['pending', 'active', 'past_due']);

/** States that are believed to be paying. `past_due` still is — see reconcile. */
export const BILLED_STATES = new Set(['active', 'past_due']);

/**
 * Who may see any of this.
 *
 * An env allowlist of ACCOUNT IDS rather than a column, and account ids rather
 * than emails. The column would mean a migration on the table whose whole
 * design is "losing it costs a customer nothing"; the emails would mean
 * inheriting OAuth's claim variance (`.` in a Gmail address, `+` aliases,
 * case) into an authorisation decision. Revocable in seconds, and a solo
 * operator is a list of one.
 *
 * An EMPTY list disables the surface entirely — every `/operator` hit 404s.
 * That is the deployed default, deliberately: turning it on is an act.
 */
export function operatorIds(env) {
  return String(env?.OPERATOR_ACCOUNT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOperator(env, account) {
  if (!account?.id) return false;
  const ids = operatorIds(env);
  return ids.length > 0 && ids.includes(account.id);
}

/**
 * What the plane can honestly say about one cell's health.
 *
 * `probe` is a real observation when the sweep captured one (Stage 3 — the
 * cell's own `/health` body). Without it there is no observation at all, and
 * the honest answers are only two: `down` when the plane knows it stopped the
 * cell, `unknown` otherwise. `healthy` is never inferred.
 */
export function cellHealth(row, probe = null) {
  if (probe) return probe.ok ? 'healthy' : 'down';
  if (!row.cell_running) return 'down';
  return 'unknown';
}

/**
 * D1 project rows → the `Cell` shape fleet.mjs speaks.
 *
 * `config` is what `detectDrift` compares against the template. Only columns
 * that describe the CELL belong in it — a drifted `plan` is a billing fact,
 * not a bespoke cell.
 */
export function cellsFromProjects(projects, { probes = new Map() } = {}) {
  return projects
    .filter((row) => SERVING_STATES.has(row.state))
    .map((row) => ({
      id: row.id,
      version: row.version ?? null,
      previousVersion: row.previous_version ?? null,
      health: cellHealth(row, probes.get(row.id) ?? null),
      canary: !!row.canary,
      lastRestoreDrill: row.last_restore_drill ?? null,
      lastCheckpoint: row.last_checkpoint ?? null,
      config: { version: row.version ?? null, canary: !!row.canary },
    }));
}

/**
 * Collapse `fleetBoard`'s problem list into one line per KIND.
 *
 * Not cosmetic. `fleetBoard` emits one entry per cell per problem, and the
 * fleet's honest current state is "nothing has ever been restore-drilled" —
 * which at twelve projects is twelve identical rows that say one thing. A list
 * an operator scrolls past is a list they stop reading (fleet.mjs's own words),
 * so the count goes on the left and the ids stay available behind it.
 */
export function groupProblems(problems, { sample = 6 } = {}) {
  const byKind = new Map();
  for (const p of problems) {
    const seen = byKind.get(p.kind) ?? { kind: p.kind, count: 0, ids: [], detail: p.detail };
    seen.count += 1;
    if (seen.ids.length < sample) seen.ids.push(p.id);
    byKind.set(p.kind, seen);
  }
  return [...byKind.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/**
 * The board, assembled.
 *
 * `costAlarms` needs observed spend, which the plane deliberately does not
 * fetch (the debate's verdict: a GraphQL Analytics API token is an
 * account-wide read credential in the secret store, for a number near €0). So
 * `actual` is passed in — `{}` when nothing is known — and the result is a
 * MODEL-VS-ACTUAL RATIO, never an invoice.
 */
export function assembleBoard({
  projects = [],
  template = null,
  actual = {},
  probes = new Map(),
  render = null,
  now = Date.now(),
  modelPerCellEur = 3,
  ceilingHitThreshold = CEILING_HIT_THRESHOLD,
} = {}) {
  const cells = cellsFromProjects(projects, { probes });
  const board = fleetBoard(cells, { now, template: template ?? undefined });
  const alarms = costAlarms(actual, { cells: cells.length, modelPerCellEur });
  const pressure = buildPressure(render);
  const ceiling = ceilingAlarms(render, { threshold: ceilingHitThreshold });

  const byState = {};
  for (const row of projects) byState[row.state] = (byState[row.state] ?? 0) + 1;

  return {
    cells,
    board,
    problems: groupProblems(board.problems),
    alarms: {
      ...alarms,
      // The pathological-canvas signal, and the same signal as abuse. Worth a
      // line on a page somebody opens, not a chart nobody does.
      alarms: [...alarms.alarms, ...ceiling],
      // `ok` has to account for BOTH, or a fleet whose only problem is
      // ceiling hits reports itself clean.
      ok: alarms.ok && ceiling.length === 0,
    },
    byState,
    serving: cells.length,
    // `null`, not 0: nothing has reported spend, which is a different fact
    // from "spend was zero". Rule 3.
    observedSpend: Object.keys(actual).length > 0 ? alarms.total : null,
    modelPerCellEur,
    // Stage 4 — WHICH SIDE an over-model cell is on. The €3 model covers a
    // cell's sync lane and its canvas builds together, and until the sandbox
    // shipped there was no way to tell which half moved. These are the build
    // half's own figures; anything the model spends that they do not explain
    // is the sync half.
    build: pressure,
  };
}

/**
 * A cell may hit its build ceilings this often in a window before it is worth
 * saying out loud. Not zero: a ceiling that fires occasionally is the ceiling
 * doing its job, and paging on the first one teaches an operator to mute it.
 */
export const CEILING_HIT_THRESHOLD = 5;

/**
 * The build half of the cost model, summed over whatever reported.
 *
 * `null` when analytics could not answer at all. The RATIO is computed here,
 * at read time, from the two stored counts — never in the cell and never in
 * the sweep. A ratio computed over a window that reset is a confident lie; two
 * counts and a window start can be judged (the render-telemetry contract).
 */
export function buildPressure(render) {
  if (!render || render.size === 0) return null;
  const sum = (key) =>
    [...render.values()].reduce((n, r) => (r?.[key] == null ? n : n + r[key]), 0);
  const hits = sum('cacheHits');
  const misses = sum('cacheMisses');
  const looked = hits + misses;
  return {
    projects: render.size,
    builds: sum('builds'),
    cacheHits: hits,
    cacheMisses: misses,
    // `null`, not 0, when nothing was ever looked up — a 0% cache is a
    // catastrophe and "no builds yet" is a Tuesday.
    cacheHitRatio: looked === 0 ? null : hits / looked,
    ceilingHits: sum('timeouts') + sum('memoryKills'),
    rejectedImports: sum('rejectedImports'),
    cpuMsTotal: sum('cpuMsTotal'),
  };
}

/** Cells whose builds keep hitting the wall. */
function ceilingAlarms(render, { threshold = CEILING_HIT_THRESHOLD } = {}) {
  if (!render) return [];
  const over = [...render.entries()]
    .map(([id, r]) => [id, (r?.timeouts ?? 0) + (r?.memoryKills ?? 0)])
    .filter(([, n]) => n > threshold)
    .sort((a, b) => b[1] - a[1]);
  if (over.length === 0) return [];
  return [
    {
      kind: 'build-ceiling-hits',
      detail: `${over.map(([id, n]) => `${id} (${n})`).join(', ')} — a canvas that keeps hitting the wall costs Active-CPU on our bill while the tenant pays a flat rate`,
    },
  ];
}

/**
 * MRR, as the plane believes it.
 *
 * Two named inaccuracies, both stated on the page rather than smoothed over:
 *
 *   - STRIPE IS THE AUTHORITY. This is derived from `projects.plan × state`,
 *     so a missed webhook shows up here as revenue that is not there (or the
 *     reverse). The page deep-links to Stripe for the real number.
 *   - THE INTERVAL IS NOT RECORDED. `projects` has a `plan` column and no
 *     billing interval, so an annually-billed project is counted at its
 *     MONTHLY price — €19 where the true monthly share is €15.83. It
 *     overstates, and it overstates knowably.
 *
 * A plan with no matching price lands in `unpriced` rather than contributing
 * zero: a project quietly worth nothing is exactly the thing worth seeing.
 */
export function deriveMrr(projects = [], pricing = { plans: [], currency: 'eur' }) {
  const priceOf = new Map(
    (pricing.plans ?? []).map((p) => [p.id, p.amounts?.monthlyMinor ?? null])
  );
  const byPlan = new Map();
  const unpriced = [];
  let believedMonthlyMinor = 0;

  for (const row of projects) {
    if (!BILLED_STATES.has(row.state)) continue;
    // A Promo project is free by an operator's decision (D1 v21) and carries a
    // plan word all the same. With no subscription it earns nothing, and a
    // "believed" figure that includes it would be believing something false.
    if (row.promo_since != null && !row.subscription_id) continue;
    const plan = row.plan ?? 'project';
    const monthlyMinor = priceOf.get(plan) ?? null;
    if (monthlyMinor === null) {
      unpriced.push({ id: row.id, plan });
      continue;
    }
    const seen = byPlan.get(plan) ?? { plan, count: 0, monthlyMinor, subtotalMinor: 0 };
    seen.count += 1;
    seen.subtotalMinor += monthlyMinor;
    byPlan.set(plan, seen);
    believedMonthlyMinor += monthlyMinor;
  }

  return {
    believedMonthlyMinor,
    currency: pricing.currency ?? 'eur',
    byPlan: [...byPlan.values()].sort((a, b) => b.subtotalMinor - a.subtotalMinor),
    unpriced,
    caveat: 'as-the-plane-believes',
  };
}

// ------------------------------------------------------------------- CSRF
//
// `edge.mjs sameSiteGate` carries most of the load here, and more than its own
// comment credits it for: it accepts only `same-origin`/`none`, so it refuses
// `same-site` too — which IS the tenant-canvas-on-a-sibling-subdomain case. But
// it FAILS OPEN when `Sec-Fetch-Site` is absent (correct: the CLI and the
// desktop app send none), so it decides nothing about a non-browser client
// holding a stolen cookie. The one write on this surface therefore carries a
// token of its own, DERIVED from the session with a server-side key — see
// `deriveCsrf` for why a double-submit cookie was the wrong shape on this
// particular domain.

/** Hidden form field carrying the token. */
export const CSRF_FIELD = 'csrf';

/**
 * The CSRF token for one session — DERIVED, not stored.
 *
 * The first cut was a double-submit cookie, and it had a hole that only shows
 * up on this particular domain: every workspace lives at
 * `<project>.cloud.maude.sh`, the SAME registrable domain as the board, and a
 * workspace renders customer-authored canvas content that DDR-054 designates
 * untrusted. Such an origin cannot READ our cookies, but it can SET one for
 * the parent domain — so it could pin the operator's CSRF value to something
 * it knew, or simply break the nudge form at will. A token the client supplies
 * both halves of is a token an attacker can supply both halves of.
 *
 * Deriving it from the session with a server-side key closes that: the value
 * is a function of a secret the browser never sees, so it cannot be guessed
 * and cannot be fixated, and there is no second cookie to toss. It also means
 * the token is automatically invalidated when the session is.
 */
export async function deriveCsrf(sessionToken, secret) {
  if (!sessionToken || !secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`operator-csrf:${sessionToken}`));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Constant-time compare of the cookie value against the submitted field.
 *
 * Byte loop rather than `crypto.subtle`: this is a synchronous predicate the
 * route reads before deciding anything, and the values are equal-length hex.
 * An early return on a length mismatch leaks only the length, which is fixed.
 */
export function verifyCsrf(expected, fieldValue) {
  if (typeof expected !== 'string' || typeof fieldValue !== 'string') return false;
  if (expected.length === 0 || expected.length !== fieldValue.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ fieldValue.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Is this reconcile nudge acceptable?
 *
 * The REASON is required by the application, not by the schema (schema.sql:
 * "an access with no stated reason is the one worth noticing"). Blank, or
 * whitespace, is not a reason.
 */
export function checkNudge({ expected, fieldValue, reason }) {
  // `expected` is null when no signing key is configured — fail CLOSED. A
  // surface whose only write silently loses its CSRF check because a secret
  // is missing is worse than one whose write is unavailable.
  if (!expected || !verifyCsrf(expected, fieldValue)) return { ok: false, reason: 'csrf' };
  const trimmed = String(reason ?? '').trim();
  if (trimmed.length === 0) return { ok: false, reason: 'no-reason' };
  // Bounded — the value lands in an append-only table nobody can edit
  // afterwards, so a paste of a whole log is a permanent one.
  if (trimmed.length > 500) return { ok: false, reason: 'reason-too-long' };
  return { ok: true, cleaned: trimmed };
}

// ------------------------------------------------- what a cell reported (Stage 3/4)

/**
 * A `/health` body → the datapoints worth recording, or none.
 *
 * PURE, and tested as such: the fetch belongs to the sweep, the judgement
 * belongs here (DDR-196 §1). It returns an ARRAY because one probe can yield
 * two facts — what the project holds, and how hard its canvases are to build —
 * and because a body that reports neither must yield an empty array rather
 * than a datapoint full of zeroes.
 *
 * THE RULE THIS FUNCTION EXISTS FOR: absent is not zero. A cell on an older
 * image omits `stats` entirely, and emitting `{canvases: 0}` for it would tell
 * the operator board that a customer with sixty canvases has none. So a
 * missing key produces no measure, and a missing block produces no datapoint.
 */
export function statsDatapoints(projectId, body) {
  const out = [];
  const stats = body?.stats;
  if (!stats || typeof stats !== 'object') return out;

  // The key list is the vocabulary's, not a third copy: it must be a subset of
  // what `events.mjs` declares or `validateEvent` refuses the datapoint at
  // runtime, and deriving it makes that structural rather than a coincidence.
  const measures = pickNumbers(stats, EVENTS.tenant_stats.doubles);
  if (Object.keys(measures).length > 0) {
    out.push({ name: 'tenant_stats', projectId, measures });
  }

  const render = stats.render;
  if (render && typeof render === 'object') {
    const r = pickNumbers(render, [
      'builds',
      'cacheHits',
      'cacheMisses',
      'rejectedImports',
      'timeouts',
      'memoryKills',
      'cpuMsTotal',
      'largestGraphBytes',
      'windowStartedAt',
    ]);
    // The percentiles the cell names differently from the wire vocabulary.
    if (Number.isFinite(Number(render.p50Ms))) r.durationMsP50 = Number(render.p50Ms);
    if (Number.isFinite(Number(render.p95Ms))) r.durationMsP95 = Number(render.p95Ms);
    if (Number.isFinite(Number(render.maxMs))) r.durationMsMax = Number(render.maxMs);
    // DELIBERATELY NOT `cacheHitRatio`, even though the cell computes one: the
    // two counts travel and the board divides at read time. A ratio computed
    // over a window that reset is a confident lie; two counts and a window
    // start can be judged (the render-telemetry contract).
    if (Object.keys(r).length > 0) out.push({ name: 'tenant_render', projectId, measures: r });
  }
  return out;
}

/**
 * A cell may report a figure this large, and no larger.
 *
 * The body these numbers come from is written by a process we do not trust to
 * its peers (DDR-054). `Number.isFinite` alone admits `-1` and `1e308`, and a
 * board is a place where one absurd value ruins every scale it shares — or,
 * worse, reaches a formatter that was only ever total over sane input.
 */
const MEASURE_MAX = 1e15;

function pickNumbers(source, keys) {
  const out = {};
  for (const key of keys) {
    const v = source?.[key];
    // `null` from a cell means "I have no figure for this", which must stay
    // absent rather than become 0.
    if (v === null || v === undefined) continue;
    const n = Number(v);
    // Out of range is dropped rather than clamped: a clamped value is a
    // number the board would present as real. Absent is the honest answer to
    // "the cell said something impossible".
    if (!Number.isFinite(n) || n < 0 || n > MEASURE_MAX) continue;
    out[key] = n;
  }
  return out;
}
