// S8.19 — asset presence and V2-1.16 (contract §5.4 / §5.6): a canvas-only
// session gets `unknown` for every rel outside its closure, byte-identical to
// a path the hub never heard of (U1); its `held` claims outside the closure
// are ignored; no answer carries an e-mail.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { bootAclHub, call } from './_acl-files-fixture.mjs';

let hub;
before(async () => {
  hub = await bootAclHub('maude-presence-acl');
});
after(async () => {
  await hub?.stop();
});

const probe = (token, body) =>
  call(hub, 'POST', '/_asset-probe', token, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const presence = (token, rel) =>
  call(hub, 'GET', `/api/projects/local/v1/asset-presence?rel=${encodeURIComponent(rel)}`, token);
const text = (r) => r.bytes.toString('utf8');

describe('a canvas-only session', () => {
  test('outside its closure: unknown, byte-identical to a never-heard path', async () => {
    // The owner's Mac holds a B-only file the hub lacks — known waiting to the project.
    await probe(hub.tokens.owner, {
      paths: ['ui/b-later.png'],
      held: true,
      sweep: { id: 'o1', final: true },
    });
    assert.equal(
      (await presence(hub.tokens.member, 'ui/b-later.png')).body.items[0].state,
      'waiting'
    );
    for (const rel of ['assets/b-only.png', 'ui/b-styles.css', 'ui/b-later.png']) {
      const b = await presence(hub.tokens.canvasA, rel);
      const n = await presence(hub.tokens.canvasA, 'assets/never-heard.png');
      assert.equal(b.status, 200, rel);
      assert.equal(b.status, n.status, rel);
      assert.equal(
        text(b).split(rel).join('<T>'),
        text(n).split('assets/never-heard.png').join('<T>'),
        rel
      );
      assert.equal(b.body.items[0].state, 'unknown', rel);
    }
  });

  test('inside its closure it sees the real state', async () => {
    assert.equal(
      (await presence(hub.tokens.canvasA, 'assets/a-only.png')).body.items[0].state,
      'here'
    );
    assert.equal(
      (await presence(hub.tokens.canvasA, 'assets/shared.png')).body.items[0].state,
      'here'
    );
  });

  test('a `held` claim outside its closure is ignored', async () => {
    await probe(hub.tokens.canvasA, {
      paths: ['assets/b-only.png', 'assets/b-forged.png', 'ui/b-later.png'],
      held: true,
      sweep: { id: 'ca1' },
    });
    const snap = hub.built.assetPresence.snapshot();
    for (const rel of ['assets/b-only.png', 'assets/b-forged.png', 'ui/b-later.png']) {
      assert.equal(snap.holders[rel]?.['canvas-a'], undefined, rel);
    }
  });

  test('the query is not reachable without a session that can read (no canvas-origin lane)', async () => {
    assert.equal((await presence(null, 'assets/a-only.png')).status, 401);
  });
});

describe('names, never addresses', () => {
  test('no presence answer carries an e-mail', async () => {
    for (const who of ['owner', 'member', 'viewer', 'canvasA']) {
      for (const rel of ['ui/b-later.png', 'assets/a-only.png', 'assets/nope.png']) {
        const r = await presence(hub.tokens[who], rel);
        assert.equal(text(r).includes('@'), false, `${who} ${rel}`);
        assert.equal(text(r).includes('x.test'), false, `${who} ${rel}`);
      }
    }
  });
});
