// The persistent-writer registry tripwire — DDR-241, plan T6.
//
// Every `/_api/*` route the studio serves must be classified in
// `sync/writer-registry.ts`. A new route fails here until somebody decides
// which lane carries its persistent effect in accepted-revisions mode — the
// "remaining writers" catch-all the plan forbids cannot come back silently.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WRITER_REGISTRY } from '../sync/writer-registry.ts';

const ROOT = join(import.meta.dir, '..');

function servedRoutes(): string[] {
  const src = readFileSync(join(ROOT, 'http.ts'), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/'(\/_api\/[a-zA-Z0-9/_:-]+)'/g)) {
    const route = m[1] as string;
    // Parameterised prefixes (e.g. `/_api/comments/`) are matched by their
    // handler, not listed; comments ride the comments lane (S24).
    if (route.endsWith('/')) continue;
    found.add(route);
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

  test('every lane/structural writer names how it travels and a test that proves it', () => {
    for (const [route, e] of Object.entries(WRITER_REGISTRY)) {
      if (e.class !== 'lane' && e.class !== 'structural') continue;
      expect({ route, via: typeof e.via }).toEqual({ route, via: 'string' });
      expect({ route, test: !!e.test && existsSync(join(ROOT, e.test)) }).toEqual({
        route,
        test: true,
      });
    }
  });
});
