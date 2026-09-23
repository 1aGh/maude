// Plan T30 — the rollback boundary, exercised rather than described.
//
// `docs/operations/project-multiplayer-rollout.md` makes three promises about
// going back to legacy writes, and until now all three were prose an operator
// would only find out about during an incident:
//
//   1. the documents already hold the accepted state, so nothing accepted is
//      lost by rolling back;
//   2. every credential gets back exactly the access it had before — a member
//      writes again, a viewer still does not;
//   3. switching forward again imports what legacy writers changed in between
//      and never rolls that work back.
//
// A rollback is the step taken when something has already gone wrong. It is
// the worst possible moment to discover which of those three was optimistic.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const src = (title) => `export default () => <h1 title="${title}">x</h1>;\n`;

async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error(`${what} not reached before deadline`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

let tx = 0;

describe('the rollback boundary', () => {
  test('accepted work survives going back to legacy, and the fence lifts for exactly who had it', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-rollback-'));
    dirs.push(dataDir);
    const owner = addToken(dataDir, { label: 'owner', scope: '*' }).value;
    const alice = addToken(dataDir, {
      label: 'alice',
      scope: '*',
      role: 'member',
      owner: 'alice@x.test',
    }).value;
    const viewer = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;

    const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
    await built.server.listen();
    await built.acceptedReady;
    const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
    const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
    const name = 'ws/local/main/ui-rollback';

    const mode = async (body) => {
      const res = await fetch(`${http}/api/projects/local/v1/mode`, {
        method: 'POST',
        headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };
    const propose = async (epoch, operations) => {
      const res = await fetch(`${http}/api/projects/local/v1/proposals`, {
        method: 'POST',
        headers: { authorization: `Bearer ${alice}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 1,
          projectId: 'local',
          epoch,
          transactionId: `tx_rollback_${++tx}_${Date.now()}`,
          origin: { deviceId: 'test', sessionId: 's1' },
          action: { kind: 'edit', label: 'rollback drill', operations },
        }),
      });
      return { status: res.status, body: await res.json() };
    };
    const open = (token) => {
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({ url: ws, name, token, document: doc });
      return {
        doc,
        provider,
        html: () => doc.getText('html').toString(),
        close: () => {
          provider.destroy();
          doc.destroy();
        },
      };
    };

    const readers = [];
    try {
      // Forward, and one accepted action on the record.
      const on = await mode({ mode: 'transactions', expectEpoch: 0 });
      assert.equal(on.body.mode, 'transactions');
      const accepted = src('accepted before the rollback');
      const made = await propose(on.body.epoch, [
        { op: 'doc.create', doc: name, path: 'ui/rollback.tsx', lanes: { html: accepted } },
      ]);
      assert.equal(made.status, 200, JSON.stringify(made.body));

      // PROMISE 1 — the documents already hold it, so a rollback cannot lose it.
      const back = await mode({ mode: 'legacy', expectEpoch: on.body.epoch });
      assert.equal(back.body.mode, 'legacy');
      const afterRollback = open(alice);
      readers.push(afterRollback);
      await until(
        () => afterRollback.html().includes('accepted before the rollback'),
        10000,
        'the accepted body still in the document after the rollback'
      );

      // PROMISE 2 — a member writes again; a viewer still does not.
      afterRollback.doc.transact(() => {
        afterRollback.doc.getText('html').delete(0, afterRollback.doc.getText('html').length);
        afterRollback.doc.getText('html').insert(0, src('written while back in legacy'));
      });
      const witness = open(owner);
      readers.push(witness);
      await until(
        () => witness.html().includes('written while back in legacy'),
        10000,
        'a member writing again after the rollback'
      );

      const denied = open(viewer);
      readers.push(denied);
      await until(() => denied.html().length > 0, 10000, 'the viewer synced');
      denied.doc.transact(() => {
        denied.doc.getText('html').insert(0, '// a viewer must not write\n');
      });
      await new Promise((r) => setTimeout(r, 600));
      assert.ok(
        !witness.html().includes('a viewer must not write'),
        'a viewer stays a viewer through a rollback'
      );

      // PROMISE 3 — forward again keeps BOTH: the accepted history, and the
      // legacy-era work done while the project was rolled back.
      const again = await mode({ mode: 'transactions', expectEpoch: back.body.epoch });
      assert.equal(again.body.mode, 'transactions');
      const parity = await (
        await fetch(`${http}/api/projects/local/v1/parity`, {
          headers: { authorization: `Bearer ${owner}` },
        })
      ).json();
      assert.equal(parity.ok, true, JSON.stringify(parity));
      const lane = await (
        await fetch(
          `${http}/api/projects/local/v1/lane?doc=${encodeURIComponent(name)}&lane=html&rev=${parity.revision}`,
          { headers: { authorization: `Bearer ${owner}` } }
        )
      ).json();
      assert.ok(
        String(lane.body).includes('written while back in legacy'),
        `the legacy-era work must come forward, not be rolled back: ${String(lane.body).slice(0, 120)}`
      );
    } finally {
      for (const r of readers) r.close();
      await built.server.destroy();
    }
  });

  // F3 S16 (2026-09-23): a second hub process on the same volumes kept stale
  // replicas; switching forward THROUGH it imported its old copy as a
  // "legacy change" and rolled eight accepted revisions back. A value the lane
  // already had before its head is a stale replica, not an edit: it is
  // reported, not imported, and the document is brought to the head.
  test('re-entry never imports a replica that holds an older accepted value', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-rollback-stale-'));
    dirs.push(dataDir);
    const owner = addToken(dataDir, { label: 'owner', scope: '*' }).value;
    const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
    await built.server.listen();
    await built.acceptedReady;
    const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
    const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
    const name = 'ws/local/main/ui-stale';
    const call = async (route, body) => {
      const res = await fetch(`${http}/api/projects/local/v1/${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json() };
    };
    const propose = (epoch, operations) =>
      call('proposals', {
        protocol: 1,
        projectId: 'local',
        epoch,
        transactionId: `tx_stale_${++tx}_${Date.now()}`,
        origin: { deviceId: 'test', sessionId: 's1' },
        action: { kind: 'edit', label: 'stale drill', operations },
      });
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: ws, name, token: owner, document: doc });
    try {
      const on = await call('mode', { mode: 'transactions', expectEpoch: 0 });
      assert.equal(
        (
          await propose(on.body.epoch, [
            { op: 'doc.create', doc: name, path: 'ui/stale.tsx', lanes: { html: src('v1') } },
          ])
        ).status,
        200
      );
      const { createHash } = await import('node:crypto');
      const h = (s) => createHash('sha256').update(s).digest('hex');
      assert.equal(
        (
          await propose(on.body.epoch, [
            { op: 'lane.replace', doc: name, lane: 'html', base: h(src('v1')), content: src('v2') },
          ])
        ).status,
        200
      );
      const back = await call('mode', { mode: 'legacy', expectEpoch: on.body.epoch });
      await until(() => doc.getText('html').toString() === src('v2'), 10000, 'the doc at v2');
      // A stale replica's content reaches the document while legacy.
      doc.transact(() => {
        doc.getText('html').delete(0, doc.getText('html').length);
        doc.getText('html').insert(0, src('v1'));
      });
      await new Promise((r) => setTimeout(r, 600));
      const again = await call('mode', { mode: 'transactions', expectEpoch: back.body.epoch });
      assert.equal(again.status, 200);
      assert.ok(
        again.body.imported.skipped.some((x) => x.doc === name && /stale/.test(x.reason)),
        JSON.stringify(again.body.imported)
      );
      const boot = await call('bootstrap');
      const d = boot.body.docs.find((x) => x.doc === name);
      assert.equal(d.lanes.html.hash, h(src('v2')), 'the head stays the newest accepted value');
      await until(
        () => doc.getText('html').toString() === src('v2'),
        10000,
        'the doc brought to the head'
      );
    } finally {
      provider.destroy();
      doc.destroy();
      await built.server.destroy();
    }
  });
});
