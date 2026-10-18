// S9.11 — V2-1.16 L16: `/_sync-status` is `project`-class. An A-only session gets 403
// `not-in-scope` with no slug in the body; a project session gets today's body (U7).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { A_ONLY, type AclCell, bootAclCell, get, hasCanary, OWNER, VIEWER } from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

let cell: AclCell;
beforeAll(async () => {
  cell = await bootAclCell();
  // sync trouble naming B — stamped after the process started, so it is the live answer
  writeFileSync(
    join(cell.designRoot, '_sync.json'),
    JSON.stringify({
      linked: true,
      state: 'online',
      updatedAt: Date.now() + 60_000,
      rejectedSlugs: ['ui-canary-b-zx'],
      conflicts: [{ slug: 'ui-canary-b-zx' }],
    })
  );
}, 60000);
afterAll(async () => {
  if (cell) await killProc(cell.proc);
});

test('an A-only session: /_sync-status → 403 not-in-scope, no slug', async () => {
  const r = await get(`${cell.base}/_sync-status`, A_ONLY);
  expect(r.status).toBe(403);
  expect(JSON.parse(r.text)).toEqual({ error: 'not-in-scope', reason: 'not-in-scope' });
  expect(hasCanary(r.text)).toBe(false);
});

test('project sessions keep the full sync status (U7)', async () => {
  for (const who of [OWNER, VIEWER]) {
    const r = await get(`${cell.base}/_sync-status`, who);
    expect(r.status).toBe(200);
    expect(hasCanary(r.text)).toBe(true);
  }
});
