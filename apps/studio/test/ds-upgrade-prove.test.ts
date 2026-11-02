// S10.15a — the Bring-up visual gate for real (V2-1.13 §5.10 step 6): two headless studios
// (`NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`) on the staged before/ and after/ copies of a scratch project,
// every artboard rendered through each studio's capture origin and diffed in the page (OKLab ΔE).
// Headless lane: boots studios + Chromium. Never this repo's `.design`; every studio is killed.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proveStage } from '../ds/upgrade-prove.ts';
import { discardStage, stageUpgrade } from '../ds/upgrade-stage.ts';
import { FX, fxProject } from './_ds-upgrade-fixture.ts';

const root = mkdtempSync(join(tmpdir(), 'maude-ds-prove-test-'));
const stamps: string[] = [];
let designRoot = '';
afterAll(() => {
  for (const s of stamps) discardStage(designRoot, FX.name, s);
  rmSync(root, { recursive: true, force: true });
});

describe('ds-upgrade --prove (S10.15a, headless)', () => {
  test('one passing and one failing codemod: the failing one is refused, the rest applies; a system pixel change refuses everything', async () => {
    designRoot = await fxProject(root);
    // a planted codemod bug: the alias rewritten to the WRONG v1 name in Bad's staged copy
    const one = stageUpgrade({ designRoot, ds: FX.name, judged: [] });
    stamps.push(one.stage.stamp);
    const bad = join(one.stage.dir, 'after', '.design', 'ui', 'Bad.tsx');
    writeFileSync(bad, readFileSync(bad, 'utf8').replace('var(--accent-soft)', 'var(--fg-0)'));
    const r1 = await proveStage(designRoot, FX.name, one.stage.stamp);
    expect(r1.systemFailed).toBe(false);
    const diff = (path: string) => r1.updatesCanvases.find((c) => c.path === path)?.diff;
    expect(diff('ui/Good.tsx')).toBe('pass');
    expect(diff('ui/Bad.tsx')).toBe('fail');
    expect(r1.refused).toEqual([{ path: 'ui/Bad.tsx', reason: 'visual' }]);
    const d1 = JSON.parse(
      readFileSync(
        join(designRoot, '_state', 'ds-upgrade', FX.name, one.stage.stamp, 'diff.json'),
        'utf8'
      )
    );
    // every canvas and specimen of the system rendered, the spec and left-out canvases included
    expect(d1.canvases.map((c: { path: string }) => c.path).sort()).toEqual([
      'system/fx/preview/logo.tsx',
      'ui/Bad.tsx',
      'ui/Good.tsx',
      'ui/Left.tsx',
      'ui/Plain.tsx',
      'ui/v2/Spec.tsx',
    ]);
    const good = d1.canvases.find((c: { path: string }) => c.path === 'ui/Good.tsx');
    expect(good.artboards.length).toBeGreaterThan(0);
    expect(good.artboards.every((a: { changed: number }) => a.changed === 0)).toBe(true);

    // a planted system-value change: visible on canvases with no codemod → the whole apply
    const two = stageUpgrade({ designRoot, ds: FX.name, judged: [] });
    stamps.push(two.stage.stamp);
    const css = join(two.stage.dir, 'after', '.design', FX.tokensCssRel);
    writeFileSync(
      css,
      readFileSync(css, 'utf8').replace(/--bg-1: [^;]*;/g, '--bg-1: oklch(0.5 0.2 30);')
    );
    const r2 = await proveStage(designRoot, FX.name, two.stage.stamp);
    expect(r2.systemFailed).toBe(true);
  }, 240_000);
});
