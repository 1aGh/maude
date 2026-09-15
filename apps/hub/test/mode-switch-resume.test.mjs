// Plan T30 — a switch into accepted revisions that dies between persisting the
// mode and finishing the import is finished by the next start, never left as a
// project whose store lacks documents its peers still hold.
//
// The switch's order is its safety argument (hub-integration.mjs `setMode`):
// persist mode + epoch first, import after. This test kills the process at
// exactly that seam — the mode is written through the store itself, nothing is
// imported — then starts a fresh hub on the same data directory.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { openSqliteProjectStore } from '../src/project-transactions/store-sqlite.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function until(fn, ms = 10000, what = 'condition') {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error(`${what} not reached before deadline`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function startHub(dataDir) {
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  return { built, http: built.server.httpURL.replace('0.0.0.0', '127.0.0.1') };
}

async function stopHub(built) {
  await built.server.destroy();
  built.projectStore.close();
}

const src = (title) => `export default () => <h1 title="${title}">x</h1>;\n`;

describe('T30 — resuming an interrupted switch', () => {
  test('a switch that died before its import is finished by the next start', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-switch-resume-'));
    dirs.push(dataDir);
    const owner = addToken(dataDir, { label: 'owner', scope: '*' }).value;
    const alice = addToken(dataDir, {
      label: 'alice',
      scope: '*',
      role: 'member',
      owner: 'a@x.test',
    }).value;
    const get = async (http, path) =>
      (await fetch(`${http}${path}`, { headers: { authorization: `Bearer ${owner}` } })).json();

    // 1. A legacy project with one canvas, written the way every client did.
    let { built, http } = await startHub(dataDir);
    const name = 'ws/local/main/ui-kept';
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1'),
      name,
      token: alice,
      document: doc,
    });
    try {
      await until(() => provider.isSynced, 30000, 'legacy writer synced');
      doc.transact(() => {
        doc.getText('html').insert(0, src('kept'));
        doc.getMap('syncMeta').set('path', 'ui/kept.tsx');
      });
      await until(
        async () =>
          ((await get(http, '/api/documents')).documents ?? []).some(
            (d) => d.name === name && d.bytes > 0
          ),
        10000,
        'legacy document persisted'
      );
    } finally {
      provider.destroy();
      doc.destroy();
    }
    await stopHub(built);

    // 2. The switch's first step and nothing after it: mode + epoch persisted,
    //    no import (the process died here).
    const store = openSqliteProjectStore(dataDir);
    const at = await store.setMode({ mode: 'transactions', expectEpoch: 0 });
    assert.equal(at.importPending, true);
    assert.equal((await store.manifest()).docs.length, 0, 'nothing imported yet');
    store.close();

    // 3. The next start finishes it before anything is served.
    ({ built, http } = await startHub(dataDir));
    try {
      const boot = await get(http, '/api/projects/current/v1/bootstrap');
      assert.equal(boot.mode, 'transactions');
      assert.ok(
        boot.docs.some((d) => d.path === 'ui/kept.tsx' && !d.retired),
        `the canvas is part of the project: ${JSON.stringify(boot.docs)}`
      );
      const parity = await get(http, '/api/projects/current/v1/parity');
      assert.equal(parity.ok, true, JSON.stringify(parity));
      const history = await get(http, '/api/projects/current/v1/history');
      assert.ok(
        (history.history ?? []).some((h) => /baseline/i.test(h.label ?? '')),
        'the resumed import is an ordinary, attributable project action'
      );
    } finally {
      await stopHub(built);
    }

    // 4. …and a finished import is not re-run on the start after that.
    const after = openSqliteProjectStore(dataDir);
    try {
      assert.equal((await after.state()).importPending, false);
      const revision = (await after.state()).revision;
      after.close();
      ({ built, http } = await startHub(dataDir));
      try {
        assert.equal((await get(http, '/api/projects/current/v1/mode')).revision, revision);
      } finally {
        await stopHub(built);
      }
    } catch (err) {
      try {
        after.close();
      } catch {}
      throw err;
    }
  });

  test('a completed switch clears the note; switching back to legacy never sets it', {
    timeout: 30000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-switch-note-'));
    dirs.push(dataDir);
    const owner = addToken(dataDir, { label: 'owner', scope: '*' }).value;
    const { built, http } = await startHub(dataDir);
    const post = async (body) =>
      (
        await fetch(`${http}/api/projects/current/v1/mode`, {
          method: 'POST',
          headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json();
    try {
      const switched = await post({ mode: 'transactions', expectEpoch: 0 });
      assert.equal(switched.importPending, false, 'the answer reports the finished import');
      assert.equal((await built.projectStore.state()).importPending, false);
      await post({ mode: 'legacy' });
      assert.equal((await built.projectStore.state()).importPending, false);
    } finally {
      await stopHub(built);
    }
  });
});
