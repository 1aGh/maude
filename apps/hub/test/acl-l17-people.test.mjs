// V2-1.16 L17 — people and mentions, the hub's `/api/access/people` (S9.6).
//
// People with access to THAT canvas only; e-mails, invited and requested rows
// only to `invite` holders. A person who has B but not A is absent from A's
// list, and an A-only session asking about B hears what a missing canvas says.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { addToken } from '../src/tokens.mjs';
import { createUser } from '../src/users.mjs';
import { A, B, http, NOPE, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const q = (c) => `/api/access/people?canvas=${encodeURIComponent(c)}`;
const only = (c) => ({ v: 1, role: null, grants: [{ c, r: 'member' }] });

let dataDir;
let hub;
let t;
const as = (who) => http(hub.http, t[who]);

before(async () => {
  dataDir = tmpDir('maude-acl-l17-');
  t = seedTokens(dataDir);
  createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'max@x.test', password: PW, role: 'member' });
  createUser(dataDir, { email: 'petra@x.test', password: PW, role: 'member', access: only(A) });
  createUser(dataDir, { email: 'canary-b@x.test', password: PW, role: 'member', access: only(B) });
  // Petra's session, as the mint door would store it for a v2 client.
  t.petra = addToken(dataDir, {
    label: 'petra-v2',
    scope: '*',
    owner: 'petra@x.test',
    readOnly: true,
    access: only(A),
  }).value;
  hub = await startHub(dataDir, { rateLimit: false, rolesV2: true });
  // Pending rows the owner — and only the owner — sees.
  const owner = as('owner');
  assert.equal(
    (await owner.post('/api/access/invites', { email: 'inv-a@x.test', role: 'member', canvas: A }))
      .status,
    201
  );
  assert.equal(
    (await owner.post('/api/access/invites', { email: 'inv-b@x.test', role: 'member', canvas: B }))
      .status,
    201
  );
  assert.equal((await as('viewer').post('/api/access/requests', { canvas: A })).status, 201);
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const hasEmail = (people) => people.some((p) => 'email' in p);

describe('L17 — /api/access/people', () => {
  test('the owner: everyone on A, with e-mails, invites and requests on A', async () => {
    const r = await as('owner').get(q(A));
    assert.equal(r.status, 200, r.text);
    const emails = r.body.people.map((p) => p.email).sort();
    assert.deepEqual(emails, [
      'inv-a@x.test',
      'max@x.test',
      'olga@x.test',
      'petra@x.test',
      'vera@x.test',
    ]);
    assert.equal(r.body.people.find((p) => p.email === 'inv-a@x.test').state, 'invited');
    assert.equal(r.body.people.find((p) => p.email === 'vera@x.test').state, 'requested');
    assert.doesNotMatch(r.text, /canary-b|inv-b/);
  });

  test('a person who has B but not A is absent from A', async () => {
    for (const who of ['owner', 'member', 'petra']) {
      const r = await as(who).get(q(A));
      assert.doesNotMatch(r.text, /canary-b/i, who);
    }
  });

  test('non-owners: no e-mail, no invited, no requested rows', async () => {
    for (const who of ['member', 'viewer', 'observer', 'petra']) {
      const r = await as(who).get(q(A));
      assert.equal(r.status, 200, `${who}: ${r.text}`);
      assert.equal(hasEmail(r.body.people), false, `${who} sees an e-mail`);
      assert.doesNotMatch(r.text, /@/, `${who} sees an address`);
      assert.equal(
        r.body.people.some((p) => p.state),
        false,
        `${who} sees a pending row`
      );
      const names = r.body.people.map((p) => p.name).sort();
      assert.deepEqual(names, ['max', 'olga', 'petra'], who);
    }
  });

  test('A-only: B answers exactly as a canvas that does not exist; the project is not A', async () => {
    const b = await as('petra').get(q(B));
    const nope = await as('petra').get(q(NOPE));
    assert.equal(b.status, 403);
    assert.equal(b.text, nope.text);
    assert.equal(b.body.reason, 'not-in-scope');
    const project = await as('petra').get('/api/access/people');
    assert.equal(project.status, 403);
    assert.equal(project.text, nope.text);
  });

  test('the project list carries no canvas-only person', async () => {
    const r = await as('owner').get('/api/access/people');
    const emails = r.body.people.map((p) => p.email);
    assert.equal(emails.includes('petra@x.test'), false);
    assert.equal(emails.includes('canary-b@x.test'), false);
    assert.doesNotMatch(r.text, /inv-a|inv-b/, 'canvas invites stay on their canvas');
  });

  test('a stranger is refused', async () => {
    const r = await http(hub.http, 'nope').get(q(A));
    assert.equal(r.status, 401);
  });
});
