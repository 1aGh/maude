// The self-hosted invite door's words — Maude v2 S9.14 (CONTRACT §3–§4).
//
// A self-hosted hub is a "project" to the person who was invited, never a
// "workspace"; the page names no protocol and never says "we".

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { joinPage } from '../src/join-page.mjs';

const visible = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

// The shared provider button (studio-door.mjs `oidcButton`) names the issuer's
// host when one is configured; its own fallback wording is not this page's.
const CASES = [
  { token: 't', workspace: 'https://design.acme.com/', email: 'a@acme.com', env: {} },
  { token: 't', workspace: null, email: null, env: {} },
  {
    token: 't',
    workspace: 'https://design.acme.com/',
    email: 'a@acme.com',
    env: { HUB_OIDC_MODE: 'strict', HUB_OIDC_ISSUER: 'https://login.acme.com' },
  },
  {
    token: 't',
    workspace: null,
    email: 'a@acme.com',
    env: { HUB_OIDC_MODE: 'strict', HUB_OIDC_ISSUER: 'https://login.acme.com' },
  },
];

test('the join page never says "workspace", "identity provider" or "we"', () => {
  for (const c of CASES) {
    const text = visible(joinPage(c));
    assert.doesNotMatch(text, /\bworkspace\b/i, JSON.stringify(c));
    assert.doesNotMatch(text, /identity provider/i, JSON.stringify(c));
    assert.doesNotMatch(text, /\b[Ww]e(?:’|'|\b)/, JSON.stringify(c));
    assert.doesNotMatch(text, /!/, JSON.stringify(c));
  }
});

test('with no hub address the page names "this project", capitalised where a sentence starts', () => {
  const strict = visible(
    joinPage({ token: 't', workspace: null, email: null, env: { HUB_OIDC_MODE: 'strict' } })
  );
  assert.match(strict, /You're invited to this project/);
  assert.match(strict, /This project signs people in through its own sign-in page\./);
});
