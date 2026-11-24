// A failing reproduction (not a fix): a subscription that ends while the
// project is `active` is never suspended.
//
//   node --test scripts/dev/admin-e2e/cloud-repro-suspend-debounce.test.mjs
//
// `reconcile()` debounces an abrupt `canceled` for SUSPEND_DEBOUNCE_MS and
// returns the start of that wait as `adverseSince` on the RESULT, "carried onto
// the next row by applyActions". But `settle()` returns as soon as a round has
// no actions — which is exactly the debounce round — so `applyActions` never
// runs, `adverse_since` is never written (worker.mjs runOne saves
// `settle().tenant`), and every later sweep starts the wait again from `now`.
// cloud-scenarios.mjs C3 shows the same thing end to end against local D1.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SUSPEND_DEBOUNCE_MS, settle } from '../../../apps/cloud/reconcile.mjs';

const T0 = Date.UTC(2026, 10, 1);
const active = {
  id: 'repro',
  state: 'active',
  stateSince: T0 - 30 * 86_400_000,
  cellRunning: true,
  exportSent: false,
  adverseSince: null,
  trialEndsAt: null,
  subscriptionId: 'sub_repro',
  promo: false,
  holdSince: null,
};

test('settle() records when a canceled subscription was first seen', () => {
  const first = settle(active, { status: 'canceled' }, { now: T0 });
  assert.equal(first.tenant.state, 'active', 'held on the first reading — correct');
  assert.equal(first.tenant.adverseSince, T0, 'the debounce clock must start, or it never ends');
});

test('a subscription that stays canceled past the debounce suspends the project', () => {
  let tenant = active;
  // An hourly sweep for a whole day, each one saving what settle() returned.
  for (let hour = 0; hour <= 24; hour++) {
    tenant = settle(tenant, { status: 'canceled' }, { now: T0 + hour * 3600_000 }).tenant;
  }
  assert.ok(24 * 3600_000 > SUSPEND_DEBOUNCE_MS);
  assert.equal(tenant.state, 'suspended', 'a day of `canceled` readings must end in suspended');
});
