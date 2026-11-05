// The visual gate's hard per-canvas deadline, for real: a canvas whose renderer never answers (here a
// render that loops forever, standing in for a heavy 3D scene at 99 % CPU) is reported `timeout`,
// the run goes on, every later canvas is still measured, and the timeout blocks nothing. Without
// the deadline the whole proof waited for hours, and killing it failed every canvas after it.
// Headless lane: two studios + Chromium on a scratch project; every studio is killed.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proveStage, renderWithShim } from '../ds/upgrade-prove.ts';
import { discardStage, stageUpgrade } from '../ds/upgrade-stage.ts';
import { artboard, FX, fxProject } from './_ds-upgrade-fixture.ts';

const root = mkdtempSync(join(tmpdir(), 'maude-ds-prove-timeout-'));
let designRoot = '';
let stamp = '';
afterAll(() => {
  if (stamp) discardStage(designRoot, FX.name, stamp);
  rmSync(root, { recursive: true, force: true });
});

const HANG = artboard('hang', '<Hang />').replace(
  'export default function Canvas',
  'function Hang() {\n  for (;;) {}\n  return null;\n}\n\nexport default function Canvas'
);

describe('ds-upgrade --prove: a canvas that never answers', () => {
  test('is reported timeout; the run goes on and the timeout blocks nothing', async () => {
    designRoot = await fxProject(root);
    // first in the job (sorted listing), so every other canvas comes after it on the same browser
    writeFileSync(join(designRoot, 'ui', 'AHang.tsx'), HANG);
    writeFileSync(
      join(designRoot, 'ui', 'AHang.meta.json'),
      `${JSON.stringify({ title: 'Hang', designSystem: FX.name })}\n`
    );
    const s = stageUpgrade({ designRoot, ds: FX.name, judged: [] });
    stamp = s.stage.stamp;
    const t0 = Date.now();
    const review = await proveStage(designRoot, FX.name, stamp, {
      render: (job, o) => renderWithShim({ ...job, canvasTimeout: 15_000, workers: 1 } as never, o),
    });
    expect(Date.now() - t0).toBeLessThan(150_000);
    const diff = JSON.parse(
      readFileSync(join(designRoot, '_state', 'ds-upgrade', FX.name, stamp, 'diff.json'), 'utf8')
    );
    const row = (p: string) => diff.canvases.find((c: { path: string }) => c.path === p);
    expect(row('ui/AHang.tsx').error).toBe('timeout');
    for (const p of ['ui/Good.tsx', 'ui/Plain.tsx', 'ui/Bad.tsx']) {
      expect(row(p).error).toBeUndefined();
      expect(row(p).artboards.length).toBeGreaterThan(0);
    }
    expect(review.systemFailed).toBe(false);
    expect(review.unmeasured).toEqual([{ path: 'ui/AHang.tsx', reason: 'timeout' }]);
    expect(review.updatesCanvases.find((c) => c.path === 'ui/Good.tsx')?.diff).toBe('pass');
  }, 240_000);
});
