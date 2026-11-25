// Promo, free time and the operator's pause — the pure half.
//
// Three facts an operator can now put on a project row, and what the two
// decision functions make of each:
//
//   - `promo_since` (+ tier, + optional end): free by an operator's decision.
//     Never a trial, never paused while it runs, and a paid plan replaces it;
//   - a later `trial_ends_at` (free time): the same trial clock, moved;
//   - `hold_since`: paused by hand, through the reconciler's own transitions,
//     with NO export e-mail and NO deletion clock.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';

import { d1FromSqlite, tenantFromRow } from './db.mjs';
import { applySchema, MIGRATIONS } from './migrate.mjs';
import { decideAccess, planPausedAt, planState } from './project-access.mjs';
import { PROMO_TIERS, promoTier, promoTierLabel, validPromoTier } from './promo.mjs';
import { reconcile, SUSPEND_RETENTION_DAYS, settle } from './reconcile.mjs';
import { SCHEMA_SQL } from './schema.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 12);

describe('migration v21', () => {
  test('adds the promo and hold columns and the request ledger, once', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const DB = d1FromSqlite(sqlite);
    const first = await applySchema(DB, SCHEMA_SQL);
    assert.equal(first.version, Math.max(...MIGRATIONS.map((m) => m.version)));
    assert.ok(first.version >= 21);
    const cols = sqlite
      .prepare('PRAGMA table_info(projects)')
      .all()
      .map((c) => c.name);
    for (const c of ['promo_since', 'promo_tier', 'promo_ends_at', 'hold_since']) {
      assert.ok(cols.includes(c), `projects.${c}`);
    }
    assert.ok(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'operator_actions'").get(),
      'operator_actions exists'
    );
    // Running it again changes nothing and does not throw (ALTER is not idempotent).
    const again = await applySchema(DB, SCHEMA_SQL);
    assert.equal(again.version, first.version);
  });

  test('the version list is strictly increasing with no gap or repeat', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    assert.deepEqual(
      versions,
      versions.map((_, i) => i + 2),
      'versions run 2..N in order'
    );
  });
});

describe('planState with Promo', () => {
  test('a Promo project is promo — not a trial, not paused — whatever its trial clock says', () => {
    const promo = { promo_since: NOW - DAY, promo_tier: 'dedicated', promo_ends_at: null };
    assert.equal(planState({ ...promo, trial_ends_at: null }, { now: NOW }), 'promo');
    assert.equal(planState({ ...promo, trial_ends_at: NOW + DAY }, { now: NOW }), 'promo');
    assert.equal(
      planState({ ...promo, trial_ends_at: NOW - 30 * DAY }, { now: NOW }),
      'promo',
      'an expired trial underneath does not pause a Promo project'
    );
  });

  test('a paid plan wins over Promo — never both', () => {
    assert.equal(
      planState({ promo_since: NOW, subscription_id: 'sub_1', trial_ends_at: null }, { now: NOW }),
      'paid'
    );
  });

  test('Promo with an end date pauses at that date, and not before', () => {
    const p = { promo_since: NOW - DAY, promo_ends_at: NOW + 5 * DAY, trial_ends_at: null };
    assert.equal(planState(p, { now: NOW }), 'promo');
    assert.equal(planState(p, { now: NOW + 5 * DAY }), 'paused');
    assert.equal(planPausedAt(p), NOW + 5 * DAY);
    assert.equal(planPausedAt({ trial_ends_at: 7 }), 7);
    assert.equal(planPausedAt({ promo_since: 1, promo_ends_at: null, trial_ends_at: 7 }), null);
  });

  test('decideAccess: nobody on a running Promo project is paused', () => {
    const project = {
      id: 'p',
      account_id: 'acct_o',
      state: 'active',
      promo_since: NOW - DAY,
      trial_ends_at: NOW - 30 * DAY,
    };
    const owner = decideAccess({ accountId: 'acct_o', project, now: NOW });
    assert.deepEqual(owner, { ok: true, role: 'owner' });
    const member = decideAccess({
      accountId: 'acct_m',
      project,
      members: [{ account_id: 'acct_m', role: 'member' }],
      now: NOW,
    });
    assert.deepEqual(member, { ok: true, role: 'member' });
  });
});

describe('the Promo storage tiers', () => {
  test('three tiers: 25 GB, 250 GB, unlimited — named after the plans in pricing.json', () => {
    assert.deepEqual(
      PROMO_TIERS.map((t) => [t.id, t.storageGb]),
      [
        ['project', 25],
        ['dedicated', 250],
        ['unlimited', null],
      ]
    );
    assert.equal(promoTierLabel('project'), 'Cloud Project · 25 GB');
    assert.equal(promoTierLabel('dedicated'), 'Dedicated · 250 GB');
    assert.equal(promoTierLabel('unlimited'), 'Unlimited');
    assert.equal(validPromoTier('dedicated'), true);
    assert.equal(validPromoTier('enterprise'), false);
    assert.equal(promoTier('nope'), null);
  });
});

const tenant = (over = {}) => ({
  id: 'p',
  state: 'active',
  stateSince: NOW - 40 * DAY,
  cellRunning: true,
  exportSent: false,
  adverseSince: null,
  trialEndsAt: null,
  subscriptionId: null,
  promo: false,
  holdSince: null,
  ...over,
});

describe('reconcile with Promo and the operator hold', () => {
  test('tenantFromRow carries promo and hold', () => {
    const t = tenantFromRow({
      id: 'p',
      state: 'active',
      state_since: 1,
      cell_running: 1,
      promo_since: 5,
      hold_since: 9,
    });
    assert.equal(t.promo, true);
    assert.equal(t.holdSince, 9);
    const plain = tenantFromRow({ id: 'p', state: 'active', state_since: 1, cell_running: 1 });
    assert.equal(plain.promo, false);
    assert.equal(plain.holdSince, null);
  });

  test('a Promo project with no subscription is left alone: no action, no alert', () => {
    const out = reconcile(tenant({ promo: true }), null, { now: NOW });
    assert.deepEqual(out.actions, []);
    assert.equal(out.desiredState, 'active');
    // …however long ago it started, and whatever its trial clock said.
    const old = reconcile(tenant({ promo: true, trialEndsAt: NOW - 90 * DAY }), null, { now: NOW });
    assert.deepEqual(old.actions, []);
  });

  test('a Promo row that gained a subscription is the ordinary machine’s again', () => {
    const out = reconcile(
      tenant({ promo: true, subscriptionId: 'sub_1', adverseSince: NOW - DAY }),
      { status: 'canceled' },
      { now: NOW }
    );
    assert.equal(out.desiredState, 'suspended');
  });

  test('a hold suspends through the machine — stop the cell, NO export, NO deletion clock', () => {
    const { tenant: after, actions } = settle(
      tenant({ holdSince: NOW, trialEndsAt: NOW + DAY }),
      null,
      {
        now: NOW,
      }
    );
    assert.equal(after.state, 'suspended');
    assert.equal(after.cellRunning, false);
    assert.deepEqual(
      actions.map((a) => a.kind),
      ['set-state', 'suspend-cell']
    );
    // Held for longer than the retention window: still no export, warning or purge.
    const later = reconcile({ ...after, stateSince: NOW }, null, {
      now: NOW + (SUSPEND_RETENTION_DAYS + 5) * DAY,
    });
    assert.deepEqual(later.actions, []);
    assert.equal(later.desiredState, 'suspended');
  });

  test('a hold also stops a PAID project, and its subscription does not start the clock', () => {
    const { tenant: after, actions } = settle(
      tenant({ holdSince: NOW, subscriptionId: 'sub_1' }),
      { status: 'active' },
      { now: NOW }
    );
    assert.equal(after.state, 'suspended');
    assert.ok(!actions.some((a) => a.kind === 'send-export'));
  });

  test('lifting the hold wakes a trial project (no subscription to re-derive it from)', () => {
    const held = tenant({
      state: 'suspended',
      cellRunning: false,
      stateSince: NOW - DAY,
      trialEndsAt: NOW + 10 * DAY,
    });
    const { tenant: after, actions } = settle(held, null, { now: NOW });
    assert.equal(after.state, 'active');
    assert.equal(after.cellRunning, true);
    assert.deepEqual(
      actions.map((a) => a.kind),
      ['set-state', 'resume-cell']
    );
  });

  test('lifting the hold wakes a Promo project and a paid one alike', () => {
    const base = { state: 'suspended', cellRunning: false, stateSince: NOW - DAY };
    assert.equal(
      settle(tenant({ ...base, promo: true }), null, { now: NOW }).tenant.state,
      'active'
    );
    assert.equal(
      settle(tenant({ ...base, subscriptionId: 'sub_1' }), { status: 'active' }, { now: NOW })
        .tenant.state,
      'active'
    );
  });

  test('a hold never resurrects or touches a project already queued for deletion', () => {
    const exported = tenant({ state: 'exported', holdSince: NOW, subscriptionId: 'sub_1' });
    const out = reconcile(exported, { status: 'canceled' }, { now: NOW });
    assert.equal(out.desiredState, 'purged');
    assert.equal(
      reconcile(tenant({ state: 'purged', holdSince: NOW }), null).desiredState,
      'purged'
    );
  });

  test('the fixed point holds for every new shape', () => {
    for (const t of [
      tenant({ promo: true }),
      tenant({ holdSince: NOW }),
      tenant({ holdSince: NOW, promo: true }),
      tenant({ state: 'suspended', cellRunning: false, promo: true }),
      tenant({ state: 'pending', cellRunning: false, holdSince: NOW, trialEndsAt: NOW + DAY }),
    ]) {
      const once = settle(t, null, { now: NOW });
      const twice = settle(once.tenant, null, { now: NOW });
      assert.deepEqual(twice.actions, [], JSON.stringify(t));
    }
  });
});

describe('believed revenue never counts a free project', () => {
  test('a Promo project is not revenue, whatever plan word its row carries', async () => {
    const { deriveMrr } = await import('./operator.mjs');
    const pricing = {
      currency: 'eur',
      plans: [{ id: 'project', amounts: { monthlyMinor: 1900 } }],
    };
    const paid = { id: 'a', state: 'active', plan: 'project', subscription_id: 'sub_1' };
    const promo = { id: 'b', state: 'active', plan: 'project', promo_since: 1 };
    const out = deriveMrr([paid, promo], pricing);
    assert.equal(out.believedMonthlyMinor, 1900);
    assert.deepEqual(out.unpriced, []);
  });
});
