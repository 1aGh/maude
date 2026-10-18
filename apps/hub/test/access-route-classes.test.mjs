// Every hub path has a class — V2-1.16 U3, hub half (S9.3).
//
// The paths are SCRAPED from `server.mjs onRequest` (and the hub-owned list the
// shell door keeps), never a hand list: a branch added there without a row in
// `routes-v2/` is a red test here, which is what makes the later canary sweep
// (S9.12) enumerate everything.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DOCUMENT_PATH_PREFIX, DOCUMENTS_PATH } from '../src/documents.mjs';
import { FILE_DOOR_PREFIX, FILE_LIMITS_PATH } from '../src/file-door.mjs';
import { FILES_PATH, PROJECT_FILE_PREFIX } from '../src/file-manifest.mjs';
import { HISTORY_FILE_PATH, HISTORY_PATH } from '../src/history.mjs';
import { JOURNAL_PATH, JOURNAL_REPORT_PATH } from '../src/journal.mjs';
import { MATERIALIZE_PATH } from '../src/materializer.mjs';
import { PROJECT_CONFIG_PATH } from '../src/project-config-door.mjs';
import { FORMAT_ROUTE } from '../src/project-transactions/hub-integration.mjs';
import {
  checkHubRouteTable,
  DEFAULT_ROW,
  HUB_ROUTE_ROWS,
  rowFor,
  SCOPES,
} from '../src/routes-v2/index.mjs';
import { HUB_OWNED } from '../src/studio-door.mjs';
import { UPLOADS_PREFIX } from '../src/upload-sessions.mjs';

const CONSTANTS = {
  DOCUMENT_PATH_PREFIX,
  DOCUMENTS_PATH,
  FILE_DOOR_PREFIX,
  FILE_LIMITS_PATH,
  FILES_PATH,
  PROJECT_FILE_PREFIX,
  HISTORY_FILE_PATH,
  HISTORY_PATH,
  JOURNAL_PATH,
  JOURNAL_REPORT_PATH,
  MATERIALIZE_PATH,
  PROJECT_CONFIG_PATH,
  FORMAT_ROUTE,
  UPLOADS_PREFIX,
};

const SRC = readFileSync(fileURLToPath(new URL('../src/server.mjs', import.meta.url)), 'utf8');
const ON_REQUEST = SRC.slice(SRC.indexOf('async onRequest('), SRC.indexOf('async onConnect('));

/** Every path `onRequest` compares the request against: literal or constant. */
function scrapedPaths() {
  const out = new Map();
  const re = /\b(?:authPath|url)\s*(?:===\s*|\.startsWith\()\s*(?:'([^']*)'|([A-Z][A-Z0-9_]*))/g;
  for (const m of ON_REQUEST.matchAll(re)) {
    const [, literal, constant] = m;
    if (constant) {
      assert.ok(
        Object.hasOwn(CONSTANTS, constant),
        `onRequest compares against ${constant}; import it here so its path is classified`
      );
      out.set(CONSTANTS[constant], constant);
    } else if (literal) {
      // `/health?` / `/?` are the same route with a query.
      out.set(literal.replace(/\?$/, '') || '/', literal);
    }
  }
  return out;
}

/** A concrete request path for a scraped path (a prefix gets one segment). */
const sample = (p) => (p.endsWith('/') && p !== '/' ? `${p}x` : p);

test('the scrape still finds the routes (a guard on the guard)', () => {
  const paths = scrapedPaths();
  assert.ok(paths.size >= 30, `found only ${paths.size} paths in onRequest`);
  for (const must of ['/health', '/auth/login', PROJECT_FILE_PREFIX, '/api/export']) {
    assert.ok(paths.has(must), `${must} was not scraped`);
  }
});

test('every path onRequest serves has a row with a scope class', () => {
  const missing = [];
  for (const [p, from] of scrapedPaths()) {
    const row = rowFor(sample(p));
    if (!row) missing.push(`${p} (${from})`);
    else assert.ok(SCOPES.includes(row.scope), `${p}: scope '${row.scope}'`);
  }
  assert.deepEqual(missing, [], 'unclassified hub paths — add a row in apps/hub/src/routes-v2/');
});

test('every hub-owned path on the shell origin has a row', () => {
  for (const p of HUB_OWNED) {
    assert.ok(rowFor(sample(p)), `${p} is hub-owned but unclassified`);
  }
});

test('the accepted-revisions lane is classified per route, bytes as export', () => {
  for (const [route, cap] of [
    ['bootstrap', 'export'],
    ['lane', 'export'],
    ['blobs/abc', 'export'],
    ['history', 'read'],
    ['proposals', 'read'],
  ]) {
    assert.equal(rowFor(`/api/projects/current/v1/${route}`).cap.safe, cap, route);
  }
});

test('the studio’s lane is the default row, classified by its own manifest', () => {
  assert.equal(rowFor('/_api/canvas'), null);
  assert.equal(DEFAULT_ROW.delegate, 'studio-manifest');
  assert.ok(SCOPES.includes(DEFAULT_ROW.scope));
});

test('the table refuses a row it cannot classify', () => {
  const ok = { path: '/a', cap: { safe: 'read', unsafe: 'edit' }, scope: 'none' };
  assert.doesNotThrow(() => checkHubRouteTable([ok]));
  assert.throws(() => checkHubRouteTable([ok, { ...ok }]), /classified twice/);
  assert.throws(() => checkHubRouteTable([{ ...ok, scope: 'all' }]), /scope class/);
  assert.throws(
    () => checkHubRouteTable([{ ...ok, cap: { safe: 'raed', unsafe: null } }]),
    /not a capability/
  );
  assert.throws(() => checkHubRouteTable([{ ...ok, cap: { safe: 'read' } }]), /cap\.unsafe/);
  assert.throws(() => checkHubRouteTable([{ ...ok, path: '*' }]), /path or a pattern/);
  // The real table passes (it is also checked at import).
  assert.doesNotThrow(() => checkHubRouteTable(HUB_ROUTE_ROWS));
});
