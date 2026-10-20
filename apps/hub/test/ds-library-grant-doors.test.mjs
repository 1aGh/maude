// S10.18a-2 — the library grant at the REAL hub: one door admits it, every other door treats
// it as an unknown bearer.
//
// The hub runs in workspace mode over a tmp checkout with a design system, with a studio
// child CONFIGURED (so the studio proxy exists and the design root is served — `ds-library`
// is on) but never started (`createHub` does not start it; its lane answers 503). With
// MAUDE_DS_LIBRARY_GRANTS=1 the owner mints a grant over HTTP, and:
//   - `/health` lists `ds-library` and `ds-library-grants` (and drops the second when off);
//   - the grant reads its system's head and a revision at the ds door, nothing else there;
//   - EVERY other route-table row, the studio's default lane and the Yjs socket answer the
//     grant byte-identically to a forged token of the same shape (the sweep table,
//     `_acl-sweep-requests.mjs`, so a row added later is swept the day it lands);
//   - revoking it closes the ds door at once.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { DS_GRANT_ROWS, DS_GRANTS_CAPABILITY } from '../src/ds-grants.mjs';
import { DS_LIBRARY_CAPABILITY, DS_LIBRARY_ROWS } from '../src/ds-library.mjs';
import { HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';
import { docOf, http, NOPE, openDoc, rm, seedTokens, tmpDir } from './_acl-docs-fixture.mjs';
import { checkSweepTable, requestsFor, studioDefaultRequests } from './_acl-sweep-requests.mjs';

const V1 = '/api/projects/local/v1';
const REV = 'e'.repeat(64);
const REV_BODY = '{"format":"maude.ds-revision","v":1,"system":"brand","files":{}}\n';
const ENV_KEYS = [
  'HUB_WORKSPACE_MODE',
  'MAUDE_STUDIO_CHILD',
  'MAUDE_REPO_DIR',
  'MAUDE_DS_LIBRARY_GRANTS',
  'MAUDE_TENANT_ID',
];

let saved;
let dataDir;
let repoDir;
let built;
let base;
let ws;
let t;
let grant;
let forged;

before(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  repoDir = tmpDir('maude-ds-doors-repo-');
  dataDir = tmpDir('maude-ds-doors-data-');
  const design = join(repoDir, '.design');
  mkdirSync(join(design, 'system/brand/revisions'), { recursive: true });
  mkdirSync(join(design, 'system/other/revisions'), { recursive: true });
  writeFileSync(
    join(design, 'config.json'),
    JSON.stringify({
      designSystems: [
        { name: 'brand', path: 'system/brand' },
        { name: 'other', path: 'system/other' },
      ],
    })
  );
  const head = (system) =>
    JSON.stringify({
      format: 'maude.ds-head',
      v: 1,
      system,
      head: REV,
      base: REV,
      drafts: [],
      log: [{ rev: REV, parent: null, action: 'publish', at: 'x', by: { kind: 'ai' } }],
    });
  writeFileSync(join(design, 'system/brand/revisions/head.json'), head('brand'));
  writeFileSync(join(design, `system/brand/revisions/${REV}.json`), REV_BODY);
  writeFileSync(join(design, 'system/other/revisions/head.json'), head('other'));
  writeFileSync(join(design, 'system/brand/tokens.json'), '{"secret":"tokens"}');

  process.env.HUB_WORKSPACE_MODE = '1';
  delete process.env.MAUDE_STUDIO_CHILD; // the child is configured; createHub never starts it
  delete process.env.MAUDE_TENANT_ID;
  process.env.MAUDE_REPO_DIR = repoDir;
  process.env.MAUDE_DS_LIBRARY_GRANTS = '1';

  t = seedTokens(dataDir);
  const { createHub } = await import('../src/server.mjs');
  built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false, rateLimit: false });
  await built.server.listen();
  await built.acceptedReady;
  base = built.server.httpURL.replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '');
  ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');

  const minted = await http(base, t.owner).post(`${V1}/ds-grants`, {
    system: 'brand',
    label: 'Junior site',
  });
  assert.equal(minted.status, 201, minted.text);
  grant = minted.body.token;
  // The same shape, a real-looking id, a secret nobody minted.
  forged = `mdsg_${randomBytes(8).toString('hex')}_${randomBytes(32).toString('hex')}`;
});

after(async () => {
  await built?.server.destroy();
  built?.stopBackgroundWork?.();
  for (const [k, v] of Object.entries(saved ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (dataDir) rm(dataDir);
  if (repoDir) rm(repoDir);
});

const capabilities = async () => (await (await fetch(`${base}/health`)).json()).capabilities;

describe('a hub that serves a library, grants on', () => {
  test('/health lists ds-library and ds-library-grants', async () => {
    const caps = await capabilities();
    assert.ok(caps.includes(DS_LIBRARY_CAPABILITY), JSON.stringify(caps));
    assert.ok(caps.includes(DS_GRANTS_CAPABILITY), JSON.stringify(caps));
  });

  test('the grant reads its system’s head and a revision, and nothing else at the ds door', async () => {
    const g = http(base, grant);
    const head = await g.get(`${V1}/ds/brand/head`);
    assert.equal(head.status, 200, head.text);
    assert.deepEqual(Object.keys(head.body).sort(), ['head', 'log']);
    const rev = await g.get(`${V1}/ds/brand/revisions/${REV}`);
    assert.equal(rev.status, 200);
    assert.equal(rev.text, REV_BODY);
    for (const p of [
      `${V1}/ds/other/head`,
      `${V1}/ds/brand/tokens.json`,
      `${V1}/ds/brand/revisions/head.json`,
      '/api/projects/elsewhere/v1/ds/brand/head',
    ]) {
      const r = await g.get(p);
      assert.equal(r.status, 404, `${p} → ${r.status}`);
    }
    // A forged token is no grant: 401.
    assert.equal((await http(base, forged).get(`${V1}/ds/brand/head`)).status, 401);
  });

  test('the owner’s list shows the grant, never its token', async () => {
    const list = await http(base, t.owner).get(`${V1}/ds-grants`);
    assert.equal(list.status, 200);
    assert.equal(list.body.grants.length, 1);
    assert.equal(list.body.grants[0].label, 'Junior site');
    assert.ok(!list.text.includes(grant.split('_').at(-1)));
    // A member and a viewer are not the owner.
    for (const tok of [t.member, t.viewer, t.observer, t.aEdit]) {
      assert.equal((await http(base, tok).get(`${V1}/ds-grants`)).status, 403);
    }
  });
});

/** Mask both bearers and the volatile fields, so two unknown-bearer answers compare equal. */
function normalize(text) {
  return String(text)
    .split(grant)
    .join('<BEARER>')
    .split(forged)
    .join('<BEARER>')
    .replace(
      /"(proposalHash|transactionId|committedAt|at|date|uptimeMs|startedAt|now|requestId|id)":("[^"]*"|\d+)/g,
      '"$1":0'
    );
}

async function send(token, [method, path, body]) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
    redirect: 'manual',
  });
  return { status: res.status, text: method === 'HEAD' ? '' : await res.text() };
}

// Sign-out doors are bearer-blind on purpose; they end nothing for an unknown bearer either,
// but they run last in the canary sweep for the same reason they are skipped here.
const SESSION_ENDING = new Set(['/auth/logout', '/auth/browser/signout']);

describe('every other door treats the grant as an unknown bearer', () => {
  const target = {
    action: `a_${'0'.repeat(24)}`,
    path: NOPE,
    doc: docOf(NOPE),
    hash: '1'.repeat(64),
    commentsHash: '2'.repeat(64),
    slug: 'nothing-here',
    vote: `v_${'0'.repeat(16)}`,
    tx: 'tx_sweep_seed_n',
    sha: '3'.repeat(40),
    css: 'ui/nothing-here.css',
    asset: 'assets/nothing-here.png',
  };

  test('the sweep table reaches every row', () => {
    assert.deepEqual(checkSweepTable(HUB_ROUTE_ROWS, [target, target], { epoch: 0 }), []);
  });

  test('every route-table row but the ds door, and the studio lane: grant ≡ forged', async () => {
    const rows = HUB_ROUTE_ROWS.filter(
      (r) => !SESSION_ENDING.has(r.path) && !DS_LIBRARY_ROWS.includes(r)
    );
    assert.ok(
      rows.some((r) => DS_GRANT_ROWS.includes(r)),
      'the grant routes are swept too'
    );
    const requests = [
      ...rows.flatMap((row) => requestsFor(row, target, { epoch: 0 }).map((q) => [row, q])),
      ...studioDefaultRequests(target).map((q) => [{ path: '(studio default)' }, q]),
    ];
    const findings = [];
    for (const [row, q] of requests) {
      const where = `${q[0]} ${q[1].split('?')[0]} [${row.path ?? row.pattern}]`;
      const g = await send(grant, q);
      const f = await send(forged, q);
      if (g.status !== f.status) findings.push(`${where}: grant ${g.status} ≠ forged ${f.status}`);
      else if (normalize(g.text) !== normalize(f.text)) {
        findings.push(
          `${where}: bodies differ — ${g.text.slice(0, 120)} | ${f.text.slice(0, 120)}`
        );
      }
      if (g.status >= 200 && g.status < 300 && !['/health', '/'].includes(row.path)) {
        // A 2xx is only acceptable where an anonymous caller gets one too (public doors).
        if (f.status !== g.status) findings.push(`${where}: grant got ${g.status}`);
      }
    }
    assert.deepEqual(findings, []);
    assert.ok(requests.length > rows.length, `swept ${requests.length} requests`);
  });

  test('the Yjs socket refuses the grant exactly as a forged token', async () => {
    const name = docOf(NOPE);
    const g = await openDoc(ws, grant, name);
    const f = await openDoc(ws, forged, name);
    g.close?.();
    f.close?.();
    assert.notEqual(g.status, 'synced', 'the grant opened a document');
    assert.equal(g.status, f.status);
  });
});

describe('revoke, then dark', () => {
  test('revoking closes the ds door at once', async () => {
    const owner = http(base, t.owner);
    const extra = (await owner.post(`${V1}/ds-grants`, { system: 'brand' })).body;
    assert.equal((await http(base, extra.token).get(`${V1}/ds/brand/head`)).status, 200);
    const del = await owner.send('DELETE', `${V1}/ds-grants/${extra.grant.id}`);
    assert.equal(del.status, 204);
    assert.equal((await http(base, extra.token).get(`${V1}/ds/brand/head`)).status, 401);
  });

  test('flag off: no capability, no mint, and a live grant is refused like any non-member', async () => {
    process.env.MAUDE_DS_LIBRARY_GRANTS = '0';
    try {
      const caps = await capabilities();
      assert.ok(caps.includes(DS_LIBRARY_CAPABILITY), 'the library itself stays');
      assert.ok(!caps.includes(DS_GRANTS_CAPABILITY), 'the grant capability goes');
      assert.equal((await http(base, grant).get(`${V1}/ds/brand/head`)).status, 401);
      const owner = http(base, t.owner);
      assert.equal((await owner.post(`${V1}/ds-grants`, { system: 'brand' })).status, 404);
      assert.equal((await owner.get(`${V1}/ds-grants`)).status, 404);
      // Members still read.
      assert.equal((await http(base, t.member).get(`${V1}/ds/brand/head`)).status, 200);
    } finally {
      process.env.MAUDE_DS_LIBRARY_GRANTS = '1';
    }
    assert.equal((await http(base, grant).get(`${V1}/ds/brand/head`)).status, 200, 'back on');
  });
});
