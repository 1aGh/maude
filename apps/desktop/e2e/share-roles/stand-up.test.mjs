// Headless proof that the share-roles runner's world does what scenarios/share-roles.e2e.ts expects of it —
// no wdio, no screen. It boots the REAL rig (hub + control plane + Lukáš's studio), then plays the owner's
// part over the hub's own HTTP API (what the Share sheet's buttons call) and the scenario's part over the
// rig's loopback control, and asserts what each person ends up holding:
//
//   node --test --test-force-exit apps/desktop/e2e/share-roles/stand-up.test.mjs   (Node 24, bun on PATH)
//
// Heavy (a hub, a control plane, up to four studios): not in a default suite. Run on the mini with
//   scripts/remote-lane.sh --slot auto -- node --test --test-force-exit apps/desktop/e2e/share-roles/stand-up.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { standUp } from './stand-up.mjs';

let rig;
before(
  async () => {
    rig = await standUp();
    // The native app runs its own sidecar on the owner's project; a studio on the same folder, same
    // credentials, stands in for it so the canvases reach the hub.
    await rig.startOwnerStudio();
  },
  { timeout: 180_000 }
);
after(async () => {
  await rig?.stop();
});

const hub = (path, { token, method = 'GET', body } = {}) =>
  fetch(`${rig.hub.http}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-maude-access': '2',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const docs = async (token) =>
  ((await json(await hub('/api/documents', { token })))?.documents ?? []).map((d) => d.name);
const json = async (res) => res.json().catch(() => null);
const control = (path, body = {}) =>
  fetch(new URL(path, rig.run.lifecycle), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const hubsOf = (who) => JSON.parse(readFileSync(rig.studios[who].hubs, 'utf8')).hubs[rig.hub.http];
const until = async (what, fn, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`${what}: not within ${ms} ms`);
};

describe('the run file', () => {
  it('names everything wdio.share-roles.conf.ts insists on', () => {
    const run = JSON.parse(readFileSync(rig.runFile, 'utf8'));
    for (const key of ['out', 'nativeProject', 'ownerHubs', 'project', 'canvas', 'lifecycle'])
      assert.equal(typeof run[key], 'string', key);
    for (const who of ['petra', 'lukas', 'viewer'])
      assert.equal(typeof run[who].name, 'string', who);
    assert.match(run.canvas, /^ui\/[^/.][^/]*\.tsx$/);
    for (const u of [run.lifecycle, run.lukas.url]) {
      assert.ok(['127.0.0.1', 'localhost'].includes(new URL(u).hostname), u);
    }
    assert.ok(existsSync(join(run.nativeProject, '.design', run.canvas)));
    assert.equal(typeof run.petra.email, 'string');
    // The owner's app is linked to the rig's hub and holds the owner's credential, nothing else.
    const cfg = JSON.parse(readFileSync(join(run.nativeProject, '.design/config.json'), 'utf8'));
    assert.equal(cfg.linkedHub.url, rig.hub.http);
    const hubs = JSON.parse(readFileSync(run.ownerHubs, 'utf8')).hubs;
    assert.deepEqual(Object.keys(hubs), [rig.hub.http]);
    assert.equal(hubs[rig.hub.http].role, 'owner');
    const links = JSON.parse(readFileSync(join(run.ownerHubs, '..', 'project-links.json'), 'utf8'));
    assert.equal(Object.values(links.links)[0].hub, rig.hub.http);
  });

  it('the hub is a roles-v2 cloud cell: links, requests and canvas scope', async () => {
    const access = (await json(await hub('/health'))).access;
    assert.equal(access.authority, 'control-plane');
    assert.equal(access.links, true);
    assert.equal(access.requests, true);
    assert.ok(access.scopes.includes('canvas'));
    assert.ok(access.roles.includes('observer'));
  });

  it('Lukáš’s studio is already running and holds a Can edit credential', async () => {
    assert.equal((await fetch(`${rig.run.lukas.url}/_health`)).status, 200);
    assert.equal(hubsOf('lukas').role, 'member');
    const me = await json(await hub('/api/access/me', { token: hubsOf('lukas').token }));
    assert.equal(me.role, 'member');
  });
});

describe('Petra: Can view on one canvas, Ask to edit, Let Petra edit', () => {
  let ownerToken;
  let petraToken;
  before(() => {
    ownerToken = rig.owner.token;
  });

  it('/petra/accept answers an invitation the owner sent through the Share sheet’s own call', async () => {
    // Nothing to accept before the owner invites.
    const early = await control('/petra/accept');
    assert.notEqual(early.status, 200);

    const sent = await hub('/api/access/invites', {
      token: ownerToken,
      method: 'POST',
      body: { email: rig.run.petra.email, role: 'observer', canvas: rig.run.canvas },
    });
    assert.equal(sent.status, 201, JSON.stringify(await json(sent.clone())));

    const res = await control('/petra/accept');
    const body = await json(res);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal((await fetch(`${body.url}/_health`)).status, 200);
    // Idempotent: a second call hands back the same studio, not a second one.
    assert.equal((await json(await control('/petra/accept'))).url, body.url);

    // What she holds: Can view on that one canvas, nothing at project level.
    const verdict = await rig.loadClaimFor('petra');
    assert.equal(verdict.role, null);
    assert.deepEqual(verdict.grants, [{ c: rig.run.canvas, r: 'observer' }]);
    const rec = hubsOf('petra');
    assert.equal(rec.role, 'viewer', 'a 1.x build reads the only read-only role it knows');
    assert.deepEqual(rec.access.grants, [{ c: rig.run.canvas, r: 'observer' }]);
    petraToken = rec.token;
    const me = await json(await hub('/api/access/me', { token: petraToken }));
    assert.equal(me.role, null);
    assert.deepEqual(me.grants, [{ c: rig.run.canvas, r: 'observer' }]);
    assert.equal(me.canvasCaps[rig.run.canvas].edit, false);

    // Her own studio says the same (p8-e2e-rolefix): the shell's access word reads `/_config.access`, and a
    // comment on that canvas is refused — Can view looks only.
    const cfg = await json(await fetch(`${body.url}/_config`));
    assert.equal(cfg.readOnlyReason, 'role');
    assert.deepEqual(cfg.access, { role: null, grants: [{ c: rig.run.canvas, r: 'observer' }] });
    const said = await fetch(`${body.url}/_api/comments/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: body.url },
      body: JSON.stringify({
        op: 'add',
        file: `.design/${rig.run.canvas}`,
        text: 'hi',
        x: 1,
        y: 1,
      }),
    });
    assert.equal(said.status, 403);

    // Can view holds no document credential (the export class — a Yjs canvas document is its source): the hub
    // lists her nothing, and never the owner's other canvas.
    const hers = await docs(petraToken);
    assert.ok(!hers.some((n) => /private/i.test(n)), JSON.stringify(hers));
  });

  it('Ask to edit reaches the owner, and Let Petra edit puts the edit credential in her hubs.json', async () => {
    const asked = await hub('/api/access/requests', {
      token: petraToken,
      method: 'POST',
      body: { canvas: rig.run.canvas },
    });
    assert.equal(asked.status, 201, JSON.stringify(await json(asked.clone())));
    const { requests } = await json(await hub('/api/access/requests', { token: rig.owner.token }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].from.name.split(' ')[0], 'Petra');
    assert.equal(requests[0].canvas, rig.run.canvas);

    const ok = await hub(`/api/access/requests/${requests[0].id}/approve`, {
      token: rig.owner.token,
      method: 'POST',
      body: {},
    });
    assert.equal(ok.status, 200, JSON.stringify(await json(ok.clone())));

    // The re-exchange the scenario waits for: her record now says she can edit that canvas.
    const rec = await until('Petra’s re-exchanged credential', () => {
      const r = hubsOf('petra');
      return r.token !== petraToken ? r : null;
    });
    assert.deepEqual(rec.access.grants, [{ c: rig.run.canvas, r: 'member' }]);
    const me = await json(await hub('/api/access/me', { token: rec.token }));
    assert.equal(me.canvasCaps[rig.run.canvas].edit, true);
    assert.deepEqual(me.grants, [{ c: rig.run.canvas, r: 'member' }]);
    // Her studio hands the shell the raised claim (p8-e2e-rolefix): project-level still read-only, Can edit
    // on that canvas — the shell opens it editable from this (access-client.js `canEditOn`).
    const cfg = await until('Petra’s studio to read the raised claim', async () => {
      const c = await json(await fetch(`${rig.studios.petra.url}/_config`));
      return c?.access?.grants?.[0]?.r === 'member' ? c : null;
    });
    assert.equal(cfg.readOnlyReason, 'role');
    assert.deepEqual(cfg.access, { role: null, grants: [{ c: rig.run.canvas, r: 'member' }] });
    // Still nothing of the owner's other canvas.
    assert.ok(!(await docs(rec.token)).some((n) => /private/i.test(n)));
  });
});

describe('a link turned off', () => {
  it('/viewer/redeem opens the owner’s link as a third person; turning it off ends their access', async () => {
    const made = await hub('/api/access/links', {
      token: rig.owner.token,
      method: 'POST',
      body: { canvas: rig.run.canvas, role: 'observer', who: 'anyone' },
    });
    const link = await json(made);
    assert.equal(made.status, 201, JSON.stringify(link));

    // A link that is not the rig's own is refused, not followed.
    const foreign = await control('/viewer/redeem', { url: 'https://example.com/l/abc.def' });
    assert.notEqual(foreign.status, 200);

    const res = await control('/viewer/redeem', { url: link.url });
    const body = await json(res);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal((await fetch(`${body.url}/_health`)).status, 200);
    const verdict = await rig.loadClaimFor('viewer');
    assert.deepEqual(verdict.grants, [{ c: rig.run.canvas, r: 'observer' }]);
    const token = hubsOf('viewer').token;
    assert.equal((await hub('/api/access/me', { token })).status, 200);

    const off = await hub(`/api/access/links/${link.id}`, {
      token: rig.owner.token,
      method: 'PATCH',
      body: { off: true },
    });
    assert.equal(off.status, 200, JSON.stringify(await json(off.clone())));
    assert.equal((await rig.loadClaimFor('viewer')).ok, false);
    // The cell was told (control plane → hub), and after its grace the session is gone.
    await until('the viewer’s session to end', async () => {
      return (await hub('/api/access/me', { token })).status === 401;
    });
  });
});

describe('Lukáš removed', () => {
  it('his last change lands in the owner’s project, and the owner’s Remove ends his session', async () => {
    const mine = join(rig.studios.lukas.project, '.design', rig.run.canvas);
    const theirs = join(rig.run.nativeProject, '.design', rig.run.canvas);
    const title = `Edited by Lukáš ${Date.now()}`;
    writeFileSync(
      mine,
      readFileSync(mine, 'utf8').replace('Maude desktop E2E</h1>', `${title}</h1>`)
    );
    await until(
      'Lukáš’s change in the owner’s project',
      () => readFileSync(theirs, 'utf8').includes(title),
      30_000
    );

    const token = hubsOf('lukas').token;
    const { people } = await json(await hub('/api/access/people', { token: rig.owner.token }));
    const lukas = people.find((p) => p.name.startsWith('Luk'));
    assert.ok(lukas, JSON.stringify(people));
    const gone = await hub(`/api/access/people/${lukas.id}`, {
      token: rig.owner.token,
      method: 'DELETE',
    });
    assert.equal(gone.status, 204);
    assert.equal((await rig.loadClaimFor('lukas')).ok, false);
    await until('Lukáš’s session to end', async () => {
      return (await hub('/api/access/me', { token })).status === 401;
    });
  });
});
