#!/usr/bin/env node
// S02 on the Docker self-host hub, through its real operator + join doors:
// expired and revoked invitations create no account; a view-only invite is
// refused (a hub's accounts are admin | member); a removed designer loses write
// and live access while their accepted work stays in history; a same-named
// project on ANOTHER server is a different project that this server's
// credentials cannot open.
//   node s02-selfhost.mjs --work <dir> --other <second hub dir>
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { canvasSource, loadBackend, sha } from './backend.mjs';
const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

const argv = process.argv.slice(2);
const arg = (n) => argv[argv.indexOf(`--${n}`) + 1];
const work = arg('work');
const fx = JSON.parse(readFileSync(join(work, 'fixture.json'), 'utf8'));
const admin = { authorization: `Bearer ${fx.operatorSecret}`, 'content-type': 'application/json' };
const post = async (url, body, headers = { 'content-type': 'application/json' }) => {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual' });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// The hub rate-limits its unauthenticated doors (a real control): wait out a 429.
const door = async (url, body) => {
  for (let i = 0; i < 12; i++) {
    const r = await post(url, body);
    if (r.status !== 429) return r;
    await new Promise((res) => setTimeout(res, 15000));
  }
  throw new Error(`${url} still rate limited`);
};
const users = async () =>
  (await (await fetch(`${fx.url}/admin/api/users`, { headers: admin })).json()).users.map((u) => u.email);
const results = {};
async function signIn(url, u) {
  for (let i = 0; i < 12; i++) {
    const r = await post(`${url}/auth/login`, u);
    if (r.status === 200) return { token: r.body.token, role: r.body.user?.role ?? null };
    if (r.status !== 429) throw new Error(`login ${r.status}`);
    await new Promise((res) => setTimeout(res, 15000));
  }
  throw new Error('still rate limited');
}
const tag = randomBytes(3).toString('hex');

// Expired invitation — expiry moved into the past only in this disposable hub's store.
{
  const email = `expired-${tag}@f3-selfhost.invalid`;
  const inv = await post(`${fx.url}/admin/api/invites`, { email, role: 'member' }, admin);
  assert.equal(inv.status, 201);
  const require = createRequire(join(REPO, 'apps/hub/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(work, 'data', 'invites.db'));
  db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, inv.body.invite.id);
  db.close();
  const joined = await door(`${fx.url}/join`, { token: inv.body.value, email, password: `pw-${tag}-expired-long` });
  assert.ok(joined.status >= 400, `expired invite refused (${joined.status})`);
  assert.ok(!(await users()).includes(email), 'no account created');
  results.expiredInvite = { status: joined.status, accountCreated: false };
}

// Revoked invitation.
{
  const email = `revoked-${tag}@f3-selfhost.invalid`;
  const inv = await post(`${fx.url}/admin/api/invites`, { email, role: 'member' }, admin);
  const rev = await post(`${fx.url}/admin/api/invites/revoke`, { id: inv.body.invite.id }, admin);
  assert.equal(rev.status, 200);
  const joined = await door(`${fx.url}/join`, { token: inv.body.value, email, password: `pw-${tag}-revoked-long` });
  assert.ok(joined.status >= 400, `revoked invite refused (${joined.status})`);
  assert.ok(!(await users()).includes(email), 'no account created');
  results.revokedInvite = { status: joined.status, accountCreated: false };
}

// View-only invitation: refused, never minted as a writer.
{
  const inv = await post(`${fx.url}/admin/api/invites`, { email: `viewer-${tag}@f3-selfhost.invalid`, role: 'viewer' }, admin);
  assert.equal(inv.status, 400);
  results.viewerInvite = { status: inv.status, error: inv.body?.error };
}

// A designer who is removed: loses write + live access; accepted work stays.
{
  const u = { email: `removed-${tag}@f3-selfhost.invalid`, password: `pw-${tag}-removed-designer` };
  const inv = await post(`${fx.url}/admin/api/invites`, { email: u.email, role: 'member' }, admin);
  assert.equal((await door(`${fx.url}/join`, { token: inv.body.value, ...u })).status, 201);
  const session = await signIn(fx.url, u);
  const B = await loadBackend('selfhost', { work });
  B.tokens.c = session;
  const name = `F3Removed${tag}`;
  const src = canvasSource(name, 'By a designer who leaves');
  const doc = `ui-${name.toLowerCase()}`;
  const made = await B.propose('c', [{ op: 'doc.create', doc, path: `ui/${name}.tsx`, lanes: { html: src } }]);
  assert.equal(made.status, 200, 'designer can write before removal');
  const disabled = await post(`${fx.url}/admin/api/users/disable`, { email: u.email }, admin);
  assert.equal(disabled.status, 200);
  const epoch = (await B.bootstrap('owner')).epoch;
  const after = await B.propose(
    'c',
    [{ op: 'lane.replace', doc, lane: 'html', base: sha(src), content: src.replace('leaves', 'lingers') }],
    { epoch }
  );
  const readAfter = await B.api('c', 'bootstrap');
  assert.equal(readAfter.status, 401, 'removed designer cannot read either');
  assert.ok([401, 403].includes(after.status), `removed designer cannot write (${after.status})`);
  const relogin = await door(`${fx.url}/auth/login`, u);
  assert.ok(relogin.status >= 400, `removed designer cannot sign in again (${relogin.status})`);
  const kept = (await B.doc(doc, 'owner')).source;
  assert.equal(kept, src, 'their accepted work is still the project state');
  const hist = await B.history('owner', 20);
  assert.ok(hist.some((h) => h.actor === u.email), 'history still names them');
  results.removedDesigner = {
    revoked: disabled.body.revoked,
    kicked: disabled.body.kicked,
    writeAfterRemoval: after.status,
    readAfterRemoval: readAfter.status,
    signInAfterRemoval: relogin.status,
    acceptedWorkKept: true,
  };
}

// Same project name on another server is another project.
{
  const other = JSON.parse(readFileSync(join(arg('other'), 'fixture.json'), 'utf8'));
  const B = await loadBackend('selfhost', { work });
  const O = await loadBackend('selfhost', { work: arg('other') });
  const here = await B.bootstrap('a');
  const there = await O.bootstrap('a');
  assert.notEqual(here.projectId, there.projectId, 'distinct project identity');
  const cross = await fetch(`${other.url}/api/projects/current/v1/bootstrap`, {
    headers: { authorization: `Bearer ${B.tokens.a.token}` },
  });
  assert.equal(cross.status, 401, "this server's credential is not accepted by the other");
  results.sameNameOtherServer = {
    projectName: 'F3 self-host (both)',
    projectIds: [here.projectId, there.projectId],
    crossCredentialStatus: cross.status,
  };
}

console.log(JSON.stringify({ id: 'S02', backend: 'selfhost', status: 'pass', ...results }, null, 2));
