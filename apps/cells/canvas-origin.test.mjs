// The data plane's hostname routing.
//
// Cloud Phase 25 A4 added a SECOND kind of hostname to this Worker, and the
// two are not distinguishable by shape: `canvas.<zone>` is a syntactically
// valid tenant label, so without an explicit branch a canvas-origin request
// routes to a cell called "canvas" and serves the generic landing page. That
// is the failure this file exists to prevent, because it is silent — a
// working-looking page at exactly the address the origin should be at, which
// is how it reached production before these tests did.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CANVAS_ORIGIN_HEADER,
  canvasInnerRequest,
  canvasOriginTenant,
  stripCanvasOriginMarker,
  tenantFromHostname,
} from './cell-config.mjs';

test('canvas.<zone>/<project>/… resolves to the project, tenant stripped from the path', () => {
  const out = canvasOriginTenant(
    new URL('https://canvas.cloud.maude.sh/alligators/_canvas/module?c=ui/Home.tsx'),
    'cloud.maude.sh'
  );
  // The cell must see the path WITHOUT the tenant segment, so that a cell
  // serving a self-hoster and a cell serving a Cloud tenant handle
  // byte-identical requests.
  assert.deepEqual(out, { tenant: 'alligators', rest: '/_canvas/module' });
});

test('deeper canvas paths keep their remainder intact', () => {
  const out = canvasOriginTenant(
    new URL('https://canvas.cloud.maude.sh/alligators/_canvas/runtime/react.js'),
    'cloud.maude.sh'
  );
  assert.deepEqual(out, { tenant: 'alligators', rest: '/_canvas/runtime/react.js' });
});

test('the canvas origin with no project is a refusal, never a fall-through', () => {
  const out = canvasOriginTenant(new URL('https://canvas.cloud.maude.sh/'), 'cloud.maude.sh');
  assert.equal(out.tenant, null);
});

test('an ordinary project hostname is NOT the canvas origin', () => {
  assert.equal(
    canvasOriginTenant(new URL('https://alligators.cloud.maude.sh/studio'), 'cloud.maude.sh'),
    null
  );
});

// Cloud Phase 27 — `canvas-<project>.<zone>` IS the origin now, one per project.
//
// The shared host with the project in the PATH could not work: canvas code
// contains ABSOLUTE asset URLs (`/.design/system/<ds>/assets/…`), and an
// absolute URL resolves against the origin, silently dropping the project.
// Nothing in the shell reaches inside a tenant's compiled module to fix that.

test('canvas-<project>.<zone> is that project’s origin, and the path is untouched', () => {
  assert.deepEqual(
    canvasOriginTenant(
      new URL('https://canvas-alligators.cloud.maude.sh/.design/system/x/assets/a.png'),
      'cloud.maude.sh'
    ),
    { tenant: 'alligators', rest: '/.design/system/x/assets/a.png' }
  );
  // No stripping — the origin root IS the project, which is the whole point.
  assert.equal(
    canvasOriginTenant(new URL('https://canvas-club.cloud.maude.sh/studio'), 'cloud.maude.sh')
      .tenant,
    'club'
  );
});

test('a canvas hostname whose project id is malformed resolves to nothing', () => {
  // Never a guess, and never a cell for a project that cannot exist.
  for (const h of [
    'canvas-.cloud.maude.sh',
    'canvas-a_b.cloud.maude.sh',
    'canvas-x..cloud.maude.sh',
  ]) {
    assert.equal(canvasOriginTenant(new URL(`https://${h}/x`), 'cloud.maude.sh'), null, h);
  }
});

test('hostname case is normalised, not rejected — DNS is case-insensitive', () => {
  // `canvas-Alligators` and `canvas-alligators` are the SAME host; treating the
  // first as malformed would 404 a project because of how somebody typed it.
  assert.equal(
    canvasOriginTenant(new URL('https://canvas-Alligators.cloud.maude.sh/x'), 'cloud.maude.sh')
      .tenant,
    'alligators'
  );
});

test('the canvas hostname never starts a cell of its own name', () => {
  // `canvas-alligators` is a valid tenant-id shape, so without the reserved
  // prefix it would start a brand-new empty project at the very address
  // alligators' canvases load from — the `view-` lesson, second time.
  assert.equal(tenantFromHostname('canvas-alligators.cloud.maude.sh', 'cloud.maude.sh'), null);
  assert.equal(tenantFromHostname('alligators.cloud.maude.sh', 'cloud.maude.sh'), 'alligators');
});

test('no zone configured means no canvas origin — never a guess', () => {
  assert.equal(canvasOriginTenant(new URL('https://canvas.cloud.maude.sh/x'), ''), null);
});

// ── the gallery's namespace stays dead (Cloud Phase 25 C5) ──────────────────

test('a leftover view-<project> hostname resolves to no tenant at all', () => {
  // Deleting the routes did not delete the addresses: `view-alligators` was
  // still live in production after C5. Left unguarded it is not a 404 — it is
  // a NEW empty cell at an old URL, with autosave ready to commit over it.
  assert.equal(tenantFromHostname('view-alligators.cloud.maude.sh', 'cloud.maude.sh'), null);
  assert.equal(tenantFromHostname('view-anything.cloud.maude.sh', 'cloud.maude.sh'), null);
  // A project whose own name merely contains the word is untouched.
  assert.equal(tenantFromHostname('viewfinder.cloud.maude.sh', 'cloud.maude.sh'), 'viewfinder');
});

// Cloud Phase 27 — the marker the cell trusts, and the one it must never see.
//
// The cell cannot tell the canvas origin from the project hostname by looking:
// after a Durable Object and a container proxy, `Host` is not what the browser
// typed. So the Worker says which it is. That is only safe while the Worker
// also STRIPS the claim from every request on the project hostname.

// Since the write-loss fix (canvas-request.test.mjs) the rebuilds live in
// cell-config.mjs as `canvasInnerRequest` / `stripCanvasOriginMarker`, so the
// marker rules are held BEHAVIORALLY against those functions — a source regex
// over worker.mjs would pin an inline shape that no longer exists (and could
// not see a lossy rebuild anyway, which is how the GET-collapse shipped).

test('the canvas branch marks the request — an inbound claim never survives', () => {
  const forged = new Request('https://canvas-alligators.cloud.maude.sh/_api/annotations', {
    method: 'PUT',
    headers: { [CANVAS_ORIGIN_HEADER]: 'forged' },
    body: '{}',
  });
  const inner = canvasInnerRequest(forged, new URL(forged.url), '/_api/annotations');
  assert.equal(inner.headers.get(CANVAS_ORIGIN_HEADER), '1');
});

test('the project hostname strips any claim before the cell sees it', () => {
  const forged = new Request('https://alligators.cloud.maude.sh/studio', {
    headers: { [CANVAS_ORIGIN_HEADER]: '1' },
  });
  const inbound = stripCanvasOriginMarker(forged);
  // Stripped, and never re-asserted — the project hostname must not be able
  // to open the canvas lane.
  assert.equal(inbound.headers.has(CANVAS_ORIGIN_HEADER), false);
});

test('a scanner path on the shared canvas host names no project (2026-10-02)', () => {
  // Bots walking canvas.<zone>/<anything> were creating one Durable Object per
  // probe — `.env.prod`, `database.sql`, `.git-credentials` all became names.
  for (const probe of [
    '/.env.prod',
    '/database.sql',
    '/.git-credentials',
    '/wp-admin%2F',
    '/A_B/x',
  ]) {
    const out = canvasOriginTenant(
      new URL(`https://canvas.cloud.maude.sh${probe}`),
      'cloud.maude.sh'
    );
    assert.equal(out.tenant, null, probe);
  }
});
