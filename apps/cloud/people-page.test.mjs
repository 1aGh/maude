// Cloud Phase 22 Task 5 — the people panel.
//
// Adding somebody is a form. Removing them is the part that has to be honest,
// because "Remove" reads as instantaneous and is not.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allPeopleHtml, peoplePage, removeConfirmPage } from './people-page.mjs';

const project = { id: 'alligators', name: 'Brno Alligators' };
const people = [
  { account_id: 'a1', email: 'owner@example.com', role: 'owner' },
  { account_id: 'a2', email: 'member@example.com', role: 'member' },
];

describe('the removal confirmation is honest about timing', () => {
  it('says how long an open project keeps working', () => {
    // The whole reason this page exists as a confirmation rather than a
    // one-click action. An admin who thinks removal is instant makes a
    // decision they would not otherwise make.
    const html = removeConfirmPage({
      project,
      person: people[1],
      tokenTtlMs: 12 * 3_600_000,
    });
    assert.match(html, /Remove member@example\.com\?/);
    assert.match(html, /keeps working for up to 12 hours/);
    assert.match(html, /no longer open the project/);
  });

  it('offers the urgent answer instead of burying it', () => {
    const html = removeConfirmPage({ project, person: people[1], tokenTtlMs: 3_600_000 });
    assert.match(html, /pause the project/);
    assert.match(html, /stops working within the hour/);
  });

  it('offers a way out of the confirmation', () => {
    const html = removeConfirmPage({ project, person: people[1], tokenTtlMs: 3_600_000 });
    assert.match(html, />Cancel</);
  });
});

describe('the owner is not something you can edit here', () => {
  it('shows no controls at all for the owner row', () => {
    // Not disabled controls — a disabled button invites somebody to go hunting
    // for the way to enable it.
    const html = peoplePage({ project, people, isOwner: true });
    const ownerRow = html.split('<tr>').find((r) => r.includes('owner@example.com'));
    assert.ok(!/<button/.test(ownerRow), 'the owner row must carry no buttons');
    assert.ok(!/<select/.test(ownerRow));
  });

  it('never offers "owner" as a role you can assign', () => {
    // Handing the project over is a transfer, not a role change — and doing it
    // here would leave a project with nobody who can pay for it.
    const html = peoplePage({ project, people, isOwner: true });
    assert.ok(!/<option value="owner"/.test(html));
    assert.match(html, /<option value="member"/);
    assert.match(html, /<option value="viewer"/);
  });
});

describe('a non-owner sees the truth, not a broken form', () => {
  it('gets no management controls and is told why', () => {
    // The SHELL chrome (Sign out) is allowed; the people panel's own
    // controls — invite, role save, remove — must be absent entirely.
    const html = peoplePage({ project, people, isOwner: false });
    assert.ok(!/Remove…/.test(html));
    assert.ok(!/value="invite"/.test(html));
    assert.ok(!/value="role"/.test(html));
    assert.ok(!/<select/.test(html));
    assert.match(html, /Only the project’s owner can add or remove people/);
  });
});

describe('roles are explained, not just named', () => {
  it('says what each role can actually do', () => {
    // "viewer" is a word we chose. What somebody needs to know is whether that
    // person can change their work.
    const html = peoplePage({ project, people, isOwner: true });
    assert.match(
      html,
      /<strong>Can edit<\/strong> <span class="quiet">Change the designs, comment and download\./
    );
    assert.match(
      html,
      /<strong>Owner<\/strong> <span class="quiet">Everything, plus billing, people and deleting/
    );
  });
});

describe('copy and safety', () => {
  it('escapes an email rather than trusting it', () => {
    const html = peoplePage({
      project,
      people: [{ account_id: 'x', email: '<img src=x onerror=alert(1)>', role: 'member' }],
      isOwner: true,
    });
    assert.ok(!/<img/.test(html));
    assert.match(html, /&lt;img/);
  });

  // Cloud Phase 24 A12a. The select rendered bare single words, which asks the
  // inviter to already know a vocabulary we invented. With no script on the
  // page, the option text is the only place the meaning can appear at the
  // moment of the decision.
  it('the role dropdown says what each role means while it is being chosen', () => {
    const html = peoplePage({ project, people: [], isOwner: true });
    assert.match(html, /<option value="member"[^>]*>Can edit — change the designs<\/option>/);
    assert.match(
      html,
      /<option value="viewer"[^>]*>Can comment — look, comment and download<\/option>/
    );
    assert.match(html, /<option value="observer"[^>]*>Can view — look only<\/option>/);
    assert.doesNotMatch(html, /<option value="member"[^>]*>member<\/option>/);
  });

  it('ships no script', () => {
    const html = allPeopleHtml();
    assert.ok(!/<script/i.test(html));
    assert.ok(!/\son[a-z]+\s*=/i.test(html));
  });

  it('uses no vocabulary of ours', () => {
    const html = allPeopleHtml();
    for (const jargon of ['tenant', 'cell', 'token', 'revoke', 'session', 'container']) {
      assert.ok(
        !new RegExp(`\\b${jargon}`, 'i').test(html),
        `"${jargon}" leaked into the people panel`
      );
    }
  });
});

// Maude v2 S9.16 — v2 role words, who sees an address, grants and invitations.
describe('S9.16: the v2 people panel', () => {
  const team = [
    { account_id: 'a1', email: 'ana@example.com', name: 'Ana', role: 'owner' },
    { account_id: 'a2', email: 'tereza@example.com', name: 'Tereza', role: 'member' },
    { account_id: 'a3', email: 'jonas@example.com', name: null, role: 'viewer' },
    { account_id: 'a4', email: 'olga@example.com', name: 'Olga', role: 'observer' },
  ];
  const grants = [
    {
      account_id: 'a5',
      email: 'grant@example.com',
      name: 'Petr',
      role: 'viewer',
      canvas_path: 'ui/Pricing.tsx',
    },
  ];
  const invites = [
    {
      email: 'pending@example.com',
      role: 'member',
      canvas_path: null,
      expires_at: Date.UTC(2026, 9, 20),
    },
    {
      email: 'canvas@example.com',
      role: 'observer',
      canvas_path: 'ui/Homepage.tsx',
      expires_at: Date.UTC(2026, 9, 20),
    },
  ];
  const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

  it('draws the four v2 words, never a wire id', () => {
    const html = peoplePage({
      account: { id: 'a1' },
      project,
      people: team,
      grants,
      invites,
      isOwner: true,
    });
    for (const word of ['Owner', 'Can edit', 'Can comment', 'Can view']) {
      assert.ok(html.includes(`<strong>${word}</strong>`), word);
    }
    assert.doesNotMatch(text(html), /\b(observer|viewer|member)\b/);
  });

  it('a non-owner sees names and role words only — no address, no invitation', () => {
    const html = peoplePage({
      account: { id: 'a2' },
      project,
      people: team,
      grants,
      invites,
      isOwner: false,
    });
    assert.doesNotMatch(html, /@example\.com/, 'no one else’s address reaches a non-owner');
    assert.match(html, /<td>You<\/td>/, 'the signed-in person is You');
    assert.match(html, /<td>Ana<\/td>/);
    assert.match(html, /No name yet/, 'a person with no name is not shown by address');
    assert.match(
      html,
      /<td>Petr<\/td><td><strong>Can comment<\/strong> <span class="quiet">on Pricing only/
    );
    assert.doesNotMatch(html, /not joined yet/);
  });

  it('the owner sees addresses, canvas grants and pending invitations with their words', () => {
    const html = peoplePage({
      account: { id: 'a1' },
      project,
      people: team,
      grants,
      invites,
      isOwner: true,
    });
    assert.match(html, /Tereza <span class="quiet">tereza@example\.com<\/span>/);
    assert.match(html, /grant@example\.com/);
    assert.match(
      html,
      /pending@example\.com<\/td><td><strong>Can edit<\/strong> <span class="quiet">· not joined yet · the link works until 20 Oct/
    );
    assert.match(html, /canvas@example\.com<\/td><td><strong>Can view<\/strong> on Homepage/);
  });

  it('Make owner stays hidden (lead decision v2-lead-make-owner-hidden)', () => {
    const html = peoplePage({
      account: { id: 'a1' },
      project,
      people: team,
      grants,
      invites,
      isOwner: true,
    });
    assert.doesNotMatch(html, /Make owner|value="owner"/);
  });

  it('escapes names as it escapes addresses', () => {
    const html = peoplePage({
      account: { id: 'a1' },
      project,
      people: [{ account_id: 'x', email: 'x@example.com', name: '<b>x</b>', role: 'member' }],
      isOwner: false,
    });
    assert.ok(!/<b>x<\/b>/.test(html));
  });
});
