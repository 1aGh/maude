// gate-b-sec3b — the join page and an account holder.
//
// Since gate-b-sec3 an existing account accepts an invitation addressed to it by signing in on /join (the form's
// password field). The page used to read as sign-up only ("Choose a password"); it now says an account holder
// enters the password they already have — one page for everybody, so it still says nothing about whether the address
// has an account. An open link stays a sign-up door and keeps its sign-up words.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { joinPage } from '../src/join-page.mjs';
import { createUser } from '../src/users.mjs';
import { http, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const visible = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');

describe('joinPage words', () => {
  test('a page for a named address tells an account holder to enter their password', () => {
    const text = visible(
      joinPage({ token: 't', workspace: 'https://design.acme.com/', email: 'a@acme.com', env: {} })
    );
    assert.match(text, /Already have an account on this project\? Enter its password instead\./);
    assert.match(text, /Choose a password and you're in/);
    assert.doesNotMatch(text, /\bworkspace\b/i);
    assert.doesNotMatch(text, /!/);
  });

  test('an open link is a sign-up door and keeps its sign-up words', () => {
    const text = visible(joinPage({ token: 't', workspace: null, email: null, env: {} }));
    assert.doesNotMatch(text, /Already have an account/);
    assert.match(text, /Choose a password/);
  });

  test('the page is the same for every address: it never branches on an account', () => {
    const a = joinPage({ token: 't', workspace: null, email: 'a@acme.com', env: {} });
    const b = joinPage({ token: 't', workspace: null, email: 'a@acme.com', env: {} });
    assert.equal(a, b);
  });
});

describe('POST /join from the page, a wrong password for an existing account', () => {
  let dataDir;
  let hub;
  let owner;
  before(async () => {
    dataDir = tmpDir('maude-join-holder-');
    const t = seedTokens(dataDir);
    createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
    createUser(dataDir, { email: 'bob@x.test', password: PW, role: 'member' });
    hub = await startHub(dataDir, { rateLimit: false });
    owner = http(hub.http, t.owner);
  });
  after(async () => {
    await hub.close();
    rm(dataDir);
  });

  const form = (token, email, password) =>
    fetch(`${hub.http}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-maude-access': '2' },
      body: new URLSearchParams({ token, email, password }).toString(),
    });

  test('the form comes back pointing at the password, not at a sign-in page', async () => {
    const add = await owner.post('/api/access/invites', { email: 'bob@x.test', role: 'member' });
    assert.equal(add.status, 201);
    const value = add.body.url.split('/join/')[1];
    const r = await form(value, 'bob@x.test', 'not the password at all');
    assert.equal(r.status, 400);
    const text = visible(await r.text());
    assert.match(text, /can't be used with this invitation/);
    assert.match(text, /If you already have an account on this project, enter its password\./);
    assert.doesNotMatch(text, /Sign in if you already have an account/);
  });
});
