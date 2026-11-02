// p8-docker-desktop-legs (V2-8.18 desktop.team-project + desktop.selfhost-entry red at 4b373909f):
// a hub's OWN paired studio (cell pairing — a cloud cell, a self-hosted workspace hub) must never author
// the checkout's config.json.
//
// Since p8-fix-c2 #1 an empty linked copy cycles its sync when the project's first canvas arrives, and the
// boot pull after that cycle is a "fresh link" — no config, no canvas on disk — so it SEEDED a config.json
// with the studio's DEFAULT groups (`system`, `ui`) plus what it learned. In a paired studio that file is
// the hub's checkout config: the hub reads its `canvasGroups` as the project's classification boundary
// (kernel checkCanvasPath, the bootstrap's canvasGroups). Seen in the Docker gate's container log:
// `[studio] [sync] wrote .design/config.json (system, ui).` → a v2 teammate's `screens/home.tsx` was
// refused as `invalid`, and every desktop copy drew an empty `system` folder. That boundary is the
// project owner's to set (the owner-only project-config door, decision
// maude/owner-sets-cell-project-config) — never the hub's own studio.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Context } from '../context.ts';
import { seedProjectConfig } from '../sync/index.ts';

let scratch = '';
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p8-paired-cfg-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function bareCtx(name: string): { ctx: Context; file: string } {
  const designRoot = join(scratch, name, '.design');
  mkdirSync(designRoot, { recursive: true });
  const ctx = {
    // the studio's defaults, as a design root with no config.json boots with them
    cfg: {
      name: 'Design',
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'Canvases', path: 'ui' },
      ],
    },
    paths: { designRoot, designRel: '.design' },
  } as unknown as Context;
  return { ctx, file: join(designRoot, 'config.json') };
}

describe("a hub's paired studio never writes the checkout's config.json", () => {
  test('cell pairing: the fresh-link seed writes nothing', () => {
    const { ctx, file } = bareCtx('cell');
    expect(seedProjectConfig(ctx, new Set(['ui']), false, 2, { cellPairing: true })).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  test('a desktop copy (no pairing) still seeds what it pulled', () => {
    const { ctx, file } = bareCtx('desktop');
    expect(seedProjectConfig(ctx, new Set(['screens']), false, 2, { cellPairing: false })).toBe(
      true
    );
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    expect(cfg.canvasGroups.map((g: { path: string }) => g.path)).toContain('screens');
  });

  test('the runtime passes its pairing to the seed', () => {
    // the one call site (noteLearnedGroup in sync/index.ts) must hand the pairing over — a seed call
    // without it would default to "not paired" and write the hub's checkout config again
    const src = readFileSync(join(import.meta.dir, '../sync/index.ts'), 'utf8');
    const calls = [...src.matchAll(/(?<!function )seedProjectConfig\(([\s\S]*?)\n\s*\)\n/g)].map(
      (m) => m[1]
    );
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/cellPairing: cellPairing !== null/);
  });
});
