// V2-2.4b — the agent routes are MAIN ORIGIN ONLY (contract V2-1.11 §5.4 "Loopback routes", §5.8
// invariant 5; DDR-088). A route reachable from the untrusted canvas iframe must be in BOTH
// http.ts `CANVAS_SAFE_API` and server.ts `startCanvasServer` `routes` — so an agent route must be
// in NEITHER. Plus: every spec is origin 'main', and none is ever served to a browser.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANVAS_SAFE_API } from '../http.ts';
import { agentRouteSpecs } from '../routes/agent.ts';

const STUDIO = join(import.meta.dir, '..');
const src = (f: string) => readFileSync(join(STUDIO, f), 'utf8');

const specs = agentRouteSpecs({
  repoRoot: '/nonexistent',
  designRel: '.design',
  shells: () => {
    throw new Error('a dep was called while building the table');
  },
  emit: () => {
    throw new Error('a dep was called while building the table');
  },
});

describe('agent routes — main origin only', () => {
  test('the table carries /_api/ui/open (+ the hook routes as they land), each origin main', () => {
    const paths = specs.map((s) => s.path);
    expect(paths).toContain('/_api/ui/open');
    for (const s of specs) {
      expect(s.path === '/_api/ui/open' || s.path.startsWith('/_api/agent/')).toBe(true);
      expect(s.origin).toBe('main');
    }
  });

  test('absent from CANVAS_SAFE_API (http.ts)', () => {
    // V2-2.5 made the allowlist a module-level export: read the live set, not the source text.
    expect(CANVAS_SAFE_API.size).toBeGreaterThan(0);
    for (const s of specs)
      expect({ p: s.path, safe: CANVAS_SAFE_API.has(s.path) }).toEqual({ p: s.path, safe: false });
    for (const p of CANVAS_SAFE_API) {
      expect(p.startsWith('/_api/agent')).toBe(false);
      expect(p.startsWith('/_api/ui/')).toBe(false);
    }
  });

  test('absent from the startCanvasServer routes map (server.ts)', () => {
    const server = src('server.ts');
    const at = server.indexOf('function startCanvasServer(');
    expect(at).toBeGreaterThan(0);
    const fn = server.slice(at, server.indexOf('\n}\n', at));
    expect(fn).not.toContain('/_api/agent');
    expect(fn).not.toContain('/_api/ui/');
  });

  test('every agent route refuses a browser, whatever its origin', async () => {
    for (const s of specs) {
      const r = await s.handle(
        new Request(`http://127.0.0.1:4399${s.path}`, {
          method: s.method,
          headers: { host: '127.0.0.1:4399', 'sec-fetch-site': 'same-origin' },
          body: s.method === 'GET' ? undefined : '{}',
        }),
        {}
      );
      expect({ p: s.path, s: r.status }).toEqual({ p: s.path, s: 403 });
    }
  });

  // The canvas-origin 403 against the LIVE server needs the routes wired (lead patch, after
  // V2-2.5's routes/index.ts): then extend test/canvas-origin-gate.test.ts with these paths.
  test.todo('canvas origin → 403 for /_api/ui/open and /_api/agent/* on a booted studio');
});
