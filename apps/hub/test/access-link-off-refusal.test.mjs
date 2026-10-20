// S9.21d — a plain-browser viewer on a cell learns "link turned off" from the
// refusal (decision v2-lead-browser-link-off-via-refusal).
//
// Access notices reach desktop shells only (S9.21b), so a browser tab learns
// nothing until its next request. That request carries the session cookie of
// a session the notice just ended; the cell's door answers 401 with a reason
// the browser shell maps through `accessOutcome()`:
//
//   - `ended` + `link-off`  → reason `link-off` (the link card)
//   - `ended` + anything    → reason `access-withdrawn` (`expired` stays itself)
//   - `narrowed`            → no reason: they still have access, they sign in again
//
// No oracle: the reason is told only to a cookie whose OWN session the notice
// ended — an unknown, forged or somebody else's cookie, and every live
// session (a canvas-only one included), get exactly today's answer.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  endedRefusalReason,
  endedSessionReason,
  rememberEndedSessions,
  resetEndedSessions,
} from '../src/ended-sessions.mjs';
import { signInRefusal } from '../src/studio-door.mjs';
import { addToken, listTokensForOwner } from '../src/tokens.mjs';
import { rm, seedTokens, sleep, startHub, tmpDir, until } from './_acl-docs-fixture.mjs';

const GRACE = 300;

describe('the ended-session memo', () => {
  let dataDir;
  beforeEach(() => {
    resetEndedSessions();
    dataDir = tmpDir('maude-ended-sessions-');
  });
  after(() => rm(dataDir));

  test('a notice reason becomes the refusal reason; narrowing has none', () => {
    assert.equal(endedRefusalReason('link-off'), 'link-off');
    assert.equal(endedRefusalReason('removed'), 'access-withdrawn');
    assert.equal(endedRefusalReason(undefined), 'access-withdrawn');
    assert.equal(endedRefusalReason('expired'), 'expired');
    assert.equal(endedRefusalReason('<script>'), 'access-withdrawn');
  });

  test('only the ended person’s own cookies hear the reason', () => {
    const mine = addToken(dataDir, { label: 'studio-a', owner: 'ada@x.test', scope: '*' }).value;
    const mine2 = addToken(dataDir, { label: 'studio-b', owner: 'ada@x.test', scope: '*' }).value;
    const theirs = addToken(dataDir, { label: 'studio-c', owner: 'cy@x.test', scope: '*' }).value;
    assert.equal(rememberEndedSessions(dataDir, 'ADA@x.test', 'link-off'), 2);
    assert.equal(endedSessionReason(dataDir, mine), 'link-off');
    assert.equal(endedSessionReason(dataDir, mine2), 'link-off');
    assert.equal(endedSessionReason(dataDir, theirs), null, 'somebody else’s cookie');
    assert.equal(endedSessionReason(dataDir, `${mine}x`), null, 'a forged cookie');
    assert.equal(endedSessionReason(dataDir, ''), null);
    assert.equal(endedSessionReason(dataDir, null), null);
  });

  test('the memo dies with the session it names', () => {
    const now = 1_700_000_000_000;
    const v = addToken(dataDir, {
      label: 'studio-short',
      owner: 'ada@x.test',
      scope: '*',
      expiresAt: Date.now() + 60_000,
    }).value;
    rememberEndedSessions(dataDir, 'ada@x.test', 'removed', Date.now());
    assert.equal(endedSessionReason(dataDir, v), 'access-withdrawn');
    assert.equal(endedSessionReason(dataDir, v, Date.now() + 61_000), null, 'past its expiry');
    // A token with no expiry is remembered no longer than a browser session lives.
    const w = addToken(dataDir, { label: 'studio-long', owner: 'bo@x.test', scope: '*' }).value;
    rememberEndedSessions(dataDir, 'bo@x.test', 'link-off', now);
    assert.equal(endedSessionReason(dataDir, w, now + 1000), 'link-off');
    assert.equal(endedSessionReason(dataDir, w, now + 13 * 3600_000), null);
  });

  test('the door’s 401 carries the reason only when there is one', () => {
    assert.deepEqual(signInRefusal(null), { error: 'sign in to open this project' });
    assert.deepEqual(signInRefusal('link-off'), {
      error: 'sign in to open this project',
      reason: 'link-off',
    });
    assert.deepEqual(signInRefusal('anything-else'), { error: 'sign in to open this project' });
  });

  test('the studio door answers its 401 through the memo (source pin)', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/server.mjs', import.meta.url)), 'utf8');
    assert.match(
      src,
      /respondJson\(\s*response,\s*401,\s*signInRefusal\(\s*endedSessionReason\(\s*dataDir,\s*cookieValue\(request, BROWSER_SESSION_COOKIE\)\s*\)\s*\)\s*\)/,
      'the API 401 of the studio door reads the ended-session memo'
    );
    assert.doesNotMatch(
      src,
      /respondJson\(response, 401, \{ error: 'sign in to open this project' \}\)/
    );
  });
});

describe('a notice ends the session and leaves the reason behind', () => {
  let dataDir;
  let hub;
  let t;
  before(async () => {
    resetEndedSessions();
    dataDir = tmpDir('maude-link-off-refusal-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false, switchGraceMs: GRACE });
  });
  after(async () => {
    await hub?.close();
    rm(dataDir);
  });

  const changed = (body) =>
    fetch(`${hub.http}/internal/access-changed`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('link turned off: a canvas-only viewer’s dead cookie says link-off', async () => {
    const r = await changed({ email: 'ada@x.test', change: 'ended', reason: 'link-off' });
    assert.equal(r.status, 202);
    await until(
      () => listTokensForOwner(dataDir, 'ada@x.test').length === 0,
      GRACE + 3000,
      'her session ends after the grace'
    );
    assert.equal(endedSessionReason(dataDir, t.aView), 'link-off');
    assert.equal(endedSessionReason(dataDir, t.aComment), null, 'cyril heard nothing');
  });

  test('removed: access-withdrawn; narrowed: no reason at all', async () => {
    assert.equal(
      (await changed({ email: 'max@x.test', change: 'ended', reason: 'removed' })).status,
      202
    );
    assert.equal(
      (await changed({ email: 'cyril@x.test', change: 'narrowed', reason: 'link-off' })).status,
      202
    );
    await until(
      () =>
        listTokensForOwner(dataDir, 'max@x.test').length === 0 &&
        listTokensForOwner(dataDir, 'cyril@x.test').length === 0,
      GRACE + 3000,
      'both sessions end'
    );
    assert.equal(endedSessionReason(dataDir, t.member), 'access-withdrawn');
    assert.equal(endedSessionReason(dataDir, t.aComment), null, 'narrowed signs in again');
  });

  test('raised never leaves a reason', async () => {
    assert.equal((await changed({ email: 'olga@x.test', change: 'raised' })).status, 202);
    await sleep(GRACE + 200);
    assert.equal(endedSessionReason(dataDir, t.owner), null);
  });
});
