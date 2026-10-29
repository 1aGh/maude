// p8-dead-reasons part 3 — "Keep this version" (`ds.canvas-leave`) on the design-system update card.
// Keep = this canvas stays on its current version, the card stays away for this update (also after a reload:
// it is the versioned `.meta.json` `dsKept`, so a peer sees it too), and Update still works later and moves the
// pin. A follower's Keep pins it where it is (the old `canvasLeave`).
import { afterAll, describe, expect, test } from 'bun:test';
import { leftOutOf } from '../client/v2/ds/update-model.js';
import { ACCENT, cleanup, DS, DS_PATH, makeProject, PERSON } from './_ds-engine-fixture.ts';

afterAll(cleanup);

async function leftOutProject() {
  const p = await makeProject();
  await p.engine.mergePending(DS, {
    tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)'),
    by: PERSON,
  });
  const r = await p.engine.publish(DS, {
    expectHead: p.R0,
    canvases: [{ path: 'ui/Landing.tsx', ticked: false }],
    by: PERSON,
  });
  return { p, head: r.rev as string };
}

describe('Keep this version', () => {
  test('a left-out canvas keeps its version: dsRev stays, dsKept = the head it declined', async () => {
    const { p, head } = await leftOutProject();
    expect(p.meta('ui/Landing.tsx').dsRev).toBe(p.R0);
    const r = await p.engine.canvasLeave('ui/Landing.tsx', { by: PERSON });
    expect(r.action).toBe('canvas-leave');
    expect(r.actionId).toBeTruthy();
    const m = p.meta('ui/Landing.tsx');
    expect(m.dsRev).toBe(p.R0); // NOT moved to head: it stays on its version
    expect(m.dsKept).toBe(head);
    // again: nothing to write
    expect((await p.engine.canvasLeave('ui/Landing.tsx', { by: PERSON })).actionId).toBeNull();
  });

  test('the card reads the kept update as quiet; a newer update brings it back', async () => {
    const { p, head } = await leftOutProject();
    const cfg = (kept: string | null) => ({
      designRel: '.design',
      designSystems: [{ name: DS, path: DS_PATH }],
      dsConverted: { [DS]: true },
      systemHeads: { [DS]: head },
      canvasDsRevs: { 'ui/Landing.tsx': p.R0 },
      ...(kept ? { canvasDsKept: { 'ui/Landing.tsx': kept } } : {}),
    });
    expect(leftOutOf('ui/Landing.tsx', cfg(null) as never)?.kept).toBeFalsy();
    expect(leftOutOf('ui/Landing.tsx', cfg(head) as never)?.kept).toBe(true);
    expect(leftOutOf('ui/Landing.tsx', cfg('b'.repeat(64)) as never)?.kept).toBeFalsy();
  });

  test('a later Update still works: it follows head and the keep goes with the pin', async () => {
    const { p } = await leftOutProject();
    await p.engine.canvasLeave('ui/Landing.tsx', { by: PERSON });
    const u = await p.engine.canvasUpdate('ui/Landing.tsx', { by: PERSON });
    expect(u.action).toBe('canvas-update');
    const m = p.meta('ui/Landing.tsx');
    expect(m.dsRev).toBeUndefined();
    expect(m.dsKept).toBeUndefined();
  });

  test('a follower’s Keep pins it at the head it shows (no dsKept)', async () => {
    const p = await makeProject();
    await p.engine.canvasLeave('ui/Pricing.tsx', { by: PERSON });
    const m = p.meta('ui/Pricing.tsx');
    expect(m.dsRev).toBe(p.R0);
    expect(m.dsKept).toBeUndefined();
  });
});
