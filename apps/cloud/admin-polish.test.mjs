// The admin polish of 2026-11-27 (owner's round): Settings as one page of
// cards, four doors on a project, a search that answers, activity that folds,
// Needs a look that opens Fleet, and a read-only view with a way out.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { overviewPage } from './account-pages.mjs';
import { appShell } from './brand.mjs';
import { assembleBoard } from './operator.mjs';
import { operatorFleetPage, operatorSearchPage } from './operator-pages.mjs';
import { readOnlyView, viewPage } from './operator-view.mjs';
import { foldActivity, projectSettingsPage } from './project-admin.mjs';
import { markHit, searchPage } from './search.mjs';

const owner = { id: 'acct_1', email: 'ana@example.com', name: 'Ana', owns: 1 };
const project = (over = {}) => ({
  id: 'alligators',
  account_id: 'acct_1',
  name: 'Brno Alligators',
  state: 'active',
  state_since: 1_700_000_000_000,
  plan: 'project',
  subscription_id: 'sub_1',
  version: 'v1',
  cell_running: 1,
  last_checkpoint: null,
  last_restore_drill: null,
  created_at: 1_600_000_000_000,
  owner_email: 'ana@example.com',
  ...over,
});

describe('the shell', () => {
  it('a project has four doors — Open, People, Activity, Settings — and a member three', () => {
    const strip = (html) => /<nav class="ma-ptabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    const mine = strip(
      appShell({
        account: owner,
        title: 'x',
        body: '',
        project: project(),
        isOwner: true,
        active: 'billing',
      })
    );
    assert.deepEqual(
      [...mine.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]),
      ['Open', 'People', 'Activity', 'Settings']
    );
    assert.match(mine, /href="\/projects\/alligators\/settings" aria-current="page">Settings/);
    const theirs = strip(
      appShell({
        account: owner,
        title: 'x',
        body: '',
        project: project(),
        isOwner: false,
        active: 'people',
      })
    );
    assert.deepEqual(
      [...theirs.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]),
      ['Open', 'People', 'Activity']
    );
  });

  it('a door inside Settings says so above its title', () => {
    const html = appShell({
      account: owner,
      title: 'Billing',
      body: '',
      project: project(),
      isOwner: true,
      active: 'billing',
    });
    assert.match(
      html,
      /<p class="ma-crumb"><a href="\/projects">Projects<\/a> › <a href="\/projects\/alligators\/connect">Brno Alligators<\/a> › <a href="\/projects\/alligators\/settings">Settings<\/a><\/p>/
    );
    const dev = appShell({ account: owner, title: 'Devices', body: '', active: 'devices' });
    assert.match(dev, /<p class="ma-crumb"><a href="\/account">Settings<\/a><\/p>/);
  });

  it('the search field is a real GET form with no ⌘K promise — the pages ship no script', () => {
    const html = appShell({ account: owner, title: 'x', body: '', active: 'overview' });
    assert.match(html, /<form class="ma-nav-search" role="search" method="get" action="\/search">/);
    assert.doesNotMatch(html, /⌘K|<script/);
  });

  it('an entrance animation leaves no transform behind — the bulk bar stays fixed to the window', () => {
    // fill-mode both kept a transform on every card, so the position:fixed bulk
    // bar was laid out inside its (clipped) card and could not be clicked.
    const html = appShell({ account: owner, title: 'x', body: '', active: 'overview' });
    const rules = html.match(/animation:[^;}]*/g) ?? [];
    assert.ok(rules.length > 0);
    for (const r of rules) assert.doesNotMatch(r, /\bboth\b|\bforwards\b/, r);
  });

  it('pages move, nothing blocks a click while they do, and reduced motion stills it', () => {
    const html = appShell({ account: owner, title: 'x', body: '', active: 'overview' });
    assert.match(html, /@keyframes ma-rise \{ from \{ opacity: 0; top: 6px; \}/);
    // A cross-document view transition overlays the page and takes the click
    // until it finishes — in a browser that paints no frames, forever.
    assert.doesNotMatch(html, /@view-transition/);
    assert.match(
      html,
      /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important;/
    );
  });
});

describe('Settings', () => {
  it('the account is one page of cards: Account, Plans, Notifications, Devices, Your data, Delete', () => {
    const html = overviewPage({
      account: owner,
      trial: { state: 'trialing', daysLeft: 9 },
      plans: [
        {
          id: 'alligators',
          name: 'Brno Alligators',
          line: 'Cloud Project · plan chosen',
          tone: 'ok',
        },
      ],
      devices: [{ label: 'Maude on a ThinkPad', last_used_at: Date.now() }],
      mentions: true,
    });
    const cards = [...html.matchAll(/class="ma-set-h">(?:<svg[\s\S]*?<\/svg>)?([^<]+)/g)].map(
      (m) => m[1]
    );
    assert.deepEqual(cards, [
      'Account',
      'Plans',
      'Notifications',
      'Devices',
      'Your data',
      'Delete the account',
    ]);
    assert.match(html, /The account is free\. Each project you own has its own plan\./);
    assert.match(html, /href="\/projects\/alligators\/billing">Brno Alligators/);
    assert.match(html, /Maude on a ThinkPad/);
    assert.doesNotMatch(html, /Your Macs|>E-mails<|Billing and plan/);
  });

  it('a project is one page of cards too, read from the row alone', () => {
    const html = projectSettingsPage({
      account: owner,
      project: project({ mirror_repo: 'ana/design' }),
    });
    for (const card of [
      'Plan',
      'Copy to GitHub',
      'Saving',
      'Download everything',
      'Delete the project',
    ])
      assert.match(html, new RegExp(`class="ma-set-h">[\\s\\S]*?${card}`), card);
    assert.match(html, /Copied to <strong>ana\/design<\/strong>/);
    assert.match(html, /href="\/projects\/alligators\/delete"/);
  });
});

describe('search', () => {
  it('finds projects, people, invitations and settings, and marks the match', () => {
    const html = searchPage({
      account: owner,
      q: 'al',
      projects: [{ id: 'alligators', name: 'Brno Alligators', role: 'owner' }],
      people: [
        {
          account_id: 'acct_2',
          email: 'alice@example.com',
          name: 'Alice',
          projects: ['Brno Alligators'],
        },
      ],
      invites: [
        { email: 'kalina@example.com', project: 'Brno Alligators', projectId: 'alligators' },
      ],
    });
    assert.match(html, /Brno <mark>Al<\/mark>ligators/);
    assert.match(html, /<mark>Al<\/mark>ice/);
    assert.match(html, /k<mark>al<\/mark>ina@example\.com/);
    assert.match(html, /href="\/projects\/alligators\/connect"/);
  });

  it('a setting is found by the word somebody would type', () => {
    const html = searchPage({ account: owner, q: 'invoice' });
    assert.match(html, /href="\/account\/plans"/);
    assert.match(searchPage({ account: owner, q: 'windows' }), /href="\/account\/devices"/);
  });

  it('escapes what it marks', () => {
    assert.equal(markHit('<b>x</b>', 'x'), '&lt;b&gt;<mark>x</mark>&lt;/b&gt;');
  });

  it('the operator search lists accounts and projects, each opening its operator page', () => {
    const html = operatorSearchPage({
      account: { id: 'acct_op', email: 'op@example.com', operator: true },
      q: 'kol',
      accounts: [{ id: 'acct_k', email: 'jan@kolar.studio', name: 'Ateliér Kolář', projects: 2 }],
      projects: [
        { id: 'kolar-web', name: 'Kolář web', state: 'active', owner_email: 'jan@kolar.studio' },
      ],
    });
    assert.match(html, /href="\/operator\/accounts\/acct_k"/);
    assert.match(html, /href="\/operator\/projects\/kolar-web"/);
    assert.match(html, /<mark>Kol<\/mark>ář web/);
  });
});

describe('activity folds, nothing is hidden', () => {
  it('the same thing by the same hand on the same day is one row with a count', () => {
    const at = Date.UTC(2026, 10, 27, 9);
    const look = {
      actor: 'operator:op@example.com',
      action: 'operator.account.viewed-as',
      reason: null,
    };
    const rows = foldActivity([
      { ...look, at },
      { ...look, at: at - 60_000 },
      { ...look, at: at - 120_000 },
      { actor: 'customer:ana', action: 'access.invite', reason: null, at: at - 180_000 },
      { ...look, at: at - 240_000 },
      { ...look, at: at - 86_400_000 },
    ]);
    assert.deepEqual(
      rows.map((r) => [r.action, r.times ?? 1, r.at]),
      [
        ['operator.account.viewed-as', 4, at],
        ['access.invite', 1, at - 180_000],
        ['operator.account.viewed-as', 1, at - 86_400_000],
      ]
    );
  });

  it('a different reason is its own row — a reason is never folded away', () => {
    const at = Date.UTC(2026, 10, 27, 9);
    const rows = foldActivity([
      { actor: 'operator:op', action: 'operator.free-time.given', reason: 'pilot', at },
      { actor: 'operator:op', action: 'operator.free-time.given', reason: 'support', at: at - 1 },
    ]);
    assert.equal(rows.length, 2);
  });
});

describe('operator', () => {
  it('Fleet narrows to one kind of problem, from a chip or from Needs a look', () => {
    const projects = [project({ id: 'a', last_checkpoint: Date.now() }), project({ id: 'b' })];
    const board = assembleBoard({ projects });
    const html = operatorFleetPage({
      account: { id: 'op', email: 'op@x', operator: true },
      board,
      projects,
      need: 'never-drilled',
    });
    assert.match(html, /<nav class="ma-chips" aria-label="Show">/);
    assert.match(html, /href="\/operator\/fleet\?need=never-drilled" aria-current="page"/);
  });

  it('the read-only view walks every page of the owner, closed doors included, and has a way out', () => {
    for (const rest of [
      '/projects',
      '/projects/new',
      '/account/devices',
      '/projects/a/connect',
      '/projects/a/mirror',
      '/projects/a/saving',
      '/projects/a/settings',
    ])
      assert.ok(viewPage(rest), rest);
    const html = readOnlyView(
      '<style></style><main class="ma-main"><a href="/account">x</a><form class="ma-nav-search" action="/search"><input name="q"></form></main>',
      {
        email: 'jan@kolar.studio',
        base: '/operator/accounts/acct_k/view',
        exit: '/operator/accounts/acct_k',
      }
    );
    assert.match(
      html,
      /<a class="ro-exit" href="\/operator\/accounts\/acct_k">Leave this view<\/a>/
    );
    assert.match(html, /href="\/operator\/accounts\/acct_k\/view\/account"/);
    assert.match(html, /<div class="ma-nav-search"><input disabled name="q">/);
    assert.doesNotMatch(html, /<form/);
  });
});
