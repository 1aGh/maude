// S10.18a — team libraries over the hub (V2-1.6 §5.14): the head / revision routes, the
// library read grant to NON-members, and the leak probes (V2-1.16 U1 / U5 / L1-shaped).
//
// A grant holder reads `<ds.path>/revisions/head.json` (projected) and
// `<ds.path>/revisions/<64 hex>.json` of ITS system — and nothing else: every other probe
// answers the one 404 body a missing path gives. Members read too (Can view included); a
// canvas-only session is refused at the gate; the "used by N" count goes to members only.
//
// Driven through the REAL table (`runHubRoutes` over `HUB_ROUTE_ROWS`) and the real access
// gate. The grant tests run TWICE (S10.18a-2): once over the stubbed seam, once with real
// tokens minted by the hub's grant store (`ds-grants.mjs`, sqlite in a tmp dir).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { peerAccess } from '../src/access-gate.mjs';
import { closeDsGrants, createDsGrantStore } from '../src/ds-grants.mjs';
import {
  createDsLibraryRoutes,
  createDsLibraryUsage,
  DS_LIBRARY_NOT_FOUND,
  DS_LIBRARY_ROWS,
  DS_LIBRARY_USAGE_WINDOW_MS,
} from '../src/ds-library.mjs';
import { HUB_ROUTE_ROWS, rowFor, runHubRoutes } from '../src/routes-v2/index.mjs';

const P = 'proj-lib';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const LINK_IN = 'c'.repeat(64);
const LINK_OUT = 'd'.repeat(64);
const REV_A = `{"format":"maude.ds-revision","v":1,"system":"brand","files":{}}\n`;

let root;
let outside;
let grantData;
/** The hub's real grant store, on (MAUDE_DS_LIBRARY_GRANTS=1 for this file). */
let realGrants;
/** Real tokens, minted in before() — one per grant the stub mode names. */
let realTok;

function headDoc(system, n) {
  return {
    format: 'maude.ds-head',
    v: 1,
    system,
    head: A,
    base: A,
    drafts: [{ rev: B, label: 'Secret draft', direction: 'b', by: { kind: 'ai' }, at: 'x' }],
    log: Array.from({ length: n }, (_, i) => ({
      rev: A,
      parent: B,
      action: 'publish',
      at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
      by: { kind: 'person', name: 'Tereza', email: 'tereza@example.com' },
      summary: `Change ${i}`,
      actionId: `act-${i}`,
      updated: 4,
      leftOut: 1,
    })),
    library: { hub: 'https://elsewhere.example', project: 'x', system: 'y' },
  };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'maude-ds-lib-'));
  outside = mkdtempSync(join(tmpdir(), 'maude-ds-lib-out-'));
  const w = (rel, text) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  w('system/brand/revisions/head.json', JSON.stringify(headDoc('brand', 25)));
  w(`system/brand/revisions/${A}.json`, REV_A);
  w(`system/brand/revisions/${A}.tokens.css`, ':root{--x:1}');
  w('system/brand/tokens.json', '{"secret":"tokens"}');
  w('system/brand/colors_and_type.css', ':root{}');
  w('system/other/revisions/head.json', JSON.stringify(headDoc('other', 3)));
  w(`system/other/revisions/${B}.json`, '{"other":true}');
  w('ui/secret.tsx', 'export default "secret canvas";');
  w('config.json', '{"designSystems":[]}');
  writeFileSync(join(outside, 'outside.json'), '{"outside":true}');
  // DDR-054: a peer can commit links. One stays inside the design root, one leaves it.
  symlinkSync('../../../ui/secret.tsx', join(root, `system/brand/revisions/${LINK_IN}.json`));
  symlinkSync(join(outside, 'outside.json'), join(root, `system/brand/revisions/${LINK_OUT}.json`));
  // A whole system directory that is a link — to another system's real files.
  symlinkSync(join(root, 'system/other'), join(root, 'system/linked'));
  grantData = mkdtempSync(join(tmpdir(), 'maude-ds-lib-grants-'));
  realGrants = createDsGrantStore({ dataDir: grantData, projectId: P, enabled: () => true });
  const real = (system) => realGrants.mint({ system }).token;
  realTok = {
    brandF1: real('brand'),
    brandF2: real('brand'),
    spaced: real('Club brand'),
    linked: real('linked'),
  };
});

after(() => {
  closeDsGrants(grantData);
  rmSync(grantData, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const SYSTEMS = [
  { name: 'brand', path: 'system/brand' },
  { name: 'other', path: 'system/other' },
  { name: 'linked', path: 'system/linked' },
  { name: 'Club brand', path: 'system/brand' },
];

/** Peer tokens (the hub's tokens table, stubbed). */
const PEERS = {
  member: { label: 'm', role: 'member', scope: '*' },
  observer: { label: 'o', access: { v: 1, role: 'observer' }, scope: '*' },
  scoped: { label: 's', role: 'member', scope: 'ui' },
  canvasOnly: {
    label: 'c',
    readOnly: true,
    access: { v: 1, role: null, grants: [{ c: 'ui/secret.tsx', r: 'viewer' }] },
    scope: '*',
  },
};
/** Library grants (the credential a non-member presents — stubbed; S10.18a's seam). */
const GRANTS = {
  'grant-brand-f1': { system: 'brand', fetcher: 'proj-junior' },
  'grant-brand-f2': { system: 'brand', fetcher: 'proj-flag' },
  'grant-other-project': { system: 'brand', fetcher: 'proj-x', project: 'someone-else' },
  'grant-bad-fetcher': { system: 'brand', fetcher: '../etc' },
  'grant-spaced': { system: 'Club brand', fetcher: 'proj-junior' },
  'grant-linked': { system: 'linked', fetcher: 'proj-junior' },
};

/** The two credential modes every grant test runs in: the stubbed seam, and real tokens. */
const MODES = {
  stub: {
    tok: {
      brandF1: 'grant-brand-f1',
      brandF2: 'grant-brand-f2',
      spaced: 'grant-spaced',
      linked: 'grant-linked',
    },
    verifyGrant: (t) => GRANTS[t] ?? null,
  },
  real: {
    get tok() {
      return realTok;
    },
    verifyGrant: (t) => realGrants.verifyGrant(t),
  },
};

const verifyPeer = (t) => PEERS[t] ?? null;
const auth = (req) => {
  const t = (req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const m = verifyPeer(t);
  if (!m) return null;
  return { actor: m.label, readOnly: !!m.readOnly, scope: m.scope, access: peerAccess(m).access };
};

function makeLib({ now = () => Date.now(), verifyGrant = (t) => GRANTS[t] ?? null } = {}) {
  return createDsLibraryRoutes({
    limits: null, // the 401 limiter has its own test (ds-grants.test.mjs)
    projectId: P,
    designRoot: () => root,
    systems: () => SYSTEMS,
    auth,
    verifyGrant,
    usage: createDsLibraryUsage({ now }),
  });
}

async function call(lib, path, { token = null, method = 'GET' } = {}) {
  const out = { status: null, body: null, bytes: null, headers: null };
  const response = {
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
      return this;
    },
    end(b) {
      out.bytes = b ? Buffer.from(b) : null;
    },
  };
  const request = { headers: token ? { authorization: `Bearer ${token}` } : {}, url: path };
  const handled = await runHubRoutes({
    request,
    response,
    method,
    path,
    verify: verifyPeer,
    respondJson: (status, body) => {
      out.status = status;
      out.body = body;
    },
    deps: { dsLibrary: lib },
  });
  out.handled = handled;
  return out;
}

const url = (rest, project = P) => `/api/projects/${project}/v1/ds/${rest}`;

test('the route table carries the ds-library row (one table, S9 Q12)', () => {
  for (const row of DS_LIBRARY_ROWS) assert.ok(HUB_ROUTE_ROWS.includes(row), 'row mounted');
  const row = rowFor(url('brand/head'));
  assert.equal(row, DS_LIBRARY_ROWS[0]);
  assert.equal(row.scope, 'project');
  assert.notEqual(row.canvasDoor, true, 'a canvas-only session is refused at the gate');
  // Every path under /v1/ds is this row's — none falls through to another door.
  assert.equal(rowFor(url('brand/revisions/../../../config.json')), row);
  assert.equal(rowFor(`/api/projects/${P}/v1/ds`), row);
});

for (const [mode, M] of Object.entries(MODES)) {
  const mk = (o = {}) => makeLib({ verifyGrant: (x) => M.verifyGrant(x), ...o });

  test(`a grant holder reads its system’s head: the pointer and the log’s own words only [${mode}]`, async () => {
    const lib = mk();
    const r = await call(lib, url('brand/head'), { token: M.tok.brandF1 });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['head', 'log']);
    assert.equal(r.body.head, A);
    assert.equal(r.body.log.length, 20, 'the last 20 log entries');
    for (const e of r.body.log) {
      assert.deepEqual(Object.keys(e).sort(), ['action', 'at', 'by', 'parent', 'rev', 'summary']);
      assert.deepEqual(e.by, { kind: 'person', name: 'Tereza' }, 'no e-mail on the wire');
    }
    const wire = JSON.stringify(r.body);
    for (const leak of ['Secret draft', 'actionId', 'leftOut', 'updated', 'elsewhere', 'usedBy']) {
      assert.ok(!wire.includes(leak), `head leaks ${leak}`);
    }
  });

  test(`a grant holder reads a revision of its system byte for byte [${mode}]`, async () => {
    const lib = mk();
    const r = await call(lib, url(`brand/revisions/${A}`), { token: M.tok.brandF1 });
    assert.equal(r.status, 200);
    assert.equal(r.bytes.toString('utf8'), REV_A);
    assert.match(r.headers['Content-Type'], /^application\/json/);
    const h = await call(lib, url(`brand/revisions/${A}`), {
      token: M.tok.brandF1,
      method: 'HEAD',
    });
    assert.equal(h.status, 200);
    assert.equal(h.bytes, null);
  });

  test(`a system name with a space resolves when encoded [${mode}]`, async () => {
    const r = await call(mk(), url('Club%20brand/head'), { token: M.tok.spaced });
    assert.equal(r.status, 200);
  });

  test(`LEAK PROBES: every other path answers exactly as a missing one (U1) [${mode}]`, async () => {
    const lib = mk();
    const missing = await call(lib, url('no-such-system/head'), { token: M.tok.brandF1 });
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, DS_LIBRARY_NOT_FOUND);
    const probes = [
      url('other/head'), // another system, which exists
      url(`other/revisions/${B}`), // a revision of another system
      url(`brand/revisions/${B}`), // that revision asked under the granted system
      url('brand/tokens.json'),
      url('brand/colors_and_type.css'),
      url('brand/revisions/head.json'),
      url(`brand/revisions/${A}.tokens.css`), // a sibling, not the revision JSON
      url(`brand/revisions/${A}.json`),
      url(`brand/revisions/${A.toUpperCase()}`),
      url(`brand/revisions/${A.slice(0, 63)}`),
      url(`brand/revisions/${LINK_IN}`), // a link to a canvas inside the design root
      url(`brand/revisions/${LINK_OUT}`), // a link out of the design root
      url('linked/head'), // a system whose directory is a link
      url('brand'),
      url('brand/'),
      url('brand/head/x'),
      url('brand/files'),
      url('brand/revisions'),
      url('%2e%2e/head'),
      url('brand%2f..%2fother/head'),
      url('..%2F..%2Fui/head'),
      url('brand/revisions/../../../config.json'),
      url('brand/head', 'someone-else'), // another project id
      `/api/projects/${P}/v1/ds`,
      `/api/projects/${P}/v1/ds/`,
    ];
    for (const p of probes) {
      const r = await call(lib, p, { token: M.tok.brandF1 });
      assert.equal(r.status, 404, `${p} → ${r.status}`);
      assert.deepEqual(r.body, DS_LIBRARY_NOT_FOUND, `${p} answers the missing body`);
      assert.equal(r.bytes, null, `${p} sent bytes`);
    }
    // A system directory that is a link serves nothing, to its grant or to a member.
    for (const token of [M.tok.linked, 'member']) {
      for (const p of [url('linked/head'), url(`linked/revisions/${B}`)]) {
        const r = await call(lib, p, { token });
        assert.equal(r.status, 404, `${token} ${p} → ${r.status}`);
        assert.deepEqual(r.body, DS_LIBRARY_NOT_FOUND);
      }
    }
  });

  test(`LEAK PROBES: a grant never writes, and a foreign or malformed grant is no grant [${mode}]`, async () => {
    const lib = mk();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await call(lib, url('brand/head'), { token: M.tok.brandF1, method });
      assert.equal(r.status, 405, method);
    }
    for (const token of ['grant-other-project', 'grant-bad-fetcher', 'not-a-credential']) {
      const r = await call(lib, url('brand/head'), { token });
      assert.equal(r.status, 401, token);
    }
    assert.equal((await call(lib, url('brand/head'))).status, 401, 'no credential');
  });

  test(`fail closed: with no grant verifier wired, a non-member is refused [${mode}]`, async () => {
    const lib = createDsLibraryRoutes({
      projectId: P,
      designRoot: () => root,
      systems: () => SYSTEMS,
      auth,
    });
    assert.equal((await call(lib, url('brand/head'), { token: M.tok.brandF1 })).status, 401);
    assert.equal((await call(lib, url('brand/head'), { token: 'member' })).status, 200);
  });

  test(`members read (Can view included) and see "used by N"; a grant holder never does (U5) [${mode}]`, async () => {
    let t = Date.parse('2026-10-20T10:00:00Z');
    const lib = mk({ now: () => t });
    const first = await call(lib, url('brand/head'), { token: 'observer' });
    assert.equal(first.status, 200);
    assert.equal(first.body.usedBy, 1, 'only this project, where it is edited');
    await call(lib, url('brand/head'), { token: M.tok.brandF1 });
    await call(lib, url('brand/head'), { token: M.tok.brandF2 });
    await call(lib, url('brand/head'), { token: M.tok.brandF1 });
    await call(lib, url(`brand/revisions/${A}`), { token: M.tok.brandF1 });
    const m = await call(lib, url('brand/head'), { token: 'member' });
    assert.equal(m.body.usedBy, 3, 'distinct fetchers of head + this project');
    assert.equal((await call(lib, url('other/head'), { token: 'member' })).body.usedBy, 1);
    t += DS_LIBRARY_USAGE_WINDOW_MS + 1000;
    assert.equal(
      (await call(lib, url('brand/head'), { token: 'member' })).body.usedBy,
      1,
      '90 days'
    );
  });

  test(`a member’s machine scope and a canvas-only session stay narrow [${mode}]`, async () => {
    const lib = mk();
    const scoped = await call(lib, url('brand/head'), { token: 'scoped' });
    assert.equal(scoped.status, 404, 'DDR-053 scope ui does not cover system/brand');
    const co = await call(lib, url('brand/head'), { token: 'canvasOnly' });
    assert.equal(co.status, 403);
    assert.equal(co.body.reason, 'not-in-scope', 'refused at the gate (fail closed)');
    assert.equal(
      (await call(lib, url(`brand/revisions/${A}`), { token: 'canvasOnly' })).status,
      403
    );
  });

  test(`a hub with no design root serves no library (the capability predicate is false) [${mode}]`, async () => {
    const lib = createDsLibraryRoutes({
      projectId: P,
      designRoot: () => null,
      systems: () => SYSTEMS,
      auth,
      verifyGrant: (x) => M.verifyGrant(x),
    });
    assert.equal(lib.enabled(), false);
    assert.equal(mk().enabled(), true);
    assert.equal((await call(lib, url('brand/head'), { token: 'member' })).status, 404);
    assert.equal((await call(lib, url('brand/head'), { token: M.tok.brandF1 })).status, 404);
  });
}

test('the usage file survives a restart and drops what it cannot trust', () => {
  const file = join(outside, 'usage.json');
  const t = Date.parse('2026-10-20T10:00:00Z');
  const u1 = createDsLibraryUsage({ file, now: () => t });
  u1.record('brand', 'proj-junior');
  u1.record('brand', '../evil');
  const u2 = createDsLibraryUsage({ file, now: () => t + 1000 });
  assert.equal(u2.fetchers('brand'), 1);
});
