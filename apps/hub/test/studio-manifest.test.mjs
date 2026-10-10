// E3 — every studio route surviving `pruneForWorkspace()` maps to a capability.
//
// THE POINT IS THE RED BUILD. The cell serves the real studio (DDR-209), whose
// route table grows every phase. A proxy is only default-deny if somebody
// notices the deny; without this test a new route is simply unreachable in the
// cloud, and the bug report is "the Layers panel is empty for my colleague"
// three weeks later. With it, the person adding the route is the person who
// classifies it, in the same change, while they still know the answer.
//
// It reads the studio's route table out of SOURCE rather than importing it,
// because `http.ts` is TypeScript that only Bun runs and this suite is
// `node --test`. That is the same trade `scripts/check-containment.sh` makes,
// and it is sound for the same reason: the shape being matched
// (`    '/route': ` at one indent level inside the routes literal) is the one
// the file has had since it was written, and a change that breaks the match
// makes the test fail loudly rather than pass vacuously — the count assertion
// below exists exactly to catch a regex that silently stops matching.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CAPABILITIES } from '../src/role-matrix.mjs';
import { capabilitiesUsed, classify, decide, STUDIO_ROUTES } from '../src/studio-manifest.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HTTP_TS = join(REPO, 'apps', 'studio', 'http.ts');
const WORKSPACE_TS = join(REPO, 'apps', 'studio', 'workspace-mode.ts');

/**
 * Route keys declared in the studio's `routes` object literal, plus every EXACT spec `path:`
 * in its route table (`apps/studio/routes/*.ts`, V2-2.5) — a route added there is served
 * in a cell like one in http.ts. `:param` spec paths are left out: like the fall-through's
 * dynamic routes they match no exact entry here and are refused default-closed.
 */
function studioRouteKeys(studioDir = join(REPO, 'apps', 'studio')) {
  const src = readFileSync(join(studioDir, 'http.ts'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/^ {4}'(\/[^']*)':/gm)) keys.add(m[1]);
  const tableDir = join(studioDir, 'routes');
  for (const f of readdirSync(tableDir).filter((n) => n.endsWith('.ts'))) {
    const table = readFileSync(join(tableDir, f), 'utf8');
    for (const m of table.matchAll(/\bpath:\s*'(\/[^':]*)'/g)) keys.add(m[1]);
  }
  return [...keys].sort();
}

/** The forbidden prefixes, read from the vocabulary rather than re-typed. */
function forbiddenPrefixes() {
  const src = readFileSync(WORKSPACE_TS, 'utf8');
  const start = src.indexOf('FORBIDDEN_ROUTE_PREFIXES');
  const end = src.indexOf('SANDBOXED_ROUTE_PREFIXES');
  assert.ok(start !== -1 && end > start, 'both containment lists must exist (DDR-209 A′1)');
  return [...src.slice(start, end).matchAll(/prefix:\s*'([^']+)'/g)].map((m) => m[1]);
}

test('the route-key scrape still finds the studio table', () => {
  const keys = studioRouteKeys();
  // Not an exact number — that would fail on every unrelated feature. A floor
  // catches the only failure this guard has: a regex that matches nothing and
  // therefore approves everything.
  assert.ok(keys.length > 80, `expected the studio route table, scraped ${keys.length} keys`);
  assert.ok(keys.includes('/_config'), 'the scrape must see /_config');
  assert.ok(keys.includes('/_health'), 'the scrape must see /_health');
  // V2-2.5 — and the route table beside it.
  assert.ok(keys.includes('/_api/project/migrate'), 'the scrape must see routes/*.ts');
});

test('the route-key scrape sees a route planted in the studio route table (V2-2.5)', () => {
  const studio = mkdtempSync(join(tmpdir(), 'studio-manifest-'));
  mkdirSync(join(studio, 'routes'));
  writeFileSync(
    join(studio, 'http.ts'),
    "  const legacyRoutes = {\n    '/_api/legacy-x': () => null,\n"
  );
  writeFileSync(
    join(studio, 'routes', 'plant.ts'),
    "[{ method: 'POST', path: '/_api/planted', origin: 'main' },\n" +
      " { method: 'GET', path: '/_api/planted/:id', origin: 'main' }]\n"
  );
  // The exact path is seen; the `:param` one is default-closed, so it is not a key.
  assert.deepEqual(studioRouteKeys(studio), ['/_api/legacy-x', '/_api/planted']);
});

test('every route a cell serves is classified', () => {
  const forbidden = forbiddenPrefixes();
  const survives = (route) => !forbidden.some((p) => route === p || route.startsWith(p));
  const unclassified = studioRouteKeys()
    .filter(survives)
    .filter((route) => !Object.hasOwn(STUDIO_ROUTES, route));
  assert.deepEqual(
    unclassified,
    [],
    `these studio routes survive pruneForWorkspace() but no one has said what they mean:\n` +
      unclassified.map((r) => `  ${r}`).join('\n') +
      `\n\nAdd each to STUDIO_ROUTES in apps/hub/src/studio-manifest.mjs with the ` +
      `capability it needs (or REFUSED, with the reason). Cloud Phase 27 E3.`
  );
});

test('a write-classified route is never a GET-only handler (the edit-scope inversion)', () => {
  // The class that shipped: `/_api/edit-scope` was filed `{safe:null,
  // unsafe:'edit'}` — write-only — but its handler is `if (req.method !== 'GET')
  // 405`, a pure read. The hub then refused the shell's GET with 405 for every
  // role, owner included, and the Local/Shared badge (plus, by the same shape,
  // any other inverted route) was dead in the cloud. The manifest's `safe` side
  // must not be null when the handler answers ONLY GET.
  //
  // Source-scrape, same trade the rest of this file makes: `http.ts` is Bun-only
  // TS and this suite is node --test. The shape matched — a handler whose FIRST
  // guard is `req.method !== 'GET') ... 'Method not allowed'` — is GET-only.
  const src = readFileSync(HTTP_TS, 'utf8');
  const starts = [...src.matchAll(/^ {4}'(\/[^']*)': (?:async )?\(req/gm)].map((m) => ({
    path: m[1],
    at: m.index,
  }));
  const bodyOf = (path) => {
    const i = starts.findIndex((s) => s.path === path);
    if (i === -1) return null;
    return src.slice(starts[i].at, starts[i + 1]?.at ?? src.length);
  };
  const getOnly = (b) =>
    /req\.method !== 'GET'\)?\s*return new Response\('Method not allowed'/.test(b);

  // V2-2.5 — a table route (apps/studio/routes/*.ts) declares its methods: it is GET-only when
  // every spec for its path says `method: 'GET'`.
  const tableMethods = new Map();
  const tableDir = join(REPO, 'apps', 'studio', 'routes');
  for (const f of readdirSync(tableDir).filter((n) => n.endsWith('.ts'))) {
    const t = readFileSync(join(tableDir, f), 'utf8');
    for (const m of t.matchAll(/method:\s*'([A-Z]+)',\s*path:\s*'([^']+)'/g))
      tableMethods.set(m[2], [...(tableMethods.get(m[2]) ?? []), m[1]]);
  }

  const inverted = [];
  for (const [path, cls] of Object.entries(STUDIO_ROUTES)) {
    if (cls === null || cls === undefined) continue;
    const methods = tableMethods.get(path);
    if (methods) {
      if (cls.unsafe && cls.safe === null && methods.every((m) => m === 'GET')) inverted.push(path);
      continue;
    }
    const body = bodyOf(path);
    if (!body) continue; // dynamic / fetch-served — not an exact route literal
    if (cls.unsafe && cls.safe === null && getOnly(body)) inverted.push(path);
  }
  assert.deepEqual(
    inverted,
    [],
    `these routes are classified write-only but their handler answers only GET ` +
      `(the edit-scope inversion — the shell's GET gets 405 for every role):\n` +
      inverted.map((r) => `  ${r} → should be { safe: 'read', unsafe: null }`).join('\n')
  );
});

test('the manifest names no capability the matrix does not have', () => {
  for (const capability of capabilitiesUsed()) {
    assert.ok(
      CAPABILITIES.includes(capability),
      `'${capability}' is not in role-matrix.mjs — one table, one authority`
    );
  }
});

test('an unknown path is denied, not defaulted', () => {
  assert.deepEqual(decide('GET', '/_api/whatever-lands-next-phase', 'owner'), {
    allow: false,
    reason: 'unclassified',
    capability: null,
  });
  // Even for an owner. Deny-by-default that an owner can walk through is an
  // allowlist with extra steps.
  assert.equal(decide('POST', '/_api/nope', 'owner').allow, false);
});

test('a viewer may read, comment and keep their own place — and nothing else', () => {
  assert.equal(decide('GET', '/_config', 'viewer').allow, true);
  assert.equal(decide('POST', '/_comments', 'viewer').allow, true);
  assert.equal(decide('PUT', '/_canvas-state', 'viewer').allow, true);
  assert.equal(decide('POST', '/_api/edit-text', 'viewer').allow, false);
  assert.equal(decide('PUT', '/_api/annotations', 'viewer').allow, false);
  assert.equal(decide('POST', '/_api/git/commit', 'viewer').allow, false);
});

test('a viewer may not switch the branch everyone else is looking at', () => {
  // Cloud Phase 27 D2. Both of these were `read`, on the reasoning that
  // "looking at another branch is not changing one" — true for ONE user at ONE
  // checkout, and false in a cell, where the tree is shared: a viewer switching
  // branches replaces the files under an owner who is mid-edit, and a viewer
  // pulling merges into them. It is the most destructive write in the product,
  // performed by the role that is supposed to hold none.
  assert.equal(decide('POST', '/_api/git/checkout', 'viewer').allow, false);
  assert.equal(decide('POST', '/_api/git/pull', 'viewer').allow, false);
  assert.equal(decide('POST', '/_api/git/checkout', 'member').allow, true);
  assert.equal(decide('POST', '/_api/git/pull', 'member').allow, true);
  // Fetching moves remote-tracking refs and nothing else — still a read.
  assert.equal(decide('POST', '/_api/git/fetch', 'viewer').allow, true);
});

test('a member may edit but may not push this project somewhere else', () => {
  assert.equal(decide('POST', '/_api/edit-text', 'member').allow, true);
  assert.equal(decide('PUT', '/_api/annotations', 'member').allow, true);
  assert.equal(decide('POST', '/_api/git/push', 'member').allow, false);
  assert.equal(decide('POST', '/_api/git/push', 'owner').allow, true);
});

test('an unknown role gets nothing at all', () => {
  for (const path of ['/_config', '/_comments', '/_canvas-state']) {
    assert.equal(decide('GET', path, 'admin').allow, false, `${path} leaked to a bogus role`);
  }
  assert.equal(decide('GET', '/_config', undefined).allow, false);
  assert.equal(decide('GET', '/_config', '').allow, false);
});

test('the export JOBS lane is served, the synchronous render is not (render-workers)', () => {
  // feature-cloud-export-render-workers — the job routes evaluate nothing in
  // the cell (enqueue/list/stream; the render happens in maude-render), and
  // `export` is an all-roles capability ("look, comment and download" is what
  // viewer means — role-matrix.mjs).
  assert.equal(decide('GET', '/_api/export-jobs', 'viewer').allow, true);
  assert.equal(decide('POST', '/_api/export-jobs', 'viewer').allow, true);
  assert.equal(decide('POST', '/_api/export-jobs', 'member').allow, true);
  assert.equal(decide('GET', '/_api/export-jobs/download', 'viewer').allow, true);
  // Download is a GET-only handler — POST is a method refusal, not a grant.
  assert.equal(decide('POST', '/_api/export-jobs/download', 'viewer').allow, false);
  assert.equal(decide('GET', '/_api/export-history', 'viewer').allow, true);
  // DDR-231 — the browser lane's assemble half: the member's browser captured
  // the PNGs, the cell only composes the deck (pure JS over pure data — the
  // zip containment class). POST because it takes work; `export` capability,
  // all roles. GET is a method refusal on the handler, not a grant.
  assert.equal(decide('POST', '/_api/export-assemble', 'viewer').allow, true);
  assert.equal(decide('POST', '/_api/export-assemble', 'member').allow, true);
  assert.equal(decide('GET', '/_api/export-assemble', 'viewer').allow, false);
  // DDR-231 T7 — the warm-up ping is a harmless read (proxied /_health).
  assert.equal(decide('GET', '/_api/export-warmup', 'viewer').allow, true);
  // The synchronous render stays refused for everyone — a cloud render is a job.
  assert.equal(decide('POST', '/_api/export', 'owner').reason, 'refused');
});

test('the refused lane is refused for the owner too', () => {
  for (const path of ['/_api/export', '/_api/acp/status', '/_api/github/repos', '/_api/hub/link']) {
    const verdict = decide('POST', path, 'owner');
    assert.equal(verdict.allow, false, `${path} must never be served by a cell`);
    assert.equal(verdict.reason, 'refused');
  }
});

test('a GET on a POST-only editing route is a method refusal, not a role refusal', () => {
  const verdict = decide('GET', '/_api/edit-text', 'owner');
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'method');
});

test('prefix rules resolve longest-match and cover the dynamic comment lane', () => {
  assert.equal(classify('POST', '/_api/comments/abc123/reply').capability, 'comment');
  assert.equal(decide('POST', '/_api/comments/abc123/reply', 'viewer').allow, true);
  assert.equal(decide('GET', '/_client/client.bundle.js', 'viewer').allow, true);
  assert.equal(decide('POST', '/_client/client.bundle.js', 'owner').allow, false);
});

// ── The design-system asset read lane ────────────────────────────────────────
//
// Reported 2026-08-13: in the cloud file browser every DS logo, font and photo
// showed a broken-image icon, while the SAME files rendered inside canvases.
// The canvas origin has always allowed `<designRoot>/…` (studio `isCanvasSafe`);
// the main origin never did, so the default-closed manifest refused the preview
// as `unclassified` and answered 404 without ever asking the studio child.
//
// What these pin is the boundary, not the feature: the lane must open exactly
// the paths the desktop is allowed to PUSH (`checkoutAssetRel`, the one home
// for that question) and nothing else — above all not the studio's repo-wide
// fall-through, which on a cell would be the whole tenant repository.

test('a design-system asset is readable — the file browser preview lane', () => {
  assert.deepEqual(
    decide('GET', '/.design/system/alligators/assets/logos/horizontal-green.svg', 'viewer'),
    {
      allow: true,
      capability: 'read',
    }
  );
  // Fonts and photographs travel the same lane.
  assert.equal(decide('GET', '/.design/system/ds/assets/fonts/Body.woff2', 'viewer').allow, true);
  assert.equal(decide('GET', '/.design/assets/acko-group-real.png', 'viewer').allow, true);
});

test('runtime state stays invisible, whatever it contains', () => {
  // DDR-115: `_history/`, `_chat/`, `_comments/`, `_untrusted/` are per-user
  // runtime state. A segment must start alphanumeric, so they never match.
  for (const p of [
    '/.design/_history/ui-home/assets/shot.png',
    '/.design/_comments/assets/pasted.png',
    '/.design/_untrusted/assets/hub-supplied.png',
    '/.design/_chat/assets/attachment.png',
  ]) {
    assert.equal(decide('GET', p, 'owner').reason, 'unclassified', p);
  }
});

test('the lane is assets-only — it is not a repository browser', () => {
  for (const p of [
    '/.design/ui/Home.tsx', // canvas SOURCE
    '/.design/config.json', // project config
    '/.design/system/ds/assets/logos/notes.txt', // wrong extension
    '/.design/system/ds/preview/logo.tsx', // no assets segment
    '/../../etc/passwd',
    '/.design/system/ds/assets/../../../escape.svg',
  ]) {
    assert.equal(decide('GET', p, 'owner').allow, false, p);
  }
});

test('it is READ-ONLY — an owner cannot write through it', () => {
  const v = decide('PUT', '/.design/system/ds/assets/logos/mark.svg', 'owner');
  assert.equal(v.allow, false);
  assert.equal(v.reason, 'method');
});

test('a percent-encoded traversal is decoded before it is judged', () => {
  assert.equal(
    decide('GET', '/.design/system/ds/assets/%2e%2e/%2e%2e/config.json', 'owner').allow,
    false
  );
});

// ── The design-system tokens-CSS read lane ───────────────────────────────────
//
// Reported 2026-08-13: the inspector's Variables tab was empty in every cloud
// session ("No color tokens" / "No match") while the desktop showed the full
// set. The client fetches each DS's tokens CSS from the MAIN origin
// (`/.design/system/<ds>/colors_and_type.css`); the asset lane refuses it —
// no `assets` segment, and `.css` is deliberately outside the binary-only
// extension set that guards the WRITE surface — so the default-closed manifest
// answered 404. These pin the lane: same segment shape rules as the asset
// lane, extension pinned to `.css`, read-only.

test('a DS tokens CSS is readable — the inspector variables lane', () => {
  // The reported path, by name (alligators' tokensCssRel).
  assert.deepEqual(decide('GET', '/.design/system/alligators/colors_and_type.css', 'viewer'), {
    allow: true,
    capability: 'read',
  });
  // The skeleton default per-DS path shape travels the same lane.
  assert.equal(decide('GET', '/.design/system/ds/core/tokens.css', 'viewer').allow, true);
});

test('the tokens lane is css-only — it is still not a repository browser', () => {
  for (const p of [
    '/.design/ui/Home.tsx', // canvas SOURCE
    '/.design/config.json', // project config
    '/.design/ui/home.meta.json', // canvas layout sidecar
    '/.design/system/ds/README.md', // DS prose
    '/.design/system/ds/tokens.css.bak', // extension must be the FINAL suffix
  ]) {
    assert.equal(decide('GET', p, 'owner').allow, false, p);
  }
});

test('runtime state stays invisible to the tokens lane too', () => {
  // DDR-115 again: a segment must start alphanumeric, so `_history/` &co.
  // never match even when the file inside is a stylesheet.
  for (const p of [
    '/.design/_history/ui-home/tokens.css',
    '/.design/_untrusted/hub-supplied.css',
    '/.design/_canvas-state/slug.view.css',
  ]) {
    assert.equal(decide('GET', p, 'owner').reason, 'unclassified', p);
  }
});

test('the tokens lane is READ-ONLY — no method writes through it', () => {
  const v = decide('PUT', '/.design/system/ds/core/tokens.css', 'owner');
  assert.equal(v.allow, false);
  assert.equal(v.reason, 'method');
});

test('a percent-encoded traversal cannot reach a css outside designRoot', () => {
  assert.equal(
    decide('GET', '/.design/system/%2e%2e/%2e%2e/secrets/creds.css', 'owner').allow,
    false
  );
});
