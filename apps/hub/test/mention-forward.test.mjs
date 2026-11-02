// A mention with nobody home — Maude v2 S9.18 (canvas 10 co-mention-notify).
//
// The comment door delivers `maude.mention` to the mentioned person's live
// connections (S9.7). When it reaches nobody live, a CLOUD cell forwards the
// mention to the control plane, which e-mails the person once; a self-hosted
// hub sends none. These drive the real door (`handleCommentsRoute`) into the
// real control-plane handler (`apps/cloud/mentions.mjs`) over a fetch shim,
// with the e-mail transport faked — no provider is ever called.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';

import * as Y from 'yjs';

import { createAccount } from '../../cloud/accounts.mjs';
import { deriveCellSecret } from '../../cloud/cell-token.mjs';
import { d1FromSqlite } from '../../cloud/db.mjs';
import { handleMentionRoutes } from '../../cloud/mentions.mjs';
import { applySchema } from '../../cloud/migrate.mjs';
import { SCHEMA_SQL } from '../../cloud/schema.mjs';
import { docSlugOf } from '../src/access-docs.mjs';
import { createMentionForwarder, handleCommentsRoute } from '../src/routes-v2/comments.mjs';

const MASTER = 'test-master-secret';
const TENANT = 'alligators';
const CANVAS = 'ui/poster.tsx';
const DOC = `ws/local/main/${docSlugOf(CANVAS)}`;
const CLOUD_ENV = {
  MAUDE_CLOUD_IDENTITY: '1',
  MAUDE_CONTROL_PLANE_URL: 'https://cloud.test',
  MAUDE_TENANT_ID: TENANT,
};

/** The control plane: Jonas edits Alligators brand, Ana can comment on it. */
async function controlPlane() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const jonas = await createAccount(DB, { email: 'jonas@example.com', name: 'Jonas' });
  const ana = await createAccount(DB, { email: 'ana@example.com', name: 'Ana' });
  const tereza = await createAccount(DB, { email: 'tereza@example.com', name: 'Tereza' });
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at, subscription_id)
       VALUES (?, ?, 'Alligators brand', 'active', 1, 1, 'sub_t')`
    )
    .run(TENANT, tereza.id);
  const add = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  add.run(TENANT, jonas.id, 'member');
  add.run(TENANT, ana.id, 'viewer');
  return { env: { DB, CELL_SECRET_MASTER: MASTER } };
}

/** A live connection the door can see: a person, the doc open, a socket. */
function liveConnection(email, name) {
  const frames = [];
  return {
    frames,
    connection: {
      socketId: `s-${email}`,
      context: { user: { email, displayName: name } },
      sendStateless: (payload) => frames.push(JSON.parse(payload)),
    },
  };
}

/** The door's deps — one in-memory Y document, the given live connections. */
function commentsDeps({ connections = [], forwardMentions = null } = {}) {
  const ydoc = new Y.Doc();
  return {
    designRel: '.design',
    projectId: TENANT,
    personKey: 'k',
    accepted: () => null,
    docExists: async (name) => name === DOC,
    withDoc: async (_name, _context, fn) => fn(ydoc),
    connections: () => connections,
    ...(forwardMentions ? { forwardMentions } : {}),
  };
}

/** POST /api/comments as Jonas (a member), through the real handler. */
async function postComment(deps, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.headers = { authorization: 'Bearer tok-jonas' };
  let answer = null;
  await handleCommentsRoute({
    request,
    method: 'POST',
    respondJson: (status, json) => {
      answer = { status, json };
    },
    verify: (token) =>
      token === 'tok-jonas'
        ? { owner: 'jonas@example.com', label: 'tok-jonas', access: { v: 1, role: 'member' } }
        : null,
    deps: { comments: deps },
  });
  return answer;
}

const addMentioningAna = (extra = {}) => ({
  op: 'add',
  doc: DOC,
  canvas: CANVAS,
  text: '@ana mrkni prosím na datum, je pořád malé.',
  x: 10,
  y: 10,
  ...extra,
});

/** The real forwarder pointed at the real control plane, with a fake transport. */
async function wiredForwarder() {
  const plane = await controlPlane();
  const sent = [];
  const pending = [];
  const real = createMentionForwarder({
    env: CLOUD_ENV,
    secret: await deriveCellSecret(MASTER, TENANT),
    fetchImpl: (url, init) =>
      handleMentionRoutes(new Request(url, init), plane.env, {
        send: async (msg) => {
          sent.push(msg);
          return { ok: true };
        },
      }),
  });
  assert.ok(real, 'a cloud cell has a forwarder');
  const forwardMentions = (m) => {
    const p = real(m);
    pending.push(p);
    return p;
  };
  return { sent, settle: () => Promise.all(pending), forwardMentions };
}

describe('a mention reaches the control plane only when nobody is home', () => {
  test('no live connection → the cell forwards → exactly one e-mail (fake transport)', async () => {
    const w = await wiredForwarder();
    const res = await postComment(
      commentsDeps({ forwardMentions: w.forwardMentions }),
      addMentioningAna()
    );
    assert.equal(res.status, 200);
    await w.settle();
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0].to, 'ana@example.com');
    assert.equal(w.sent[0].subject, 'Jonas mentioned you in Alligators brand');
    assert.match(w.sent[0].text, /mrkni prosím na datum/);
    assert.ok(!w.sent[0].text.includes('jonas@example.com'), 'never the author’s address');
  });

  test('a live connection → the in-app notice, and no e-mail', async () => {
    const w = await wiredForwarder();
    const ana = liveConnection('ana@example.com', 'Ana');
    const res = await postComment(
      commentsDeps({ connections: [ana.connection], forwardMentions: w.forwardMentions }),
      addMentioningAna()
    );
    assert.equal(res.status, 200);
    await w.settle();
    assert.equal(ana.frames.filter((f) => f.type === 'maude.mention').length, 1);
    assert.equal(w.sent.length, 0);
  });

  test('what the cell forwards: tokens, who was reached, the canvas from the record', async () => {
    const calls = [];
    const ana = liveConnection('ana@example.com', 'Ana');
    const deps = commentsDeps({
      connections: [ana.connection],
      forwardMentions: async (m) => calls.push(m),
    });
    // No `canvas` in the body (only the file): the door names the record's own canvas.
    const res = await postComment(
      deps,
      addMentioningAna({ canvas: undefined, file: CANVAS, text: '@ana @lin hi' })
    );
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    const [m] = calls;
    assert.deepEqual(m.tokens, ['@ana', '@lin']);
    assert.deepEqual(m.reached, ['ana@example.com']);
    assert.equal(m.canvas, CANVAS);
    assert.equal(m.thread, res.json.id);
    assert.equal(m.author, 'jonas@example.com');
    assert.equal(m.excerpt, '@ana @lin hi');
  });

  test('an AI-written comment forwards nothing (C3)', async () => {
    const calls = [];
    const deps = commentsDeps({ forwardMentions: async (m) => calls.push(m) });
    await postComment(deps, addMentioningAna({ as: 'ai' }));
    assert.equal(calls.length, 0);
  });

  test('a reply that mentions forwards its own words, not the root’s', async () => {
    const calls = [];
    const deps = commentsDeps({ forwardMentions: async (m) => calls.push(m) });
    const root = await postComment(deps, addMentioningAna({ text: 'no mention here' }));
    assert.equal(calls.length, 0);
    await postComment(deps, { op: 'reply', doc: DOC, id: root.json.id, body: '@ana tady' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].excerpt, '@ana tady');
    assert.equal(calls[0].canvas, CANVAS);
  });
});

describe('createMentionForwarder', () => {
  test('a self-hosted hub (no cloud identity) has none — it sends no e-mail', () => {
    assert.equal(createMentionForwarder({ env: {}, secret: 's' }), null);
    assert.equal(
      createMentionForwarder({ env: { ...CLOUD_ENV, MAUDE_CLOUD_IDENTITY: '' }, secret: 's' }),
      null
    );
    assert.equal(createMentionForwarder({ env: CLOUD_ENV, secret: '' }), null);
    assert.equal(
      createMentionForwarder({ env: { ...CLOUD_ENV, MAUDE_CONTROL_PLANE_URL: '' }, secret: 's' }),
      null
    );
  });

  test('cell → cloud: the derived secret, the vouched author, nothing the client sent', async () => {
    const seen = [];
    const fwd = createMentionForwarder({
      env: CLOUD_ENV,
      secret: 'cell-secret',
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return new Response('{"sent":0}', { status: 202 });
      },
    });
    const ok = await fwd({
      tokens: ['@ana'],
      reached: [],
      canvas: CANVAS,
      thread: 'c_1',
      author: 'jonas@example.com',
      from: 'Jonas',
      excerpt: 'x'.repeat(5000),
    });
    assert.equal(ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://cloud.test/internal/mentions');
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.authorization, 'Bearer cell-secret');
    assert.equal(seen[0].init.headers['x-maude-actor'], 'jonas@example.com');
    const body = JSON.parse(seen[0].init.body);
    assert.equal(body.tenant, TENANT);
    assert.ok(body.excerpt.length <= 280);
  });

  test('a control-plane outage is a quiet false, never a throw', async () => {
    const fwd = createMentionForwarder({
      env: CLOUD_ENV,
      secret: 's',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    assert.equal(await fwd({ tokens: ['@a'], reached: [], thread: 't', author: 'a@b.c' }), false);
    assert.equal(await fwd({ tokens: ['@a'], reached: [], thread: 't', author: '' }), false);
  });
});
