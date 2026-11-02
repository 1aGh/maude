// The comment door — `POST /api/comments` (S9.7; V2-1.7 §5.6, V2-1.16 L10).
//
// Per role (owner · member · viewer · observer, plus canvas-only):
//   - a Can comment (viewer) desktop's comment lands in the canvas doc's Y
//     `comments` lane with the SESSION's author; a forged author is ignored;
//   - a Y comments update sent on the viewer's own (read-only) connection is
//     still dropped — the door is the only way in;
//   - observer → 403; ops on someone else's comment other than reply / resolve /
//     reopen → 403 `not-yours`;
//   - canvas-only: a document it cannot open answers exactly as a missing one;
//   - mentions are parsed on the server and `maude.mention` reaches only the
//     mentioned person's own connections; unknown and no-access are the same
//     silence; AI comments never mention;
//   - a writer of another file format gets 426 (V2-1.12 §5.4);
//   - accepted revisions (DDR-241): the op goes through the kernel.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  A,
  B,
  closeAll,
  docOf,
  http,
  NOPE,
  openDoc,
  proposal,
  rm,
  seedTokens,
  sleep,
  src,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const OBSERVER_REFUSAL = {
  error: 'You can look at this project, not change it.',
  reason: 'read-only',
};

function listen(provider) {
  const frames = [];
  provider.on('stateless', ({ payload }) => {
    try {
      frames.push(JSON.parse(payload));
    } catch {
      frames.push(payload);
    }
  });
  return frames;
}

const mentionsIn = (frames) => frames.filter((f) => f?.type === 'maude.mention');

describe('the comment door (legacy save mode)', () => {
  let dataDir;
  let hub;
  let t;
  let ownerA;
  let ownerB;

  before(async () => {
    dataDir = tmpDir('maude-comments-door-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false });
    // The owner keeps A and B open: both documents exist on this hub.
    ownerA = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
    ownerB = await openDoc(hub.ws, t.owner, docOf(B), { keep: true });
    ownerA.doc.getText('html').insert(0, 'alpha');
    ownerB.doc.getText('html').insert(0, 'beta');
  });

  after(async () => {
    closeAll();
    await hub?.close();
    rm(dataDir);
  });

  const comments = (open) => open.doc.getArray('comments').toArray();
  const post = (token, body, headers = {}) =>
    fetch(`${hub.http}/api/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  test('a viewer’s comment lands in the Y lane with the session’s author; a forged one is ignored', async () => {
    const r = await post(t.viewer, {
      doc: docOf(A),
      canvas: A,
      op: 'add',
      text: 'Logo is late',
      author: 'Olga',
      authorId: 'h:olga',
      artboard: 'hero',
      t: 3.5,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await until(() => comments(ownerA).some((c) => c.id === r.body.id), 3000, 'comment synced');
    const c = comments(ownerA).find((x) => x.id === r.body.id);
    assert.equal(c.author, 'vera');
    assert.match(c.authorId, /^h:[0-9a-f]{24}$/);
    assert.notEqual(c.authorId, 'h:olga');
    assert.equal(c.file, '.design/ui/Alpha.tsx');
    assert.deepEqual([c.artboard, c.t], ['hero', 3.5]);
    // no address reaches the lane (L17)
    assert.equal(JSON.stringify(comments(ownerA)).includes('@x.test'), false);
  });

  test('a comment written on the viewer’s own Y connection is still dropped', async () => {
    const v = await openDoc(hub.ws, t.viewer, docOf(A), { keep: true });
    try {
      v.doc.getArray('comments').push([{ id: 'c_sneaky', text: 'over the wire' }]);
      await sleep(400);
      assert.equal(
        comments(ownerA).some((c) => c.id === 'c_sneaky'),
        false
      );
    } finally {
      v.close();
    }
  });

  test('observer (Can view) → 403 with its own words; no token → 401', async () => {
    const r = await post(t.observer, { doc: docOf(A), op: 'add', text: 'hi' });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, OBSERVER_REFUSAL);
    const anon = await fetch(`${hub.http}/api/comments`, { method: 'POST', body: '{}' });
    assert.equal(anon.status, 401);
  });

  test('someone else’s comment: reply / resolve / reopen yes, edit / delete no', async () => {
    const mine = await post(t.viewer, { doc: docOf(A), canvas: A, op: 'add', text: 'mine' });
    const id = mine.body.id;
    for (const op of ['reply', 'resolve', 'reopen']) {
      const r = await post(t.member, { doc: docOf(A), op, id, body: 'ok' });
      assert.equal(r.status, 200, `${op}: ${JSON.stringify(r.body)}`);
    }
    for (const op of ['edit-own', 'delete-own']) {
      const r = await post(t.member, { doc: docOf(A), op, id, text: 'not mine' });
      assert.equal(r.status, 403, op);
      assert.equal(r.body.code, 'not-yours');
    }
    const own = await post(t.viewer, { doc: docOf(A), op: 'edit-own', id, text: 'mine, edited' });
    assert.equal(own.status, 200);
    await until(
      () => comments(ownerA).find((c) => c.id === id)?.text === 'mine, edited',
      3000,
      'edit synced'
    );
    const thread = comments(ownerA).find((c) => c.id === id);
    assert.equal(thread.status, 'open');
    assert.equal(thread.thread[0].author, 'max');
  });

  test('canvas-only: B answers exactly as a missing canvas; A works; Can view grant refused', async () => {
    const onA = await post(t.aComment, { doc: docOf(A), canvas: A, op: 'add', text: 'on A' });
    assert.equal(onA.status, 200, JSON.stringify(onA.body));
    assert.equal(onA.body.comment.file, '.design/ui/Alpha.tsx');
    for (const op of [
      { op: 'add', text: 'on B' },
      { op: 'reply', id: 'c_1', body: 'x' },
    ]) {
      const b = await post(t.aComment, { doc: docOf(B), canvas: B, ...op });
      const n = await post(t.aComment, { doc: docOf(NOPE), canvas: NOPE, ...op });
      assert.equal(b.status, 403);
      assert.deepEqual([b.status, b.body], [n.status, n.body]);
    }
    // A's lane cannot name B's file.
    const cross = await post(t.aComment, {
      doc: docOf(A),
      op: 'add',
      text: 'x',
      file: '.design/ui/canary-b-zx.tsx',
    });
    assert.equal(cross.status, 400);
    const view = await post(t.aView, { doc: docOf(A), canvas: A, op: 'add', text: 'look only' });
    assert.equal(view.status, 403);
  });

  test('a project member’s comment on a canvas that does not exist → 404, nothing created', async () => {
    const r = await post(t.member, { doc: docOf(NOPE), op: 'add', text: 'x' });
    assert.equal(r.status, 404);
    const docs = await http(hub.http, t.owner).get('/api/documents');
    assert.equal(
      docs.body.documents.some((d) => d.name === docOf(NOPE)),
      false
    );
  });

  test('mentions: parsed on the server, delivered only to the mentioned person', async () => {
    const max = await openDoc(hub.ws, t.member, docOf(A), { keep: true });
    const petra = await openDoc(hub.ws, t.aEdit, docOf(A), { keep: true });
    const maxFrames = listen(max.provider);
    const petraFrames = listen(petra.provider);
    const olgaFrames = listen(ownerA.provider);
    try {
      const r = await post(t.viewer, {
        doc: docOf(A),
        canvas: A,
        op: 'add',
        text: 'Mrkni @max, date is small',
        // a client-stated list is never read
        mentions: ['@olga'],
      });
      assert.equal(r.status, 200);
      await until(() => mentionsIn(maxFrames).length === 1, 3000, 'max notified');
      assert.deepEqual(mentionsIn(maxFrames)[0], {
        type: 'maude.mention',
        thread: r.body.id,
        canvas: A,
        doc: docOf(A),
        from: 'vera',
      });
      // Petra can open A but not B: a mention of her on B is the same silence as nobody.
      const onB = await post(t.viewer, { doc: docOf(B), canvas: B, op: 'add', text: 'see @petra' });
      const nobody = await post(t.viewer, {
        doc: docOf(B),
        canvas: B,
        op: 'add',
        text: 'see @zed',
      });
      assert.deepEqual(
        [onB.status, Object.keys(onB.body).sort()],
        [nobody.status, Object.keys(nobody.body).sort()]
      );
      // AI comments never mention (C3).
      const ai = await post(t.viewer, {
        doc: docOf(A),
        canvas: A,
        op: 'add',
        text: 'Contrast @max',
        as: 'ai',
      });
      assert.equal(ai.body.comment.authorKind, 'ai');
      // A reply that adds no new handle re-notifies nobody.
      await post(t.member, { doc: docOf(A), op: 'reply', id: r.body.id, body: 'ok @max' });
      await sleep(300);
      assert.equal(mentionsIn(maxFrames).length, 1);
      assert.deepEqual(mentionsIn(petraFrames), []);
      assert.deepEqual(mentionsIn(olgaFrames), []);
    } finally {
      max.close();
      petra.close();
    }
  });

  test('a writer of another file format gets 426 (V2-1.12 §5.4)', async () => {
    const r = await post(
      t.viewer,
      { doc: docOf(A), op: 'add', text: 'x' },
      { 'x-maude-format': '2' }
    );
    assert.equal(r.status, 426);
    assert.equal(r.body.reason, 'format');
  });

  test('GET is not a door', async () => {
    const r = await http(hub.http, t.viewer).get('/api/comments');
    assert.equal(r.status, 405);
  });
});

describe('the comment door (accepted revisions — the kernel writes)', () => {
  let dataDir;
  let hub;
  let t;

  before(async () => {
    dataDir = tmpDir('maude-comments-door-tx-');
    t = seedTokens(dataDir);
    hub = await startHub(dataDir, { rateLimit: false });
    const owner = http(hub.http, t.owner);
    const V1 = '/api/projects/local/v1';
    const { epoch } = (await owner.post(`${V1}/mode`, { mode: 'transactions', expectEpoch: 0 }))
      .body;
    const made = await owner.post(
      `${V1}/proposals`,
      proposal(epoch, [{ op: 'doc.create', doc: docOf(A), path: A, lanes: { html: src('a') } }])
    );
    assert.equal(made.status, 200, JSON.stringify(made.body));
  });

  after(async () => {
    closeAll();
    await hub?.close();
    rm(dataDir);
  });

  test('a viewer’s comment is accepted as a comments-lane revision with the session’s author', async () => {
    const r = await fetch(`${hub.http}/api/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.viewer}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        doc: docOf(A),
        canvas: A,
        op: 'add',
        text: 'via kernel',
        author: 'x',
      }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const open = await openDoc(hub.ws, t.owner, docOf(A), { keep: true });
    try {
      await until(
        () =>
          open.doc
            .getArray('comments')
            .toArray()
            .some((c) => c.id === body.id),
        3000,
        'replica has it'
      );
      const c = open.doc
        .getArray('comments')
        .toArray()
        .find((x) => x.id === body.id);
      assert.equal(c.author, 'vera');
    } finally {
      open.close();
    }
    const revs = await http(hub.http, t.owner).get('/api/projects/local/v1/revisions?after=0');
    const last = revs.body.revisions?.at(-1) ?? revs.body.actions?.at(-1);
    assert.equal(last?.actor, 'vera@x.test');
  });
});
