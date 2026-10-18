// S9.13 — the votes routes per role (contract S4-S9-votes-comments.md §2.3, §2.6
// "Per role"). A real hub; every role the fixture mints.
//
//   observer (Can view)  → 403 on ballot, start, end
//   viewer (Can comment) → ballot 200; start / end 403
//   member / owner       → all 200
//   canvas-only on A     → B's vote answers exactly as a missing one; A's is 200
//   a forged `voter` in the body is ignored
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { A, B, http, NOPE, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const V = '/api/projects/local/v1/votes';
const C = 'ui/Gamma.tsx';
const TARGETS = ['ab:dir-a', 'ab:dir-b', 'ab:dir-c'];

let dataDir;
let hub;
let t;
let as;

before(async () => {
  dataDir = tmpDir('maude-votes-roles-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir, { rateLimit: false });
  as = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, http(hub.http, v)]));
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

const start = (who, canvas, extra = {}) => as[who].post(V, { canvas, targets: TARGETS, ...extra });

describe('the hub advertises votes', () => {
  test('/health capabilities name votes-v1', async () => {
    const r = await http(hub.http).get('/health');
    assert.ok(r.body.capabilities.includes('votes-v1'), JSON.stringify(r.body));
  });
});

describe('per role (§2.6)', () => {
  test('observer: reads, but ballot / start / end are 403', async () => {
    const v = (await start('owner', A)).body.vote;
    assert.equal((await as.observer.get(`${V}/${v.id}`)).status, 200);
    assert.equal((await as.observer.get(V)).status, 200);
    for (const r of [
      await as.observer.post(`${V}/${v.id}/ballot`, { picks: { 'ab:dir-a': 1 } }),
      await start('observer', C),
      await as.observer.post(`${V}/${v.id}/end`, {}),
    ]) {
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.reason, 'read-only');
    }
    assert.equal((await as.owner.post(`${V}/${v.id}/end`, {})).status, 200);
  });

  test('viewer: ballot 200 (with mine), start / end 403', async () => {
    const v = (await start('owner', A)).body.vote;
    const cast = await as.viewer.post(`${V}/${v.id}/ballot`, { picks: { 'ab:dir-b': 2 } });
    assert.equal(cast.status, 200, JSON.stringify(cast.body));
    assert.deepEqual(cast.body.mine, { 'ab:dir-b': 2 });
    assert.deepEqual((await as.viewer.get(`${V}/${v.id}`)).body.mine, { 'ab:dir-b': 2 });
    assert.equal((await start('viewer', C)).status, 403);
    assert.equal((await as.viewer.post(`${V}/${v.id}/end`, {})).status, 403);
    assert.equal((await as.owner.post(`${V}/${v.id}/end`, {})).status, 200);
  });

  test('member and owner: start 201, ballot 200, end 200 (with counts)', async () => {
    for (const who of ['member', 'owner']) {
      const s = await start(who, C, { title: `by ${who}` });
      assert.equal(s.status, 201, JSON.stringify(s.body));
      const id = s.body.vote.id;
      assert.equal(
        (await as[who].post(`${V}/${id}/ballot`, { picks: { 'ab:dir-c': 3 } })).status,
        200
      );
      const e = await as[who].post(`${V}/${id}/end`, {});
      assert.equal(e.status, 200);
      assert.deepEqual(e.body.vote.tallies, { 'ab:dir-c': 3 });
      assert.equal((await as[who].post(`${V}/${id}/end`, {})).status, 409);
    }
  });

  test('a second open vote on one canvas is 409; a bad body is 400', async () => {
    const v = (await start('owner', C)).body.vote;
    assert.equal((await start('member', C)).status, 409);
    assert.equal((await as.owner.post(V, { canvas: C, targets: [] })).status, 400);
    assert.equal((await as.owner.post(V, { canvas: '../x.tsx', targets: TARGETS })).status, 400);
    assert.equal((await as.owner.post(V, '[1]')).status, 400);
    assert.equal(
      (await as.owner.post(`${V}/${v.id}/ballot`, { picks: { 'ab:dir-a': 4 } })).status,
      400
    );
    assert.equal((await as.owner.get(`${V}/${v.id}/ballot`)).status, 405);
    assert.equal((await as.owner.post(`${V}/${v.id}`, {})).status, 405);
    await as.owner.post(`${V}/${v.id}/end`, {});
  });

  test('a forged voter in the body is ignored — the ballot is the session person’s', async () => {
    const v = (await start('owner', A)).body.vote;
    const r = await as.viewer.post(`${V}/${v.id}/ballot`, {
      picks: { 'ab:dir-a': 1 },
      voter: 'olga@x.test',
      actor: 'olga@x.test',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.vote.done, ['vera@x.test']);
    // Olga (the owner) holds no ballot.
    assert.equal('mine' in (await as.owner.get(`${V}/${v.id}`)).body, false);
    await as.owner.post(`${V}/${v.id}/end`, {});
  });

  test('no bearer: 401', async () => {
    assert.equal((await http(hub.http).get(V)).status, 401);
    assert.equal((await http(hub.http).post(V, { canvas: A, targets: TARGETS })).status, 401);
  });
});

describe('a canvas-only session (V2-1.16 U1)', () => {
  test('B’s vote answers exactly as a missing one; A’s is 200; the list holds A only', async () => {
    const onA = (await start('owner', A)).body.vote;
    const onB = (await start('owner', B)).body.vote;
    const missing = 'vote-zzzzzzzzzz';
    for (const [method, suffix, body] of [
      ['GET', '', undefined],
      ['POST', '/ballot', { picks: { 'ab:dir-a': 1 } }],
      ['POST', '/end', {}],
    ]) {
      const b = await as.aEdit.send(method, `${V}/${onB.id}${suffix}`, body);
      const n = await as.aEdit.send(method, `${V}/${missing}${suffix}`, body);
      assert.equal(b.status, 404, `${method} ${suffix}`);
      assert.equal(b.status, n.status, `${method} ${suffix}`);
      assert.equal(b.text, n.text, `${method} ${suffix}`);
      assert.equal(b.text.toLowerCase().includes('canary'), false);
    }
    assert.equal((await as.aEdit.get(`${V}/${onA.id}`)).status, 200);
    const list = await as.aEdit.get(V);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.votes.map((v) => v.canvas),
      list.body.votes.map(() => A)
    );
    assert.ok(list.body.votes.some((v) => v.id === onA.id));
    assert.equal(list.text.toLowerCase().includes('canary'), false);
    const byB = await as.aEdit.get(`${V}?canvas=${encodeURIComponent(B)}`);
    const byNope = await as.aEdit.get(`${V}?canvas=${encodeURIComponent(NOPE)}`);
    assert.deepEqual(byB.body.votes, []);
    assert.equal(byB.text, byNope.text);
    // Starting on a canvas it was not granted: one answer, whatever the canvas.
    const sB = await start('aEdit', B);
    const sN = await start('aEdit', NOPE);
    assert.equal(sB.status, 403);
    assert.equal(sB.text, sN.text);
    // On A it holds member: it may run the vote there.
    assert.equal(
      (await as.aEdit.post(`${V}/${onA.id}/ballot`, { picks: { 'ab:dir-a': 1 } })).status,
      200
    );
    assert.equal((await as.aEdit.post(`${V}/${onA.id}/end`, {})).status, 200);
    await as.owner.post(`${V}/${onB.id}/end`, {});
  });

  test('Can comment on A votes there but cannot start or end; Can view on A cannot vote', async () => {
    const v = (await start('owner', A)).body.vote;
    assert.equal(
      (await as.aComment.post(`${V}/${v.id}/ballot`, { picks: { 'ab:dir-b': 1 } })).status,
      200
    );
    assert.equal((await start('aComment', A)).status, 403);
    assert.equal((await as.aComment.post(`${V}/${v.id}/end`, {})).status, 403);
    assert.equal(
      (await as.aView.post(`${V}/${v.id}/ballot`, { picks: { 'ab:dir-b': 1 } })).status,
      403
    );
    assert.equal('mine' in (await as.aView.get(`${V}/${v.id}`)).body, false);
    await as.owner.post(`${V}/${v.id}/end`, {});
  });
});
