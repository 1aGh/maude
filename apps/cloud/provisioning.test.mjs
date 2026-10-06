// Cloud Phase 14 — provision first, charge after.
//
// One rule, and it is the product promise: nobody is charged for a workspace
// that did not come up. These tests exist so the ordering cannot be reversed
// by accident while somebody is adding a feature.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { probeCellBody } from './provision.mjs';
import {
  chargeIsPermitted,
  decideCheckout,
  PROVISION_TIMEOUT_MS,
  waitingRoom,
} from './provisioning.mjs';

const T0 = 1_700_000_000_000;
const attempt = (over = {}) => ({
  payment: 'authorized',
  provision: 'pending',
  authorizedAt: T0,
  ...over,
});

describe('a charge cannot precede a healthy workspace', () => {
  it('is stated as a rule, over every combination', () => {
    // Asserted exhaustively rather than through the decision function, so a
    // future branch in `decideCheckout` cannot quietly create a path that
    // charges without a healthy workspace.
    for (const payment of ['authorized', 'charged', 'voided']) {
      for (const provision of ['pending', 'healthy', 'failed']) {
        const permitted = chargeIsPermitted({ payment, provision });
        assert.equal(
          permitted,
          payment === 'authorized' && provision === 'healthy',
          `${payment} × ${provision}`
        );
      }
    }
  });

  it('charges only once the workspace answers', () => {
    assert.equal(decideCheckout(attempt({ provision: 'healthy' }), { now: T0 }).outcome, 'charge');
    assert.equal(decideCheckout(attempt(), { now: T0 }).outcome, 'waiting');
  });
});

describe('a failure costs the customer nothing', () => {
  it('voids on a provisioning failure', () => {
    const d = decideCheckout(attempt({ provision: 'failed' }), { now: T0 });
    assert.equal(d.outcome, 'void');
    // The thing they are actually worried about, said first.
    assert.match(d.tellCustomer, /you have not been charged/);
    assert.match(d.tellCustomer, /Nothing was taken from your card/);
  });

  it('voids when provisioning simply never finishes', () => {
    // The silent case. Without a timeout an authorization sits there, and the
    // person is left not knowing whether they paid.
    const d = decideCheckout(attempt(), { now: T0 + PROVISION_TIMEOUT_MS });
    assert.equal(d.outcome, 'void');
    assert.match(d.tellCustomer, /released the hold on your card/);
    assert.match(d.tellCustomer, /have not been charged/);
  });

  it('does not void one millisecond early', () => {
    assert.equal(
      decideCheckout(attempt(), { now: T0 + PROVISION_TIMEOUT_MS - 1 }).outcome,
      'waiting'
    );
  });
});

describe('webhooks arrive more than once', () => {
  it('a settled payment is never settled again', () => {
    // Stripe redelivers as a matter of course. A second delivery that charged
    // again would be the single worst bug this file can have.
    for (const payment of ['charged', 'voided']) {
      const d = decideCheckout(attempt({ payment, provision: 'healthy' }), { now: T0 });
      assert.equal(d.outcome, 'already-settled', payment);
      assert.equal(d.tellCustomer, null, 'and says nothing a second time');
    }
  });
});

describe('the waiting room is honest', () => {
  it('answers "have I been charged?" before anyone asks', () => {
    // That question arrives long before any email does, so the reassurance
    // belongs on the screen the person is already looking at.
    const w = waitingRoom(attempt(), { now: T0 });
    assert.equal(w.done, false);
    assert.match(w.note, /card has not been charged yet/);
  });

  it('names steps rather than inventing a percentage', () => {
    // A percentage made up from nothing is a lie that gets found out at 90%.
    const w = waitingRoom(attempt(), { now: T0 });
    assert.deepEqual(
      w.steps.map((s) => s.key),
      ['account', 'workspace', 'project', 'ready']
    );
    assert.ok(!('percent' in w));
  });

  it('ends on ready when the workspace is up', () => {
    const w = waitingRoom(attempt({ provision: 'healthy' }), { now: T0 });
    assert.equal(w.step, 'ready');
    assert.equal(w.done, true);
  });

  it('carries the failure sentence through to the screen', () => {
    const w = waitingRoom(attempt({ provision: 'failed' }), { now: T0 });
    assert.equal(w.done, true);
    assert.match(w.note, /not been charged/);
  });
});

describe('the customer-facing wording', () => {
  it('never uses our vocabulary for our problems', () => {
    const said = ['pending', 'healthy', 'failed']
      .map((provision) =>
        decideCheckout(attempt({ provision }), { now: T0 + PROVISION_TIMEOUT_MS })
      )
      .map((d) => d.tellCustomer)
      .filter(Boolean)
      .join(' ');
    for (const jargon of [
      'tenant',
      'cell',
      'provision',
      'reconcil',
      'webhook',
      'R2',
      'container',
    ]) {
      assert.ok(!new RegExp(jargon, 'i').test(said), `"${jargon}" leaked into a customer message`);
    }
  });
});

// ------------------------------------- probing a cell we do not trust (Phase 26)

describe('probeCellBody treats the cell as the untrusted peer it is', () => {
  const env = { CELL_ZONE: 'cloud.maude.sh' };
  const answer = (body, { headers = {} } = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => headers[k] ?? (k === 'content-length' ? String(text.length) : null) },
      text: async () => text,
    };
  };

  it('refuses to follow a redirect', async () => {
    // `fetch` follows by default, so a compromised cell answering 302 would
    // steer a call made from the control plane's own network position.
    let init = null;
    await probeCellBody(env, 'alligators', {
      fetchImpl: async (_url, opts) => {
        init = opts;
        return answer({ ok: true });
      },
    });
    assert.equal(init.redirect, 'manual');
  });

  it('presents the tenant’s secret when given one, and nothing when not', async () => {
    let withSecret = null;
    let without = null;
    await probeCellBody(env, 'x', {
      secret: 's3cret',
      fetchImpl: async (_u, o) => {
        withSecret = o;
        return answer({ ok: true });
      },
    });
    await probeCellBody(env, 'x', {
      fetchImpl: async (_u, o) => {
        without = o;
        return answer({ ok: true });
      },
    });
    assert.equal(withSecret.headers.authorization, 'Bearer s3cret');
    assert.equal(without.headers, undefined);
  });

  it('asks a cell not to wake only when told to (the hourly telemetry read)', async () => {
    let quiet = null;
    let waking = null;
    await probeCellBody(env, 'x', {
      wake: false,
      fetchImpl: async (_u, o) => {
        quiet = o;
        return answer({ state: 'asleep' });
      },
    });
    await probeCellBody(env, 'x', {
      fetchImpl: async (_u, o) => {
        waking = o;
        return answer({ ok: true });
      },
    });
    assert.equal(quiet.headers['x-maude-wake'], 'never');
    assert.equal(waking.headers?.['x-maude-wake'], undefined);
  });

  it('reads a sleeping cell as unknown, not as healthy', async () => {
    const res = await probeCellBody(env, 'x', {
      wake: false,
      fetchImpl: async () => answer({ state: 'asleep' }),
    });
    assert.equal(res.state, 'pending');
    assert.deepEqual(res.body, { state: 'asleep' });
  });

  it('refuses an oversized body rather than buffering it', async () => {
    // A health probe answerable with a gigabyte is a health probe that can
    // take the hourly sweep down.
    const huge = `{"ok":true,"pad":"${'x'.repeat(200)}"}`;
    const res = await probeCellBody(env, 'x', {
      maxBytes: 64,
      fetchImpl: async () => answer(huge),
    });
    assert.equal(res.body, null);
    assert.equal(res.state, 'pending');
  });

  it('refuses on a LYING content-length as well as a real overrun', async () => {
    const res = await probeCellBody(env, 'x', {
      maxBytes: 64,
      fetchImpl: async () => answer({ ok: true }, { headers: { 'content-length': '999999' } }),
    });
    assert.equal(res.body, null);
  });

  it('unparseable JSON is "we do not know", never a throw', async () => {
    const res = await probeCellBody(env, 'x', { fetchImpl: async () => answer('not json at all') });
    assert.equal(res.state, 'pending');
    assert.equal(res.body, null);
  });

  it('keeps the answer when the cell behaves', async () => {
    const res = await probeCellBody(env, 'x', {
      fetchImpl: async () => answer({ ok: true, stats: { canvases: 3 } }),
    });
    assert.equal(res.state, 'healthy');
    assert.equal(res.body.stats.canvases, 3);
  });
});
