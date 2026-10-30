// S10.14 — switch canvases to another design system (13 · ds-multi-switch; V2-1.13 §5.7).
// The review lists every canvas that would move with its state; blocked and pinned ones are unticked with a
// reason and never written, a system at level 11 is refused (the dialog offers Bring-up), and the switch is ONE
// kernel action that rewrites `designSystem`, drops `dsRev` + the pins, and writes `dsPairing` only for slot
// names the target lacks (display by rank, palette by index-mod). Never this repo's `.design`.
import { afterAll, describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { DsUsageError, planDsVerb } from '../ds/ds-verb.ts';
import { createDsSwitch, DsSwitchError, pairIndex } from '../ds/switch.ts';
import { createDsRoutes } from '../routes/ds.ts';
import { cleanup, PERSON, type Project } from './_ds-engine-fixture.ts';
import { canvas, pairsCanvas, switchProject } from './_ds-switch-fixture.ts';

afterAll(cleanup);

describe('pairing by kind counts (V2-1.13 §5.3.5)', () => {
  test('display pairs by rank, palette by index-mod, accent / chart by nearest index, none when the target has none', () => {
    // 4 display steps → 3: the last pairs to the last, the middle two keep their relative place
    expect([1, 2, 3, 4].map((n) => pairIndex('rank', n, [1, 2, 3, 4], [1, 2, 3]))).toEqual([
      1, 2, 2, 3,
    ]);
    // palette 5 onto a palette of 2 wraps
    expect([1, 2, 3, 4, 5].map((n) => pairIndex('index-mod', n, [1, 2, 3, 4, 5], [1, 2]))).toEqual([
      1, 2, 1, 2, 1,
    ]);
    expect(pairIndex('index', 6, [1, 2, 3, 4, 5, 6], [1, 2, 3])).toBe(3);
    expect(pairIndex('index', 2, [1, 2], [1, 3])).toBe(1); // a tie goes to the lower step
    expect(pairIndex('rank', 2, [1, 2], [])).toBeNull();
  });

  test('the review writes a pair only for names the target lacks', async () => {
    const p = await switchProject();
    const r = createDsSwitch(p.engine).review({
      to: 'beta',
      scope: { kind: 'canvas', path: 'ui/Pairs.tsx' },
    });
    expect(r.refused).toBeNull();
    expect(r.pairing.kinds).toEqual(['display', 'palette']);
    // alpha's display-4 → beta's display-3 (rank), palette-5 → palette-1 (index-mod over 2)
    expect(r.pairing.canvases['ui/Pairs.tsx']).toEqual({
      '--display-4': '--display-3',
      '--palette-5': '--palette-1',
    });
    // beta declares display-1..3: a canvas using display-2 needs no pair
    p.write('ui/Pairs.tsx', canvas('<h1 style={{ fontSize: "var(--display-2)" }}>x</h1>'));
    const again = createDsSwitch(p.engine).review({
      to: 'beta',
      scope: { kind: 'canvas', path: 'ui/Pairs.tsx' },
    });
    expect(again.pairing.canvases['ui/Pairs.tsx']).toBeUndefined();
  });
});

describe('the review', () => {
  test('blocked and pinned are unticked with a reason; a canvas already there is not listed', async () => {
    const p = await switchProject();
    const r = createDsSwitch(p.engine).review({
      to: 'beta',
      scope: { kind: 'folder', path: 'ui' },
    });
    const row = (path: string) => r.canvases.find((c) => c.path === path);
    expect(row('ui/Home.tsx')).toMatchObject({ state: 'switchable', ticked: true, from: 'alpha' });
    expect(row('ui/Pinned.tsx')).toMatchObject({
      state: 'pinned',
      ticked: false,
      reason: 'pinned',
    });
    expect(row('ui/Blocked.tsx')).toMatchObject({
      state: 'blocked',
      ticked: false,
      reason: 'S2:undefined',
    });
    // acme's own canvases (no meta.designSystem) can't move: S9
    expect(row('ui/Landing.tsx')).toMatchObject({ ticked: false, reason: 'S9:meta' });
    // scope folder → only that folder
    const f = createDsSwitch(p.engine).review({
      to: 'beta',
      scope: { kind: 'folder', path: 'ui/combine' },
    });
    expect(f.canvases.map((c) => c.path)).toEqual(['ui/combine/One.tsx', 'ui/combine/Two.tsx']);
    // scope canvas on a canvas already on the target → nothing listed
    p.write('ui/Home.meta.json', `${JSON.stringify({ designSystem: 'beta' })}\n`);
    const h = createDsSwitch(p.engine).review({
      to: 'beta',
      scope: { kind: 'canvas', path: 'ui/Home.tsx' },
    });
    expect(h.canvases).toEqual([]);
  });

  test('a system at level 11 is refused, as target and as the only source', async () => {
    const p = await switchProject();
    const sw = createDsSwitch(p.engine);
    // acme is private-only (level 11)
    const toAcme = sw.review({ to: 'acme', scope: { kind: 'canvas', path: 'ui/Home.tsx' } });
    expect(toAcme.refused).toEqual({ code: 'ds-level-11', system: 'acme' });
    const fromAcme = (() => {
      p.write('ui/Home.meta.json', `${JSON.stringify({ designSystem: 'acme' })}\n`);
      return sw.review({ to: 'beta', scope: { kind: 'canvas', path: 'ui/Home.tsx' } });
    })();
    expect(fromAcme.refused).toEqual({ code: 'ds-level-11', system: 'acme' });
    expect(fromAcme.canvases[0]).toMatchObject({ ticked: false, reason: 'ds-level-11' });
    await expect(
      sw.apply({ to: 'acme', scope: { kind: 'canvas', path: 'ui/Pairs.tsx' }, by: PERSON })
    ).rejects.toMatchObject({ code: 'ds-level-11', status: 409 });
    expect(p.meta('ui/Pairs.tsx').designSystem).toBe('alpha');
  });

  test('an unknown system or canvas is a 404', async () => {
    const p = await switchProject();
    const sw = createDsSwitch(p.engine);
    expect(() => sw.review({ to: 'nope', scope: { kind: 'all' } })).toThrow(DsSwitchError);
    expect(() => sw.review({ to: 'beta', scope: { kind: 'canvas', path: 'ui/Nope.tsx' } })).toThrow(
      /no such canvas/
    );
    expect(() => sw.review({ to: 'beta', scope: { kind: 'folder', path: '../x' } })).toThrow(
      DsSwitchError
    );
  });
});

describe('the switch', () => {
  test('one action: designSystem moves, dsRev + pins go, dsPairing is written, locked rows stay', async () => {
    const p = await switchProject();
    const before = (await p.home.runtime.acceptedHistory({ limit: 200 })).length;
    const r = await createDsSwitch(p.engine).apply({
      to: 'beta',
      scope: { kind: 'folder', path: 'ui' },
      by: PERSON,
    });
    // Home, Pairs, Pin, combine/One, combine/Two move; Pinned, Blocked and acme's two stay
    expect(r.result).toMatchObject({ switched: 5, kept: 4 });
    expect(r.result?.actionId).toBeTruthy();
    const after = await p.home.runtime.acceptedHistory({ limit: 200 });
    expect(after.length - before).toBe(1); // ONE action → one ⌘Z
    for (const c of ['Home', 'Pairs', 'Pin', 'combine/One', 'combine/Two'])
      expect(p.meta(`ui/${c}.tsx`).designSystem).toBe('beta');
    expect(p.meta('ui/Pairs.tsx').dsRev).toBeUndefined();
    expect(p.meta('ui/Pairs.tsx').dsPairing).toEqual({
      '--display-4': '--display-3',
      '--palette-5': '--palette-1',
    });
    expect(p.meta('ui/Home.tsx').dsPairing).toBeUndefined();
    expect(p.read('ui/Pin.tsx')).not.toContain('data-ds-rev');
    expect(p.read('ui/Pairs.tsx')).toBe(pairsCanvas); // the source is otherwise untouched
    for (const c of ['Pinned', 'Blocked']) expect(p.meta(`ui/${c}.tsx`).designSystem).toBe('alpha');
    expect(p.meta('ui/Pinned.tsx').dsPinned).toBe(true);
  });

  test('a person’s unticked canvas stays; a tick cannot move a locked one', async () => {
    const p = await switchProject();
    const r = await createDsSwitch(p.engine).apply({
      to: 'beta',
      scope: { kind: 'folder', path: 'ui/combine' },
      canvases: [{ path: 'ui/combine/Two.tsx', ticked: false }],
      by: PERSON,
    });
    expect(r.result).toMatchObject({ switched: 1, kept: 1 });
    expect(p.meta('ui/combine/One.tsx').designSystem).toBe('beta');
    expect(p.meta('ui/combine/Two.tsx').designSystem).toBe('alpha');
    await createDsSwitch(p.engine).apply({
      to: 'beta',
      scope: { kind: 'all' },
      canvases: [
        { path: 'ui/Pinned.tsx', ticked: true },
        { path: 'ui/Blocked.tsx', ticked: true },
      ],
      by: PERSON,
    });
    expect(p.meta('ui/Pinned.tsx').designSystem).toBe('alpha');
    expect(p.meta('ui/Blocked.tsx').designSystem).toBe('alpha');
  });

  test('no project home answers → nothing is written; nothing ticked → nothing to switch', async () => {
    const p = await switchProject({ kernel: null });
    const sw = createDsSwitch(p.engine);
    await expect(
      sw.apply({ to: 'beta', scope: { kind: 'canvas', path: 'ui/Home.tsx' }, by: PERSON })
    ).rejects.toMatchObject({ code: 'ds-kernel-unavailable', status: 503 });
    expect(p.meta('ui/Home.tsx').designSystem).toBe('alpha');
    const q = await switchProject();
    await expect(
      createDsSwitch(q.engine).apply({
        to: 'beta',
        scope: { kind: 'canvas', path: 'ui/Pinned.tsx' },
        by: PERSON,
      })
    ).rejects.toMatchObject({ code: 'ds-nothing-to-switch', status: 422 });
  });
});

describe('the verb and the route', () => {
  test('`maude design ds switch` plans a canvas, a folder or --all, and needs --to', () => {
    expect(planDsVerb(['switch', '.design/ui/Home.tsx', '--to', 'beta'])).toMatchObject({
      op: 'switch',
      input: { to: 'beta', canvas: 'ui/Home.tsx' },
      read: false,
    });
    expect(planDsVerb(['switch', 'ui/combine/', '--to', 'beta', '--dry-run'])).toMatchObject({
      input: { to: 'beta', folder: 'ui/combine', dryRun: true },
      read: true,
    });
    expect(planDsVerb(['switch', '--all', '--to', 'beta']).input).toEqual({
      to: 'beta',
      all: true,
    });
    for (const bad of [
      ['switch', 'ui/Home.tsx'],
      ['switch', '--to', 'beta'],
      ['switch', 'ui/a.tsx', '--all', '--to', 'beta'],
      ['switch', 'ui/a.tsx', 'ui/b.tsx', '--to', 'beta'],
    ])
      expect(() => planDsVerb(bad)).toThrow(DsUsageError);
  });

  const call = async (p: Project, who: 'edit' | 'view', body: Record<string, unknown>) => {
    const spec = createDsRoutes({
      engine: () => p.engine,
      access: () => resolveAccess({ v: 1, role: who === 'edit' ? 'member' : 'observer' }),
      person: async () => ({ name: 'Michal' }),
    }).find((s) => s.method === 'POST' && s.path === '/_api/ds/switch');
    if (!spec) throw new Error('no POST /_api/ds/switch');
    const res = await spec.handle(
      new Request('http://localhost/_api/ds/switch', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
      {}
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  test('anyone who sees the system may read the review; only Can edit switches', async () => {
    const p = await switchProject();
    const review = await call(p, 'view', { to: 'beta', canvas: 'ui/Home.tsx', dryRun: true });
    expect(review.status).toBe(200);
    expect(review.json).toMatchObject({ format: 'maude.ds-switch-review', v: 1, to: 'beta' });
    const refused = await call(p, 'view', { to: 'beta', canvas: 'ui/Home.tsx' });
    expect(refused).toMatchObject({ status: 403, json: { code: 'forbidden' } });
    expect(p.meta('ui/Home.tsx').designSystem).toBe('alpha');
    const done = await call(p, 'edit', { to: 'beta', canvas: 'ui/Home.tsx' });
    expect(done.status).toBe(200);
    expect(p.meta('ui/Home.tsx').designSystem).toBe('beta');
    // a malformed ask is a 422, a refused one carries its code
    expect((await call(p, 'edit', { to: 'beta' })).status).toBe(422);
    expect(await call(p, 'edit', { to: 'acme', all: true })).toMatchObject({
      status: 409,
      json: { code: 'ds-level-11' },
    });
  });
});
