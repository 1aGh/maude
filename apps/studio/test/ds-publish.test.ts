// S10.2 (V2-1.6 §5.11 c): "Update N canvases" is ONE action. An unticked follower keeps the old
// head (`dsRev`), a ticked canvas follows (its `dsRev` and `data-ds-rev="head"` go), head = base =
// R, the pending entries go — and the three 409 preconditions refuse with nothing written.
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { DsEngineError, type DsKernelPort } from '../ds/engine.ts';
import {
  ACCENT,
  cleanup,
  DS,
  DS_PATH,
  makeProject,
  PERSON,
  TOKENS_CSS,
} from './_ds-engine-fixture.ts';

afterAll(cleanup);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof DsEngineError ? { code: err.code, status: err.status } : String(err);
  }
};
const revisions = (dsAbs: string) => readdirSync(path.join(dsAbs, 'revisions')).sort();

describe('ds publish', () => {
  test('one canvas unticked → dsRev = old head; ticked → follows; head = base = R; one action', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    expect(
      Object.keys((p.meta(`${DS_PATH}/design-system.tsx`).dsPending as { tokens: object }).tokens)
    ).toEqual(['--accent']);
    const review = p.engine.review(DS);
    expect(review.expectHead).toBe(p.R0);
    expect(review.changes.map((c) => c.css)).toEqual(['--accent']);
    expect(review.canvases.map((c) => [c.path, c.state, c.ticked])).toEqual([
      ['ui/Home.tsx', 'follows', true],
      ['ui/Landing.tsx', 'follows', true],
      ['ui/Pricing.tsx', 'follows', true],
    ]);
    const before = (await p.home.runtime.acceptedHistory({ limit: 200 })).length;
    const r = await p.engine.publish(DS, {
      expectHead: p.R0,
      canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
      by: PERSON,
    });
    expect(r).toMatchObject({ action: 'publish', updated: 2, leftOut: 1 });
    expect(r.rev).toMatch(/^[0-9a-f]{64}$/);
    expect(r.actionId).toBeTruthy();
    // the canvas left out keeps the old head; the followers carry nothing
    expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
    expect(p.meta('ui/Home.tsx').dsRev).toBeUndefined();
    // head = base = R, logged with the kernel action's id
    const h = p.head();
    expect([h.head, h.base]).toEqual([r.rev, r.rev]);
    expect(h.log[0]).toMatchObject({
      rev: r.rev,
      parent: p.R0,
      action: 'publish',
      actionId: r.actionId,
      updated: 2,
      leftOut: 1,
      by: PERSON,
      was: { head: p.R0, base: p.R0 },
      is: { head: r.rev, base: r.rev },
    });
    // the working files are R's; R and its siblings exist
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toContain('--accent: oklch(0.5 0.19 255);');
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toContain('--accent: oklch(0.6 0.175 255);');
    expect(p.read(`${DS_PATH}/revisions/${r.rev}.tokens.css`)).toBe(
      p.read(`${DS_PATH}/colors_and_type.css`)
    );
    expect(existsSync(path.join(p.dsAbs, 'revisions', `${r.rev}.components.css`))).toBe(true);
    expect(
      JSON.parse(p.read(`${DS_PATH}/tokens.json`) as string).$extensions['sh.maude'].source
    ).toBe('canvas');
    // the pending entries went with it, and the whole Plane-A half is ONE kernel action
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
    const rows = await p.home.runtime.acceptedHistory({ limit: 200 });
    expect(rows.length).toBe(before + 1);
    expect(rows[0]).toMatchObject({ actionId: r.actionId, kind: 'edit', mine: true });
    expect(rows[0].canvases).toEqual([`${DS_PATH}/design-system.tsx`, 'ui/Landing.tsx']);
    // the review now lists Landing as left out, unticked by default
    expect(p.engine.state(DS).leftOut).toEqual({ count: 1, canvases: ['ui/Landing.tsx'] });
  });

  test('a ticked canvas that had a dsRev follows: dsRev deleted, data-ds-rev="head" stripped', async () => {
    const p = await makeProject();
    await p.engine.canvasLeave('ui/Pricing.tsx', { by: PERSON });
    expect(p.meta('ui/Pricing.tsx').dsRev).toBe(p.R0);
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.4 0.1 200)', 'oklch(0.7 0.1 200)'),
      by: PERSON,
    });
    expect(p.engine.review(DS).canvases.find((c) => c.path === 'ui/Pricing.tsx')).toMatchObject({
      state: 'left-out',
      ticked: false,
    });
    const r = await p.engine.publish(DS, {
      expectHead: p.R0,
      canvases: [{ path: 'ui/Pricing.tsx', ticked: true }],
      by: PERSON,
    });
    expect(r).toMatchObject({ updated: 3, leftOut: 0 });
    expect(p.meta('ui/Pricing.tsx').dsRev).toBeUndefined();
    expect(p.read('ui/Pricing.tsx')).not.toContain('data-ds-rev');
    expect(p.read('ui/Home.tsx')).toContain('className="btn"');
  });

  test('the three 409 preconditions refuse and write nothing', async () => {
    const p = await makeProject();
    await p.engine.mergePending(DS, {
      tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
      by: PERSON,
    });
    const files0 = revisions(p.dsAbs);
    const head0 = p.read(`${DS_PATH}/revisions/head.json`);
    // 1. expectHead != head
    expect(await code(p.engine.publish(DS, { expectHead: 'f'.repeat(64), by: PERSON }))).toEqual({
      code: 'ds-head-moved',
      status: 409,
    });
    // 2. an outside change waits for review
    await p.outside(
      `${DS_PATH}/colors_and_type.css`,
      TOKENS_CSS.replace('--fg-0: #111111', '--fg-0: #222222')
    );
    expect(await code(p.engine.publish(DS, { expectHead: p.R0, by: PERSON }))).toEqual({
      code: 'ds-outside-unreviewed',
      status: 409,
    });
    // 3. the outside change touches a pending token with another value → a conflict
    await p.outside(
      `${DS_PATH}/colors_and_type.css`,
      TOKENS_CSS.replace('oklch(0.55 0.2 255)', 'oklch(0.3 0.1 100)')
    );
    expect(await code(p.engine.publish(DS, { expectHead: p.R0, by: PERSON }))).toEqual({
      code: 'ds-conflict',
      status: 409,
    });
    expect(revisions(p.dsAbs)).toEqual(files0);
    expect(p.read(`${DS_PATH}/revisions/head.json`)).toBe(head0);
    expect(p.meta('ui/Home.tsx').dsRev).toBeUndefined();
  });

  test('a refused kernel proposal leaves the working files and head.json as they were', async () => {
    const refuse: DsKernelPort = {
      propose: async () => ({ status: 'rejected', code: 'store-locked' }),
    };
    const p = await makeProject({ kernel: refuse });
    // pending written straight into the DS meta (the refusing port would refuse mergePending too)
    p.write(
      `${DS_PATH}/design-system.meta.json`,
      `${JSON.stringify({ title: 'Design system', dsPending: { tokens: { '--accent': { light: 'oklch(0.5 0.19 255)' } } } }, null, 2)}\n`
    );
    const head0 = p.read(`${DS_PATH}/revisions/head.json`);
    expect(await code(p.engine.publish(DS, { expectHead: p.R0, by: PERSON }))).toEqual({
      code: 'ds-kernel-rejected',
      status: 409,
    });
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(TOKENS_CSS);
    expect(p.read(`${DS_PATH}/revisions/head.json`)).toBe(head0);
    expect(p.engine.state(DS).outside).toBeNull();
  });

  test('no home answering → refused, never written behind the log', async () => {
    const p = await makeProject({ kernel: null });
    expect(
      await code(p.engine.mergePending(DS, { tokens: ACCENT('red', 'blue'), by: PERSON }))
    ).toEqual({
      code: 'ds-kernel-unavailable',
      status: 503,
    });
    expect(p.meta(`${DS_PATH}/design-system.tsx`).dsPending).toBeUndefined();
  });

  test('a linked project with no home answering refuses Publish up front, before the lock and any write (v2-lead-ds-publish-offline-refuses)', async () => {
    const p = await makeProject({ kernel: null });
    p.write(
      `${DS_PATH}/design-system.meta.json`,
      `${JSON.stringify({ title: 'Design system', dsPending: { tokens: { '--accent': { light: 'oklch(0.5 0.19 255)' } } } }, null, 2)}\n`
    );
    const head0 = p.read(`${DS_PATH}/revisions/head.json`);
    const revs0 = revisions(p.dsAbs);
    let held: unknown = null;
    try {
      await p.engine.publish(DS, { expectHead: p.R0, by: PERSON });
    } catch (err) {
      held = err;
    }
    expect(held).toBeInstanceOf(DsEngineError);
    expect((held as DsEngineError).code).toBe('ds-kernel-unavailable');
    expect((held as DsEngineError).status).toBe(503);
    expect((held as DsEngineError).message).toBe(
      "No project home answers right now — publish when you're back online."
    );
    // nothing was written, not even a revision folder the refusal would have to take back
    expect(revisions(p.dsAbs)).toEqual(revs0);
    expect(p.read(`${DS_PATH}/revisions/head.json`)).toBe(head0);
    expect(p.read(`${DS_PATH}/colors_and_type.css`)).toBe(TOKENS_CSS);
  });

  test('nothing waiting → 409; an unconverted system → 409 ds-not-converted', async () => {
    const p = await makeProject();
    expect(await code(p.engine.publish(DS, { expectHead: p.R0, by: PERSON }))).toEqual({
      code: 'ds-nothing-waiting',
      status: 409,
    });
    const { rmSync } = await import('node:fs');
    rmSync(path.join(p.dsAbs, 'revisions', 'head.json'));
    expect(await code(p.engine.publish(DS, { expectHead: p.R0, by: PERSON }))).toEqual({
      code: 'ds-not-converted',
      status: 409,
    });
    expect(p.engine.state(DS).converted).toBe(false);
  });

  test('S12.16 (S10): the folder-system refusal names the token file to edit and the emit verb', async () => {
    const p = await makeProject();
    const { rmSync } = await import('node:fs');
    rmSync(path.join(p.dsAbs, 'revisions', 'head.json'));
    let msg = '';
    try {
      await p.engine.mergePending(DS, {
        tokens: ACCENT('oklch(0.47 0.19 255)', 'oklch(0.6 0.175 255)'),
        by: PERSON,
      });
    } catch (err) {
      msg = err instanceof DsEngineError ? `${err.code}: ${err.message}` : String(err);
    }
    expect(msg.startsWith('ds-not-converted: ')).toBe(true);
    expect(msg).toContain(`${DS_PATH}/colors_and_type.css`);
    expect(msg).toContain(`maude design ds-check ${DS} --emit`);
    expect(msg).toContain('tokens.json');
  });
});
