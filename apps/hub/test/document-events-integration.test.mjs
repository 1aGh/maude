import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error('Expected real control notification before deadline');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('real persisted document and authorized delete/revive invalidate scoped discovery', {
  timeout: 25000,
}, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-doc-events-'));
  const token = addToken(dataDir, { label: 'designer', scope: '*', role: 'designer' }).value;
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  const providers = [];
  const documents = [];
  try {
    await built.server.listen();
    const url = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
    const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
    const open = (name, document, onStateless) => {
      const p = new HocuspocusProvider({
        url,
        name,
        token,
        document,
        ...(onStateless ? { onStateless } : {}),
      });
      providers.push(p);
      documents.push(document);
      return p;
    };
    const frames = [];
    const ctl = open('maude.files', new Y.Doc(), ({ payload }) => frames.push(JSON.parse(payload)));
    await until(() => ctl.synced);
    const doc = new Y.Doc();
    doc.getMap('syncMeta').set('path', 'ui/New.tsx');
    doc.getText('html').insert(0, 'export default () => <h1>new</h1>');
    open('ui-new', doc);
    await until(() => frames.some((f) => f.documents === true));
    const headers = { authorization: `Bearer ${token}` };
    const listing = await (await fetch(`${http}/api/documents`, { headers })).json();
    assert.ok(listing.documents.some((d) => d.name === 'ui-new' && d.bytes > 0));
    let before = frames.length;
    const removed = await fetch(`${http}/api/documents/ui-new`, { method: 'DELETE', headers });
    assert.equal(removed.status, 200);
    await until(() => frames.length > before);
    const afterDelete = await (await fetch(`${http}/api/documents`, { headers })).json();
    assert.ok(afterDelete.tombstones.some((d) => d.name === 'ui-new'));
    before = frames.length;
    const revived = await fetch(`${http}/api/documents/ui-new`, { method: 'POST', headers });
    assert.equal(revived.status, 200);
    await until(() => frames.length > before);
    const afterRevive = await (await fetch(`${http}/api/documents`, { headers })).json();
    assert.ok(!afterRevive.tombstones.some((d) => d.name === 'ui-new'));
    assert.ok(frames.every((f) => !('path' in f) && !('name' in f)));
    const viewer = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;
    before = frames.length;
    const refused = await fetch(`${http}/api/documents/ui-new`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${viewer}` },
    });
    assert.equal(refused.status, 403);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(frames.length, before, 'a refused mutation must not invalidate membership');
  } finally {
    for (const p of providers) p.destroy();
    for (const doc of documents) doc.destroy();
    await built.stopJournal();
    await built.server.destroy();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
