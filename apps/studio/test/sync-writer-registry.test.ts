// The persistent-writer registry tripwire — DDR-241, plan T6.
//
// Every `/_api/*` route the studio serves must be classified in
// `sync/writer-registry.ts`. A new route fails here until somebody decides
// which lane carries its persistent effect in accepted-revisions mode — the
// "remaining writers" catch-all the plan forbids cannot come back silently.

import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WRITER_REGISTRY } from '../sync/writer-registry.ts';

const ROOT = join(import.meta.dir, '..');

/** Every `/_api` route the studio serves: http.ts's literals, plus each spec `path:` in the
 *  V2-2.5 table (routes/*.ts) — so a route added there is classified like one in http.ts. */
function servedRoutes(root = ROOT): string[] {
  const src = readFileSync(join(root, 'http.ts'), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/'(\/_api\/[a-zA-Z0-9/_:-]+)'/g)) {
    const route = m[1] as string;
    // Parameterised prefixes (e.g. `/_api/comments/`) are matched by their
    // handler, not listed; comments ride the comments lane (S24).
    if (route.endsWith('/')) continue;
    found.add(route);
  }
  const tableDir = join(root, 'routes');
  for (const f of readdirSync(tableDir).filter((n) => n.endsWith('.ts'))) {
    const table = readFileSync(join(tableDir, f), 'utf8');
    for (const m of table.matchAll(/\bpath:\s*'(\/_api\/[a-zA-Z0-9/_:-]+)'/g))
      found.add(m[1] as string);
  }
  return [...found].sort();
}

describe('persistent writer registry', () => {
  test('every served /_api route is classified', () => {
    const missing = servedRoutes().filter((r) => !(r in WRITER_REGISTRY));
    expect(missing).toEqual([]);
  });

  test('no stale entries: every classified route is still served', () => {
    const served = new Set(servedRoutes());
    const stale = Object.keys(WRITER_REGISTRY).filter((r) => !served.has(r));
    expect(stale).toEqual([]);
  });

  test('the scrape sees a route planted in the routes/ table (V2-2.5)', () => {
    const root = mkdtempSync(join(tmpdir(), 'writer-registry-'));
    mkdirSync(join(root, 'routes'));
    writeFileSync(
      join(root, 'http.ts'),
      "const legacyRoutes = { '/_api/legacy-x': () => null };\n"
    );
    writeFileSync(
      join(root, 'routes', 'plant.ts'),
      "export const plant = () => [{ method: 'POST', path: '/_api/planted/:id/go', origin: 'main' }];\n"
    );
    expect(servedRoutes(root)).toEqual(['/_api/legacy-x', '/_api/planted/:id/go']);
    // …and the real scrape sees the real table.
    expect(servedRoutes()).toContain('/_api/project/migrate');
    expect(servedRoutes()).toContain('/_api/outbox/:id/retry');
  });

  test('every lane/structural/migration writer names how it travels and a test that proves it', () => {
    for (const [route, e] of Object.entries(WRITER_REGISTRY)) {
      if (e.class !== 'lane' && e.class !== 'structural' && e.class !== 'migration') continue;
      expect({ route, via: typeof e.via }).toEqual({ route, via: 'string' });
      expect({ route, test: !!e.test && existsSync(join(ROOT, e.test)) }).toEqual({
        route,
        test: true,
      });
    }
  });
});
