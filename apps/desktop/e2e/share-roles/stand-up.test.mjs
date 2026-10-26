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
let ownerStudio;
before(
  async () => {
    rig = await standUp(process.env.MAUDE_E2E_OUT ? { out: process.env.MAUDE_E2E_OUT } : {});
    // The native app runs its own sidecar on the owner's project; a studio on the same folder, same
    // credentials, stands in for it so the canvases reach the hub.
    ownerStudio = (await rig.startOwnerStudio()).url;
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
    // The owner's window is a desktop shell on its studio's inspector socket: what it hears there is the
    // request toast's only source (ws.ts `access-request` ← sync `access:notice` ← the hub's stateless frame).
    const heard = [];
    const shell = new WebSocket(`${ownerStudio.replace(/^http/, 'ws')}/_ws`);
    shell.addEventListener('message', (e) => {
      try {
        heard.push(JSON.parse(String(e.data)));
      } catch {
        /* not a frame */
      }
    });
    await new Promise((ok, no) => {
      shell.addEventListener('open', ok, { once: true });
      shell.addEventListener('error', no, { once: true });
    });
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
    // …and the owner's shell hears it: "Petra … asks to edit <canvas>" with a Review (share-roles.e2e.ts toast)
    const toast = await until('the owner’s shell to hear the request', () =>
      heard.find((f) => f?.type === 'access-request')
    );
    shell.close();
    assert.equal(toast.id, requests[0].id);
    assert.equal(toast.from?.name?.split(' ')[0], 'Petra');
    assert.equal(toast.canvas, rig.run.canvas);

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

describe('a link turned off: the viewer is a plain browser on the cell door', () => {
  let chromium = null;
  let page = null;
  let link = null;
  let session = null;
  const seen = [];
  after(async () => {
    await chromium?.close().catch(() => {});
  });
  /** One same-origin request from the viewer's page — through its own (watched) window.fetch. */
  const inPage = (path) =>
    page.evaluate(async (p) => {
      const r = await fetch(p, { cache: 'no-store' });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, path);
  /** Evidence for a red step: a screenshot, the frame's address and every refused answer the page got. */
  const evidence = async (label) => {
    await page.screenshot({ path: join(rig.run.out, `${label}.png`) }).catch(() => {});
    const src = await page
      .locator('[data-testid="canvas-frame"]')
      .getAttribute('src', { timeout: 1000 })
      .catch(() => null);
    writeFileSync(join(rig.run.out, `${label}.log`), `frame src ${src}\n${seen.join('\n')}\n`);
  };
  const row = () =>
    `canvas-row-${rig.run.canvas
      .replace(/\.tsx$/, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()}`;

  it('/viewer/redeem walks the control plane to the cell’s door; a headless browser signs in there', async () => {
    const made = await hub('/api/access/links', {
      token: rig.owner.token,
      method: 'POST',
      body: { canvas: rig.run.canvas, role: 'observer', who: 'anyone' },
    });
    link = await json(made);
    assert.equal(made.status, 201, JSON.stringify(link));

    // A link that is not the rig's own is refused, not followed.
    const foreign = await control('/viewer/redeem', { url: 'https://example.com/l/abc.def' });
    assert.notEqual(foreign.status, 200);

    // The control plane's own redirects end at the CELL's sign-in door, with a one-time code.
    const res = await control('/viewer/redeem', { url: link.url });
    const body = await json(res);
    assert.equal(res.status, 200, JSON.stringify(body));
    const door = new URL(body.url);
    assert.equal(door.origin, rig.cell.public);
    assert.equal(door.pathname, '/auth/browser');
    assert.ok(door.searchParams.get('code'));
    assert.equal(rig.studios.viewer, undefined, 'the viewer has no studio of their own');
    const verdict = await rig.loadClaimFor('viewer');
    assert.deepEqual(verdict.grants, [{ c: rig.run.canvas, r: 'observer' }]);

    // A plain browser opens it: the cell exchanges the code and mints the session cookie itself.
    const { chromium: pw } = await import('@playwright/test');
    chromium = await pw.launch({
      headless: true,
      ...(process.env.MAUDE_E2E_CHROMIUM ? { executablePath: process.env.MAUDE_E2E_CHROMIUM } : {}),
    });
    page = await chromium.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (m) => {
      if (m.type() === 'error') seen.push(`console error: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() === 401) seen.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });
    await page.goto(body.url);
    session = await until('the cell’s session cookie', async () =>
      (await page.context().cookies(rig.cell.public)).find((c) => c.name === 'maude_studio')
    );
    // The studio behind the door holds exactly the link's claim: Can view on that one canvas.
    const cfg = await inPage('/_config');
    assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
    assert.deepEqual(cfg.body.access, {
      role: null,
      grants: [{ c: rig.run.canvas, r: 'observer' }],
    });
    // Its tree offers that canvas; opening it frames it from the cell's canvas origin.
    await page.locator(`[data-testid="${row()}"]`).click({ timeout: 30_000 });
    const src = await page
      .locator('[data-testid="canvas-frame"]')
      .getAttribute('src', { timeout: 30_000 });
    assert.equal(new URL(src).origin, rig.cell.canvasOrigin);
    await page.screenshot({ path: join(rig.run.out, 'viewer-on-cell.png') });
  });

  // FINDING (p8-e2e-link-viewer): a canvas-only session gets no canvas capability at the cell's shell door
  // (studio-proxy.mjs `canvasTokenFor`: `if (canvasOnly) return null`, decision S3.7c), so its frame carries
  // no `t=` and the canvas door answers 401 "this canvas link has expired". A Can view link opened in a
  // browser shows the shell and no canvas. Left red as a todo until the lead decides the capability shape.
  it('the viewer sees the canvas through the cell’s canvas door', {
    todo: 'a canvas-only session gets no canvas capability on a cell (finding)',
  }, async () => {
    try {
      await page
        .frameLocator('[data-testid="canvas-frame"]')
        .locator('h1')
        .first()
        .waitFor({ timeout: 20_000 });
    } catch (e) {
      await evidence('viewer-canvas-red');
      throw e;
    }
  });

  it('the owner turns the link off: the next request is refused link-off and the shell shows the link card', async () => {
    const off = await hub(`/api/access/links/${link.id}`, {
      token: rig.owner.token,
      method: 'PATCH',
      body: { off: true },
    });
    assert.equal(off.status, 200, JSON.stringify(await json(off.clone())));
    assert.equal((await rig.loadClaimFor('viewer')).ok, false);

    // The cell was told; after its grace the browser's next request is refused, and says why.
    let refused;
    try {
      refused = await until(
        'the cell to refuse the viewer’s next request',
        async () => {
          const r = await inPage('/_health');
          return r.status === 401 ? r : null;
        },
        30_000
      );
    } catch (e) {
      await evidence('viewer-link-off-red');
      throw e;
    }
    assert.deepEqual(refused.body, { error: 'sign in to open this project', reason: 'link-off' });
    // The shell read that refusal (watchRefusals): the link card, in words.
    const card = page.locator('[data-testid="access-link-off"]');
    try {
      await card.waitFor({ timeout: 30_000 });
    } catch (e) {
      await evidence('viewer-link-card-red');
      throw e;
    }
    const words = ((await card.textContent()) ?? '').replace(/\s+/g, ' ');
    assert.ok(words.includes('This link was turned off.'), words);
    await page.screenshot({ path: join(rig.run.out, 'viewer-link-off.png') });

    // The ended session sees nothing of the project any more: not its config, not the canvas source,
    // not the canvas's own address.
    const asViewer = (path) =>
      fetch(`${rig.cell.http}${path}`, {
        headers: { cookie: `maude_studio=${session.value}`, accept: 'application/json' },
      });
    for (const path of ['/_config', '/api/access/me', `/.design/${rig.run.canvas}`]) {
      const r = await asViewer(path);
      assert.equal(r.status, 401, `${path} → ${r.status}`);
    }
    // …and its cookie is not somebody else's oracle: a forged one hears no reason.
    const forged = await fetch(`${rig.cell.http}/_health`, {
      headers: { cookie: `maude_studio=${session.value}x`, accept: 'application/json' },
    });
    assert.equal(forged.status, 401);
    assert.equal((await forged.json()).reason, undefined);
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
