// S9.10 — V2-1.16 L8: the project tree, /_config and /_system-data for a canvas-only session.
//
// As A-only: `/_index-data`, `/_system-data` and `/_config` contain no B / C path, slug,
// folder-only name, kind, DS mapping, README or session key — and the owner's answers do
// (so the assertions are not vacuous). Bytes on the wire, never the DOM (U2).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { A_ONLY, bootCanaryCell, type Cell, canaries, get, OWNER } from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

describe('L8 — /_index-data', () => {
  test('A-only: only A and what it renders with; no Project / Runtime group; no canary', async () => {
    const owner = await get(cell, '/_index-data', OWNER);
    expect(canaries(owner.text).length).toBeGreaterThan(0);
    const r = await get(cell, '/_index-data', A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    const data = r.json as {
      groups: Array<{ kind: string; label: string; paths: string[]; dirs?: string[] }>;
      canvasDesignSystems: Record<string, string>;
      canvasKinds: Record<string, string>;
    };
    expect(data.groups.map((g) => g.kind)).not.toContain('project');
    expect(data.groups.map((g) => g.kind)).not.toContain('runtime');
    const paths = data.groups.flatMap((g) => g.paths);
    expect(paths).toContain('.design/ui/a.tsx');
    expect(paths).not.toContain('.design/ui/fixture.html');
    // The project README is the Project group's; the DS README A renders under is in its closure.
    expect(paths).not.toContain('.design/README.md');
    expect(data.canvasDesignSystems).toEqual({ '.design/ui/a.tsx': 'shared' });
    expect(data.canvasKinds).toEqual({});
    const dirs = data.groups.flatMap((g) => g.dirs ?? []);
    for (const d of dirs) expect(paths.some((p) => p.startsWith(`${d}/`))).toBe(true);
  });
});

describe('L8 — /_config', () => {
  test('A-only: no canvas groups, only the DS A renders with, no new-canvas dir, no hub', async () => {
    const owner = await get(cell, '/_config', OWNER);
    expect(canaries(owner.text).length).toBeGreaterThan(0);
    const r = await get(cell, '/_config', A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    const cfg = r.json as Record<string, unknown>;
    expect(cfg.canvasGroups).toEqual([]);
    expect((cfg.designSystems as Array<{ name: string }>).map((d) => d.name)).toEqual(['shared']);
    expect(cfg.defaultDesignSystem).toBe('shared');
    expect('newCanvasDir' in cfg).toBe(false);
    expect('linkedHub' in cfg).toBe(false);
    // The role / format fields the client gates on are still there.
    expect(cfg.readOnly).toBe(true);
  });
});

describe('L8 — /_system-data', () => {
  test('A-only: the shared DS without its README or specimens; canary-ds is an unknown DS', async () => {
    const owner = await get(cell, '/_system-data', OWNER);
    expect(canaries(owner.text).length).toBeGreaterThan(0);
    const r = await get(cell, '/_system-data', A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    const d = r.json as Record<string, unknown>;
    expect(d.readme).toBeNull();
    expect(d.readmePath).toBeNull();
    expect((d.availableDesignSystems as Array<{ name: string }>).map((x) => x.name)).toEqual([
      'shared',
    ]);
    expect(d.previewGallery).toEqual([]);

    const shared = await get(cell, '/_system-data?ds=shared', A_ONLY);
    expect(shared.status).toBe(200);
    expect(canaries(shared.text)).toEqual([]);
    expect((shared.json as { tokens: unknown[] }).tokens.length).toBeGreaterThan(0);

    // Invisible = absent (U1): the same 404 an unknown DS gets, byte for byte modulo the name.
    const hidden = await get(cell, '/_system-data?ds=canary-ds', A_ONLY);
    const unknown = await get(cell, '/_system-data?ds=nope-ds', A_ONLY);
    expect(hidden.status).toBe(404);
    expect(hidden.text.replace('canary-ds', 'X')).toBe(unknown.text.replace('nope-ds', 'X'));
    // The owner still reads it.
    expect((await get(cell, '/_system-data?ds=canary-ds', OWNER)).status).toBe(200);
  });
});
