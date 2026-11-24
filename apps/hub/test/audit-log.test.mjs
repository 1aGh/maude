// The kept activity log (audit-log.mjs): it survives a restart, it is bounded,
// it can be searched, and it never holds a credential.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  auditCsv,
  closeAudit,
  countAuditSince,
  listAudit,
  RETENTION_MS,
  recordAudit,
  scrub,
} from '../src/audit-log.mjs';

const dirs = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), 'maude-audit-'));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) {
    closeAudit(d);
    rmSync(d, { recursive: true, force: true });
  }
});

test('an event is still there after the store is closed and opened again', () => {
  const d = fresh();
  recordAudit(d, {
    kind: 'role-change',
    actor: 'michal@x.test',
    target: 'jonas@x.test',
    detail: 'Can edit → Admin',
  });
  closeAudit(d); // what a restart does
  const rows = listAudit(d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, 'michal@x.test');
  assert.equal(rows[0].target, 'jonas@x.test');
  assert.equal(rows[0].area, 'people');
  assert.ok(rows[0].at > 0);
});

test('filters: an area, one kind, a person (as actor or target), free text, paging', () => {
  const d = fresh();
  recordAudit(d, { kind: 'login', actor: 'anna@x.test' });
  recordAudit(d, { kind: 'invite-create', actor: 'michal@x.test', target: 'petra@x.test' });
  recordAudit(d, { kind: 'user-disable', actor: 'michal@x.test', target: 'anna@x.test' });
  recordAudit(d, { kind: 'settings', actor: 'michal@x.test', detail: 'Who can join: invite-only' });
  recordAudit(d, { kind: 'backup', detail: 'Backup made' });

  assert.deepEqual(
    listAudit(d, { kind: 'people' }).map((r) => r.kind),
    ['user-disable', 'invite-create']
  );
  assert.deepEqual(
    listAudit(d, { kind: 'login' }).map((r) => r.kind),
    ['login']
  );
  assert.deepEqual(
    listAudit(d, { who: 'ANNA@x.test' }).map((r) => r.kind),
    ['user-disable', 'login']
  );
  assert.deepEqual(
    listAudit(d, { q: 'invite-only' }).map((r) => r.kind),
    ['settings']
  );
  assert.deepEqual(listAudit(d, { q: '%' }), [], 'a LIKE wildcard is text, not a wildcard');
  const page = listAudit(d, { limit: 2 });
  assert.equal(page.length, 2);
  const next = listAudit(d, { limit: 2, before: page[1].id });
  assert.equal(next.length, 2);
  assert.ok(next[0].id < page[1].id);
  assert.equal(listAudit(d, { kind: 'server' })[0].kind, 'backup');
});

test('rows older than the retention are dropped when the store opens', () => {
  const d = fresh();
  recordAudit(d, { kind: 'login', actor: 'old@x.test', at: Date.now() - RETENTION_MS - 1000 });
  recordAudit(d, { kind: 'login', actor: 'new@x.test' });
  closeAudit(d);
  assert.deepEqual(
    listAudit(d).map((r) => r.actor),
    ['new@x.test']
  );
  assert.equal(countAuditSince(d, Date.now() - 7 * 86_400_000), 1);
});

test('a credential never reaches the log, even when a caller passes one', () => {
  const invite = `inv_${'ab'.repeat(24)}`;
  const token = `mau_${'0f'.repeat(16)}`;
  const d = fresh();
  recordAudit(d, {
    kind: 'invite-create',
    actor: 'a@x.test',
    target: invite,
    detail: `link /join/${invite} token ${token} key ${'c'.repeat(64)}`,
  });
  const row = listAudit(d)[0];
  const text = JSON.stringify(row);
  assert.ok(!text.includes(invite));
  assert.ok(!text.includes(token));
  assert.ok(!text.includes('c'.repeat(64)));
  assert.equal(scrub('petra@studyfi.com'), 'petra@studyfi.com', 'an address is not a secret');
  assert.equal(scrub('line\r\nbreak').includes('\n'), false);
});

test('the CSV quotes every cell and defuses a formula', () => {
  const csv = auditCsv([
    { at: 0, actor: '=cmd()', kind: 'login', target: 'a"b', detail: 'x,y', area: 'signin' },
  ]);
  const [head, line] = csv.split('\r\n');
  assert.equal(head, 'when,who,what,about,detail,where');
  assert.match(line, /"'=cmd\(\)"/);
  assert.match(line, /"a""b"/);
  assert.match(line, /"x,y"/);
});
