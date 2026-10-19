import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 14 Editing — the Pen (S2.14, ed-pen): P and three clicks draw a path (the second press drags, so it is smooth), ↵
 * finishes it as ONE plain `<svg data-shape="path">`; a double-click on it shows its points, a double-click on a point
 * flips smooth and sharp (one more write), ⌫ removes a point. WRITTEN, NOT RUN in the S2.14 hand-back (the lead runs
 * the desktop lane).
 *
 * Driving model: same as edit-shapes.e2e.ts — MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas iframe is same-origin and
 * pointer events are dispatched synthetically inside it, on the overlay `[data-testid="edit-pen-input"]` the armed
 * Pen puts over the canvas and on the point handles. The scenario writes through to disk, so the fixture is
 * snapshotted and restored byte-exact by the fixture guard.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('edit-pen', [SMOKE]);
const ARTBOARD = 'smoke';
const OVERLAY = '[data-testid="edit-pen-input"]';

/** Run `fn` inside the canvas frame with its window; coordinates are frame-local. */
function inFrame<T>(fn: string, ...args: unknown[]): Promise<T> {
  return browser.execute(
    (src, a) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;
      if (!doc || !win) return null as never;
      // biome-ignore lint/security/noGlobalEval: test-only DOM probe inside the canvas frame
      return new (win as unknown as { Function: FunctionConstructor }).Function(
        'doc',
        'win',
        'args',
        src
      )(doc, win, a);
    },
    fn,
    args
  ) as Promise<T>;
}

const fire = (type: string, x: number, y: number, target: string, mods = '{}') =>
  inFrame<boolean>(
    `const t = args[3] === 'window' ? win : doc.querySelector(args[3]);
     if (!t) return false;
     t.dispatchEvent(new win.MouseEvent(args[0], { bubbles: true, cancelable: true, clientX: args[1], clientY: args[2], button: 0, ...JSON.parse(args[4]) }));
     return true;`,
    type,
    x,
    y,
    target,
    mods
  );

const key = (k: string) =>
  inFrame<boolean>(
    `doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: args[0], bubbles: true, cancelable: true })); return true;`,
    k
  );

const body = () =>
  inFrame<{ x: number; y: number; w: number; h: number; zoom: number }>(
    `const b = doc.querySelector('[data-dc-screen="' + args[0] + '"] .dc-artboard-body');
     const r = b.getBoundingClientRect();
     return { x: r.left, y: r.top, w: r.width, h: r.height, zoom: r.width / b.offsetWidth };`,
    ARTBOARD
  );

const pathD = () => /<path d="([^"]+)"/.exec(readFileSync(SMOKE, 'utf8'))?.[1] ?? null;

describe('edit-pen — draw a path, edit its points', () => {
  before(() => {
    rmSync(join(HERE, '../fixtures/project/.design/_canvas-state'), {
      recursive: true,
      force: true,
    });
    fixtures.snapshot();
    startReport('edit-pen');
  });
  after(() => fixtures.restore());

  it('P arms the Pen; click, click-drag, click and ↵ write one plain svg path', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await inFrame(`doc.querySelector('[data-testid="toolbar-slot-el-pen"]').click(); return true;`);
    await browser.waitUntil(
      async () => await inFrame<boolean>(`return !!doc.querySelector('${OVERLAY}');`),
      { timeout: 15_000, timeoutMsg: 'the pen overlay never appeared' }
    );
    const b = await body();
    const at = (x: number, y: number) => ({ x: b.x + x * b.zoom, y: b.y + y * b.zoom });
    const p1 = at(60, 200);
    const p2 = at(180, 100);
    const p3 = at(300, 200);
    await fire('pointerdown', p1.x, p1.y, OVERLAY);
    await fire('pointerup', p1.x, p1.y, OVERLAY);
    // a drag past the threshold pulls handles: a smooth point
    await fire('pointerdown', p2.x, p2.y, OVERLAY);
    await fire('pointermove', p2.x + 40 * b.zoom, p2.y, OVERLAY);
    await fire('pointerup', p2.x + 40 * b.zoom, p2.y, OVERLAY);
    await fire('pointermove', p3.x, p3.y, OVERLAY);
    await capture('pen-rubber-band');
    await fire('pointerdown', p3.x, p3.y, OVERLAY);
    await fire('pointerup', p3.x, p3.y, OVERLAY);
    await key('Enter');
    await browser.waitUntil(() => /data-shape="path"/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the path never reached the file',
    });
    const src = readFileSync(SMOKE, 'utf8');
    expect(src).toMatch(/data-cd-id="path"/);
    expect(src).toMatch(/stroke: "var\(--accent\)"/);
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(pathD()).toMatch(/^M[\d. -]+C[\d. -]+/);
  });

  it('double-click shows the points; double-click a point flips it; ⌫ removes one', async () => {
    const before = pathD();
    const centre = await inFrame<{ x: number; y: number }>(
      `const r = doc.querySelector('svg[data-shape="path"] path').getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`
    );
    await fire('dblclick', centre.x, centre.y, 'svg[data-shape="path"] path');
    await browser.waitUntil(
      async () =>
        await inFrame<boolean>(`return !!doc.querySelector('[data-testid="edit-pen-points"]');`),
      { timeout: 15_000, timeoutMsg: 'point editing never opened' }
    );
    await capture('pen-points-and-handles');
    const point = await inFrame<{ x: number; y: number }>(
      `const r = doc.querySelector('[data-testid="edit-pen-point-0-1"]').getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`
    );
    await fire('dblclick', point.x, point.y, '[data-testid="edit-pen-point-0-1"]');
    await browser.waitUntil(() => pathD() !== before, {
      timeout: 15_000,
      timeoutMsg: 'the smooth/sharp flip never reached the file',
    });
    const chip = await inFrame<string | null>(
      `return doc.querySelector('[data-testid="edit-pen-chip-type"]')?.textContent ?? null;`
    );
    expect(chip).toMatch(/^(Smooth|Sharp)$/);
    const flipped = pathD();
    await key('Backspace');
    await browser.waitUntil(() => pathD() !== flipped, {
      timeout: 15_000,
      timeoutMsg: 'removing the point never reached the file',
    });
    await key('Enter');
    expect(
      await inFrame<boolean>(`return !doc.querySelector('[data-testid="edit-pen-points"]');`)
    ).toBe(true);
  });
});
