// S10.2 (S10 Q1): ⌘Z after "Update N canvases" takes the whole publish back across BOTH planes —
// the metas and the DS canvas's pending entries (Plane A, the kernel's undo) and head.json + the
// working files (Plane B, the registered undo hook) — and ⇧⌘Z re-applies it. A refused undo
// (someone else's action, or one changed since) moves nothing on either plane.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { DS_UNDO_HOOK, registerDsUndoHook } from '../ds/undo-hook.ts';
import { createProjectUndoRoutes, registerUndoHook } from '../routes/project-undo.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  type Project,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

let off: (() => void) | null = null;
afterEach(() => {
  off?.();
  off = null;
});

async function published(): Promise<{ p: Project; rev: string; actionId: string }> {
  const p = await makeProject();
  off = registerDsUndoHook(p.engine);
  await p.engine.mergePending(DS, {
    tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    by: PERSON,
  });
  const r = await p.engine.publish(DS, {
    expectHead: p.R0,
    canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
    by: PERSON,
  });
  return { p, rev: r.rev as string, actionId: r.actionId as string };
}

describe('ds undo hook', () => {
  beforeEach(() => {
    off?.();
    off = null;
  });

  test('⌘Z restores files, metas, pending and head.json; ⇧⌘Z re-applies', async () => {
    const { p, rev, actionId } = await published();
    const publishedCss = p.read(`${DS_PATH}/colors_and_type.css`);
    const u = await p.undo({ actionId });
    expect(u.status).toBe(200);
    expect(u.body.ok).toBe(true);
    const undoId = u.body.actionId as string;
    // Plane A: the left-out canvas follows again, the pending entry is back
    expect(p.meta('ui/Landing.tsx').dsRev).toBeUndefined();
    const pending = p.meta(`${DS_PATH}/design-system.tsx`).dsPending as {
      tokens: Record<string, { light: string }>;
    };
    expect(pending.tokens['--accent'].light).toBe('oklch(0.5 0.19 255)');
    // Plane B: head = base = R0 again, the working CSS is R0's bytes, R stays (unreferenced)
    let h = p.head();
    expect([h.head, h.base]).toEqual([p.R0, p.R0]);
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(TOKENS_CSS);
    expect(p.read(`${DS_PATH}/revisions/${rev}.json`)).not.toBeNull();
    expect(h.log[0]).toMatchObject({
      action: 'restore',
      actionId: undoId,
      rev: p.R0,
      parent: rev,
      was: { head: rev, base: rev },
      is: { head: p.R0, base: p.R0 },
    });
    expect(p.engine.state(DS).outside).toBeNull();

    // ⇧⌘Z: redo names the undo it re-applies
    const r = await p.undo({ actionId: undoId, redo: true });
    expect(r.status).toBe(200);
    h = p.head();
    expect([h.head, h.base]).toEqual([rev, rev]);
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(publishedCss);
    expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    expect(h.log[0]).toMatchObject({ action: 'restore', actionId: r.body.actionId });
    expect(p.engine.state(DS).outside).toBeNull();

    // ⌘Z of the redo takes it back again — the same revert, on the redo's restore entry
    const again = await p.undo({ actionId: r.body.actionId });
    expect(again.status).toBe(200);
    expect(p.head().head).toBe(p.R0);
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(TOKENS_CSS);
    expect(p.meta('ui/Landing.tsx').dsRev).toBeUndefined();
  });

  test('a refused undo (someone else’s action) runs no hook: head.json does not move', async () => {
    const { p, rev, actionId } = await published();
    let ran = 0;
    const offSpy = registerUndoHook('spy', () => {
      ran++;
    });
    try {
      const specs = createProjectUndoRoutes({
        control: () => ({
          acceptedUndo: async () => ({ status: 'rejected' as const, code: 'forbidden' }),
        }),
        designRel: '.design',
      });
      const post = specs.find((s) => s.method === 'POST') as {
        handle: (r: Request) => Promise<Response>;
      };
      const res = await post.handle(
        new Request('http://localhost/_api/project/undo', {
          method: 'POST',
          body: JSON.stringify({ actionId }),
        })
      );
      expect(res.status).toBe(409);
      expect(ran).toBe(0);
      expect(p.head().head).toBe(rev);
      expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
    } finally {
      offSpy();
    }
  });

  test('undoing an action that is not a design-system one leaves head.json alone', async () => {
    const { p, rev } = await published();
    await p.outside('ui/Home.meta.json', `${JSON.stringify({ title: 'Home 2' }, null, 2)}\n`);
    const r = await p.home.runtime.proposeFiles(
      [{ rel: 'ui/Home.meta.json', text: `${JSON.stringify({ title: 'Home 3' }, null, 2)}\n` }],
      { kind: 'edit', label: 'Rename' }
    );
    expect(r.status).toBe('accepted');
    const u = await p.undo({ actionId: r.actionId });
    expect(u.status).toBe(200);
    expect(p.meta('ui/Home.tsx').title).toBe('Home 2');
    expect(p.head().head).toBe(rev);
  });

  test('an undo refused by a concurrent meta edit: the DS part does not run', async () => {
    const { p, rev, actionId } = await published();
    // both lanes the publish touched change again since — the undo has nothing it can apply
    await p.outside(
      'ui/Landing.meta.json',
      `${JSON.stringify({ title: 'Landing', dsRev: 'a'.repeat(64) }, null, 2)}\n`
    );
    await p.outside(
      `${DS_PATH}/design-system.meta.json`,
      `${JSON.stringify({ title: 'Design system', dsPending: { tokens: { '--fg-0': { light: '#000000' } } } }, null, 2)}\n`
    );
    const u = await p.undo({ actionId });
    expect(u.status).toBe(409);
    expect(u.body.code).toBe('undo-conflict');
    const h = p.head();
    expect([h.head, h.base]).toEqual([rev, rev]);
    expect(h.log[0].action).toBe('publish');
  });

  test('head moved since (a later publish): the kernel half undoes, head.json is reported skipped', async () => {
    const { p, rev, actionId } = await published();
    await p.engine.mergePending(DS, { tokens: { '--fg-0': { light: '#000000' } }, by: PERSON });
    const r2 = await p.engine.publish(DS, { expectHead: rev, by: PERSON });
    const u = await p.undo({ actionId });
    expect(u.status).toBe(200);
    expect(u.body.skipped).toContainEqual({
      doc: `${DS_PATH}/revisions/head.json`,
      reason: 'ds-head-moved',
    });
    expect(p.head().head).toBe(r2.rev);
  });

  test('the hook is registered once under its name', () => {
    expect(DS_UNDO_HOOK).toBe('ds');
  });
});
