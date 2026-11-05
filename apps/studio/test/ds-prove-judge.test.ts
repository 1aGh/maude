// The Bring-up visual gate's pure half (bin/_ds-prove-judge.mjs) and the review it feeds:
//   - an artboard is shot by its OWN rect, isolated (nothing else can cover it) — the old shim
//     moved it to the viewport's top-left corner and shot that corner, where a neighbour could sit;
//   - a pair that differs with itself (before × before, the noise control) is not a failure, and a
//     change the control does not explain still is;
//   - a canvas the gate could not measure (a timeout) never blocks the system files, and its own
//     codemod is not applied unproved.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  clipOf,
  isolateArtboard,
  judge,
  restoreArtboard,
  SPECIMEN_ID,
  themesFor,
  viewportFor,
  withDeadline,
} from '../bin/_ds-prove-judge.mjs';
import type { UpgradePlan } from '../ds/upgrade.ts';
import { type RenderResult, reviewOf } from '../ds/upgrade-prove.ts';
import type { StageManifest } from '../ds/upgrade-stage.ts';

describe('the clip is the artboard’s own rect', () => {
  test('never the viewport corner', () => {
    expect(clipOf({ x: 312.4, y: 120, width: 240, height: 160.2 })).toEqual({
      x: 312,
      y: 120,
      width: 241,
      height: 161,
    });
    expect(clipOf({ x: 0, y: 0, width: 0, height: 10 })).toBeNull();
    expect(clipOf({ x: 0, y: 0, width: 9000, height: 10 }, 4000)?.width).toBe(4000);
    expect(
      viewportFor({ x: 10, y: 0, width: 1600, height: 200 }, { width: 1440, height: 900 })
    ).toEqual({ width: 1610, height: 900 });
  });
});

describe('isolation (happy-dom)', () => {
  beforeAll(() => GlobalRegistrator.register());
  afterAll(() => GlobalRegistrator.unregister());

  const page = () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.innerHTML = `
      <div id="canvas-root"><div class="dc-world">
        <section id="s1"><h3 id="label-a">A</h3>
          <div data-dc-screen="a" id="a" style="position:absolute;left:100px;top:40px">
            <div class="ds" data-theme="light" id="a-wrap"><span id="a-child">a</span></div>
          </div>
          <div data-dc-screen="b" id="b" style="position:absolute;left:100px;top:40px">cover</div>
        </section>
        <section id="s2"><div data-dc-screen="c" id="c">plain</div></section>
        <div id="overlay" style="position:fixed">chrome</div>
      </div></div>
      <pre id="canvas-mount-error"></pre>`;
  };
  const vis = (id: string) => (document.getElementById(id) as HTMLElement).style.visibility;
  const arg = (id: string, theme: string | null, htmlTheme: string | null = null) => ({
    id,
    theme,
    htmlTheme,
    specimenId: SPECIMEN_ID,
  });

  test('everything but the artboard, its ancestors and its own content is hidden; restore undoes it', () => {
    page();
    expect(isolateArtboard(arg('a', 'dark'))).not.toBeNull();
    for (const id of ['b', 'label-a', 's2', 'overlay', 'canvas-mount-error'])
      expect(vis(id)).toBe('hidden');
    for (const id of ['a', 'a-wrap', 'a-child', 's1', 'canvas-root']) expect(vis(id)).toBe('');
    expect(document.getElementById('a-wrap')?.getAttribute('data-theme')).toBe('dark');
    // idempotent: a second call (the stability loop) saves nothing twice
    isolateArtboard(arg('a', 'dark'));
    restoreArtboard({ id: 'a' });
    for (const id of ['b', 'label-a', 's2', 'overlay']) expect(vis(id)).toBe('');
    expect(document.getElementById('a-wrap')?.getAttribute('data-theme')).toBe('light');
    expect((document.getElementById('a') as HTMLElement).style.left).toBe('100px');
  });

  test('an artboard with no theme of its own takes the system theme on <html>', () => {
    page();
    isolateArtboard(arg('c', 'dark', 'dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    restoreArtboard({ id: 'c' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  test('a specimen (no artboard) is its canvas mount', () => {
    document.body.innerHTML = `<div id="canvas-root"><div id="spec">logo</div></div><div id="x">x</div>`;
    expect(isolateArtboard(arg(SPECIMEN_ID, null))).not.toBeNull();
    expect(vis('x')).toBe('hidden');
    expect(vis('spec')).toBe('');
    restoreArtboard({ id: SPECIMEN_ID });
    expect(isolateArtboard(arg('nope', null))).toBeNull();
  });

  test('themes: the artboard’s own, else the system’s on <html>, else one plain render', () => {
    expect(themesFor(['light'], ['light', 'dark'])).toEqual([{ theme: 'light', htmlTheme: null }]);
    expect(themesFor([], ['light', 'dark'])).toEqual([
      { theme: 'light', htmlTheme: 'light' },
      { theme: 'dark', htmlTheme: 'dark' },
    ]);
    expect(themesFor([], [])).toEqual([{ theme: null, htmlTheme: null }]);
  });
});

describe('the noise control', () => {
  const R = 0.005;
  const area = 10_000;
  const clean = { sized: true, changed: 0, area };
  const dirty = (changed: number, sized = true) => ({ sized, changed, area });

  test('a clean pair passes without a control', () => {
    expect(judge({ ab: clean, ac: null, bc: null }, R)).toEqual({ fail: false, noise: false });
  });
  test('a failing pair with no control (it could not render) still fails', () => {
    expect(judge({ ab: dirty(500), ac: null, bc: null }, R).fail).toBe(true);
  });
  test('before × before is clean: the change is real', () => {
    expect(judge({ ab: dirty(500), ac: clean, bc: dirty(500) }, R)).toEqual({
      fail: true,
      noise: false,
    });
  });
  test('before × before differs the same way: noise, never a failure', () => {
    // the deterministic dark-theme size mismatch: before and after both differ from a 2nd before alike
    expect(judge({ ab: dirty(0, false), ac: dirty(0, false), bc: clean }, R)).toEqual({
      fail: false,
      noise: true,
    });
    expect(judge({ ab: dirty(300), ac: dirty(300), bc: dirty(310) }, R)).toEqual({
      fail: false,
      noise: true,
    });
  });
  test('a regression larger than the noise still fails', () => {
    expect(judge({ ab: dirty(3000), ac: dirty(100), bc: dirty(3000) }, R).fail).toBe(true);
  });
});

describe('a hard deadline', () => {
  test('a call that never answers gives up on time', async () => {
    const t = Date.now();
    expect(await withDeadline(() => new Promise(() => {}), 50)).toEqual({ ok: false });
    expect(Date.now() - t).toBeLessThan(1000);
    expect(await withDeadline(async () => 7, 1000)).toEqual({ ok: true, value: 7 });
  });
});

describe('the review: noise and timeouts never block; a real regression does', () => {
  const stage = {
    system: 'fx',
    stamp: '1',
    canvases: [
      { path: 'ui/Mod.tsx', edits: { alias: 1 }, files: ['ui/Mod.tsx'] },
      { path: 'ui/Mod2.tsx', edits: { alias: 1 }, files: ['ui/Mod2.tsx'] },
    ],
    refused: [],
  } as unknown as StageManifest;
  const plan = { items: [] } as unknown as UpgradePlan;
  const ok = { id: 'a', theme: 'light', changed: 0, area: 1, fail: false };
  const review = (canvases: RenderResult['canvases']) =>
    reviewOf(stage, plan, { canvases }, 0).review;

  test('a timed-out canvas without a codemod blocks nothing; one with a codemod stays as it is', () => {
    const r = review([
      { path: 'ui/Plain.tsx', error: 'timeout', artboards: [] },
      { path: 'ui/Mod.tsx', error: 'timeout', artboards: [] },
      { path: 'ui/Mod2.tsx', artboards: [ok] },
    ]);
    expect(r.systemFailed).toBe(false);
    expect(r.unmeasured).toEqual([
      { path: 'ui/Plain.tsx', reason: 'timeout' },
      { path: 'ui/Mod.tsx', reason: 'timeout' },
    ]);
    expect(r.refused).toEqual([{ path: 'ui/Mod.tsx', reason: 'timeout' }]);
    expect(r.updatesCanvases).toEqual([
      { path: 'ui/Mod.tsx', edits: 1, diff: 'fail' },
      { path: 'ui/Mod2.tsx', edits: 1, diff: 'pass' },
    ]);
  });

  test('a codemod is never applied unproved (its before did not render)', () => {
    const r = review([{ path: 'ui/Mod.tsx', error: 'before', artboards: [] }]);
    expect(r.refused).toEqual([{ path: 'ui/Mod.tsx', reason: 'unmeasured' }]);
    expect(r.systemFailed).toBe(false);
  });

  test('noise the control explained away is not a failure; a real one still refuses the apply', () => {
    const noisy = { ...ok, changed: 400, area: 1000, fail: false, noise: true, reason: 'size' };
    expect(review([{ path: 'ui/Plain.tsx', artboards: [noisy] }]).systemFailed).toBe(false);
    const real = { ...ok, changed: 400, area: 1000, fail: true };
    expect(review([{ path: 'ui/Plain.tsx', artboards: [real] }]).systemFailed).toBe(true);
    expect(review([{ path: 'ui/Plain.tsx', error: 'after', artboards: [] }]).systemFailed).toBe(
      true
    );
  });
});
