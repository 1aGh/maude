// CSRF Origin guard for the main-origin source-write routes (edit-css /
// edit-text / edit-attr). DDR-105. The DDR-054 origin-split already blocks the
// untrusted canvas *iframe* (canvas-origin-gate.test.ts proves that). This guard
// covers the OTHER untrusted origin: a malicious top-level page in another tab
// forging a `text/plain` CORS simple-request POST to localhost. The browser
// stamps such a request with an unspoofable cross-origin `Origin` header, so the
// guard must reject it — while still letting the legit same-origin shell write
// and not breaking non-browser clients (which send no Origin header).
//
// Unit-level on purpose: `sameOriginWrite` is a pure function of the Request, so
// we exercise the decision directly instead of booting a subprocess server.
// (A booted-server integration test would add a 124th server-booting file to the
// suite, which perturbs bun's worker scheduling and surfaces a PRE-EXISTING
// cross-worker port-collision flake in canvas-meta-api.test.ts — a test-harness
// race unrelated to this guard. See the Phase 12.2 validate notes.)

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { guardTableRoute, sameOriginRead, sameOriginWrite } from '../http.ts';
import { allSpecs } from '../routes/index.ts';
import { samplePath, stubDeps } from './_route-stubs.ts';

const SELF = 'http://localhost:4399';
const post = (origin?: string): Request =>
  new Request(`${SELF}/_api/edit-css`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...(origin ? { origin } : {}) },
    body: '{}',
  });

describe('CSRF Origin guard — sameOriginWrite (DDR-105)', () => {
  test('rejects a forged cross-origin Origin', () => {
    expect(sameOriginWrite(post('http://evil.example'))).toBe(false);
    // A look-alike host (substring / suffix tricks) must not slip through.
    expect(sameOriginWrite(post('http://localhost.evil.example'))).toBe(false);
    expect(sameOriginWrite(post('http://localhost:4399.evil.example'))).toBe(false);
    // Right host, wrong port is still cross-origin.
    expect(sameOriginWrite(post('http://localhost:4400'))).toBe(false);
  });

  test('allows the legit same-origin shell Origin', () => {
    expect(sameOriginWrite(post(SELF))).toBe(true);
  });

  test('a matching host on a different SCHEME is same-origin — TLS terminates at the cell proxy', () => {
    // The second half of the inspector-edits RCA. In a cell the browser sends
    // `https://<host>` but the studio serves plaintext and computes `req.url` as
    // `http://<host>`, so a scheme-strict compare 403'd every legitimate shell
    // write. Host+port still pins it; a cross-site page has a different host.
    const cell = 'https://alligators.cloud.maude.sh';
    const cellReq = (origin?: string) =>
      new Request('http://alligators.cloud.maude.sh/_api/edit-css', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: '{}',
      });
    expect(sameOriginWrite(cellReq(cell))).toBe(true); // https Origin ↔ http req.url, same host
    // But a genuinely different host is still rejected, scheme notwithstanding.
    expect(sameOriginWrite(cellReq('https://evil.cloud.maude.sh'))).toBe(false);
    // And the port still discriminates when present.
    expect(sameOriginWrite(post('https://localhost:4400'))).toBe(false);
  });

  test('allows a request with no Origin header (curl / programmatic / bun:test)', () => {
    expect(sameOriginWrite(post())).toBe(true);
  });

  test('rejects an unparseable Origin rather than letting it through', () => {
    expect(sameOriginWrite(post('not a url'))).toBe(false);
  });
});

describe('CSRF read guard — sameOriginRead (Task 2.5 F1, Fetch-Metadata)', () => {
  const get = (secFetchSite?: string): Request =>
    new Request(`${SELF}/_api/generate/audio-search?q=x`, {
      method: 'GET',
      headers: { ...(secFetchSite ? { 'sec-fetch-site': secFetchSite } : {}) },
    });

  test('rejects a cross-site browser GET (key-bearing fan-out must not be CSRF-triggerable)', () => {
    expect(sameOriginRead(get('cross-site'))).toBe(false);
    expect(sameOriginRead(get('same-site'))).toBe(false);
  });

  test('allows a same-origin browser GET', () => {
    expect(sameOriginRead(get('same-origin'))).toBe(true);
    expect(sameOriginRead(get('none'))).toBe(true); // direct navigation
  });

  test('allows a non-browser client (CLI / curl — no Sec-Fetch-Site header)', () => {
    expect(sameOriginRead(get())).toBe(true);
  });
});

// phase-30 / DDR-120: the ai-activity bridge now projects `/_api/ai/*` POSTs
// onto room awareness, which crosses the hub to every connected peer. So a
// forged cross-origin POST to /start /heartbeat /end is no longer a harmless
// loopback banner — it injects a fake "<x> is editing <slug>" presence to all
// peers (the channel that drives the social save/publish decision). These three
// routes MUST carry the same `sameOriginWrite` guard as the other write routes.
// Source-level assertion (same "don't boot a server" rationale as above): pin
// the guard into each route block so an accidental removal fails CI.
describe('CSRF Origin guard — /_api/ai/* presence-bridge routes (phase-30)', () => {
  const src = readFileSync(fileURLToPath(new URL('../http.ts', import.meta.url)), 'utf8');

  for (const route of ['/_api/ai/start', '/_api/ai/heartbeat', '/_api/ai/end']) {
    test(`${route} is wired with the sameOriginWrite CSRF guard`, () => {
      // Slice from this route's key to the next route key, then assert the guard
      // appears inside that block.
      const start = src.indexOf(`'${route}':`);
      expect(start).toBeGreaterThan(-1);
      const after = src.indexOf("'/_api/", start + 1);
      const block = src.slice(start, after === -1 ? undefined : after);
      expect(block).toContain('sameOriginWrite(req)');
    });
  }
});

// Phase 12.1 / DDR-138: /_api/reorder is a source-write (node-move). It MUST
// carry the same sameOriginWrite guard as the other edit-* write routes so a
// forged cross-origin POST can't drive a structural reorder of the user's .tsx.
// Source-level assertion (same "don't boot a server" rationale as above).
describe('CSRF Origin guard — /_api/reorder source-write route (DDR-138)', () => {
  const src = readFileSync(fileURLToPath(new URL('../http.ts', import.meta.url)), 'utf8');

  test('/_api/reorder is wired with the sameOriginWrite CSRF guard', () => {
    const start = src.indexOf("'/_api/reorder':");
    expect(start).toBeGreaterThan(-1);
    const after = src.indexOf("'/_api/", start + 1);
    const block = src.slice(start, after === -1 ? undefined : after);
    expect(block).toContain('sameOriginWrite(req)');
  });

  test('/_api/reorder-revert is wired with the sameOriginWrite CSRF guard', () => {
    const start = src.indexOf("'/_api/reorder-revert':");
    expect(start).toBeGreaterThan(-1);
    const after = src.indexOf("'/_api/", start + 1);
    const block = src.slice(start, after === -1 ? undefined : after);
    expect(block).toContain('sameOriginWrite(req)');
  });
});

// V2-2.5 — the route table (routes/*.ts). Its handlers carry no guard of their own: the guard
// is `guardTableRoute`, applied once where http.ts mounts the table. So the test holds every
// spec to that guard, and http.ts to mounting the table only through it.
describe('CSRF + DNS-rebind guard — every route-table spec (V2-2.5)', () => {
  const httpSrc = readFileSync(fileURLToPath(new URL('../http.ts', import.meta.url)), 'utf8');
  const SELF = 'http://localhost:4399';

  /** Route modules http.ts imports directly. Only the table's own entry points may be. */
  const routeImports = (src: string) =>
    [...src.matchAll(/'\.\/routes\/([^']+)'/g)].map((m) => m[1] as string).sort();

  test('http.ts reaches routes/ only through the table (index + table), mounted once, guarded', () => {
    expect(routeImports(httpSrc)).toEqual(['index.ts', 'table.ts']);
    expect(httpSrc.match(/\bmountRoutes\(/g)?.length).toBe(1);
    expect(httpSrc).toMatch(/const tableSpecs = allSpecs\(\{[\s\S]*?\}\)\.map\(guardTableRoute\);/);
    expect(httpSrc).toContain('const laneRoutes = mountRoutes(tableSpecs);');
    // A planted direct import of an area module is what this guard exists to catch.
    expect(routeImports(`${httpSrc}\nimport { x } from './routes/plant.ts';`)).toContain(
      'plant.ts'
    );
  });

  const specs = allSpecs(stubDeps());
  for (const spec of specs) {
    test(`${spec.method} ${spec.path} refuses a cross-site browser and a rebound Host`, async () => {
      const guarded = guardTableRoute(spec);
      const url = `${SELF}${samplePath(spec.path)}`;
      const crossSite =
        spec.method === 'GET'
          ? new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } })
          : new Request(url, {
              method: 'POST',
              headers: { origin: 'http://evil.example', 'content-type': 'text/plain' },
              body: '{}',
            });
      expect((await guarded.handle(crossSite, {})).status).toBe(403);
      // A DNS-rebound page: no Origin / Fetch Metadata to refuse, only a foreign Host.
      const rebound = new Request(url, {
        method: spec.method,
        headers: { host: 'evil.example:4399' },
        ...(spec.method === 'GET' ? {} : { body: '{}' }),
      });
      expect((await guarded.handle(rebound, {})).status).toBe(403);
    });
  }
});
