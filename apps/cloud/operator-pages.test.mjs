// Cloud Phase 26 Stage 1 — what the operator board renders.
//
// Two things these tests are really about. First the three-valued rule: an
// em-dash where the plane has no answer, never a zero — because the zero is
// the version of this bug you cannot see. Second the leak trap: the operator
// vocabulary must not be reachable from a customer's shell, which is a real
// prior bug (project-admin.test.mjs:498) and not a hypothetical.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appShell } from './brand.mjs';
import { assembleBoard, deriveMrr } from './operator.mjs';

// The pages only RENDER the token; deriving it is the route's job (and
// operator.test.mjs's). A fixed 32-hex stand-in keeps these tests about markup.
const mintCsrf = () => 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

import {
  allOperatorHtml,
  money,
  num,
  operatorAccountsPage,
  operatorEventsPage,
  operatorOverviewPage,
  operatorProjectPage,
  operatorProjectsPage,
} from './operator-pages.mjs';

const account = { email: 'op@example.com', id: 'acct_op' };

const project = (over = {}) => ({
  id: 'alligators',
  account_id: 'acct_1',
  name: 'Brno Alligators',
  state: 'active',
  state_since: 1_700_000_000_000,
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
  created_at: 1_600_000_000_000,
  ...over,
});

const pricing = { currency: 'eur', plans: [{ id: 'project', amounts: { monthlyMinor: 1900 } }] };

/**
 * Just the rows.
 *
 * Asserting a bare `/0%/` against a whole document matches the design system's
 * own `color-mix(… 40%, transparent)`, which is how a "never render 0%" test
 * passes for the wrong reason — or, as here, fails for one.
 */
const tbody = (html) => html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));

const overview = (projects, extra = {}) =>
  operatorOverviewPage({
    account,
    board: assembleBoard({ projects, ...(extra.boardArgs ?? {}) }),
    mrr: deriveMrr(projects, pricing),
    accounts: extra.accounts ?? projects.length,
    ...extra.page,
  });

// ------------------------------------------------------- unknown is not zero

describe('an em-dash means unknown, and only unknown', () => {
  it('num renders nothing-known as an em-dash and a real zero as 0', () => {
    assert.equal(num(null), '—');
    assert.equal(num(undefined), '—');
    assert.equal(num(NaN), '—');
    assert.equal(num(0), '0', 'a measured zero is a fact and must look like one');
    assert.equal(num(42), '42');
  });

  it('money does the same, and never prints €0.00 for "we do not know"', () => {
    assert.equal(money(null), '—');
    assert.equal(money(0), '€0.00');
    assert.equal(money(1900), '€19.00');
  });

  it('the cost tile says no figure was ever collected, rather than €0', () => {
    // `costAlarms` "has simply never been given real figures" (phase-0 doc).
    // A €0 tile would read as "the platform is free to run".
    const html = overview([project()]);
    assert.match(html, /no spend figure has ever been collected/);
    assert.doesNotMatch(html, /€0\.00\/cell/);
  });

  it('a project that never reported content renders —, not 0', () => {
    const html = operatorProjectsPage({
      account,
      projects: [project({ id: 'never-reported' })],
      stats: new Map(),
    });
    assert.match(tbody(html), /—/);
    assert.doesNotMatch(tbody(html), />0</);
  });

  it('a project that reported zero canvases renders 0 — a different fact', () => {
    const html = operatorProjectsPage({
      account,
      projects: [project()],
      stats: new Map([['alligators', { canvases: 0, artboards: 0, assetsBytes: 0 }]]),
    });
    assert.match(tbody(html), />0</);
  });
});

// ------------------------------------------------------------------ overview

describe('the overview answers what an operator opens it for', () => {
  it('counts accounts and projects by state', () => {
    const html = overview([project({ id: 'a' }), project({ id: 'b', state: 'suspended' })], {
      accounts: 7,
    });
    assert.match(html, /Accounts/);
    assert.match(html, />7</);
    assert.match(html, /active 1/);
    assert.match(html, /suspended 1/);
  });

  it('labels MRR as derived and links Stripe as the authority', () => {
    // A silently D1-derived MRR drifts on every missed webhook; the label and
    // the link are what keep it from being read as revenue.
    const html = overview([project()]);
    assert.match(html, /MRR \(believed\)/);
    assert.match(html, /€19\.00/);
    assert.match(html, /Stripe is the authority/);
    assert.match(html, /dashboard\.stripe\.com/);
  });

  it('lists projects on an unpriced plan instead of summing them as zero', () => {
    const html = overview([project({ id: 'freebie', plan: 'legacy' })]);
    assert.match(html, /no price/i);
    assert.match(html, /freebie \(legacy\)/);
  });

  it('renders fleet problems grouped by kind, with counts', () => {
    const html = overview([project({ id: 'a' }), project({ id: 'b' })]);
    // Nothing has ever been restore-drilled; two projects is one line, not two.
    assert.match(html, /never-drilled/);
    assert.match(html, /<span class="n">2<\/span>/);
  });

  it('says so plainly when there is nothing to interpret', () => {
    const html = overview([]);
    assert.match(html, /Nothing to interpret/);
  });

  it('marks the cost tile as an alarm when the ratio breaks the model', () => {
    const html = overview([project()], { boardArgs: { actual: { compute: 30 } } });
    assert.match(html, /tile alarm/);
    assert.match(html, /Cost alarms/);
    assert.match(html, /per-cell-cost/);
  });

  it('shows the analytics tile only when analytics answered', () => {
    assert.doesNotMatch(overview([project()]), /Active accounts/);
    const connected = overview([project()], {
      page: { metrics: { dau: 3, wau: 8, mau: 20 } },
    });
    assert.match(connected, /Active accounts/);
    assert.match(connected, /8 this week/);
  });
});

// ------------------------------------------------------------------ projects

describe('the projects table is every project, whatever state it is in', () => {
  it('links each row to its detail page', () => {
    const html = operatorProjectsPage({ account, projects: [project()] });
    assert.match(html, /href="\/operator\/projects\/alligators"/);
  });

  it('includes the states the dashboard hides — purged is still a row', () => {
    const html = operatorProjectsPage({
      account,
      projects: [project({ id: 'gone', state: 'purged' })],
    });
    assert.match(html, /gone/);
    assert.match(html, /purged/);
  });

  it('omits the content columns entirely when no stats were fetched', () => {
    const html = operatorProjectsPage({ account, projects: [project()] });
    assert.doesNotMatch(html, /Canvases/);
  });

  it('divides the cache ratio at READ time, from the two counts', () => {
    // The invariant: never store or transport a ratio. A ratio computed over a
    // window that reset is a confident lie; two counts can be judged.
    const html = operatorProjectsPage({
      account,
      projects: [project()],
      render: new Map([
        [
          'alligators',
          {
            builds: 10,
            cacheHits: 8,
            cacheMisses: 2,
            timeouts: 1,
            memoryKills: 0,
            durationMsP95: 412.6,
          },
        ],
      ]),
    });
    assert.match(html, /80%/);
    assert.match(html, /413 ms/);
    assert.match(html, /Ceiling hits/);
  });

  it('a cell with no builds shows — for the ratio, never 0%', () => {
    const html = operatorProjectsPage({
      account,
      projects: [project()],
      render: new Map([
        [
          'alligators',
          {
            builds: 0,
            cacheHits: 0,
            cacheMisses: 0,
            timeouts: 0,
            memoryKills: 0,
            durationMsP95: null,
          },
        ],
      ]),
    });
    assert.doesNotMatch(tbody(html), /0%/);
    assert.match(tbody(html), /—/);
  });
});

// ------------------------------------------------------------------ accounts

describe('the accounts list', () => {
  it('shows who exists and how many projects they hold', () => {
    const html = operatorAccountsPage({
      account,
      accounts: [
        {
          id: 'acct_1',
          email: 'a@example.com',
          projects: 2,
          stripe_customer_id: 'cus_1',
          created_at: 0,
        },
      ],
    });
    assert.match(html, /a@example\.com/);
    assert.match(html, />2</);
  });

  it('states that reading it is itself recorded', () => {
    const html = operatorAccountsPage({ account, accounts: [] });
    assert.match(html, /recorded/i);
  });
});

// ------------------------------------------------------------- project detail

describe('the project detail page', () => {
  it('renders the audit REASON column — the column nobody displayed', () => {
    const html = operatorProjectPage({
      account,
      project: project(),
      csrf: mintCsrf(),
      entries: [
        {
          at: 0,
          actor: 'operator:op@example.com',
          action: 'operator.reconcile.nudged',
          reason: 'stuck in setup',
        },
        { at: 0, actor: 'system', action: 'reconcile', reason: null },
      ],
    });
    assert.match(html, /<th>Reason<\/th>/);
    assert.match(html, /stuck in setup/);
    // A system action has no reason, and an em-dash says so.
    assert.match(html, /—/);
  });

  it('carries the CSRF token in a hidden field and REQUIRES a reason', () => {
    const csrf = mintCsrf();
    const html = operatorProjectPage({ account, project: project(), csrf });
    assert.match(html, new RegExp(`name="csrf" value="${csrf}"`));
    assert.match(html, /<textarea[^>]*name="reason"[^>]*required/);
    assert.match(html, /maxlength="500"/);
    // A11y: the textarea is labelled, because this surface ships no script and
    // has nowhere else to put the meaning.
    assert.match(html, /<label for="reason">/);
    assert.match(html, /id="reason"/);
  });

  it('every write is a known action with the token and a required reason — and none is money', () => {
    // The surface used to offer exactly one write. It now offers the operator
    // actions too (canvas 16), so the pin is what each form must carry rather
    // than how many there are: a form that posts somewhere unlisted, or with
    // no token, or with no reason, is the regression.
    const KNOWN =
      /^\/operator\/projects\/alligators\/(reconcile|free-time|promo|promo\/end|pause|wake|move)$/;
    for (const p of [
      project(),
      { ...project(), subscription_id: null, trial_ends_at: Date.now() + 86_400_000 },
      { ...project(), subscription_id: null, promo_since: 1, promo_tier: 'project' },
      { ...project(), subscription_id: null, state: 'suspended', hold_since: 1 },
    ]) {
      const html = operatorProjectPage({ account, project: p, csrf: mintCsrf() });
      const forms = [...html.matchAll(/<form method="post" action="([^"]+)">([\s\S]*?)<\/form>/g)];
      const actions = forms.filter(([, action]) => action !== '/auth/logout');
      assert.ok(actions.length >= 1);
      for (const [, action, body] of actions) {
        assert.match(action, KNOWN, action);
        assert.match(body, /name="csrf"/, `${action} carries the token`);
        assert.match(body, /<textarea[^>]*name="reason"[^>]*required/, `${action} needs a reason`);
      }
      assert.match(html, /action="\/operator\/projects\/alligators\/reconcile"/);
      assert.match(html, /stay in Stripe/);
    }
    // A project with a paid plan is offered nothing that would disagree with it.
    const paid = operatorProjectPage({ account, project: project(), csrf: mintCsrf() });
    assert.doesNotMatch(paid, /\/free-time"|\/promo"|\/move"/);
  });

  it('distinguishes a quiet build window from a cell that just rebooted', () => {
    const html = operatorProjectPage({
      account,
      project: project(),
      csrf: mintCsrf(),
      render: {
        builds: 0,
        cacheHits: 0,
        cacheMisses: 0,
        timeouts: 0,
        memoryKills: 0,
        durationMsP95: null,
        windowStartedAt: 1_700_000_000_000,
      },
    });
    assert.match(html, /window from 2023-11-14/);
  });

  it('never renders the designs — the cell holds those', () => {
    const html = operatorProjectPage({ account, project: project(), csrf: mintCsrf() });
    assert.match(html, /not reachable from here/);
  });
});

// -------------------------------------------------------------------- events

describe('the events page degrades rather than errors', () => {
  it('an unset read token is a deployment state, not a fault', () => {
    const html = operatorEventsPage({ account, metrics: null });
    assert.match(html, /not connected/i);
    assert.match(html, /CF_ANALYTICS_TOKEN/);
    // The scope matters: this token must not be able to read anything else.
    assert.match(html, /Account Analytics Read/);
  });

  it('marks sampled counts with a ~ so an approximation never reads as exact', () => {
    const html = operatorEventsPage({
      account,
      metrics: {
        dau: 12,
        wau: 40,
        mau: 90,
        signups: 4,
        checkouts: 2,
        byName: [{ name: 'login', count: 88 }],
      },
      sampled: true,
    });
    assert.match(html, /~12/);
    assert.match(html, /~88/);
  });

  it('unsampled counts carry no tilde', () => {
    const html = operatorEventsPage({
      account,
      metrics: { dau: 12, wau: 40, mau: 90, signups: 4, checkouts: 2, byName: [] },
    });
    assert.match(html, />12</);
    assert.doesNotMatch(html, /~12/);
  });
});

// ---------------------------------------------------------------- leak traps

describe('the operator vocabulary must not reach a customer', () => {
  it('no operator page says "operator console" either', () => {
    // The trap that guards the customer surfaces guards this one too — the
    // phrase was a bad phrase, not merely a misplaced one.
    assert.doesNotMatch(allOperatorHtml(), /operator console/i);
  });

  it('a customer shell renders no fleet nav at all', () => {
    // Gated at the SHELL as well as at the route: a nav entry a customer can
    // see but not open is an invitation to try.
    const customer = appShell({
      account: { email: 'a@example.com' },
      title: 'Your projects',
      body: '',
    });
    assert.doesNotMatch(customer, /\/operator/);
    assert.doesNotMatch(customer, /Fleet/);
  });

  it('an operator shell does render it', () => {
    const op = appShell({ account, title: 'Fleet overview', body: '', isOperator: true });
    assert.match(op, /href="\/operator"/);
    assert.match(op, /All projects/);
  });

  it('every operator page escapes what it renders', () => {
    const nasty = '<script>alert(1)</script>';
    const html = operatorProjectPage({
      account,
      project: project({ name: nasty, owner_email: nasty }),
      csrf: mintCsrf(),
      entries: [{ at: 0, actor: nasty, action: nasty, reason: nasty }],
    });
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
});
