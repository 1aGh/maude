// Access notices — V2-1.7 §5.6 hub stateless messages (S9.6).
//
//   - `maude.access` reaches ONLY the affected person's connections, carries
//     no grant data, and on `narrowed` / `ended` the kick waits the grace —
//     so a write already on its way lands first ("Your last changes were
//     saved first"; proven with a write sent the moment the notice arrives);
//   - `maude.access-request` reaches only connections that can `invite`;
//   - `POST /internal/access-changed` needs the cell's own secret;
//   - a cloud cell FORWARDS `/api/access/*` to the control plane with its
//     secret and the verified actor — a forged `x-maude-actor` is ignored.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { listTokensForOwner } from '../src/tokens.mjs';
import { createUser } from '../src/users.mjs';
import {
  A,
  docOf,
  http,
  rm,
  seedTokens,
  sleep,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const GRACE = 600;

/** A kept-open provider that records every stateless frame and its close time. */
function listen(ws, token, name) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const heard = [];
    const state = { closedAt: null, onNotice: null };
    const timer = setTimeout(() => reject(new Error(`${name}: no sync within 5s`)), 5000);
    const provider = new HocuspocusProvider({
      url: ws,
      name,
      token,
      document: doc,
      onStateless: ({ payload }) => {
        let msg = null;
        try {
          msg = JSON.parse(payload);
        } catch {
          return;
        }
        if (!msg?.type?.startsWith?.('maude.access')) return;
        heard.push({ msg, at: Date.now() });
        state.onNotice?.(msg, doc);
      },
      onClose: () => {
        state.closedAt ??= Date.now();
      },
      onSynced: () => {
        clearTimeout(timer);
        resolve({ doc, provider, heard, state, close: () => provider.destroy() });
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        reject(new Error(`${name}: auth failed ${reason}`));
      },
    });
  });
}

describe('maude.access + maude.access-request (self-hosted)', () => {
  let dataDir;
  let hub;
  let t;
  const open = [];
  before(async () => {
    dataDir = tmpDir('maude-access-notices-');
    t = seedTokens(dataDir);
    createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
    createUser(dataDir, { email: 'max@x.test', password: PW, role: 'member' });
    hub = await startHub(dataDir, { rateLimit: false, switchGraceMs: GRACE });
  });
  after(async () => {
    for (const o of open) o.close();
    await hub?.close();
    rm(dataDir);
  });

  test('Ask to edit: the owner hears it, a member does not', async () => {
    const owner = await listen(hub.ws, t.owner, docOf(A));
    const member = await listen(hub.ws, t.member, docOf(A));
    open.push(owner, member);
    const r = await http(hub.http, t.viewer).post('/api/access/requests', { canvas: A });
    assert.equal(r.status, 201, r.text);
    await until(() => owner.heard.length === 1, 3000, 'the owner hears the request');
    const { msg } = owner.heard[0];
    assert.equal(msg.type, 'maude.access-request');
    assert.equal(msg.id, r.body.id);
    assert.deepEqual(msg.from, { name: 'vera' });
    assert.equal(msg.canvas, A);
    assert.equal(typeof msg.at, 'number');
    await sleep(150);
    assert.equal(member.heard.length, 0, 'a member never hears a request');
  });

  test('removed mid-edit: the notice first, the write lands, the kick after the grace', async () => {
    const owner = await listen(hub.ws, t.owner, docOf(A));
    const max = await listen(hub.ws, t.member, docOf(A));
    open.push(owner, max);
    // The moment the notice reaches Max, his client flushes one last change.
    max.state.onNotice = (msg, doc) => {
      if (msg.change === 'ended') doc.getText('t').insert(0, 'LAST-CHANGE');
    };
    const people = (await http(hub.http, t.owner).get('/api/access/people')).body.people;
    const maxId = people.find((p) => p.email === 'max@x.test').id;
    const removed = await http(hub.http, t.owner).send('DELETE', `/api/access/people/${maxId}`);
    assert.equal(removed.status, 204, removed.text);

    await until(() => max.heard.length === 1, 3000, 'max hears maude.access');
    const notice = max.heard[0];
    assert.deepEqual(Object.keys(notice.msg).sort(), ['change', 'epoch', 'reason', 'type']);
    assert.equal(notice.msg.change, 'ended');
    assert.equal(notice.msg.reason, 'removed');
    assert.equal(owner.heard.filter((h) => h.msg.type === 'maude.access').length, 0);

    // The last change reached the server (the owner's replica has it).
    await until(
      () => owner.doc.getText('t').toString().includes('LAST-CHANGE'),
      3000,
      'the flush lands'
    );
    // …and the kick waited the grace.
    await until(() => max.state.closedAt !== null, GRACE + 3000, 'max is kicked');
    assert.ok(
      max.state.closedAt - notice.at >= GRACE - 100,
      `kicked ${max.state.closedAt - notice.at} ms after the notice`
    );
    assert.deepEqual(listTokensForOwner(dataDir, 'max@x.test'), [], 'his sessions are revoked');
  });

  test('POST /internal/access-changed: the cell secret only; raised never kicks', async () => {
    const owner = await listen(hub.ws, t.owner, docOf(A));
    open.push(owner);
    const no = await fetch(`${hub.http}/internal/access-changed`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.member}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'olga@x.test', change: 'ended' }),
    });
    assert.equal(no.status, 401);
    const yes = await fetch(`${hub.http}/internal/access-changed`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'OLGA@x.test', change: 'raised' }),
    });
    assert.equal(yes.status, 202);
    await until(() => owner.heard.some((h) => h.msg.change === 'raised'), 3000, 'raised');
    await sleep(GRACE + 300);
    assert.equal(owner.state.closedAt, null, 'raised never kicks');
    assert.ok(listTokensForOwner(dataDir, 'olga@x.test').length > 0);
  });
});

describe('the cloud forwarder', () => {
  let dataDir;
  let hub;
  let t;
  let cp;
  let seen;
  let reply;
  const saved = {};
  const ENV = {
    MAUDE_CLOUD_IDENTITY: '1',
    MAUDE_TENANT_ID: 'acme-site',
  };
  before(async () => {
    seen = [];
    cp = createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          auth: req.headers.authorization,
          actor: req.headers['x-maude-actor'],
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const [status, body] = reply(req);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise((r) => cp.listen(0, '127.0.0.1', r));
    for (const k of [...Object.keys(ENV), 'MAUDE_CONTROL_PLANE_URL']) saved[k] = process.env[k];
    Object.assign(process.env, ENV, {
      MAUDE_CONTROL_PLANE_URL: `http://127.0.0.1:${cp.address().port}`,
    });
    dataDir = tmpDir('maude-access-forward-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false });
  });
  after(async () => {
    await hub?.close();
    await new Promise((r) => cp.close(r));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rm(dataDir);
  });

  test('/health: the control plane is the authority', async () => {
    const body = await (await fetch(`${hub.http}/health`)).json();
    assert.equal(body.access.authority, 'control-plane');
    assert.deepEqual(body.access.roles, ['viewer', 'member', 'owner']);
  });

  test('GET me forwards with the cell secret and the VERIFIED actor', async () => {
    reply = () => [200, { role: 'owner', grants: [], caps: { invite: true } }];
    const r = await fetch(`${hub.http}/api/access/me`, {
      headers: { authorization: `Bearer ${t.owner}`, 'x-maude-actor': 'mallory@evil.test' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).caps, { invite: true });
    const last = seen.at(-1);
    assert.equal(last.method, 'GET');
    assert.equal(last.url, '/internal/projects/acme-site/access/me');
    assert.equal(last.auth, 'Bearer test-secret');
    assert.equal(last.actor, 'olga@x.test', 'a forged x-maude-actor is ignored');
  });

  test('POST requests: the answer passes through, and the owners here hear a 201', async () => {
    const owner = await listen(hub.ws, t.owner, docOf(A));
    try {
      reply = () => [201, { id: 'req_cp1' }];
      const r = await http(hub.http, t.viewer).post('/api/access/requests', { canvas: A });
      assert.equal(r.status, 201);
      assert.deepEqual(JSON.parse(seen.at(-1).body), { canvas: A });
      assert.equal(seen.at(-1).actor, 'vera@x.test');
      await until(() => owner.heard.length === 1, 3000, 'the owner hears it');
      assert.equal(owner.heard[0].msg.id, 'req_cp1');
      reply = () => [409, { error: 'You already asked.', reason: 'pending' }];
      const again = await http(hub.http, t.viewer).post('/api/access/requests', { canvas: A });
      assert.equal(again.status, 409);
      assert.equal(again.body.reason, 'pending');
      await sleep(150);
      assert.equal(owner.heard.length, 1, 'a refused request notifies nobody');
    } finally {
      owner.close();
    }
  });

  test('the gate still runs first: a member cannot reach the invite forwarder', async () => {
    const before = seen.length;
    const r = await http(hub.http, t.member).post('/api/access/invites', {
      email: 'x@x.test',
      role: 'member',
    });
    assert.equal(r.status, 403);
    assert.equal(seen.length, before, 'nothing was forwarded');
  });
});
