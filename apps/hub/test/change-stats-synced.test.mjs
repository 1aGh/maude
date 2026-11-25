// A canvas edited over live sync (the Yjs document path) is a change.
//
// A real hub, a real provider. On a project that does NOT save through
// accepted revisions the edit never becomes a file-journal row a person made
// (the hub's own walk records the materialized file) and never becomes a store
// action — so it is counted where every such edit passes exactly once: the
// debounced store of the document. A burst of keystrokes inside one flush is
// ONE change. The count is on disk: it survives a restart.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeAudit } from '../src/audit-log.mjs';
import { _resetChangeStats } from '../src/change-stats.mjs';
import { addToken } from '../src/tokens.mjs';
import { openDoc, rm, startHub, tmpDir, until } from './_acl-docs-fixture.mjs';

const dataDir = tmpDir('maude-changes-synced-');
let hub = null;
after(async () => {
  await hub?.close();
  closeAudit(dataDir);
  rm(dataDir);
});

const overview = async () => {
  _resetChangeStats();
  const res = await fetch(`${hub.http}/admin/api/overview`, {
    headers: { authorization: 'Bearer test-secret' },
  });
  return res.json();
};
const week = async () => (await overview()).counts.changesThisWeek;

test('a synced canvas edit counts once per flush, a burst is one change, and the count survives a restart', async () => {
  const token = addToken(dataDir, {
    label: 'marek-mac',
    scope: '*',
    role: 'member',
    owner: 'marek@x.test',
  }).value;
  hub = await startHub(dataDir, { rateLimit: false, env: {} });
  assert.equal(
    'changesThisWeek' in (await overview()).counts,
    false,
    'nothing known yet: absent, not 0'
  );

  const a = await openDoc(hub.ws, token, 'ui-welcome', { keep: true });
  const b = await openDoc(hub.ws, token, 'ui-welcome', { keep: true });
  assert.equal(a.status, 'synced');

  // one edit → it reaches the other peer → one change once the hub has stored it
  a.doc.getText('body').insert(0, 'export default () => <p>one</p>;');
  await until(
    () => b.doc.getText('body').toString().includes('one'),
    5000,
    'the edit reaching peer B'
  );
  await until(async () => (await week()) === 1, 9000, 'the first flushed edit being counted');

  // a burst of keystrokes inside one flush → still one more change, not fifty
  for (let i = 0; i < 50; i++) b.doc.getText('body').insert(0, 'x');
  await until(async () => (await week()) === 2, 9000, 'the burst being counted');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await week(), 2, 'fifty keystrokes in one flush are one change');

  // merely opening and reading a canvas is not a change
  const reader = await openDoc(hub.ws, token, 'ui-welcome', { keep: true });
  reader.close();
  a.close();
  b.close();

  const o = await overview();
  assert.equal(o.changesByDay.length, 30);
  assert.equal(o.changesByDay[29].count, 2);

  await hub.close();
  closeAudit(dataDir);
  hub = await startHub(dataDir, { rateLimit: false, env: {} });
  assert.equal(
    await week(),
    2,
    'still there after a restart — and loading the document did not add one'
  );
});
