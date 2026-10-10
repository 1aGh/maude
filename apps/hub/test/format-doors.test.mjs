// The project format at the hub's HTTP doors — V2-1.12 §5.4, §5.5, §5.11 F2
// (V2-2.18 H1, H2, H4, H5).
//
//   • the store holds the format (raise-only seed, owner flip, epoch + 1);
//   • every remote home serves the same store API (DO RPC allowlist);
//   • `/health` advertises it + `format-v2`;
//   • `POST /api/project-format` is owner-only (403 / 409 / 422);
//   • every write door refuses a writer of another format with 426 (never
//     401/403 — a pre-compat file plane renews its credential on those) and
//     proposals get a FINAL rejection; reads stay open;
//   • and — the release's whole point — a client that declares nothing keeps
//     working on a format-1 project exactly as before.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { STORE_METHODS } from '../../cells/project-store.mjs';
import { createStoreCore, StoreConflict } from '../src/project-transactions/store-core.mjs';
import { METHODS as REMOTE_METHODS } from '../src/project-transactions/store-remote.mjs';
import { openSqliteProjectStore } from '../src/project-transactions/store-sqlite.mjs';
import { createHub } from '../src/server.mjs';
import { childEnv } from '../src/studio-child.mjs';
import { addToken } from '../src/tokens.mjs';

const COPY = 'This project now uses Maude 2. Update Maude to edit it.';
const dirs = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('the store holds the format (H1)', () => {
  test('absent = 1; a flip bumps the epoch; the same value does not; a stale epoch conflicts', async () => {
    const store = openSqliteProjectStore(tmp('maude-fmt-store-'));
    try {
      assert.equal((await store.state()).formatVersion, 1);
      const flipped = await store.setFormat({ formatVersion: 2, expectEpoch: 0, by: 'o@x' });
      assert.equal(flipped.changed, true);
      assert.equal(flipped.formatVersion, 2);
      assert.equal(flipped.epoch, 1);
      assert.equal(flipped.changedBy, 'o@x');
      assert.match(flipped.changedAt, /^\d{4}-\d\d-\d\dT/);
      const same = await store.setFormat({ formatVersion: 2, by: 'o@x' });
      assert.equal(same.changed, false);
      assert.equal(same.epoch, 1);
      await assert.rejects(
        store.setFormat({ formatVersion: 1, expectEpoch: 0 }),
        (e) => e instanceof StoreConflict && e.code === 'epoch-stale'
      );
      await assert.rejects(store.setFormat({ formatVersion: 1.5 }), /invalid formatVersion/);
      // The checkout seed only raises — and only ONCE, before any decision:
      // after the owner set the format, a checkout can neither undo nor redo it.
      assert.equal((await store.raiseFormat(1)).changed, false);
      assert.equal((await store.state()).formatVersion, 2);
      // A mode switch carries the format through.
      const moded = await store.setMode({ mode: 'legacy', expectEpoch: 1 });
      assert.equal(moded.formatVersion, 2);
      assert.equal((await store.setFormat({ formatVersion: 1, by: 'o@x' })).formatVersion, 1);
      assert.equal((await store.raiseFormat(2)).changed, false, 'an owner decision stands');
      assert.equal((await store.state()).formatVersion, 1);
      // A fresh store takes the seed once.
      const fresh = openSqliteProjectStore(tmp('maude-fmt-store-'));
      try {
        assert.equal((await fresh.raiseFormat(2)).changed, true);
        assert.equal((await fresh.state()).formatVersion, 2);
      } finally {
        fresh.close();
      }
    } finally {
      store.close();
    }
  });

  test('every remote home serves the whole store API — the cell DO allowlist included', () => {
    const fake = { exec: () => [], transaction: (fn) => fn() };
    const api = Object.keys(createStoreCore(fake))
      .filter((k) => k !== 'migrate')
      .sort();
    assert.deepEqual([...REMOTE_METHODS].sort(), api, 'store-remote.mjs METHODS');
    assert.deepEqual([...STORE_METHODS].sort(), api, 'apps/cells/project-store.mjs STORE_METHODS');
    assert.ok(api.includes('setFormat') && api.includes('raiseFormat'));
  });

  test('the studio child is pointed at the hub-owned format file, and only when given one', () => {
    assert.equal(
      childEnv({ PATH: '/bin' }, { port: 1, formatFile: '/data/project-format.json' })
        .MAUDE_HUB_FORMAT_FILE,
      '/data/project-format.json'
    );
    assert.equal('MAUDE_HUB_FORMAT_FILE' in childEnv({ PATH: '/bin' }, { port: 1 }), false);
  });
});

/** A workspace hub with a checkout, so the file plane's doors are live. */
async function startHub({ checkoutFormat } = {}) {
  const dataDir = tmp('maude-fmt-doors-data-');
  const repoDir = tmp('maude-fmt-doors-repo-');
  mkdirSync(join(repoDir, '.design', 'assets'), { recursive: true });
  writeFileSync(
    join(repoDir, '.design', 'config.json'),
    JSON.stringify({
      name: 'fmt',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      ...(checkoutFormat ? { formatVersion: checkoutFormat } : {}),
    })
  );
  const env = {
    HUB_WORKSPACE_MODE: process.env.HUB_WORKSPACE_MODE,
    MAUDE_STUDIO_CHILD: process.env.MAUDE_STUDIO_CHILD,
    MAUDE_REPO_DIR: process.env.MAUDE_REPO_DIR,
  };
  process.env.HUB_WORKSPACE_MODE = '1';
  process.env.MAUDE_STUDIO_CHILD = '0';
  process.env.MAUDE_REPO_DIR = repoDir;
  const owner = addToken(dataDir, { label: 'owner', scope: '*', role: 'owner' }).value;
  const member = addToken(dataDir, {
    label: 'member',
    scope: '*',
    role: 'member',
    owner: 'm@x.test',
  }).value;
  const viewer = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const stop = async () => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await built.stopJournal?.();
    await built.server.destroy();
    built.projectStore?.close?.();
  };
  return { built, http, owner, member, viewer, stop, dataDir, repoDir };
}

function caller(http, token, format) {
  const headers = (extra = {}) => ({
    authorization: `Bearer ${token}`,
    ...(format === undefined ? {} : { 'x-maude-format': String(format) }),
    ...extra,
  });
  const go = async (method, path, body, extra) => {
    const res = await fetch(`${http}${path}`, {
      method,
      headers: headers(extra),
      ...(body === undefined ? {} : { body }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json, text };
  };
  return {
    put: (p, b, h) => go('PUT', p, b, h),
    post: (p, b, h) =>
      go('POST', p, typeof b === 'string' ? b : JSON.stringify(b), {
        'content-type': 'application/json',
        ...h,
      }),
    del: (p, h) => go('DELETE', p, undefined, h),
    get: (p) => go('GET', p),
  };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const proposal = (epoch) =>
  JSON.stringify({
    protocol: 1,
    projectId: 'local',
    epoch,
    transactionId: `tx_fmt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    origin: { deviceId: 'test', sessionId: 's1' },
    action: { kind: 'edit', label: 'x', operations: [{ op: 'dir.create', path: 'ui/X' }] },
  });

describe('the doors on a real hub (H4, H5)', () => {
  test('format 1: a client that declares nothing writes exactly as before; /health advertises', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const health = await (await fetch(`${hub.http}/health`)).json();
      assert.equal(health.formatVersion, 1);
      assert.ok(health.capabilities.includes('format-v2'));
      assert.ok(health.capabilities.includes('annotations-v2'), 'nothing taken away');
      const v1 = caller(hub.http, hub.member);
      const put = await v1.put('/api/file/assets/a.png', PNG, { 'content-type': 'image/png' });
      assert.equal(put.status, 200, `v1 file write on format 1: ${put.text}`);
      const del = await v1.del('/api/file/assets/a.png', {
        'x-maude-expect-hash': createHash('sha256').update(PNG).digest('hex'),
      });
      assert.notEqual(del.status, 426);
      assert.ok(del.status < 300, `v1 delete on format 1: ${del.status} ${del.text}`);
      // A v1 proposal on a legacy-mode format-1 project gets today's answer.
      const prop = await v1.post('/api/projects/local/v1/proposals', proposal(0));
      assert.equal(prop.body.code, 'mode-off');
      // A declared format-2 writer on a format-1 project is the mismatched one.
      const v2 = caller(hub.http, hub.member, 2);
      const refused = await v2.put('/api/file/assets/b.png', PNG, { 'content-type': 'image/png' });
      assert.equal(refused.status, 426);
    } finally {
      await hub.stop();
    }
  });

  test('POST /api/project-format: owner only; 400 / 422 / 409; same value = no bump', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const owner = caller(hub.http, hub.owner);
      assert.equal(
        (await caller(hub.http, hub.member).post('/api/project-format', { formatVersion: 2 }))
          .status,
        403
      );
      const asViewer = await caller(hub.http, hub.viewer).post('/api/project-format', {
        formatVersion: 2,
      });
      assert.equal(asViewer.status, 403);
      // An admin-console invite is ROLE-LESS (the save-mode switch counts it as
      // admin); it must not flip the format. Nor an owner scoped to one canvas.
      const invite = addToken(hub.dataDir, { label: 'invitee', scope: '*' }).value;
      assert.equal(
        (await caller(hub.http, invite).post('/api/project-format', { formatVersion: 2 })).status,
        403
      );
      const scopedOwner = addToken(hub.dataDir, {
        label: 'scoped-owner',
        scope: 'ws/local/main/ui-a',
        role: 'owner',
      }).value;
      assert.equal(
        (await caller(hub.http, scopedOwner).post('/api/project-format', { formatVersion: 2 }))
          .status,
        403
      );
      // A form post (what a cross-site page can send) is refused before the body.
      const form = await fetch(`${hub.http}/api/project-format`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${hub.owner}`,
          'content-type': 'text/plain',
        },
        body: '{"formatVersion":2}',
      });
      assert.equal(form.status, 415);
      assert.equal((await (await fetch(`${hub.http}/health`)).json()).formatVersion, 1);
      assert.equal(
        (await fetch(`${hub.http}/api/project-format`, { method: 'POST', body: '{}' })).status,
        401
      );
      assert.equal((await owner.post('/api/project-format', { formatVersion: '2' })).status, 400);
      const tooNew = await owner.post('/api/project-format', { formatVersion: 3 });
      assert.equal(tooNew.status, 422);
      assert.deepEqual(tooNew.body, { code: 'format-unsupported', max: 2 });
      assert.equal((await owner.post('/api/project-format', 'not json')).status, 400);
      const stale = await owner.post('/api/project-format', { formatVersion: 2, expectEpoch: 7 });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, 'epoch-stale');
      // The migrator declares format 2 on the flip; the door must not refuse it.
      const ok = await caller(hub.http, hub.owner, 2).post('/api/project-format', {
        formatVersion: 2,
        expectEpoch: 0,
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.formatVersion, 2);
      assert.equal(ok.body.epoch, 1);
      assert.equal(ok.body.changedBy, 'owner');
      const again = await owner.post('/api/project-format', { formatVersion: 2 });
      assert.equal(again.status, 200);
      assert.equal(again.body.epoch, 1, 'same value, no epoch bump');
      assert.equal((await (await fetch(`${hub.http}/health`)).json()).formatVersion, 2);
      assert.equal((await owner.get('/api/project-format')).status, 405);
    } finally {
      await hub.stop();
    }
  });

  test('format 2: every write door answers 426 to a mismatched writer; reads stay open', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      await caller(hub.http, hub.owner).post('/api/project-format', { formatVersion: 2 });
      const v1 = caller(hub.http, hub.member);
      const doors = [
        ['PUT', '/api/file/assets/a.png', () => v1.put('/api/file/assets/a.png', PNG)],
        ['DELETE', '/api/file/assets/a.png', () => v1.del('/api/file/assets/a.png')],
        [
          'POST',
          '/api/file-uploads',
          () => v1.post('/api/file-uploads', { path: 'assets/big.mp4' }),
        ],
        ['PUT', '/api/project-config', () => v1.put('/api/project-config', '{"name":"x"}')],
        ['PUT', '/assets/<key>', () => v1.put('/assets/abc.png', PNG)],
        ['PUT', '/_asset-file/<rel>', () => v1.put('/_asset-file/assets/c.png', PNG)],
        ['POST', '/api/studio/comments', () => v1.post('/api/studio/comments', { text: 'hi' })],
        ['DELETE', '/api/documents/<doc>', () => v1.del('/api/documents/ws%2Flocal%2Fmain%2Fui-a')],
      ];
      for (const [method, path, call] of doors) {
        const r = await call();
        assert.equal(r.status, 426, `${method} ${path} → ${r.status} ${r.text}`);
        assert.deepEqual(r.body, { error: COPY, reason: 'format', formatVersion: 2 });
      }
      // An explicit format-1 declaration is the same writer.
      assert.equal(
        (await caller(hub.http, hub.member, 1).put('/api/file/assets/a.png', PNG)).status,
        426
      );
      // Proposals: a FINAL rejection (every client generation drops it).
      const prop = await v1.post('/api/projects/local/v1/proposals', proposal(1));
      assert.equal(prop.status, 426);
      assert.equal(prop.body.status, 'rejected');
      assert.equal(prop.body.code, 'format');
      assert.equal(prop.body.formatVersion, 2);
      assert.equal(prop.body.error, COPY);
      // The matching writer passes every door the 426 guards.
      const v2 = caller(hub.http, hub.member, 2);
      const put = await v2.put('/api/file/assets/a.png', PNG, { 'content-type': 'image/png' });
      assert.equal(put.status, 200, put.text);
      const prop2 = await v2.post('/api/projects/local/v1/proposals', proposal(1));
      assert.notEqual(prop2.body?.code, 'format');
      // Reads, for everyone.
      assert.equal((await v1.get('/api/files')).status, 200);
      assert.equal((await v1.get('/api/projects/local/v1/bootstrap')).body.formatVersion, 2);
      assert.equal((await v1.get('/api/documents')).status, 200);
      // A viewer is refused by the read-only gate first (403), unchanged.
      assert.equal(
        (await caller(hub.http, hub.viewer).put('/api/file/assets/a.png', PNG)).status,
        403
      );
      // An asset presence probe is a read sent as POST — not gated.
      assert.notEqual((await v1.post('/_asset-probe', { keys: [] })).status, 426);
    } finally {
      await hub.stop();
    }
  });

  test('the checkout seeds the store raise-only (the cell boot)', { timeout: 60000 }, async () => {
    const hub = await startHub({ checkoutFormat: 2 });
    try {
      assert.equal((await (await fetch(`${hub.http}/health`)).json()).formatVersion, 2);
      assert.equal((await hub.built.projectStore.state()).formatVersion, 2);
      // The hub never writes into the tenant's checkout (DDR-054): its
      // child's mirror lives in the hub's own data dir (studio-child env).
      assert.equal(existsSync(join(hub.repoDir, '.design', '_state', 'hub-format.json')), false);
    } finally {
      await hub.stop();
    }
  });
});
