// S9.12 — U3: every studio route and every socket frame type has a scope class
// (V2-1.16 §5.1 U3, §7). Unclassified is red. Pure: reads the tables, boots nothing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { WS_FRAME_CLASSES } from '../access/filters.ts';
import { FALLTHROUGH, legacyRouteKeys, routeInventory, scrapedFallthrough } from './_acl-gate.ts';
import { ROUTE_CLASSES } from './_acl-route-classes.ts';

const CLASSES = ['none', 'canvas', 'filtered', 'project'];
const STUDIO = join(import.meta.dir, '..');

describe('U3 — every studio route is classified', () => {
  const inventory = [...new Set(routeInventory().map((r) => r.path))].sort();

  test('the inventory reads the real tables (not an empty scrape)', () => {
    expect(legacyRouteKeys().length).toBeGreaterThan(100);
    expect(inventory).toContain('/_api/ai/runs/:id/stop'); // a table pattern row
    expect(inventory).toContain('/_api/edit-css'); // a legacy literal key
  });

  test('every route on every origin has exactly one of the four classes', () => {
    expect(inventory.filter((p) => !(p in ROUTE_CLASSES))).toEqual([]);
    expect(Object.values(ROUTE_CLASSES).filter((c) => !CLASSES.includes(c))).toEqual([]);
  });

  test('no class entry outlives its route', () => {
    expect(Object.keys(ROUTE_CLASSES).filter((p) => !inventory.includes(p))).toEqual([]);
  });

  test('the fall-through inventory matches what handleFallthrough branches on', () => {
    // Each scraped branch is covered by one FALLTHROUGH row (prefix rows end in a `:param`).
    const covered = (b: string) =>
      FALLTHROUGH.some((row) => {
        const head = row.replace(/:[A-Za-z_]+$/, '');
        return row === b || head === b || (b.endsWith('/') && head.startsWith(b));
      });
    expect(scrapedFallthrough().filter((b) => !covered(b))).toEqual([]);
  });
});

describe('U3 — every socket frame type is classified', () => {
  test('every frame type ws.ts sends has a class (a missing one is dropped, and red here)', () => {
    const src = readFileSync(join(STUDIO, 'ws.ts'), 'utf8');
    const types = [...new Set([...src.matchAll(/\btype: '([a-z:-]+)'/g)].map((m) => m[1]))];
    expect(types.length).toBeGreaterThan(15);
    expect(types.filter((t) => !(t in WS_FRAME_CLASSES))).toEqual([]);
    expect(Object.values(WS_FRAME_CLASSES).filter((c) => !CLASSES.includes(c))).toEqual([]);
  });
});
