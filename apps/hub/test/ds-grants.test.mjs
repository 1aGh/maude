// S10.18a-2 — the team-library grant credential (option A, Michal 2026-10-20): a token the
// hub mints for ONE design system, stores hashed in its data dir, and revokes. The owner
// mints, lists and revokes it (`invite`); `verifyGrant` turns it into `{ system, fetcher }`
// at the ds-library door and nowhere else. Dark until MAUDE_DS_LIBRARY_GRANTS=1.
//
// Driven through the REAL table (`runHubRoutes` over `HUB_ROUTE_ROWS`) and the real access
// gate; the peer-token store is a stub, the grant store is the real one (sqlite in a tmp dir).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { peerAccess } from '../src/access-gate.mjs';
import {
  closeDsGrants,
  createDsGrantRoutes,
  createDsGrantStore,
  DS_GRANT_ROWS,
  DS_GRANT_TOKEN,
  DS_GRANTS_CAPABILITY,
  dsGrantsEnabled,
} from '../src/ds-grants.mjs';
import { createDsLibraryRoutes, createDsLibraryUsage } from '../src/ds-library.mjs';
import { HUB_ROUTE_ROWS, rowFor, runHubRoutes } from '../src/routes-v2/index.mjs';

const P = 'proj-lib';
const A = 'a'.repeat(64);
const HEAD = {
  format: 'maude.ds-head',
  v: 1,
  system: 'brand',
  head: A,
  base: A,
  drafts: [],
  log: [{ rev: A, parent: null, action: 'publish', at: 'x', by: { kind: 'ai' }, summary: 'one' }],
};

let root;
let dataDir;
let flag = true;
let t = Date.parse('2026-10-20T10:00:00Z');
const now = () => t;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'maude-ds-grant-root-'));
  dataDir = mkdtempSync(join(tmpdir(), 'maude-ds-grant-data-'));
  mkdirSync(join(root, 'system/brand/revisions'), { recursive: true });
  mkdirSync(join(root, 'system/other/revisions'), { recursive: true });
  writeFileSync(join(root, 'system/brand/revisions/head.json'), JSON.stringify(HEAD));
  writeFileSync(join(root, `system/brand/revisions/${A}.json`), '{"rev":"a"}');
  writeFileSync(join(root, 'system/other/revisions/head.json'), JSON.stringify(HEAD));
});

after(() => {
  closeDsGrants(dataDir);
  rmSync(root, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

const SYSTEMS = [
  { name: 'brand', path: 'system/brand' },
  { name: 'other', path: 'system/other' },
];

/** Peer tokens (the hub's tokens table, stubbed) — every role a grant route meets. */
const PEERS = {
  owner: { label: 'o', role: 'owner', owner: 'olga@x.test', scope: '*' },
  member: { label: 'm', role: 'member', owner: 'max@x.test', scope: '*' },
  viewer: { label: 'v', role: 'viewer', owner: 'vera@x.test', readOnly: true, scope: '*' },
  observer: { label: 'b', access: { v: 1, role: 'observer' }, readOnly: true, scope: '*' },
  scopedOwner: { label: 's', role: 'owner', owner: 'olga@x.test', scope: 'ui' },
  canvasOnly: {
    label: 'c',
    readOnly: true,
    access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    scope: '*',
  },
};
const verifyPeer = (tok) => PEERS[tok] ?? null;
/** The hub's `acceptedAuth` shape (server.mjs), over the stub. */
const auth = (req) => {
  const tok = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const m = verifyPeer(tok);
  if (!m) return null;
  return {
    actor: m.owner ?? m.label,
    readOnly: !!m.readOnly,
    scope: m.scope,
    access: peerAccess(m).access,
    owner: !m.readOnly && m.role === 'owner' && m.scope === '*',
  };
};

const store = () => createDsGrantStore({ dataDir, projectId: P, enabled: () => flag, now });

function makeDeps({ limits } = {}) {
  const grants = store();
  return {
    grants,
    dsGrants: createDsGrantRoutes({ store: grants, projectId: P, systems: () => SYSTEMS, auth }),
    dsLibrary: createDsLibraryRoutes({
      projectId: P,
      designRoot: () => root,
      systems: () => SYSTEMS,
      auth,
      verifyGrant: grants.verifyGrant,
      usage: createDsLibraryUsage({ now }),
      clientIp: (req) => req.ip,
      now,
      ...(limits === undefined ? {} : { limits }),
    }),
  };
}

async function call(deps, path, { token = null, method = 'GET', body, ip = '10.0.0.1' } = {}) {
  const out = { status: null, body: null, bytes: null };
  const response = {
    writeHead(status) {
      out.status = status;
      return this;
    },
    end(b) {
      out.bytes = b ? Buffer.from(b) : null;
    },
  };
  const listeners = {};
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    url: path,
    ip,
    on(ev, fn) {
      listeners[ev] = fn;
      if (ev === 'end') {
        queueMicrotask(() => {
          if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)));
          listeners.end?.();
        });
      }
      return this;
    },
  };
  out.handled = await runHubRoutes({
    request,
    response,
    method,
    path,
    verify: verifyPeer,
    respondJson: (status, b) => {
      out.status = status;
      out.body = b;
    },
    deps,
  });
  return out;
}

const grantsUrl = (rest = '', project = P) => `/api/projects/${project}/v1/ds-grants${rest}`;
const dsUrl = (rest) => `/api/projects/${P}/v1/ds/${rest}`;
const mint = (deps, body = { system: 'brand' }, token = 'owner') =>
  call(deps, grantsUrl(), { token, method: 'POST', body });

test('the flag is MAUDE_DS_LIBRARY_GRANTS=1 exactly, and the capability word is fixed', () => {
  assert.equal(DS_GRANTS_CAPABILITY, 'ds-library-grants');
  assert.equal(dsGrantsEnabled({}), false);
  assert.equal(dsGrantsEnabled({ MAUDE_DS_LIBRARY_GRANTS: 'true' }), false);
  assert.equal(dsGrantsEnabled({ MAUDE_DS_LIBRARY_GRANTS: '1' }), true);
});

test('the grant rows are in the one table: invite on both halves, project scope, no canvasDoor', () => {
  for (const row of DS_GRANT_ROWS) assert.ok(HUB_ROUTE_ROWS.includes(row), 'row mounted');
  for (const p of [grantsUrl(), grantsUrl('/g_0123456789abcdef'), grantsUrl('/x/y')]) {
    const row = rowFor(p);
    assert.equal(row, DS_GRANT_ROWS[0], p);
    assert.deepEqual({ ...row.cap }, { safe: 'invite', unsafe: 'invite' });
    assert.equal(row.scope, 'project');
    assert.notEqual(row.canvasDoor, true);
  }
  // `/v1/ds-grants` is not the ds-library row, and `/v1/ds/…` is not this one.
  assert.notEqual(rowFor(dsUrl('brand/head')), DS_GRANT_ROWS[0]);
});

test('the owner mints one token for one system; it is shown once and stored hashed', async () => {
  const deps = makeDeps();
  const r = await mint(deps, { system: 'brand', label: 'Junior site', expiresInDays: 30 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { token, grant } = r.body;
  assert.match(token, DS_GRANT_TOKEN);
  // ≥ 256 bits of secret: 64 hex after the id.
  assert.equal(token.split('_').at(-1).length, 64);
  assert.equal(grant.system, 'brand');
  assert.equal(grant.label, 'Junior site');
  assert.equal(grant.expiresAt, t + 30 * 86_400_000);
  assert.ok(!('hash' in grant) && !('token' in grant));

  const list = await call(deps, grantsUrl(), { token: 'owner' });
  assert.equal(list.status, 200);
  const wire = JSON.stringify(list.body);
  assert.ok(list.body.grants.some((g) => g.id === grant.id));
  assert.ok(!wire.includes(token), 'the list never carries the token');
  assert.ok(!wire.includes(token.split('_').at(-1)), 'nor its secret');
  assert.ok(!wire.includes('hash'), 'nor its hash');

  // At rest: the SHA-256 of the token, never the token or its secret.
  const files = readdirSync(dataDir).filter((f) => f.startsWith('ds-grants'));
  assert.ok(files.length > 0, 'the store lives in the data dir');
  const disk = files.map((f) => readFileSync(join(dataDir, f)).toString('latin1')).join('');
  assert.ok(!disk.includes(token.split('_').at(-1)), 'raw secret on disk');
  assert.ok(disk.includes(createHash('sha256').update(token).digest('hex')), 'hash on disk');
});

test('verifyGrant: the token resolves to its system and a fetcher; anything else is null', async () => {
  const deps = makeDeps();
  const { token, grant } = (await mint(deps)).body;
  const v = deps.grants.verifyGrant(token);
  assert.deepEqual(v, { system: 'brand', fetcher: `grant:${grant.id}`, project: P });
  const secret = token.split('_').at(-1);
  const flip = secret.replace(/^./, (c) => (c === '0' ? '1' : '0'));
  for (const bad of [
    token.replace(secret, flip), // one secret nibble off
    token.replace(grant.id, '0123456789abcdef'), // another id, same secret
    `${token}0`,
    token.toUpperCase(),
    token.slice(5), // no prefix
    '',
    'owner',
    null,
    42,
  ]) {
    assert.equal(deps.grants.verifyGrant(bad), null, String(bad));
  }
});

test('the compare is constant-time over the stored hash (source pin)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/ds-grants.mjs', import.meta.url)), 'utf8');
  assert.match(src, /timingSafeEqual\(/);
  assert.match(src, /createHash\('sha256'\)/);
  assert.match(src, /randomBytes\(32\)/, '256-bit secret');
});

test('revoke ends the grant at once; expiry ends it on time', async () => {
  const deps = makeDeps();
  const a = (await mint(deps)).body;
  const b = (await mint(deps, { system: 'brand', expiresInDays: 1 })).body;
  assert.equal((await call(deps, dsUrl('brand/head'), { token: a.token })).status, 200);
  const del = await call(deps, grantsUrl(`/${a.grant.id}`), { token: 'owner', method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal(deps.grants.verifyGrant(a.token), null);
  assert.equal((await call(deps, dsUrl('brand/head'), { token: a.token })).status, 401);
  const again = await call(deps, grantsUrl(`/${a.grant.id}`), { token: 'owner', method: 'DELETE' });
  assert.equal(again.status, 404);
  const list = (await call(deps, grantsUrl(), { token: 'owner' })).body.grants;
  assert.ok(!list.some((g) => g.id === a.grant.id), 'a revoked grant leaves the list');

  assert.ok(deps.grants.verifyGrant(b.token));
  t += 86_400_000 + 1;
  assert.equal(deps.grants.verifyGrant(b.token), null, 'expired');
  assert.equal((await call(deps, dsUrl('brand/head'), { token: b.token })).status, 401);
});

test('only the owner mints, lists and revokes (invite); everyone else is refused', async () => {
  const deps = makeDeps();
  const { grant } = (await mint(deps)).body;
  for (const who of ['member', 'viewer', 'observer', 'canvasOnly', 'scopedOwner']) {
    for (const [method, path, body] of [
      ['POST', grantsUrl(), { system: 'brand' }],
      ['GET', grantsUrl(), undefined],
      ['DELETE', grantsUrl(`/${grant.id}`), undefined],
    ]) {
      const r = await call(deps, path, { token: who, method, body });
      assert.equal(r.status, 403, `${who} ${method} → ${r.status}`);
    }
  }
  // No credential, an unknown one, or a grant token: 401, never the store.
  const g = (await mint(deps)).body.token;
  for (const token of [null, 'not-a-credential', g]) {
    for (const method of ['POST', 'GET']) {
      const r = await call(deps, grantsUrl(), { token, method, body: { system: 'brand' } });
      assert.equal(r.status, 401, `${token} ${method}`);
    }
  }
  assert.ok(deps.grants.verifyGrant(g), 'the grant still works where it belongs');
});

test('mint checks its input: a real system, a short label, a bounded expiry', async () => {
  const deps = makeDeps();
  const bad = [
    [{}, 422],
    [{ system: 'no-such-system' }, 404],
    [{ system: '../brand' }, 404],
    [{ system: 'brand', label: 'x'.repeat(81) }, 422],
    [{ system: 'brand', label: 'bad\u0000label' }, 422],
    [{ system: 'brand', expiresInDays: 0 }, 422],
    [{ system: 'brand', expiresInDays: 366 }, 422],
    [{ system: 'brand', expiresInDays: 1.5 }, 422],
  ];
  for (const [body, status] of bad) {
    const r = await mint(deps, body);
    assert.equal(r.status, status, JSON.stringify(body));
    assert.ok(!r.body?.token, 'no token on a refusal');
  }
  assert.equal((await mint(deps, { system: 'brand' })).body.grant.expiresAt, null, 'no expiry');
  // The path's project must be this one (or `current`).
  const other = await call(deps, grantsUrl('', 'someone-else'), {
    token: 'owner',
    method: 'POST',
    body: { system: 'brand' },
  });
  assert.equal(other.status, 404);
  const cur = await call(deps, grantsUrl('', 'current'), {
    token: 'owner',
    method: 'POST',
    body: { system: 'brand' },
  });
  assert.equal(cur.status, 201);
  for (const p of [grantsUrl('/x/y'), grantsUrl('/not-an-id')]) {
    assert.equal((await call(deps, p, { token: 'owner', method: 'DELETE' })).status, 404, p);
  }
  assert.equal((await call(deps, grantsUrl(), { token: 'owner', method: 'PUT' })).status, 405);
});

test('a grant reads its own system only: another one answers like a missing one', async () => {
  const deps = makeDeps();
  const { token } = (await mint(deps)).body;
  assert.equal((await call(deps, dsUrl('brand/head'), { token })).status, 200);
  const r = await call(deps, dsUrl(`brand/revisions/${A}`), { token });
  assert.equal(r.bytes.toString('utf8'), '{"rev":"a"}');
  assert.equal((await call(deps, dsUrl('other/head'), { token })).status, 404);
});

test('DARK: with the flag off the routes answer 404 and no grant verifies', async () => {
  const deps = makeDeps();
  const { token, grant } = (await mint(deps)).body;
  flag = false;
  try {
    assert.equal(deps.grants.enabled(), false);
    assert.equal(deps.grants.verifyGrant(token), null);
    assert.equal((await call(deps, dsUrl('brand/head'), { token })).status, 401);
    for (const [method, path] of [
      ['POST', grantsUrl()],
      ['GET', grantsUrl()],
      ['DELETE', grantsUrl(`/${grant.id}`)],
    ]) {
      const r = await call(deps, path, { token: 'owner', method, body: { system: 'brand' } });
      assert.equal(r.status, 404, `${method} dark`);
    }
  } finally {
    flag = true;
  }
  assert.ok(deps.grants.verifyGrant(token), 'back on, the same grant verifies (not revoked)');
});

test('RATE LIMIT: repeated 401s at the grant door answer 429, per address and per bearer', async () => {
  const limits = { perAddress: 5, perBearer: 3, windowMs: 60_000 };
  // Per address: five wrong bearers from one address, then even a good grant waits.
  let deps = makeDeps({ limits });
  const good = (await mint(deps)).body.token;
  for (let i = 0; i < 5; i++) {
    const r = await call(deps, dsUrl('brand/head'), { token: `wrong-${i}`, ip: '10.0.0.9' });
    assert.equal(r.status, 401, `try ${i}`);
  }
  const blocked = await call(deps, dsUrl('brand/head'), { token: 'wrong-x', ip: '10.0.0.9' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'rate-limited');
  assert.equal(
    (await call(deps, dsUrl('brand/head'), { token: good, ip: '10.0.0.9' })).status,
    429
  );
  // Another address is not that one; a member is never limited here.
  assert.equal(
    (await call(deps, dsUrl('brand/head'), { token: good, ip: '10.0.0.8' })).status,
    200
  );
  assert.equal(
    (await call(deps, dsUrl('brand/head'), { token: 'member', ip: '10.0.0.9' })).status,
    200
  );
  // The window passes.
  t += 60_001;
  assert.equal(
    (await call(deps, dsUrl('brand/head'), { token: good, ip: '10.0.0.9' })).status,
    200
  );

  // Per bearer: one revoked token polled from many addresses.
  deps = makeDeps({ limits });
  const dead = (await mint(deps)).body;
  await call(deps, grantsUrl(`/${dead.grant.id}`), { token: 'owner', method: 'DELETE' });
  for (let i = 0; i < 3; i++) {
    const r = await call(deps, dsUrl('brand/head'), { token: dead.token, ip: `10.1.0.${i}` });
    assert.equal(r.status, 401);
  }
  const r = await call(deps, dsUrl('brand/head'), { token: dead.token, ip: '10.1.0.99' });
  assert.equal(r.status, 429);
  // An absent bearer is a plain 401, never counted.
  deps = makeDeps({ limits });
  for (let i = 0; i < 8; i++) {
    assert.equal((await call(deps, dsUrl('brand/head'), { ip: '10.2.0.1' })).status, 401);
  }
  // `limits: null` (the hub's `rateLimit: false`) turns it off.
  deps = makeDeps({ limits: null });
  for (let i = 0; i < 8; i++) {
    const x = await call(deps, dsUrl('brand/head'), { token: 'wrong', ip: '10.3.0.1' });
    assert.equal(x.status, 401);
  }
});
