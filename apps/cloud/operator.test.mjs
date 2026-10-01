// Cloud Phase 26 Stage 1 — the operator surface's pure half.
//
// The tests are about the three honesty rules the module's header states,
// because each one is a way an operator board becomes worse than no board:
// health inferred from intent, MRR presented as revenue, and unknown rendered
// as zero. Plus the gate, which is an authorisation decision and therefore
// gets the adversarial cases rather than the happy one.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assembleBoard,
  buildPressure,
  cellHealth,
  cellsFromProjects,
  checkNudge,
  deriveCsrf,
  deriveMrr,
  groupProblems,
  isOperator,
  operatorIds,
  statsDatapoints,
  verifyCsrf,
} from './operator.mjs';

const project = (over = {}) => ({
  id: 'alligators',
  account_id: 'acct_1',
  name: 'Brno Alligators',
  state: 'active',
  state_since: 0,
  plan: 'project',
  version: 'v1',
  previous_version: null,
  canary: 0,
  cell_running: 1,
  last_checkpoint: null,
  last_restore_drill: null,
  created_at: 0,
  ...over,
});

const pricing = {
  currency: 'eur',
  plans: [
    { id: 'project', amounts: { monthlyMinor: 1900, annualMinor: 19000 } },
    { id: 'dedicated', amounts: { monthlyMinor: 9900, annualMinor: null } },
  ],
};

// ------------------------------------------------------------------- gating

describe('the gate is an allowlist of account ids, and an empty one disables the surface', () => {
  it('an unset variable admits nobody — the deployed default', () => {
    // Turning the surface on is a deploy-time act. Absent that act, every
    // /operator hit must 404, including for the owner's own account.
    assert.equal(isOperator({}, { id: 'acct_1' }), false);
    assert.equal(isOperator({ OPERATOR_ACCOUNT_IDS: '' }, { id: 'acct_1' }), false);
    assert.equal(isOperator({ OPERATOR_ACCOUNT_IDS: '   ' }, { id: 'acct_1' }), false);
  });

  it('admits an exact id, and only an exact id', () => {
    const env = { OPERATOR_ACCOUNT_IDS: 'acct_1, acct_2' };
    assert.equal(isOperator(env, { id: 'acct_1' }), true);
    assert.equal(isOperator(env, { id: 'acct_2' }), true);
    // No prefix, no substring, no case folding — this is an id comparison,
    // not a name match.
    assert.equal(isOperator(env, { id: 'acct_' }), false);
    assert.equal(isOperator(env, { id: 'acct_10' }), false);
    assert.equal(isOperator(env, { id: 'ACCT_1' }), false);
  });

  it('a caller with no account is never an operator', () => {
    const env = { OPERATOR_ACCOUNT_IDS: 'acct_1' };
    assert.equal(isOperator(env, null), false);
    assert.equal(isOperator(env, {}), false);
    assert.equal(isOperator(env, { id: '' }), false);
    assert.equal(isOperator(env, { id: undefined }), false);
  });

  it('the list tolerates the shapes a human types into a dashboard', () => {
    assert.deepEqual(operatorIds({ OPERATOR_ACCOUNT_IDS: ' a , b ,, c ' }), ['a', 'b', 'c']);
  });
});

// ------------------------------------------------------------------- health

describe('the plane’s belief is not an observation', () => {
  it('never infers healthy from cell_running — that column is an INTENT', () => {
    // reconcile.mjs sets cell_running from an ACTION it decided to take, not
    // from a probe. A board that renders it as health stays green through an
    // outage, which is the one moment it exists for.
    assert.equal(cellHealth(project({ cell_running: 1 })), 'unknown');
  });

  it('does say down when the plane knows it stopped the cell', () => {
    assert.equal(cellHealth(project({ cell_running: 0 })), 'down');
  });

  it('a real probe result wins over both', () => {
    assert.equal(cellHealth(project({ cell_running: 0 }), { ok: true }), 'healthy');
    assert.equal(cellHealth(project({ cell_running: 1 }), { ok: false }), 'down');
  });
});

describe('the fleet is the cells that are supposed to answer', () => {
  it('excludes the deliberate absences — a paused cell is not an outage', () => {
    const rows = [
      project({ id: 'a', state: 'active' }),
      project({ id: 'b', state: 'pending' }),
      project({ id: 'c', state: 'past_due' }),
      project({ id: 'd', state: 'suspended' }),
      project({ id: 'e', state: 'exported' }),
      project({ id: 'f', state: 'purged' }),
    ];
    assert.deepEqual(
      cellsFromProjects(rows).map((c) => c.id),
      ['a', 'b', 'c']
    );
  });

  it('maps the fleet bookkeeping fleetBoard actually reads', () => {
    const [cell] = cellsFromProjects([
      project({ version: 'v2', previous_version: 'v1', canary: 1, last_checkpoint: 5 }),
    ]);
    assert.equal(cell.version, 'v2');
    assert.equal(cell.previousVersion, 'v1');
    assert.equal(cell.canary, true);
    assert.equal(cell.lastCheckpoint, 5);
    // Never undefined: fleetBoard distinguishes null (never happened) from a
    // stale timestamp, and `undefined` would collapse that distinction.
    assert.equal(cell.lastRestoreDrill, null);
  });
});

// ------------------------------------------------------------------- board

describe('the board interprets rather than lists', () => {
  it('collapses one-problem-per-cell into one line per kind', () => {
    // The fleet's honest current state is "nothing has ever been drilled",
    // which at twelve projects is twelve identical rows saying one thing.
    const grouped = groupProblems([
      { id: 'a', kind: 'never-drilled', detail: 'x' },
      { id: 'b', kind: 'never-drilled', detail: 'x' },
      { id: 'c', kind: 'no-checkpoint', detail: 'y' },
    ]);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].kind, 'never-drilled');
    assert.equal(grouped[0].count, 2);
    assert.deepEqual(grouped[0].ids, ['a', 'b']);
  });

  it('keeps a bounded sample of ids — a board is not a database dump', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      kind: 'never-drilled',
      detail: 'x',
    }));
    const [grouped] = groupProblems(many, { sample: 6 });
    assert.equal(grouped.count, 40);
    assert.equal(grouped.ids.length, 6);
  });

  it('counts every project by state, including the ones outside the fleet', () => {
    const board = assembleBoard({
      projects: [
        project({ id: 'a', state: 'active' }),
        project({ id: 'b', state: 'active' }),
        project({ id: 'c', state: 'purged' }),
      ],
    });
    assert.deepEqual(board.byState, { active: 2, purged: 1 });
    assert.equal(board.serving, 2);
  });

  it('reports spend as UNKNOWN when nothing has been observed, never as zero', () => {
    // Rule 3. A €0 tile reads as "we spend nothing"; the truth is "no figure
    // has ever been collected", which is what the cost model has always
    // lacked.
    const board = assembleBoard({ projects: [project()] });
    assert.equal(board.observedSpend, null);
    assert.equal(board.alarms.ok, true, 'no observation cannot raise an alarm');
  });

  it('alarms on the RATIO once a figure exists', () => {
    const board = assembleBoard({
      projects: [project({ id: 'a' }), project({ id: 'b' })],
      actual: { compute: 20 },
      modelPerCellEur: 3,
    });
    assert.equal(board.observedSpend, 20);
    assert.ok(board.alarms.alarms.some((a) => a.kind === 'per-cell-cost'));
    assert.match(board.alarms.alarms[0].detail, /€10\.00\/cell/);
  });

  it('surfaces a version spread — the fleet mid-rollout is a fact, not a fault', () => {
    const board = assembleBoard({
      projects: [project({ id: 'a', version: 'v1' }), project({ id: 'b', version: 'v2' })],
    });
    assert.ok(board.problems.some((p) => p.kind === 'version-spread'));
    assert.deepEqual(board.board.versions, ['v1', 'v2']);
  });

  it('an empty fleet is ok rather than alarming', () => {
    const board = assembleBoard({ projects: [] });
    assert.equal(board.serving, 0);
    assert.deepEqual(board.problems, []);
    assert.equal(board.alarms.ok, true);
  });
});

// --------------------------------------------------------------------- MRR

describe('MRR is derived, and says so', () => {
  it('counts the states that are believed to be paying', () => {
    const mrr = deriveMrr(
      [
        project({ id: 'a', state: 'active' }),
        project({ id: 'b', state: 'past_due' }),
        project({ id: 'c', state: 'suspended' }),
        project({ id: 'd', state: 'pending' }),
      ],
      pricing
    );
    // past_due is still a live subscription — the card failed, the project
    // keeps running, and Stripe keeps trying.
    assert.equal(mrr.believedMonthlyMinor, 3800);
  });

  it('breaks down by plan, biggest first', () => {
    const mrr = deriveMrr(
      [
        project({ id: 'a', plan: 'project' }),
        project({ id: 'b', plan: 'project' }),
        project({ id: 'c', plan: 'dedicated' }),
      ],
      pricing
    );
    assert.equal(mrr.believedMonthlyMinor, 1900 + 1900 + 9900);
    assert.equal(mrr.byPlan[0].plan, 'dedicated');
    assert.equal(mrr.byPlan[1].count, 2);
    assert.equal(mrr.byPlan[1].subtotalMinor, 3800);
  });

  it('a plan with no price is REPORTED, not counted as zero', () => {
    // A project quietly worth nothing is exactly the row worth seeing, and
    // adding 0 to the total hides it perfectly.
    const mrr = deriveMrr([project({ id: 'x', plan: 'legacy-free' })], pricing);
    assert.equal(mrr.believedMonthlyMinor, 0);
    assert.deepEqual(mrr.unpriced, [{ id: 'x', plan: 'legacy-free' }]);
  });

  it('carries the label that keeps it from reading as revenue', () => {
    const mrr = deriveMrr([project()], pricing);
    assert.equal(mrr.caveat, 'as-the-plane-believes');
    assert.equal(mrr.currency, 'eur');
  });

  it('an empty plane is €0 with an empty breakdown, not a crash', () => {
    const mrr = deriveMrr([], pricing);
    assert.equal(mrr.believedMonthlyMinor, 0);
    assert.deepEqual(mrr.byPlan, []);
  });
});

// -------------------------------------------------------------------- CSRF

describe('the one write carries a token derived from the session', () => {
  const KEY = 'cell-secret-master';

  it('is a stable function of (session, key) — every tab of one session agrees', async () => {
    // A per-render random value would break the operator's second tab; a
    // stored one would need somewhere to store it.
    const a = await deriveCsrf('sess_abc', KEY);
    const b = await deriveCsrf('sess_abc', KEY);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{32}$/);
  });

  it('differs per session and per key, so it cannot be guessed or fixated', async () => {
    // The hole in the double-submit version this replaced: a tenant workspace
    // at `<project>.cloud.maude.sh` shares our registrable domain, so it can
    // SET a cookie for the parent — pinning the value the server would then
    // accept. A value the browser never supplies cannot be pinned.
    const mine = await deriveCsrf('sess_abc', KEY);
    assert.notEqual(await deriveCsrf('sess_other', KEY), mine);
    assert.notEqual(await deriveCsrf('sess_abc', 'a-different-key'), mine);
  });

  it('is null when there is no session or no key — and null fails closed', async () => {
    assert.equal(await deriveCsrf(null, KEY), null);
    assert.equal(await deriveCsrf('sess_abc', ''), null);
    assert.equal(await deriveCsrf(undefined, undefined), null);
    // The important half: a missing key must not silently disable the check.
    assert.equal(
      checkNudge({ expected: null, fieldValue: 'anything', reason: 'why' }).reason,
      'csrf'
    );
    assert.equal(checkNudge({ expected: null, fieldValue: '', reason: 'why' }).reason, 'csrf');
  });

  it('accepts a matching pair and refuses everything else', async () => {
    const token = await deriveCsrf('sess_abc', KEY);
    assert.equal(verifyCsrf(token, token), true);
    assert.equal(verifyCsrf(token, await deriveCsrf('sess_zzz', KEY)), false);
    assert.equal(verifyCsrf(null, token), false);
    assert.equal(verifyCsrf(token, null), false);
    assert.equal(verifyCsrf('', ''), false, 'two absent values are not a match');
    // A prefix must not pass a loop that stops at the shorter length.
    assert.equal(verifyCsrf(token, token.slice(0, 16)), false);
  });

  it('a nudge needs both the token and a reason in the operator’s own words', async () => {
    const token = await deriveCsrf('sess_abc', KEY);
    assert.deepEqual(
      checkNudge({ expected: token, fieldValue: token, reason: '  customer reported a stall  ' }),
      { ok: true, cleaned: 'customer reported a stall' }
    );
    assert.equal(checkNudge({ expected: token, fieldValue: 'x', reason: 'why' }).reason, 'csrf');
    assert.equal(
      checkNudge({ expected: token, fieldValue: token, reason: '   ' }).reason,
      'no-reason'
    );
    assert.equal(
      checkNudge({ expected: token, fieldValue: token, reason: undefined }).reason,
      'no-reason'
    );
    // The value lands in an append-only table with no edit path, so an
    // accidental paste of a whole log is permanent.
    assert.equal(
      checkNudge({ expected: token, fieldValue: token, reason: 'x'.repeat(501) }).reason,
      'reason-too-long'
    );
  });

  it('checks the token BEFORE it looks at the reason', async () => {
    // Order matters for what the failure teaches a caller: a forged request
    // must not learn whether its reason would have been acceptable.
    assert.equal(checkNudge({ expected: 'a', fieldValue: 'b', reason: '' }).reason, 'csrf');
  });
});

// ------------------------------------------------ what a cell reported (Stage 3/4)

describe('statsDatapoints — absent is never zero', () => {
  it('a body with no stats block yields NOTHING', () => {
    // A cell on an older image. Emitting `{canvases: 0}` for it would tell the
    // board that a customer with sixty canvases has none.
    assert.deepEqual(statsDatapoints('p', {}), []);
    assert.deepEqual(statsDatapoints('p', null), []);
    // A cell the sweep chose not to wake (x-maude-wake: never).
    assert.deepEqual(statsDatapoints('p', { state: 'asleep' }), []);
    assert.deepEqual(statsDatapoints('p', { ok: true, version: 'x' }), []);
    assert.deepEqual(statsDatapoints('p', { stats: 'not an object' }), []);
  });

  it('a reported ZERO is kept — that one is a measurement', () => {
    const [dp] = statsDatapoints('p', { stats: { canvases: 0, artboards: 0 } });
    assert.equal(dp.name, 'tenant_stats');
    assert.equal(dp.projectId, 'p');
    assert.equal(dp.measures.canvases, 0);
    assert.equal(dp.measures.artboards, 0);
    // Never reported at all, so never invented.
    assert.equal(dp.measures.assetsBytes, undefined);
  });

  it('a null from the cell means "no figure", and stays absent', () => {
    const [dp] = statsDatapoints('p', { stats: { canvases: 3, assetsBytes: null } });
    assert.equal(dp.measures.canvases, 3);
    assert.ok(!('assetsBytes' in dp.measures));
  });

  it('carries the render counters as their own datapoint', () => {
    const dps = statsDatapoints('alligators', {
      stats: {
        canvases: 4,
        render: {
          builds: 10,
          cacheHits: 8,
          cacheMisses: 2,
          timeouts: 1,
          memoryKills: 0,
          rejectedImports: 3,
          cpuMsTotal: 4200,
          largestGraphBytes: 90_000,
          p50Ms: 120,
          p95Ms: 410,
          maxMs: 900,
          windowStartedAt: 1_700_000_000_000,
        },
      },
    });
    const render = dps.find((d) => d.name === 'tenant_render');
    assert.ok(render);
    assert.equal(render.measures.builds, 10);
    assert.equal(render.measures.durationMsP95, 410);
    assert.equal(render.measures.durationMsMax, 900);
    assert.equal(render.measures.rejectedImports, 3);
    // The field that lets a row of zeroes be told apart from a reboot.
    assert.equal(render.measures.windowStartedAt, 1_700_000_000_000);
  });

  it('never carries a pre-computed cache ratio', () => {
    // The render-telemetry contract: two counts + a window start travel, and
    // the board divides at read time. A ratio computed over a window that
    // reset is a confident lie.
    const [, render] = statsDatapoints('p', {
      stats: { canvases: 1, render: { cacheHits: 8, cacheMisses: 2, cacheHitRatio: 0.8 } },
    });
    assert.equal(render.measures.cacheHits, 8);
    assert.equal(render.measures.cacheMisses, 2);
    assert.ok(!('cacheHitRatio' in render.measures));
  });

  it('carries no tenant-authored string anywhere', () => {
    // The rejected specifier is the customer's own text. A COUNT of rejections
    // is the operational fact; the string is not ours to move.
    const dps = statsDatapoints('p', {
      stats: {
        canvases: 1,
        render: { rejectedImports: 2, lastRejected: 'import secret-plans from "./x"' },
        biggestCanvas: 'acquisition-pitch.tsx',
      },
    });
    const payload = JSON.stringify(dps);
    assert.ok(!payload.includes('secret-plans'));
    assert.ok(!payload.includes('acquisition-pitch'));
    for (const dp of dps) {
      for (const v of Object.values(dp.measures)) assert.equal(typeof v, 'number');
    }
  });

  it('emits datapoints the event vocabulary actually accepts', async () => {
    const { validateEvent } = await import('./events.mjs');
    for (const dp of statsDatapoints('brno-alligators', {
      stats: { canvases: 1, render: { builds: 1, windowStartedAt: 5 } },
    })) {
      const verdict = validateEvent(dp);
      assert.equal(verdict.ok, true, verdict.error);
    }
  });
});

// ------------------------------------------------------------- build pressure

describe('the cost tile can say WHICH HALF', () => {
  it('is null when no cell reported — never a zeroed build story', () => {
    assert.equal(buildPressure(null), null);
    assert.equal(buildPressure(new Map()), null);
    assert.equal(assembleBoard({ projects: [project()] }).build, null);
  });

  it('sums the counts and divides the ratio at read time', () => {
    const p = buildPressure(
      new Map([
        [
          'a',
          { builds: 6, cacheHits: 8, cacheMisses: 2, timeouts: 1, memoryKills: 0, cpuMsTotal: 100 },
        ],
        [
          'b',
          { builds: 4, cacheHits: 2, cacheMisses: 8, timeouts: 0, memoryKills: 2, cpuMsTotal: 300 },
        ],
      ])
    );
    assert.equal(p.builds, 10);
    assert.equal(p.cacheHitRatio, 0.5);
    assert.equal(p.ceilingHits, 3);
    assert.equal(p.cpuMsTotal, 400);
    assert.equal(p.projects, 2);
  });

  it('a cell that built nothing has a null ratio, not 0%', () => {
    // 0% cached is a catastrophe; "no builds yet" is a Tuesday.
    const p = buildPressure(new Map([['a', { builds: 0, cacheHits: 0, cacheMisses: 0 }]]));
    assert.equal(p.cacheHitRatio, null);
  });

  it('alarms when a cell keeps hitting its build ceilings', () => {
    // The pathological-canvas signal, and the same signal as abuse: a huge
    // import graph burns Active-CPU on our bill while the tenant pays a flat
    // rate.
    const board = assembleBoard({
      projects: [project()],
      render: new Map([
        ['alligators', { timeouts: 9, memoryKills: 2, cacheHits: 0, cacheMisses: 1 }],
      ]),
    });
    const alarm = board.alarms.alarms.find((a) => a.kind === 'build-ceiling-hits');
    assert.ok(alarm);
    assert.match(alarm.detail, /alligators \(11\)/);
    assert.equal(board.alarms.ok, false, 'a fleet whose only problem is ceilings is not ok');
  });

  it('does not alarm on the occasional ceiling hit', () => {
    // A ceiling that fires now and then is the ceiling doing its job. Paging
    // on the first one teaches an operator to mute it.
    const board = assembleBoard({
      projects: [project()],
      render: new Map([
        ['alligators', { timeouts: 1, memoryKills: 0, cacheHits: 5, cacheMisses: 1 }],
      ]),
    });
    assert.equal(board.alarms.ok, true);
  });
});

// ------------------------------------------- numbers from an untrusted process

describe('a cell’s numbers are bounded before they reach a board', () => {
  it('drops a negative, an infinity and an absurd magnitude', () => {
    // The body these come from is written by a process DDR-054 designates
    // untrusted to its peers. `Number.isFinite` alone admits -1 and 1e308, and
    // one absurd value ruins every scale it shares.
    const [dp] = statsDatapoints('p', {
      stats: {
        canvases: 5,
        artboards: -1,
        designSystems: Number.POSITIVE_INFINITY,
        assetsBytes: 1e308,
      },
    });
    assert.equal(dp.measures.canvases, 5);
    assert.ok(!('artboards' in dp.measures));
    assert.ok(!('designSystems' in dp.measures));
    assert.ok(!('assetsBytes' in dp.measures));
  });

  it('drops rather than clamps — a clamped value would render as real', () => {
    assert.deepEqual(statsDatapoints('p', { stats: { canvases: 1e300 } }), []);
  });

  it('a poisoned windowStartedAt cannot make the page throw', async () => {
    // `new Date(x).toISOString()` throws RangeError out of range, and this
    // value originates in a cell-reported /health body.
    const { operatorProjectPage } = await import('./operator-pages.mjs');
    assert.doesNotThrow(() =>
      operatorProjectPage({
        account: { email: 'op@example.com' },
        project: project(),
        csrf: 'x'.repeat(32),
        render: {
          cacheHits: 1,
          cacheMisses: 0,
          timeouts: 0,
          memoryKills: 0,
          builds: 1,
          windowStartedAt: 1e300,
        },
      })
    );
  });
});
