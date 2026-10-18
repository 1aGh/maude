// Cloud Phase 26 Stage 2 — the event vocabulary.
//
// The privacy notice makes a specific, checkable promise: an event is a name,
// an account id and a timestamp, and it never carries an email address or
// anything from inside a design. These tests are what makes that a property of
// the code rather than a description of somebody's intentions.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BLOB, EVENTS, normalizeRoute, ROUTES, toDataPoint, validateEvent } from './events.mjs';

const ok = (event) => {
  const verdict = validateEvent(event);
  assert.equal(verdict.ok, true, verdict.error);
  return toDataPoint(event);
};
const rejects = (event, match) => {
  const verdict = validateEvent(event);
  assert.equal(verdict.ok, false, `expected a refusal, got ${JSON.stringify(event)}`);
  if (match) assert.match(verdict.error, match);
};

// ------------------------------------------------------------- the promise

describe('an email address cannot reach a blob', () => {
  it('refuses an email in accountId, however plausible the call site', () => {
    // The one check the published notice depends on. Everything else in this
    // file is hygiene; this is the sentence.
    rejects(
      { name: 'login', accountId: 'a@example.com', props: { method: 'password' } },
      /account id/
    );
    rejects({ name: 'login', accountId: 'customer:a@example.com', props: { method: 'password' } });
    rejects({ name: 'login', accountId: 'acct_1@evil', props: { method: 'password' } });
  });

  it('accepts the real shape, and treats absent as anonymous rather than invalid', () => {
    // A signed-out page view is a real event with no account attached.
    ok({ name: 'login', accountId: 'acct_abc123', props: { method: 'password' } });
    ok({ name: 'page_view', props: { route: '/login' } });
    ok({ name: 'page_view', accountId: null, props: { route: '/login' } });
  });

  it('refuses a projectId that is not a tenant id', () => {
    rejects({ name: 'invite_created', projectId: '../../etc/passwd' }, /project id/);
    rejects({ name: 'invite_created', projectId: 'Alligators' }, /project id/);
    ok({ name: 'invite_created', projectId: 'brno-alligators' });
  });

  it('no blob can carry free text — every property is a closed set', () => {
    // Not "should not be free text". Cannot be: a value outside the declared
    // set is refused, so a customer's own words have no path in.
    rejects({ name: 'login', props: { method: 'magic-link' } }, /is not a value of "method"/);
    rejects({ name: 'login', props: { method: 'my search query' } });
    rejects({ name: 'login', props: { method: '<script>alert(1)</script>' } });
  });

  it('every declared property in every event is an enum, with no escape hatch', () => {
    // Structural: a future event declaring an open property would pass its own
    // tests and quietly widen what leaves this machine.
    for (const [name, spec] of Object.entries(EVENTS)) {
      for (const [key, allowed] of Object.entries(spec.props ?? {})) {
        assert.ok(
          Array.isArray(allowed) && allowed.length > 0,
          `${name}.${key} is not a closed set`
        );
        for (const value of allowed) {
          assert.equal(typeof value, 'string', `${name}.${key} allows a non-string`);
        }
      }
    }
  });
});

// ---------------------------------------------------------------- validation

describe('validateEvent', () => {
  it('refuses an event nobody declared', () => {
    rejects({ name: 'user_typed_something' }, /unknown event/);
    rejects({}, /unknown event/);
    rejects(null, /not an event/);
    rejects('login', /not an event/);
  });

  it('refuses a property nobody declared', () => {
    rejects({ name: 'invite_created', props: { email: 'a@example.com' } }, /unknown property/);
  });

  it('refuses a MISSING declared property', () => {
    // A blob that is sometimes present and sometimes not makes every query
    // over it quietly wrong.
    rejects({ name: 'login', props: {} }, /missing property "method"/);
    rejects({ name: 'login' }, /missing property "method"/);
  });

  it('refuses a measure that is not a number', () => {
    rejects(
      { name: 'tenant_stats', projectId: 'x', measures: { canvases: 'lots' } },
      /is not a number/
    );
    ok({ name: 'tenant_stats', projectId: 'x', measures: { canvases: 12 } });
  });

  it('reports rather than throws — a bad event must never fail a request', () => {
    assert.doesNotThrow(() => validateEvent(undefined));
    assert.equal(validateEvent(undefined).ok, false);
  });
});

// -------------------------------------------------------------------- routes

describe('a page view names a route TEMPLATE, never a URL', () => {
  it('collapses a project id into :id', () => {
    assert.equal(normalizeRoute('/projects/alligators'), '/projects/:id');
    assert.equal(normalizeRoute('/projects/alligators/billing'), '/projects/:id/billing');
    assert.equal(normalizeRoute('/projects/alligators/audit'), '/projects/:id/audit');
  });

  it('collapses every operator path to one entry', () => {
    assert.equal(normalizeRoute('/operator'), '/operator');
    assert.equal(normalizeRoute('/operator/projects/alligators'), '/operator');
  });

  it('names the five account pages (S9.16), not "other"', () => {
    for (const leaf of ['people', 'billing', 'macs', 'download', 'delete'])
      assert.equal(normalizeRoute(`/account/${leaf}`), `/account/${leaf}`);
    assert.equal(normalizeRoute('/account/people/extra'), 'other');
  });

  it('drops the query string, which is where a search term would live', () => {
    assert.equal(normalizeRoute('/login?next=/projects/secret-thing'), '/login');
  });

  it('anything unrecognised is "other", never passed through', () => {
    // The default IS the safety property. A path that survives normalization
    // is a path that can one day carry a token.
    assert.equal(normalizeRoute('/some/new/surface'), 'other');
    assert.equal(normalizeRoute('/reset?token=deadbeef'), 'other');
    assert.equal(normalizeRoute('/projects/alligators/download/file'), 'other');
    assert.equal(normalizeRoute(''), '/');
    assert.equal(normalizeRoute(undefined), '/');
  });

  it('normalizes to something the vocabulary actually accepts', () => {
    for (const path of [
      '/',
      '/login',
      '/projects/x',
      '/projects/x/people',
      '/invites/abc_DEF-1',
      '/operator/accounts',
      '/nonsense',
    ]) {
      const route = normalizeRoute(path);
      assert.ok(ROUTES.includes(route), `${path} → ${route}`);
      ok({ name: 'page_view', props: { route } });
    }
  });
});

// ----------------------------------------------------------------- datapoint

describe('toDataPoint', () => {
  it('indexes on the event name — the dimension every query starts from', () => {
    const dp = ok({ name: 'signup', accountId: 'acct_1', props: { method: 'google' } });
    assert.deepEqual(dp.indexes, ['signup']);
  });

  it('puts the identifiers in a FIXED positional order', () => {
    // AE has no column names: blob1 means "account id" forever. Reordering
    // silently rewrites history, which is why the order lives in one place.
    const dp = ok({
      name: 'checkout_started',
      accountId: 'acct_1',
      projectId: 'alligators',
      props: { plan: 'project', interval: 'monthly' },
    });
    assert.deepEqual(dp.blobs, ['acct_1', 'alligators', 'project', 'monthly']);
    assert.equal(BLOB.accountId, 'blob1');
    assert.equal(BLOB.projectId, 'blob2');
  });

  it('a completed checkout names no interval, because the plane records none', () => {
    // `projects` has a plan column and no billing interval. Emitting one would
    // be inventing it, which is the failure this whole phase is written
    // against — an estimate that stops looking like one.
    assert.equal(EVENTS.checkout_completed.props.interval, undefined);
    rejects({ name: 'checkout_completed', props: { plan: 'project', interval: 'monthly' } });
    assert.deepEqual(
      ok({ name: 'checkout_completed', accountId: 'acct_1', props: { plan: 'project' } }).blobs,
      ['acct_1', '', 'project']
    );
  });

  it('a countable event carries the count 1, so a chart is a sum', () => {
    assert.deepEqual(ok({ name: 'invite_redeemed' }).doubles, [1]);
  });

  it('a measured event carries its named measures in declared order', () => {
    const dp = ok({
      name: 'tenant_stats',
      projectId: 'alligators',
      measures: { canvases: 12, artboards: 40, designSystems: 2, assetsBytes: 900 },
    });
    assert.deepEqual(dp.doubles, [12, 40, 2, 900]);
  });

  it('an absent measure is null, so "did not report" survives to the board', () => {
    // The whole three-valued rule, at the wire. A 0 here would make an image
    // that predates the counter indistinguishable from a quiet one.
    const dp = ok({ name: 'tenant_stats', projectId: 'x', measures: { canvases: 3 } });
    assert.deepEqual(dp.doubles, [3, null, null, null]);
  });

  it('carries the render window start alongside the counters', () => {
    // A row of zeroes from a cell that rebooted a minute ago is not the same
    // fact as a quiet hour, and only this field can tell them apart.
    assert.ok(EVENTS.tenant_render.doubles.includes('windowStartedAt'));
  });

  it('never emits a blob the event did not declare', () => {
    const dp = toDataPoint({
      name: 'invite_created',
      accountId: 'acct_1',
      props: { smuggled: 'a@example.com' },
    });
    assert.deepEqual(dp.blobs, ['acct_1', '']);
  });
});
