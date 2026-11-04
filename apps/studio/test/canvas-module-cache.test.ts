// Issue #204 — the built-canvas module cache stays inside its byte budget.
//
// A canvas module bundles the shared chrome (~2 MB each), and a project's server builds every canvas
// once just to render its cover. The module route used to keep one per canvas path for the life of
// the process: after a first sync of 111 canvases the desktop server held ~460 MB of module text,
// and a 311-canvas cell ~1.3 GB. The cache is now an LRU over UTF-8 bytes.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModuleCache, moduleBytes } from '../canvas-module-cache.ts';
import type { Context } from '../context.ts';
import { _canvasModuleCache, serveCanvasTsx } from '../http.ts';

const root = mkdtempSync(join(tmpdir(), 'canvas-module-cache-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('createModuleCache', () => {
  const entry = (bytes: number) => ({ bytes });

  test('stays inside its byte budget, evicting the least recently used', () => {
    const c = createModuleCache<{ bytes: number }>({ maxBytes: 100 });
    for (let i = 0; i < 10; i++) c.set(`k${i}`, entry(30));
    expect(c.bytes).toBeLessThanOrEqual(100);
    expect(c.size).toBe(3);
    expect(c.get('k9')).toBeDefined();
    expect(c.get('k0')).toBeUndefined();
  });

  test('a read keeps an entry: the oldest UNREAD one goes first', () => {
    const c = createModuleCache<{ bytes: number }>({ maxBytes: 90 });
    c.set('a', entry(30));
    c.set('b', entry(30));
    c.set('c', entry(30));
    c.get('a');
    c.set('d', entry(30));
    expect(c.get('a')).toBeDefined();
    expect(c.get('b')).toBeUndefined();
  });

  test('replacing a key re-counts it, and the entry just set survives even when over budget', () => {
    const c = createModuleCache<{ bytes: number }>({ maxBytes: 50 });
    c.set('a', entry(40));
    c.set('a', entry(10));
    expect(c.bytes).toBe(10);
    c.set('big', entry(500));
    expect(c.get('big')).toBeDefined();
    expect(c.size).toBe(1);
    expect(c.bytes).toBe(500);
  });

  test('the count bound holds too', () => {
    const c = createModuleCache<{ bytes: number }>({ maxBytes: 1e9, maxEntries: 2 });
    for (let i = 0; i < 5; i++) c.set(`k${i}`, entry(1));
    expect(c.size).toBe(2);
  });

  test('moduleBytes is UTF-8 — a non-Latin-1 module is not stored at two bytes a character', () => {
    const js = `export const s = '${'—'.repeat(10)}${'a'.repeat(1000)}';`;
    expect(moduleBytes(js).byteLength).toBe(js.length + 10 * 2);
  });
});

describe('the canvas module route', () => {
  // ~300 kB of module each, so a 1 MB budget holds three.
  const canvasSource = (i: number) =>
    `const PAD = '${String(i).repeat(1).padEnd(300_000, 'x')}';\nexport default function Canvas() {\n  return 'canvas-${i}-' + PAD.length;\n}\n`;

  test('serving many canvases keeps the cache inside its budget, and an evicted one rebuilds', async () => {
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    const ctx = {
      paths: { designRoot, designRel: '.design', repoRoot: root },
    } as unknown as Context;
    const locator = join(designRoot, '_locator.json');
    const budget = 1024 * 1024;
    _canvasModuleCache(budget);
    const serve = async (i: number) => {
      const abs = join(designRoot, 'ui', `C${i}.tsx`);
      const res = await serveCanvasTsx(
        abs,
        new Request(`http://localhost/.design/ui/C${i}.tsx`),
        ctx,
        locator
      );
      expect(res.status).toBe(200);
      return res.text();
    };
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(designRoot, 'ui', `C${i}.tsx`), canvasSource(i));
      expect(await serve(i)).toContain(`canvas-${i}-`);
      const held = _canvasModuleCache();
      expect(held.bytes).toBeLessThanOrEqual(budget);
    }
    expect(_canvasModuleCache().size).toBeLessThan(8);
    // A cache hit serves the same bytes again (the kept body is reused, never consumed).
    const hit = await serve(7);
    expect(await serve(7)).toBe(hit);
    expect(hit).toContain('canvas-7-');
    // The first canvas was evicted long ago: it is built again, and right.
    expect(await serve(0)).toContain('canvas-0-');
    expect(_canvasModuleCache().bytes).toBeLessThanOrEqual(budget);
  }, 60_000);
});
