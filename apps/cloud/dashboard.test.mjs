// Cloud Phase 22 — the one place (DDR-204).
//
// This is the page somebody opens when something is wrong, so the tests are
// about whether it tells the truth in the states people actually panic in.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allDashboardHtml, dashboardPage, STATE_COPY } from './dashboard.mjs';
import { can } from './project-access.mjs';

const account = { email: 'a@example.com' };
const project = (over = {}) => ({
  id: 'alligators',
  name: 'Brno Alligators',
  state: 'active',
  role: 'owner',
  ...over,
});
const render = (projects, capable = can) => dashboardPage({ account, projects, can: capable });

describe('every project state says what is true and what to do', () => {
  it('covers every state the database allows', () => {
    // A state with no copy renders its raw name — `past_due` is an accounting
    // word and `suspended` sounds like a punishment.
    for (const state of ['pending', 'active', 'past_due', 'suspended', 'exported', 'purged']) {
      assert.ok(STATE_COPY[state], `no copy for ${state}`);
    }
  });

  it('a payment problem does not imply the work is at risk', () => {
    // The fear on seeing a billing warning is "have I lost my designs". Answer
    // it in the same sentence.
    const html = render([project({ state: 'past_due' })]);
    assert.match(html, /Your work is safe/);
    assert.match(html, /keeps running/);
  });

  it('a paused project says nothing was deleted, and offers the way out', () => {
    const html = render([project({ state: 'suspended' })]);
    assert.match(html, /Nothing has been deleted/);
    assert.match(html, /Download everything/);
  });

  it('a deleted project does not pretend it can be recovered', () => {
    const html = render([project({ state: 'purged' })]);
    assert.match(html, /was deleted/);
    assert.match(html, /that copy is still yours/);
    assert.ok(!/>Open</.test(html), 'nothing to open');
  });
});

describe('leaving is always offered', () => {
  it('download is present in EVERY state, including the unhappy ones', () => {
    // An export you can only reach while everything is fine is not a
    // guarantee. These are exactly the states somebody is deciding in.
    for (const state of ['pending', 'active', 'past_due', 'suspended', 'exported', 'purged']) {
      assert.match(render([project({ state })]), /Download everything/, state);
    }
  });

  it('the footer promises it in words, not only as a link', () => {
    assert.match(render([project()]), /including after you stop paying/);
  });
});

describe('the menu never shows what it will then refuse', () => {
  it('a viewer sees no billing, people or sharing', () => {
    // A menu that shows everything and then refuses teaches people that the
    // interface lies.
    const html = render([project({ role: 'viewer' })]);
    assert.ok(!/Billing/.test(html));
    assert.ok(!/>People</.test(html));
    assert.ok(!/Sharing/.test(html));
    assert.match(html, />Open</);
  });

  it('an owner sees all of them', () => {
    // "Sharing" is deliberately absent everywhere: there is no sharing
    // settings surface yet, and a dead link is the menu lying politely.
    const html = render([project({ role: 'owner' })]);
    // The project's four doors, then Download and Delete (owner, 2026-11-27);
    // Billing and the GitHub copy live on the project's Settings.
    for (const label of [
      'People',
      'Open',
      'Activity',
      'Settings',
      'Download everything',
      'Delete project',
    ]) {
      assert.match(html, new RegExp(`>${label}`), label);
    }
  });
});

describe('an empty account is not an error', () => {
  it('explains what a project is instead of showing a void', () => {
    const html = render([]);
    assert.match(html, /No projects yet/);
    assert.match(html, /one design system and the work around it/);
    assert.match(html, /Start a project/);
  });
});

describe('copy discipline', () => {
  it("never uses our vocabulary for the customer's things", () => {
    const html = allDashboardHtml();
    for (const jargon of [
      'tenant',
      'cell',
      'container',
      'R2',
      'webhook',
      'reconcil',
      'purge',
      'provision',
    ]) {
      assert.ok(
        !new RegExp(`\\b${jargon}`, 'i').test(html),
        `"${jargon}" leaked into the dashboard`
      );
    }
  });

  it('ships no script, so it still works when everything else is broken', () => {
    // This is the page somebody opens BECAUSE something is wrong.
    const html = allDashboardHtml();
    assert.ok(!/<script/i.test(html));
    assert.ok(!/\son[a-z]+\s*=/i.test(html));
  });

  it('escapes a project name rather than trusting it', () => {
    const html = render([project({ name: '<img src=x onerror=alert(1)>' })]);
    assert.ok(!/<img/.test(html));
    assert.match(html, /&lt;img/);
  });
});

// Cloud Phase 26 follow-up — the fleet had no door.
//
// `appShell` grew an `isOperator` flag, and for a while `operator-pages.mjs`
// was the only module that ever set it: the Fleet nav appeared once you were
// already inside /operator, which meant the only way in was typing the URL.
// The dashboard is where a signed-in person starts, so this is where the way
// in belongs — and nowhere else on a customer surface.
describe('the fleet has exactly one door, on the dashboard', () => {
  it('offers the operator the way in', () => {
    const html = dashboardPage({ account, projects: [], can, isOperator: true });
    assert.match(html, /href="\/operator"/);
    assert.match(html, /Fleet/);
  });

  it('is absent by default, so every other caller is unchanged', () => {
    // project-admin, people-page, checkout and device-auth all render the
    // shell without the flag. Defaulting to false is what keeps their pages
    // byte-identical, and a customer's dashboard identical to a customer's.
    const html = dashboardPage({ account, projects: [], can });
    assert.doesNotMatch(html, /\/operator/);
    assert.doesNotMatch(html, /Fleet/);
  });

  it('shows a customer nothing, even one holding a project', () => {
    const html = render([project()]);
    assert.doesNotMatch(html, /\/operator/);
    assert.doesNotMatch(html, /Fleet/);
  });
});
