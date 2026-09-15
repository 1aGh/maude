// Self-administration round trips — Cloud Phase 20 (+ Phase 19 settings).

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { after, before, beforeEach, test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import {
  allProjectAdminHtml,
  deletePage,
  downloadPage,
  exportGenerations,
  parseExportKey,
} from './project-admin.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';
const realFetch = globalThis.fetch;

let network;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    for (const [needle, handler] of network) {
      if (url.includes(needle)) return handler(url, init);
    }
    return realFetch(input, init);
  };
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  network = [];
});

/** An in-memory R2 binding — list + get over a Map. */
function fakeExports(objects = new Map()) {
  return {
    objects,
    async list({ prefix }) {
      return {
        objects: [...objects.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, body]) => ({ key, size: body.length })),
      };
    },
    async get(key) {
      return objects.has(key) ? { body: objects.get(key) } : null;
    },
    async delete(keys) {
      for (const k of [].concat(keys)) objects.delete(k);
    },
  };
}

async function freshEnv(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return {
    env: {
      DB,
      CELL_SECRET_MASTER: 'master',
      STRIPE_SECRET_KEY: 'sk_test_x',
      CF_PROVISION_TOKEN: 'cf',
      CF_ACCOUNT_ID: 'acct',
      CF_ZONE_ID: 'zone',
      EXPORTS: fakeExports(),
      ...extra,
    },
    sqlite,
  };
}

function form(fields) {
  return new URLSearchParams(fields).toString();
}

async function ownerWithProject(env, sqlite) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email: 'owner@example.com', password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  const session = /maude_session=([^;]+)/.exec(res.headers.get('set-cookie'))?.[1];
  const ownerId = sqlite.prepare('SELECT id FROM accounts').get().id;
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, subscription_id, created_at)
       VALUES ('alligators', ?, 'Brno Alligators', 'active', 1, 'sub_1', 1)`
    )
    .run(ownerId);
  return { session };
}

const get = (path, session) =>
  new Request(`https://cloud.test${path}`, {
    headers: session ? { cookie: `maude_session=${session}` } : {},
  });
const post = (path, session, fields = {}) =>
  new Request(`https://cloud.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `maude_session=${session}`,
    },
    body: form(fields),
  });

function seedExport(env, stamp = '20260730T120000Z') {
  for (const name of ['repo.bundle', 'assets.json', 'MANIFEST.md']) {
    env.EXPORTS.objects.set(`tenants/alligators/exports/${stamp}/${name}`, `body-of-${name}`);
  }
}

// ------------------------------------------------------------------ download

test('preparing a copy asks the cell with an owner credential and lists the result', async () => {
  const { env, sqlite } = await freshEnv();
  const cellCalls = [];
  network.push([
    'alligators.cloud.maude.sh/api/export',
    async (_url, init) => {
      cellCalls.push(init.headers.authorization);
      seedExport(env);
      return Response.json({
        ok: true,
        stamp: '20260730T120000Z',
        prefix: 'tenants/alligators/exports/20260730T120000Z/',
        files: [],
      });
    },
  ]);
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(post('/projects/alligators/download', session), env);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /Your copy is ready below/);
  assert.match(body, /repo\.bundle/);
  assert.equal(cellCalls.length, 1);
  assert.match(cellCalls[0], /^Bearer .+\..+$/);
  assert.ok(sqlite.prepare('SELECT export_sent_at FROM projects').get().export_sent_at > 0);
});

test('a file downloads only inside the export prefix, only for the owner', async () => {
  const { env, sqlite } = await freshEnv();
  seedExport(env);
  const { session } = await ownerWithProject(env, sqlite);

  const good = await worker.fetch(
    get('/projects/alligators/download/file?g=20260730T120000Z&f=repo.bundle', session),
    env
  );
  assert.equal(good.status, 200);
  assert.match(good.headers.get('content-disposition'), /repo\.bundle/);

  // Traversal out of the export namespace is refused by shape, not by lookup.
  env.EXPORTS.objects.set('tenants/alligators/assets/photo.jpg', 'x');
  const traversal = await worker.fetch(
    get('/projects/alligators/download/file?g=..%2F..%2Fassets&f=photo.jpg', session),
    env
  );
  assert.equal(traversal.status, 404);

  // Another project's export cannot be addressed at all — the project id in
  // the key comes from the PATH, which access control already gated.
  env.EXPORTS.objects.set('tenants/other/exports/20260730T120000Z/repo.bundle', 'x');
  const cross = await worker.fetch(
    get('/projects/other/download/file?g=20260730T120000Z&f=repo.bundle', session),
    env
  );
  assert.equal(cross.status, 404);
});

// -------------------------------------------------------------------- delete

test('delete without an export is redirected to the download, and writes nothing', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  const page = await worker.fetch(get('/projects/alligators/delete', session), env);
  assert.match(await page.text(), /Download your copy first/);

  const attempt = await worker.fetch(
    post('/projects/alligators/delete', session, { sure: 'yes' }),
    env
  );
  assert.equal(attempt.status, 409);
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'active');
});

test('delete with an export stops billing first, then purges, then detaches the address', async () => {
  const { env, sqlite } = await freshEnv();
  seedExport(env);
  const order = [];
  network.push([
    'api.stripe.com',
    async (_url, init) => {
      order.push(`stripe:${init.method}`);
      return Response.json({ id: 'sub_1', status: 'canceled' });
    },
  ]);
  network.push([
    'api.cloudflare.com',
    async (_url, init) => {
      order.push(`cf:${init.method ?? 'GET'}`);
      if ((init.method ?? 'GET') === 'GET') {
        return Response.json({
          success: true,
          result: [{ id: 'dom1', hostname: 'alligators.cloud.maude.sh' }],
        });
      }
      return Response.json({ success: true, result: {} });
    },
  ]);
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(
    post('/projects/alligators/delete', session, { sure: 'yes' }),
    env
  );
  assert.equal(res.status, 303);
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'purged');
  assert.equal(order[0], 'stripe:DELETE', 'billing stops before anything else');
  assert.ok(order.includes('cf:DELETE'), 'the address was detached');
  // Cloud Phase 24 B4. Until this phase, "purges" in this test's own name was
  // aspirational: the row said `purged` and `tenants/<id>/` stayed in storage
  // forever. The bytes go, and the audit log says how many.
  assert.equal(env.EXPORTS.objects.size, 0, 'nothing of this project is left in storage');
  const purge = sqlite
    .prepare("SELECT action, detail FROM audit_log WHERE action LIKE 'project.purge%'")
    .get();
  assert.equal(purge.action, 'project.purged');
  assert.match(purge.detail, /3 objects/);
});

test('another project’s objects survive a delete — the prefix IS the isolation', async () => {
  const { env, sqlite } = await freshEnv();
  seedExport(env);
  env.EXPORTS.objects.set('tenants/other-club/exports/x/repo.bundle', 'not-yours');
  env.EXPORTS.objects.set('tenants/alligators-reserve/exports/x/repo.bundle', 'nor-this');
  network.push(['api.stripe.com', async () => Response.json({ id: 'sub_1' })]);
  network.push(['api.cloudflare.com', async () => Response.json({ success: true, result: [] })]);
  const { session } = await ownerWithProject(env, sqlite);
  await worker.fetch(post('/projects/alligators/delete', session, { sure: 'yes' }), env);
  assert.deepEqual([...env.EXPORTS.objects.keys()].sort(), [
    'tenants/alligators-reserve/exports/x/repo.bundle',
    'tenants/other-club/exports/x/repo.bundle',
  ]);
});

test('a purge that fails is RECORDED, not swallowed behind a row that says deleted', async () => {
  const { env, sqlite } = await freshEnv();
  seedExport(env);
  env.EXPORTS.delete = async () => {
    throw new Error('R2 is unreachable');
  };
  network.push(['api.stripe.com', async () => Response.json({ id: 'sub_1' })]);
  network.push(['api.cloudflare.com', async () => Response.json({ success: true, result: [] })]);
  const { session } = await ownerWithProject(env, sqlite);
  await worker.fetch(post('/projects/alligators/delete', session, { sure: 'yes' }), env);
  const failed = sqlite
    .prepare("SELECT action, detail FROM audit_log WHERE action = 'project.purge-failed'")
    .get();
  assert.ok(failed, 'the operator can find the projects whose bytes are still there');
  assert.match(failed.detail, /unreachable/);
});

test('when billing cannot be stopped, NOTHING is deleted', async () => {
  const { env, sqlite } = await freshEnv();
  seedExport(env);
  network.push(['api.stripe.com', async () => new Response('down', { status: 500 })]);
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(
    post('/projects/alligators/delete', session, { sure: 'yes' }),
    env
  );
  assert.equal(res.status, 502);
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'active');
});

// --------------------------------------------------------------------- audit

test('the activity page shows entries in the customer’s language', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  sqlite
    .prepare(
      `INSERT INTO audit_log (id, project_id, at, actor, action) VALUES
       ('a1', 'alligators', 1753872000000, 'customer:owner@example.com', 'checkout.settled'),
       ('a2', 'alligators', 1753872100000, 'system', 'reconcile')`
    )
    .run();
  const res = await worker.fetch(get('/projects/alligators/audit', session), env);
  const body = await res.text();
  assert.match(body, /Project came up — billing began/);
  assert.match(body, /Routine platform check/);
  assert.ok(!/checkout\.settled/.test(body), 'internal action names stay internal');
});

// Cloud Phase 26. `audit_log.reason` has existed since Phase 7 — "an access
// with no stated reason is the one worth noticing" — and was never displayed.
// A column nobody sees is a column nobody fills in honestly, and now that an
// operator surface writes to it, the page that promises "you can see that we
// looked" has to show why we looked.
test('the activity page renders the REASON an operator gave', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  sqlite
    .prepare(
      `INSERT INTO audit_log (id, project_id, at, actor, action, reason) VALUES
       ('a1', 'alligators', 1753872000000, 'operator:op@maude.sh', 'operator.reconcile.nudged', 'you reported it stuck in setup'),
       ('a2', 'alligators', 1753872100000, 'operator:op@maude.sh', 'operator.project.viewed', 'checking the stall you reported'),
       ('a3', 'alligators', 1753872200000, 'system', 'reconcile', NULL)`
    )
    .run();
  const body = await (await worker.fetch(get('/projects/alligators/audit', session), env)).text();

  assert.match(body, /<th>Why<\/th>/);
  assert.match(body, /you reported it stuck in setup/);
  assert.match(body, /checking the stall you reported/);
  // The operator's actions read as sentences, not as keys — a customer told
  // "operator.project.viewed" has been told that we looked and nothing else.
  assert.match(body, /Maude asked the platform to re-check this project/);
  assert.match(body, /Maude opened this project’s record/);
  assert.ok(!/operator\.reconcile\.nudged/.test(body), 'internal action names stay internal');
  assert.ok(!/operator\.project\.viewed/.test(body), 'internal action names stay internal');
  // A system action has no reason to give, and an em-dash says so rather than
  // an empty cell that reads like a rendering bug.
  assert.match(body, /—/);
  // And the operator vocabulary still never leaks onto a customer surface.
  assert.doesNotMatch(body, /operator console/i);
});

// ------------------------------------------------------------- cell identity

// Cloud Phase 24 B1. The control-plane half of "per-tenant config stops being
// Worker-GLOBAL": a cell asks who IT is, authorized by a secret derived from
// the tenant it names, so it can ask about itself and nothing else.
test('a cell can read its OWN config, and only with its own derived secret', async () => {
  const { env, sqlite } = await freshEnv();
  await ownerWithProject(env, sqlite);
  sqlite.prepare("UPDATE projects SET seed_repo = 'https://github.com/1aGh/alligators.git'").run();
  const { deriveCellSecret } = await import('./cell-token.mjs');

  const mine = await worker.fetch(
    new Request('https://cloud.test/internal/cell-config?tenant=alligators', {
      headers: { authorization: `Bearer ${await deriveCellSecret('master', 'alligators')}` },
    }),
    env
  );
  assert.deepEqual(await mine.json(), {
    projectName: 'Brno Alligators',
    seedRepo: 'https://github.com/1aGh/alligators.git',
    adminEmail: 'owner@example.com',
  });

  // Another tenant's secret does not open this door — the secret IS the
  // isolation, and this is the pair that used to be one shared global.
  const notMine = await worker.fetch(
    new Request('https://cloud.test/internal/cell-config?tenant=alligators', {
      headers: { authorization: `Bearer ${await deriveCellSecret('master', 'other-club')}` },
    }),
    env
  );
  assert.equal(notMine.status, 401);
});

test('an unknown project answers "nothing known", never another tenant’s values', async () => {
  const { env, sqlite } = await freshEnv();
  await ownerWithProject(env, sqlite);
  sqlite.prepare("UPDATE projects SET seed_repo = 'https://github.com/1aGh/alligators.git'").run();
  const { deriveCellSecret } = await import('./cell-token.mjs');

  const res = await worker.fetch(
    new Request('https://cloud.test/internal/cell-config?tenant=ghost-club', {
      headers: { authorization: `Bearer ${await deriveCellSecret('master', 'ghost-club')}` },
    }),
    env
  );
  assert.deepEqual(await res.json(), {
    projectName: null,
    seedRepo: null,
    adminEmail: null,
  });
});

// -------------------------------------------------------------------- mirror

test('the mirror settings save a validated target and the cell can then read it', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(
    post('/projects/alligators/mirror', session, {
      do: 'save',
      repository: '1aGh/alligators-mirror',
      branch: 'main',
    }),
    env
  );
  assert.match(await res.text(), /The first push happens within the hour/);
  assert.equal(
    sqlite.prepare('SELECT mirror_repo FROM projects').get().mirror_repo,
    '1aGh/alligators-mirror'
  );

  // The cell's side of the same fact: /internal/mirror-config with the derived secret.
  const { deriveCellSecret } = await import('./cell-token.mjs');
  const secret = await deriveCellSecret('master', 'alligators');
  const config = await worker.fetch(
    new Request('https://cloud.test/internal/mirror-config?tenant=alligators', {
      headers: { authorization: `Bearer ${secret}` },
    }),
    env
  );
  // Cloud Phase 25 D1/D2 — the config now carries the MODE (and what the
  // settings page needs to describe it). NULL mode reads as 'backup', which is
  // every mirror that existed before design-sync.
  assert.deepEqual(await config.json(), {
    repository: '1aGh/alligators-mirror',
    branch: 'main',
    mode: 'backup',
    folder: null,
    projectName: 'Brno Alligators',
    seededFrom: null,
  });

  // A wrong secret learns nothing.
  const refused = await worker.fetch(
    new Request('https://cloud.test/internal/mirror-config?tenant=alligators', {
      headers: { authorization: 'Bearer wrong' },
    }),
    env
  );
  assert.equal(refused.status, 401);
});

test('a URL pasted as the repository is refused with the sentence that fixes it', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(
    post('/projects/alligators/mirror', session, {
      do: 'save',
      repository: 'https://github.com/x/y',
    }),
    env
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /owner\/name/);
});

// --------------------------------------------------------------- pure pieces

test('parseExportKey accepts exactly the export namespace', () => {
  assert.ok(
    parseExportKey('tenants/alligators/exports/20260730T120000Z/repo.bundle', 'alligators')
  );
  assert.equal(parseExportKey('tenants/alligators/assets/x.jpg', 'alligators'), null);
  assert.equal(
    parseExportKey('tenants/other/exports/20260730T120000Z/repo.bundle', 'alligators'),
    null
  );
  assert.equal(parseExportKey('tenants/alligators/exports/../../secrets', 'alligators'), null);
});

test('exportGenerations groups by stamp, newest first', () => {
  const gens = exportGenerations(
    [
      { key: 'tenants/p/exports/20260729T000000Z/repo.bundle', size: 10 },
      { key: 'tenants/p/exports/20260730T000000Z/repo.bundle', size: 20 },
      { key: 'tenants/p/exports/20260730T000000Z/MANIFEST.md', size: 1 },
    ],
    'p'
  );
  assert.equal(gens.length, 2);
  assert.equal(gens[0].stamp, '20260730T000000Z');
  assert.equal(gens[0].bytes, 21);
});

// ------------------------------------------------------------------- strings

test('the admin pages ship no script and no vocabulary of ours', () => {
  const html = allProjectAdminHtml();
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  for (const jargon of ['tenant', 'cell', 'token', 'container', 'provision', 'webhook', 'purge']) {
    assert.ok(
      !new RegExp(`\\b${jargon}(?!s\\/)`, 'i').test(html),
      `"${jargon}" leaked into the admin pages`
    );
  }
});

// Cloud Phase 24 C1, 2026-08-01. Walking the funnel as a stranger found a dead
// end nobody could leave: a brand-new project has no commits, the cell answers
// 409 "nothing to export", and `delete` is gated on an export existing — so
// somebody who mistypes the project name at signup can never delete it. It is
// the very first thing a person does wrong.
test('a project with nothing in it can still be deleted', async () => {
  const { env, sqlite } = await freshEnv();
  network.push([
    'alligators.cloud.maude.sh/api/export',
    async () =>
      Response.json(
        {
          code: 'no-history',
          error: 'this project has no history yet — there is nothing to export',
        },
        { status: 409 }
      ),
  ]);
  network.push(['api.stripe.com', async () => Response.json({ id: 'sub_1' })]);
  network.push(['api.cloudflare.com', async () => Response.json({ success: true, result: [] })]);
  const { session } = await ownerWithProject(env, sqlite);

  // Asking for the copy is answered honestly, not as a 502.
  const asked = await worker.fetch(post('/projects/alligators/download', session), env);
  assert.equal(asked.status, 200);
  assert.match(await asked.text(), /nothing to download yet/);

  // …and the gate now opens.
  const page = await worker.fetch(get('/projects/alligators/delete', session), env);
  assert.match(await page.text(), /This is permanent/);
  const gone = await worker.fetch(
    post('/projects/alligators/delete', session, { sure: 'yes' }),
    env
  );
  assert.equal(gone.status, 303);
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'purged');
});

// The other 409. The cell answers 409 for TWO opposite situations, and the
// first cut of the empty-project fix accepted both — which would have let a
// project with real work reach `purged` without its files ever going out, the
// exact breach DDR-193 §3 exists to prevent.
test('a FAILED export does not open the delete gate, however it is phrased', async () => {
  const { env, sqlite } = await freshEnv();
  network.push([
    'alligators.cloud.maude.sh/api/export',
    async () =>
      Response.json(
        { code: 'export-failed', error: 'the project history could not be packaged: disk full' },
        { status: 409 }
      ),
  ]);
  const { session } = await ownerWithProject(env, sqlite);

  const asked = await worker.fetch(post('/projects/alligators/download', session), env);
  assert.equal(asked.status, 502, 'a packaging failure is an error, not a discharge');
  assert.equal(
    sqlite.prepare('SELECT export_sent_at FROM projects').get().export_sent_at,
    null,
    'the guarantee is NOT discharged'
  );

  const page = await worker.fetch(get('/projects/alligators/delete', session), env);
  assert.match(await page.text(), /Download your copy first/, 'the gate stays shut');
  const blocked = await worker.fetch(
    post('/projects/alligators/delete', session, { sure: 'yes' }),
    env
  );
  assert.equal(blocked.status, 409);
  assert.equal(sqlite.prepare('SELECT state FROM projects').get().state, 'active');
});

// Cloud Phase 24 A6. Two defects on the leaving path, both about a promise the
// page could not keep for the person actually reading it.
test('the export page says what the file IS and who can open it', () => {
  const html = downloadPage({
    account: { email: 'a@example.com' },
    project: { id: 'alligators', name: 'Brno Alligators' },
    generations: [],
    isOwner: true,
  });
  assert.doesNotMatch(html, /opens without Maude/i, 'the sentence that was false for a volunteer');
  assert.match(html, /developer archive/);
  assert.match(html, /double-click/);
  assert.match(html, /anyone who writes software/i);
});

test('a member is not shown download links the server will refuse', () => {
  // Reported from the live plane: a member saw "Only the project's owner can
  // prepare and download the full copy" AND, directly underneath, a table of
  // MANIFEST.md / assets.json / repo.bundle links — each of which `/download/file`
  // answers 404 to. The refusal and the offer have to agree.
  const generations = [
    { stamp: '20260730T073354Z', bytes: 80_300_000, files: [{ name: 'repo.bundle' }] },
  ];
  const base = {
    account: { email: 'member@example.com' },
    project: { id: 'alligators', name: 'Brno Alligators' },
    generations,
  };

  const member = downloadPage({ ...base, isOwner: false });
  assert.match(member, /Only the project’s owner/);
  assert.doesNotMatch(member, /download\/file/, 'no link to a route that answers 404');
  assert.doesNotMatch(member, /repo\.bundle/);

  const owner = downloadPage({ ...base, isOwner: true });
  assert.match(owner, /download\/file/, 'the owner still gets the copy they prepared');
  assert.match(owner, /repo\.bundle/);
});

test('the delete gate carries the button it demands, not directions to it', () => {
  const html = deletePage({
    account: { email: 'a@example.com' },
    project: { id: 'alligators', name: 'Brno Alligators' },
    hasExport: false,
  });
  assert.match(html, /action="\/projects\/alligators\/download"[^>]*>\s*<button/);
  assert.match(html, /Prepare my copy now/);
});

// ------------------------------------------------------------------ connect

test('Open leads to the connect page, which offers only doors that exist', async () => {
  const { env, sqlite } = await freshEnv();
  const { session } = await ownerWithProject(env, sqlite);
  const res = await worker.fetch(get('/projects/alligators/connect', session), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Open Brno Alligators/);
  // The one-click app lane (Phase 23 B3): a form POST to the handoff mint,
  // never a token in a link.
  assert.match(body, /action="\/projects\/alligators\/handoff"/);
  assert.match(body, /Open in Maude/);
  // Cloud Phase 24 A2. The browser card told the customer to sign in with a
  // "workspace email and password" that no customer is ever issued, and the
  // footnote pointed at an operator console behind the same credential. Both
  // are gone — an impossible instruction is worse than one door.
  assert.doesNotMatch(body, /workspace email and password/);
  assert.doesNotMatch(body, /operator console/i);
  // Cloud Phase 27. The cell URL used to be BANNED here, and that was right at
  // the time: it led to a door that asked for a credential no customer is ever
  // issued. The door works now — it is the real studio, behind this account —
  // so the rule flips from "must not appear" to "must, and must not come with
  // an impossible instruction".
  assert.match(body, /href="https:\/\/alligators\.cloud\.maude\.sh"/);
  assert.match(body, /Open in the browser/);
  // A7: one download address, everywhere in the product.
  assert.match(body, /maude\.sh\/desktop/);

  const anon = await worker.fetch(get('/projects/alligators/connect'), env);
  assert.equal(anon.status, 303, 'a stranger is sent to sign in');
});

// -------------------------------------------------------------------- saving

test('the owner previews and switches how the project saves; the cell is asked as the owner', async () => {
  const { env, sqlite } = await freshEnv();
  const calls = [];
  let mode = 'legacy';
  network.push([
    'alligators.cloud.maude.sh/api/projects/current/v1/mode',
    async (_url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method: init.method ?? 'GET', auth: init.headers.authorization, body });
      if ((init.method ?? 'GET') === 'GET') return Response.json({ mode, epoch: 3 });
      if (body.dryRun) return Response.json({ dryRun: true, mode, epoch: 3, imported: { created: 7, dirs: 2, skipped: [] } });
      mode = 'transactions';
      return Response.json({ mode, epoch: 4, imported: { created: 7 } });
    },
  ]);
  const { session } = await ownerWithProject(env, sqlite);
  const page = await (await worker.fetch(get('/projects/alligators/saving', session), env)).text();
  assert.match(page, /Shared copy/);
  const preview = await (await worker.fetch(post('/projects/alligators/saving', session, { do: 'preview' }), env)).text();
  assert.match(preview, /7 canvases/);
  const switched = await worker.fetch(post('/projects/alligators/saving', session, { do: 'switch', epoch: '3' }), env);
  assert.equal(switched.status, 200);
  assert.match(await switched.text(), /Switched/);
  const last = calls.at(-1);
  assert.deepEqual(last.body, { mode: 'transactions', expectEpoch: 3 });
  // An owner-role project token, verified offline by the cell.
  const claims = JSON.parse(Buffer.from(last.auth.replace('Bearer ', '').split('.')[0], 'base64url').toString());
  assert.equal(claims.role, 'owner');
  assert.equal(claims.project, 'alligators');
  const logged = sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'project.saving%'").all();
  assert.deepEqual(logged.map((r) => r.action), ['project.saving-switched']);
});
