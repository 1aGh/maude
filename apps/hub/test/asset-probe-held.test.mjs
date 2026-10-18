// S8.19 — `/_asset-probe`'s two optional fields (contract §5.2) and the query
// route over a real workspace hub. A v1 body is answered exactly as before and
// records nothing; `held` + `sweep.final` drive waiting → missing.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { bootAclHub, call } from './_acl-files-fixture.mjs';

let hub;
before(async () => {
  hub = await bootAclHub('maude-probe-held');
});
after(async () => {
  await hub?.stop();
});

const probe = (token, body) =>
  call(hub, 'POST', '/_asset-probe', token, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const presence = (token, rels) =>
  call(
    hub,
    'GET',
    `/api/projects/local/v1/asset-presence?${rels.map((r) => `rel=${encodeURIComponent(r)}`).join('&')}`,
    token
  );
const stateOf = async (token, rel) => (await presence(token, [rel])).body.items[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the probe body', () => {
  test('a v1 body (no fields) answers as before and records nothing', async () => {
    const before = hub.built.assetPresence.snapshot();
    const r = await probe(hub.tokens.member, { paths: ['assets/a-only.png', 'assets/v1-new.png'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { present: ['assets/a-only.png'] });
    assert.deepEqual(hub.built.assetPresence.snapshot(), before);
  });

  test('held fields do not change the answer', async () => {
    const r = await probe(hub.tokens.member, {
      paths: ['assets/a-only.png', 'assets/held-new.png'],
      held: true,
      sweep: { id: 'm1', final: true },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { present: ['assets/a-only.png'] });
  });

  test('a malformed sweep id records the holders but never finishes a sweep', async () => {
    await probe(hub.tokens.owner, {
      paths: ['assets/odd.png'],
      held: true,
      sweep: { id: '../x', final: true },
    });
    const d = hub.built.assetPresence.snapshot().devices.owner;
    assert.equal(d.sweptAt, undefined);
  });
});

describe('waiting vs missing over the wire', () => {
  test('held by another device → waiting{who}; here when the bytes are on the hub', async () => {
    await probe(hub.tokens.owner, {
      paths: ['assets/acko-hero2.png'],
      held: true,
      sweep: { id: 'o1', final: true },
    });
    const w = await stateOf(hub.tokens.member, 'assets/acko-hero2.png');
    assert.deepEqual(w, {
      rel: 'assets/acko-hero2.png',
      state: 'waiting',
      who: { name: 'o', kind: null, self: false },
    });
    assert.equal((await stateOf(hub.tokens.member, 'assets/a-only.png')).state, 'here');
  });

  test('the holder sweeps without it → missing once every device swept after', async () => {
    await probe(hub.tokens.owner, {
      paths: ['assets/partneri-2025.png'],
      held: true,
      sweep: { id: 'o2', final: true },
    });
    await probe(hub.tokens.member, { paths: [], held: true, sweep: { id: 'm2', final: true } });
    assert.equal((await stateOf(hub.tokens.member, 'assets/partneri-2025.png')).state, 'waiting');
    await sleep(5);
    // Tereza (owner token here) removed it before it synced; her next sweep says so.
    await probe(hub.tokens.owner, { paths: [], held: true, sweep: { id: 'o3', final: true } });
    // The member's last sweep predates the first query: still waiting.
    assert.equal((await stateOf(hub.tokens.member, 'assets/partneri-2025.png')).state, 'waiting');
    await sleep(5);
    await probe(hub.tokens.member, { paths: [], held: true, sweep: { id: 'm3', final: true } });
    const m = await stateOf(hub.tokens.member, 'assets/partneri-2025.png');
    assert.deepEqual(m, { rel: 'assets/partneri-2025.png', state: 'missing' });
  });

  test('a viewer reads states but can feed nothing (the probe is a write-lane door)', async () => {
    const r = await probe(hub.tokens.viewer, { paths: ['assets/v.png'], held: true });
    assert.equal(r.status, 403);
    assert.equal(hub.built.assetPresence.snapshot().devices.viewer, undefined);
    assert.equal((await presence(hub.tokens.viewer, ['assets/acko-hero2.png'])).status, 200);
  });
});

describe('the query route', () => {
  test('400 on a bad rel or none, 413 past 256, 401 without a token, 405 on POST', async () => {
    assert.equal((await presence(hub.tokens.member, ['../etc/passwd'])).status, 400);
    assert.equal((await presence(hub.tokens.member, [])).status, 400);
    const many = Array.from({ length: 257 }, (_, i) => `assets/x${i}.png`);
    assert.equal((await presence(hub.tokens.member, many)).status, 413);
    assert.equal((await presence(null, ['assets/a.png'])).status, 401);
    const post = await call(hub, 'POST', '/api/projects/local/v1/asset-presence', hub.tokens.owner);
    assert.equal(post.status, 405);
  });
});
