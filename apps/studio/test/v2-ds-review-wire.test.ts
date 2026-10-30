// S10.8 — the review host against the REAL routes and the REAL engine (a converted scratch project with three
// canvases): what the client reads and sends is what `routes/ds.ts` serves. Edit → review → untick → Update →
// the unticked canvas keeps the old head (`dsRev`) and the left-out map says so; Cancel puts the swatch back.
import { afterAll, describe, expect, test } from 'bun:test';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { leftOutOf } from '../client/v2/ds/update-model.js';
import { createDsRoutes } from '../routes/ds.ts';
import { ACCENT, cleanup, DS, DS_PATH, makeProject, type Project } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const claims: Record<string, AccessClaim> = {
  owner: { v: 1, role: 'owner' },
  view: { v: 1, role: 'observer' },
};

/** `fetch` served by the real route table. */
function wire(p: Project, who: keyof typeof claims = 'owner') {
  const specs = createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
  });
  const calls: string[] = [];
  const impl = (async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const pathname = url.split('?')[0];
    calls.push(`${method} ${pathname}`);
    const spec = specs.find((s) => s.method === method && s.path === pathname);
    if (!spec) throw new Error(`no ${method} ${pathname}`);
    return spec.handle(
      new Request(`http://localhost${url}`, {
        method,
        ...(init?.body ? { body: init.body, headers: { 'content-type': 'application/json' } } : {}),
      }),
      {}
    );
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the host speaks the routes', () => {
  test('nothing waiting: the review says so in words (no sheet)', async () => {
    const p = await makeProject();
    const { loadDsReview } = await import('../client/v2/ds/review-host.jsx');
    const r = await loadDsReview(DS, wire(p).impl);
    expect(r).toEqual({
      ok: false,
      message: 'Nothing is waiting to update. Change something on the Design system canvas first.',
    });
  });

  test('a pending accent → the review lists three followers ticked; Update with one unticked', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: { kind: 'person', name: 'Michal' },
    });
    const { loadDsReview, publishReview } = await import('../client/v2/ds/review-host.jsx');
    const { rowsOf, withTicks } = await import('../client/v2/ds/review-model.js');
    const w = wire(p);
    const loaded = await loadDsReview(DS, w.impl);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.review.expectHead).toBe(p.R0);
    expect(loaded.review.changes.map((c: { css: string }) => c.css)).toEqual(['--accent']);
    const rows = withTicks(rowsOf(loaded.review.canvases, loaded.places), {
      'ui/Landing.tsx': false,
    });
    expect(rows.map((r: { path: string; ticked: boolean }) => [r.path, r.ticked])).toEqual([
      ['ui/Home.tsx', true],
      ['ui/Landing.tsx', false],
      ['ui/Pricing.tsx', true],
    ]);
    const done = await publishReview(
      { ds: DS, expectHead: loaded.review.expectHead },
      rows,
      w.impl
    );
    expect(done).toEqual({ ok: true, updated: 2, leftOut: 1 });
    // the unticked canvas keeps the old head — and the client's own reading of the index says "left out"
    expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
    const cfg = {
      designRel: '.design',
      designSystems: [{ name: DS, path: DS_PATH }],
      dsConverted: { [DS]: true },
      systemHeads: { [DS]: p.head().head },
      canvasDsRevs: { 'ui/Landing.tsx': p.R0 },
    };
    expect(leftOutOf('ui/Landing.tsx', cfg)).toMatchObject({ ds: DS, dsRev: p.R0, folder: 'ui' });
    expect(leftOutOf('ui/Home.tsx', cfg)).toBeNull();
    // nothing waits any more
    const again = await loadDsReview(DS, w.impl);
    expect(again.ok).toBe(false);
  });

  test('a head that moved under the sheet is a refusal in words, and nothing was written', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: { kind: 'person', name: 'Michal' },
    });
    const { publishReview } = await import('../client/v2/ds/review-host.jsx');
    const r = await publishReview({ ds: DS, expectHead: 'f'.repeat(64) }, [], wire(p).impl);
    expect(r).toEqual({
      ok: false,
      message: 'The design system changed while this was open. Open it again to see the new list.',
    });
    expect(p.head().head).toBe(p.R0);
  });

  test('Cancel puts the swatch back: the pending entry goes, head stays', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: { kind: 'person', name: 'Michal' },
    });
    const { cancelReview, loadDsReview } = await import('../client/v2/ds/review-host.jsx');
    const w = wire(p);
    expect(await cancelReview({ ds: DS }, w.impl)).toEqual({ ok: true });
    expect((await loadDsReview(DS, w.impl)).ok).toBe(false);
    expect(p.head().head).toBe(p.R0);
  });

  test('Can view: Update and Cancel are refused by the server, in words', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: { kind: 'person', name: 'Michal' },
    });
    const { cancelReview, publishReview } = await import('../client/v2/ds/review-host.jsx');
    const w = wire(p, 'view');
    expect(await publishReview({ ds: DS, expectHead: p.R0 }, [], w.impl)).toEqual({
      ok: false,
      message: 'Not updated. You can look here; ask to edit.',
    });
    expect(await cancelReview({ ds: DS }, w.impl)).toEqual({
      ok: false,
      message: 'Not updated. You can look here; ask to edit.',
    });
    expect(p.head().head).toBe(p.R0);
  });
});
